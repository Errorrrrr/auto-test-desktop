import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentProvider } from '../adapters/agent/AgentProvider';
import type {
  MaestroProvider,
  MaestroRunFlowRequest,
  MaestroRunFlowResult
} from '../adapters/maestro/MaestroProvider';
import { AppDataStorage } from '../storage/AppDataStorage';
import type { DeviceInfo, DeviceStartResult, ServiceHealth, TestRunStatus } from '../../shared/types';
import { AgentSessionService } from './AgentSessionService';
import { DeviceService } from './DeviceService';
import { ReportService } from './ReportService';
import { TaskService } from './TaskService';
import { TestCaseService } from './TestCaseService';
import { TestRunService } from './TestRunService';

const tempRoots: string[] = [];

const connectedDevice: DeviceInfo = {
  id: 'android-connected',
  name: 'Pixel 8',
  platform: 'android',
  type: 'emulator',
  connected: true
};

const readyHealth: ServiceHealth = {
  status: 'ready',
  label: 'Ready',
  detail: 'Ready for task execution.'
};

const disabledAgentProvider: AgentProvider = {
  async health() {
    return {
      status: 'not_configured',
      label: 'Agent executor',
      detail: 'Agent executor is not configured.'
    };
  },
  async createSession() {
    return {
      id: 'session-disabled',
      createdAt: '2026-06-24T04:00:00Z',
      status: 'unavailable'
    };
  },
  async sendMessage(request) {
    return {
      id: 'message-disabled',
      sessionId: request.sessionId,
      role: 'assistant',
      content: 'Agent executor is not configured.',
      createdAt: '2026-06-24T04:00:00Z'
    };
  }
};

class TaskMaestroProvider implements MaestroProvider {
  readonly runFlowRequests: MaestroRunFlowRequest[] = [];
  private readonly runResult: MaestroRunFlowResult;

  constructor(runResult: MaestroRunFlowResult = { status: 'succeeded', stdout: 'task flow passed', stderr: '' }) {
    this.runResult = runResult;
  }

  async health(): Promise<ServiceHealth> {
    return readyHealth;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [connectedDevice];
  }

  async startDevice(): Promise<DeviceStartResult> {
    return {
      deviceId: connectedDevice.id,
      device: connectedDevice,
      status: 'already_running',
      detail: `${connectedDevice.name} is already connected.`
    };
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    this.runFlowRequests.push(request);
    return this.runResult;
  }
}

async function createTaskServices(): Promise<{
  provider: TaskMaestroProvider;
  rootDir: string;
  storage: AppDataStorage;
  tasks: TaskService;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-task-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));
  const provider = new TaskMaestroProvider();
  const agent = new AgentSessionService(disabledAgentProvider);
  const devices = new DeviceService({ provider });
  const cases = new TestCaseService({
    maxUploadSizeBytes: 1024 * 1024,
    storage
  });
  const runs = new TestRunService({
    agentService: agent,
    deviceService: devices,
    runStore: storage.getRunStore(),
    runTimeoutMs: 1_500,
    testCaseStore: storage.getTestCaseStore()
  });
  const reports = new ReportService({
    storage,
    testRunService: runs
  });

  tempRoots.push(rootDir);

  return {
    provider,
    rootDir,
    storage,
    tasks: new TaskService({
      reports,
      runService: runs,
      storage,
      testCaseService: cases
    })
  };
}

async function waitForTaskStatus(
  tasks: TaskService,
  taskId: string,
  statuses: TestRunStatus[]
): Promise<Awaited<ReturnType<TaskService['get']>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const task = await tasks.get({ taskId });

    if (statuses.includes(task.status as TestRunStatus)) {
      return task;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error(`Task ${taskId} did not reach ${statuses.join(', ')}.`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('TaskService', () => {
  it('imports YAML cases into the task workspace and keeps the task ready', async () => {
    const { rootDir, tasks } = await createTaskServices();
    const sourcePath = join(rootDir, 'smoke.yaml');
    const task = await tasks.create({ name: 'Smoke task' });

    await writeFile(sourcePath, 'appId: com.example.app\n---\n- launchApp\n', 'utf8');

    const updatedTask = await tasks.importCase({
      taskId: task.id,
      sourcePath,
      displayName: 'Smoke flow'
    });

    expect(updatedTask).toMatchObject({
      id: task.id,
      status: 'ready',
      input: {
        mode: 'test_case',
        blockers: [],
        testCase: {
          name: 'Smoke flow',
          format: 'yaml',
          source: 'uploaded'
        }
      }
    });
    expect(updatedTask.input.testCase?.storedPath).toContain(`/tasks/${task.id}/uploads/`);
    await expect(readFile(updatedTask.input.testCase?.storedPath ?? '', 'utf8')).resolves.toContain(
      'launchApp'
    );
  });

  it('runs upload-only tasks without requiring an Agent executor', async () => {
    const { provider, rootDir, tasks } = await createTaskServices();
    const sourcePath = join(rootDir, 'smoke.yaml');
    const task = await tasks.create({ name: 'Upload only' });

    await writeFile(sourcePath, 'appId: com.example.app\n- launchApp\n', 'utf8');
    const readyTask = await tasks.importCase({ taskId: task.id, sourcePath });
    const queuedTask = await tasks.start({
      taskId: readyTask.id,
      deviceId: connectedDevice.id
    });
    const completedTask = await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(queuedTask).toMatchObject({
      status: 'queued',
      latestRunId: expect.stringMatching(/^run-/),
      deviceId: connectedDevice.id
    });
    expect(provider.runFlowRequests[0]).toMatchObject({
      deviceId: connectedDevice.id,
      flowPath: readyTask.input.testCase?.storedPath,
      timeoutMs: 1_500
    });
    expect(completedTask).toMatchObject({
      status: 'succeeded',
      latestRunId: queuedTask.latestRunId
    });
  });

  it('blocks natural-language-only execution until an Agent task executor is configured', async () => {
    const { tasks } = await createTaskServices();
    const task = await tasks.create({ name: 'Prompt task' });
    const readyTask = await tasks.updateInput({
      taskId: task.id,
      prompt: 'Generate a login smoke flow'
    });

    expect(readyTask.input.mode).toBe('natural_language');

    const blockedTask = await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });

    expect(blockedTask).toMatchObject({
      status: 'blocked',
      failureReason: expect.stringContaining('AGENT_EXECUTOR_NOT_CONFIGURED')
    });
    expect(blockedTask.latestRunId).toBeUndefined();
  });

  it('exports task reports into the task reports workspace', async () => {
    const { rootDir, tasks } = await createTaskServices();
    const sourcePath = join(rootDir, 'smoke.yaml');
    const task = await tasks.create({ name: 'Report task' });

    await writeFile(sourcePath, 'appId: com.example.app\n- launchApp\n', 'utf8');
    const readyTask = await tasks.importCase({ taskId: task.id, sourcePath, displayName: 'Smoke flow' });
    await tasks.start({ taskId: readyTask.id, deviceId: connectedDevice.id });
    const completedTask = await waitForTaskStatus(tasks, task.id, ['succeeded']);
    const report = await tasks.exportReport({
      taskId: completedTask.id,
      format: 'markdown'
    });

    expect(report).toMatchObject({
      taskId: task.id,
      runId: completedTask.latestRunId,
      status: 'succeeded',
      conclusion: 'Succeeded',
      inputMode: 'test_case',
      inputSummary: expect.stringContaining('Smoke flow'),
      targetDevice: expect.stringContaining('Pixel 8'),
      filePath: expect.stringContaining(`/tasks/${task.id}/reports/`)
    });
    const markdown = await readFile(report.filePath ?? '', 'utf8');

    expect(markdown).toContain(`# Task report for Report task`);
    expect(markdown).toContain(`- Task: ${task.id}`);
    expect(markdown).toContain(`- Run: ${completedTask.latestRunId}`);
    expect(markdown).toContain('- Input mode: test_case');
    expect(markdown).toContain('- Conclusion: Succeeded');
  });
});
