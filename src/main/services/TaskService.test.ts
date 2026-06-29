import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentProvider,
  AgentTestExecutionRequest,
  AgentTestExecutionResult
} from '../adapters/agent/AgentProvider';
import type {
  MaestroProvider,
  MaestroRunFlowRequest,
  MaestroRunFlowResult
} from '../adapters/maestro/MaestroProvider';
import { AppDataStorage } from '../storage/AppDataStorage';
import type {
  DeviceInfo,
  DeviceStartResult,
  DeviceStopResult,
  ServiceHealth,
  TestRunStatus
} from '../../shared/types';
import { AgentModelSettingsService } from './AgentModelSettingsService';
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

class TaskAgentProvider implements AgentProvider {
  readonly runTestRequests: AgentTestExecutionRequest[] = [];

  async health(): Promise<ServiceHealth> {
    return readyHealth;
  }

  async createSession() {
    return {
      id: 'session-test',
      createdAt: '2026-06-24T04:00:00Z',
      status: 'available' as const
    };
  }

  async sendMessage(request: { sessionId: string }) {
    return {
      id: 'message-test',
      sessionId: request.sessionId,
      role: 'assistant' as const,
      content: 'Codex task executor is ready.',
      createdAt: '2026-06-24T04:00:00Z'
    };
  }

  async runTest(request: AgentTestExecutionRequest): Promise<AgentTestExecutionResult> {
    this.runTestRequests.push(request);

    return {
      status: 'succeeded',
      stdout: 'codex task passed',
      stderr: ''
    };
  }
}

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

  async stopDevice(): Promise<DeviceStopResult> {
    return {
      deviceId: connectedDevice.id,
      device: connectedDevice,
      status: 'not_stoppable',
      detail: `${connectedDevice.name} cannot be stopped by this test provider.`
    };
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    this.runFlowRequests.push(request);
    return this.runResult;
  }
}

async function createTaskServices(options: { naturalLanguageAppId?: string } = {}): Promise<{
  agentProvider: TaskAgentProvider;
  modelSettings: AgentModelSettingsService;
  provider: TaskMaestroProvider;
  rootDir: string;
  storage: AppDataStorage;
  tasks: TaskService;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-task-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));
  const provider = new TaskMaestroProvider();
  const agentProvider = new TaskAgentProvider();
  const modelSettings = new AgentModelSettingsService({ storage });
  const agent = new AgentSessionService(agentProvider, { modelSettings });
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
    agentProvider,
    modelSettings,
    provider,
    rootDir,
    storage,
    tasks: new TaskService({
      modelSettings,
      naturalLanguageAppId:
        'naturalLanguageAppId' in options ? options.naturalLanguageAppId : 'com.example.app',
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
  it('captures the effective Codex model when a task is created', async () => {
    const { tasks } = await createTaskServices();
    const task = await tasks.create({ name: 'Model task' });

    expect(task.modelSnapshot).toMatchObject({
      modelName: 'gpt-5',
      source: 'app_default'
    });
  });

  it('keeps an existing task model snapshot when global settings change later', async () => {
    const { agentProvider, modelSettings, tasks } = await createTaskServices();
    const task = await tasks.create({ name: 'Stable model task' });

    await modelSettings.saveModelSettings({
      modelName: 'gpt-5-mini',
      source: 'preset',
      presetId: 'gpt-5-mini'
    });
    await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录'
    });
    const queuedTask = await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });
    await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(queuedTask.modelSnapshot).toMatchObject({
      modelName: 'gpt-5',
      source: 'app_default'
    });
    expect(agentProvider.runTestRequests[0]?.modelSnapshot).toMatchObject({
      modelName: 'gpt-5',
      source: 'app_default'
    });
  });

  it('backfills a model snapshot before starting a legacy task', async () => {
    const { agentProvider, storage, tasks } = await createTaskServices();
    const task = await tasks.create({ name: 'Legacy task' });
    const legacyTask = { ...task };

    delete legacyTask.modelSnapshot;

    await storage.getTaskStore().upsert(legacyTask);
    await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录'
    });
    const queuedTask = await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });
    await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(queuedTask.modelSnapshot).toMatchObject({
      modelName: 'gpt-5',
      source: 'app_default'
    });
    expect(queuedTask.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'model_snapshot_captured'
        })
      ])
    );
    expect(agentProvider.runTestRequests[0]?.modelSnapshot).toMatchObject({
      modelName: 'gpt-5'
    });
  });

  it('lists the most recently updated task first after two task refresh records exist', async () => {
    const { storage, tasks } = await createTaskServices();
    const olderTask = await tasks.create({ name: 'Older task' });
    const latestTask = await tasks.create({ name: 'Latest task' });

    await storage.getTaskStore().upsert({
      ...olderTask,
      createdAt: '2026-06-25T03:00:00.000Z',
      updatedAt: '2026-06-25T03:05:00.000Z'
    });
    await storage.getTaskStore().upsert({
      ...latestTask,
      createdAt: '2026-06-25T03:10:00.000Z',
      updatedAt: '2026-06-25T03:15:00.000Z'
    });

    const [firstTask, secondTask] = await tasks.list();

    expect(firstTask?.id).toBe(latestTask.id);
    expect(secondTask?.id).toBe(olderTask.id);
  });

  it('deletes a draft task from the manifest and local task workspace', async () => {
    const { storage, tasks } = await createTaskServices();
    const deletedTask = await tasks.create({ name: 'Delete me' });
    const keptTask = await tasks.create({ name: 'Keep me' });

    await expect(readFile(storage.getTaskWorkspace(deletedTask.id).taskPath, 'utf8')).resolves.toContain(
      'Delete me'
    );

    await expect(tasks.delete({ taskId: deletedTask.id })).resolves.toMatchObject({
      id: deletedTask.id,
      name: 'Delete me'
    });

    await expect(tasks.list()).resolves.toEqual([
      expect.objectContaining({
        id: keptTask.id,
        name: 'Keep me'
      })
    ]);
    await expect(readFile(storage.getTaskWorkspace(deletedTask.id).taskPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('does not delete an active running task workspace', async () => {
    const { rootDir, tasks } = await createTaskServices();
    const sourcePath = join(rootDir, 'running.yaml');
    const task = await tasks.create({ name: 'Running task' });

    await writeFile(sourcePath, 'appId: com.example.app\n- launchApp\n', 'utf8');
    const readyTask = await tasks.importCase({ taskId: task.id, sourcePath });
    const queuedTask = await tasks.start({
      taskId: readyTask.id,
      deviceId: connectedDevice.id
    });

    await expect(tasks.delete({ taskId: queuedTask.id })).rejects.toMatchObject({
      code: 'TASK_DELETE_BLOCKED',
      message: expect.stringContaining('running')
    });
  });

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

  it('runs upload-only tasks through the Codex task executor', async () => {
    const { agentProvider, rootDir, tasks } = await createTaskServices();
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
    expect(agentProvider.runTestRequests[0]).toMatchObject({
      casePath: readyTask.input.testCase?.storedPath,
      device: expect.objectContaining({
        id: connectedDevice.id
      }),
      modelSnapshot: expect.objectContaining({
        modelName: 'gpt-5',
        source: 'app_default'
      }),
      timeoutMs: 1_500
    });
    expect(completedTask).toMatchObject({
      status: 'succeeded',
      latestRunId: queuedTask.latestRunId
    });
  });

  it('allows completed tasks to be retested and records each run in task logs', async () => {
    const { agentProvider, rootDir, tasks } = await createTaskServices();
    const sourcePath = join(rootDir, 'smoke.yaml');
    const task = await tasks.create({ name: 'Retest task' });

    await writeFile(sourcePath, 'appId: com.example.app\n- launchApp\n', 'utf8');
    const readyTask = await tasks.importCase({ taskId: task.id, sourcePath });
    const firstQueuedTask = await tasks.start({
      taskId: readyTask.id,
      deviceId: connectedDevice.id
    });
    const firstCompletedTask = await waitForTaskStatus(tasks, task.id, ['succeeded']);
    const secondQueuedTask = await tasks.start({
      taskId: firstCompletedTask.id,
      deviceId: connectedDevice.id
    });
    const secondCompletedTask = await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(secondQueuedTask.latestRunId).not.toBe(firstQueuedTask.latestRunId);
    expect(secondCompletedTask.runIds).toEqual([
      firstQueuedTask.latestRunId,
      secondQueuedTask.latestRunId
    ]);
    expect(agentProvider.runTestRequests).toHaveLength(2);
    expect(agentProvider.runTestRequests[0]?.casePath).toBe(readyTask.input.testCase?.storedPath);
    expect(agentProvider.runTestRequests[1]?.casePath).toBe(readyTask.input.testCase?.storedPath);
    expect(secondCompletedTask.logs?.filter((entry) => entry.kind === 'run_started')).toHaveLength(2);
    expect(secondCompletedTask.logs?.filter((entry) => entry.kind === 'run_completed')).toHaveLength(2);
    expect(secondCompletedTask.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'run_completed',
          runId: secondQueuedTask.latestRunId,
          status: 'succeeded'
        })
      ])
    );
  });

  it('runs natural-language-only execution through Codex without generating local YAML', async () => {
    const { agentProvider, tasks } = await createTaskServices();
    const task = await tasks.create({ name: 'Prompt task' });
    const readyTask = await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录，输入 alice，看到 首页'
    });

    expect(readyTask.input.mode).toBe('natural_language');

    const queuedTask = await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });
    const completedTask = await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(queuedTask).toMatchObject({
      status: 'queued',
      input: {
        mode: 'natural_language'
      },
      latestRunId: expect.stringMatching(/^run-/)
    });
    expect(agentProvider.runTestRequests[0]).toMatchObject({
      casePath: undefined,
      prompt: '点击 登录，输入 alice，看到 首页',
      targetAppId: 'com.example.app'
    });
    expect(completedTask).toMatchObject({
      status: 'succeeded',
      input: {
        mode: 'natural_language'
      }
    });
  });

  it('allows natural-language-only execution without a target app id', async () => {
    const { agentProvider, tasks } = await createTaskServices({ naturalLanguageAppId: undefined });
    const task = await tasks.create({ name: 'Prompt without app id' });
    await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录'
    });

    const queuedTask = await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });
    await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(queuedTask.status).toBe('queued');
    expect(agentProvider.runTestRequests[0]).toMatchObject({
      prompt: '点击 登录',
      targetAppId: undefined
    });
  });

  it('uses the task target app id for natural-language-only execution', async () => {
    const { agentProvider, tasks } = await createTaskServices({ naturalLanguageAppId: undefined });
    const task = await tasks.create({ name: 'Prompt with task app id' });
    await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录',
      targetAppId: 'com.example.task'
    });

    await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id
    });
    await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(agentProvider.runTestRequests[0]).toMatchObject({
      prompt: '点击 登录',
      targetAppId: 'com.example.task'
    });
  });

  it('uses the start request target app id when the task record has not caught up yet', async () => {
    const { agentProvider, tasks } = await createTaskServices({ naturalLanguageAppId: undefined });
    const task = await tasks.create({ name: 'Prompt with start app id' });
    await tasks.updateInput({
      taskId: task.id,
      prompt: '点击 登录'
    });

    await tasks.start({
      taskId: task.id,
      deviceId: connectedDevice.id,
      targetAppId: 'com.example.start'
    });
    await waitForTaskStatus(tasks, task.id, ['succeeded']);

    expect(agentProvider.runTestRequests[0]).toMatchObject({
      prompt: '点击 登录',
      targetAppId: 'com.example.start'
    });
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
      modelSummary: 'gpt-5 (app default)',
      targetDevice: expect.stringContaining('Pixel 8'),
      filePath: expect.stringContaining(`/tasks/${task.id}/reports/`)
    });
    const markdown = await readFile(report.filePath ?? '', 'utf8');

    expect(markdown).toContain(`# Task report for Report task`);
    expect(markdown).toContain(`- Task: ${task.id}`);
    expect(markdown).toContain(`- Run: ${completedTask.latestRunId}`);
    expect(markdown).toContain('- Input mode: test_case');
    expect(markdown).toContain('- Codex model: gpt-5 (app default)');
    expect(markdown).toContain('- Conclusion: Succeeded');

    const taskWithReportLog = await tasks.get({ taskId: task.id });

    expect(taskWithReportLog.reportPath).toBe(report.filePath);
    expect(taskWithReportLog.reportPaths).toContain(report.filePath);
    expect(taskWithReportLog.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'report_generated',
          reportPath: report.filePath,
          runId: completedTask.latestRunId,
          status: 'succeeded'
        })
      ])
    );

    const updatedInputTask = await tasks.updateInput({
      taskId: task.id,
      prompt: 'Run this report task again'
    });

    expect(updatedInputTask.status).toBe('ready');
    expect(updatedInputTask.latestRunId).toBeUndefined();
    expect(updatedInputTask.reportPath).toBeUndefined();
    expect(updatedInputTask.runIds).toEqual(expect.arrayContaining([completedTask.latestRunId]));
    expect(updatedInputTask.reportPaths).toEqual(expect.arrayContaining([report.filePath]));
  });
});
