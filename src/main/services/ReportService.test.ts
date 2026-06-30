import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentProvider, AgentTestExecutionRequest } from '../adapters/agent/AgentProvider';
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
  TestCaseManifest
} from '../../shared/types';
import { AgentModelSettingsService } from './AgentModelSettingsService';
import { AgentSessionService } from './AgentSessionService';
import { DeviceService } from './DeviceService';
import { ReportService } from './ReportService';
import { TestRunService } from './TestRunService';

const tempRoots: string[] = [];

const connectedDevice: DeviceInfo = {
  id: 'ios-booted',
  name: 'iPhone 16',
  platform: 'ios',
  type: 'simulator',
  connected: true
};

const importedCase: TestCaseManifest = {
  id: 'case-smoke',
  name: 'smoke.yaml',
  sourcePath: '/source/smoke.yaml',
  storedPath: '/stored/smoke.yaml',
  format: 'yaml',
  importedAt: '2026-06-16T02:00:00Z',
  status: 'imported',
  validationMessages: []
};

const readyHealth: ServiceHealth = {
  status: 'ready',
  label: 'Ready',
  detail: 'Ready.'
};

const testAgentProvider: AgentProvider = {
  async health() {
    return readyHealth;
  },
  async createSession() {
    return {
      id: 'session-test',
      createdAt: '2026-06-16T02:00:00Z',
      status: 'available'
    };
  },
  async sendMessage(request) {
    return {
      id: 'message-test',
      sessionId: request.sessionId,
      role: 'assistant',
      content: 'Ready.',
      createdAt: '2026-06-16T02:00:00Z'
    };
  },
  async runTest(_request: AgentTestExecutionRequest) {
    return {
      status: 'succeeded' as const,
      stdout: 'codex flow passed',
      stderr: ''
    };
  }
};

class SucceedingMaestroProvider implements MaestroProvider {
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

  async runFlow(_request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    return {
      status: 'succeeded',
      stdout: 'flow passed',
      stderr: ''
    };
  }
}

async function createRunAndReportServices(): Promise<{
  reports: ReportService;
  rootDir: string;
  runs: TestRunService;
  storage: AppDataStorage;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-report-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));
  const devices = new DeviceService({
    provider: new SucceedingMaestroProvider()
  });
  const modelSettings = new AgentModelSettingsService({
    codexConfig: {
      async getConfig() {
        return {
          path: 'test-codex-config.toml',
          status: 'not_found' as const,
          modelOptions: []
        };
      }
    },
    storage
  });
  const agent = new AgentSessionService(testAgentProvider, { modelSettings });

  await storage.getTestCaseStore().upsert(importedCase);

  const runs = new TestRunService({
    agentService: agent,
    deviceService: devices,
    runStore: storage.getRunStore(),
    runTimeoutMs: 1_000,
    testCaseStore: storage.getTestCaseStore()
  });

  tempRoots.push(rootDir);

  return {
    reports: new ReportService({
      storage,
      testRunService: runs
    }),
    rootDir,
    runs,
    storage
  };
}

async function waitForSucceededRun(runs: TestRunService, runId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const run = await runs.getStatus({ runId });

    if (run.status === 'succeeded') {
      return run;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error(`Run ${runId} did not succeed.`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('ReportService', () => {
  it('exports complete run reports into the reports appData directory', async () => {
    const { reports, runs, storage } = await createRunAndReportServices();
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: 'ios-booted',
      prompt: 'Run smoke'
    });
    const finalRun = await waitForSucceededRun(runs, run.id);
    const storedRun = await storage.getRunStore().get(run.id);
    const report = await reports.exportReport({
      runId: run.id,
      format: 'markdown'
    });

    expect(finalRun.status).toBe('succeeded');
    expect(storedRun).toMatchObject({
      id: run.id,
      status: 'succeeded'
    });
    expect(report).toMatchObject({
      conclusion: 'Succeeded',
      prompt: 'Run smoke',
      status: 'succeeded',
      targetDevice: expect.stringContaining('iPhone 16'),
      testCase: expect.stringContaining('smoke.yaml'),
      modelSummary: 'gpt-5 (app default)',
      modelSnapshot: expect.objectContaining({
        modelName: 'gpt-5'
      })
    });
    expect(report.filePath).toBe(storage.getReportPath(run.id));
    const markdown = await readFile(report.filePath ?? '', 'utf8');

    expect(markdown).toContain(`- Run: ${run.id}`);
    expect(markdown).toContain('- Target device: iPhone 16');
    expect(markdown).toContain('- Test case: smoke.yaml');
    expect(markdown).toContain('- Codex model: gpt-5 (app default)');
    expect(markdown).toContain('- Agent instruction: Run smoke');
    expect(markdown).toContain('- Started:');
    expect(markdown).toContain('- Ended:');
    expect(markdown).toContain('- Conclusion: Succeeded');
  });

  it('redacts sensitive report fields before returning or exporting markdown', async () => {
    const { reports, storage } = await createRunAndReportServices();

    await storage.getRunStore().upsert({
      id: 'run-sensitive',
      caseId: 'case-sensitive',
      caseName: 'secret.yaml',
      deviceId: 'ios-booted',
      deviceName: 'iPhone 16',
      devicePlatform: 'ios',
      deviceType: 'simulator',
      prompt: 'Run with token=abc123 from /Users/alice/work/app',
      status: 'failed',
      createdAt: '2026-06-16T02:00:00Z',
      updatedAt: '2026-06-16T02:01:00Z',
      startedAt: '2026-06-16T02:00:00Z',
      completedAt: '2026-06-16T02:01:00Z',
      failureReason: 'Authorization: Bearer secret-token failed for /Users/alice/.maestro',
      stdout: 'using api_key=local-secret and sk-1234567890abcdef',
      stderr: 'password=hunter2 in C:\\Users\\Alice\\project'
    });

    const report = await reports.exportReport({
      runId: 'run-sensitive',
      format: 'markdown'
    });
    const markdown = await readFile(report.filePath ?? '', 'utf8');

    expect(report.prompt).toBe('Run with token=[REDACTED] from /Users/[REDACTED]/work/app');
    expect(report.failureReason).toBe(
      'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    );
    expect(markdown).not.toContain('abc123');
    expect(markdown).not.toContain('secret-token');
    expect(markdown).not.toContain('local-secret');
    expect(markdown).not.toContain('hunter2');
    expect(markdown).not.toContain('/Users/alice');
    expect(markdown).toContain('api_key=[REDACTED]');
    expect(markdown).toContain('[REDACTED_SECRET]');
    expect(markdown).toContain('C:\\Users\\[REDACTED]\\project');
    expect(markdown).toContain('- Codex model: Not recorded (legacy run)');
  });
});
