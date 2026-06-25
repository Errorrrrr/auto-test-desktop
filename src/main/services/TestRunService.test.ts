import { mkdtemp, rm } from 'node:fs/promises';
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
import type {
  DeviceInfo,
  DeviceStartResult,
  ServiceHealth,
  TestCaseManifest,
  TestRunStatus
} from '../../shared/types';
import { AgentSessionService } from './AgentSessionService';
import { DeviceService } from './DeviceService';
import { TestRunService } from './TestRunService';

const tempRoots: string[] = [];

const connectedDevice: DeviceInfo = {
  id: 'android-connected',
  name: 'Pixel 8',
  platform: 'android',
  type: 'emulator',
  connected: true
};

const disconnectedDevice: DeviceInfo = {
  id: 'ios-disconnected',
  name: 'iPhone 16',
  platform: 'ios',
  type: 'simulator',
  connected: false
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
  detail: 'Ready for test execution.'
};

function createAgentProvider(health: ServiceHealth = readyHealth): AgentProvider {
  return {
    async health() {
      return health;
    },
    async createSession() {
      return {
        id: 'session-test',
        createdAt: '2026-06-16T02:00:00Z',
        status: health.status === 'ready' ? 'available' : 'unavailable'
      };
    },
    async sendMessage(request) {
      return {
        id: 'message-test',
        sessionId: request.sessionId,
        role: 'assistant',
        content: 'Ready to run.',
        createdAt: '2026-06-16T02:00:00Z'
      };
    }
  };
}

type RunFlowHandler = (request: MaestroRunFlowRequest) => Promise<MaestroRunFlowResult>;

class MockMaestroProvider implements MaestroProvider {
  readonly runFlowRequests: MaestroRunFlowRequest[] = [];
  private readonly devices: DeviceInfo[];
  private readonly serviceHealth: ServiceHealth;
  private readonly runFlowHandler: RunFlowHandler;

  constructor(options: {
    devices?: DeviceInfo[];
    health?: ServiceHealth;
    runFlow?: RunFlowHandler;
    runResult?: MaestroRunFlowResult;
  } = {}) {
    this.devices = options.devices ?? [connectedDevice];
    this.serviceHealth = options.health ?? readyHealth;
    this.runFlowHandler =
      options.runFlow ??
      (async () =>
        options.runResult ?? {
          status: 'succeeded',
          stdout: 'flow passed',
          stderr: ''
        });
  }

  async health(): Promise<ServiceHealth> {
    return this.serviceHealth;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.devices;
  }

  async startDevice(): Promise<DeviceStartResult> {
    const device = this.devices[0];

    return {
      deviceId: device?.id ?? 'unknown',
      device,
      status: device?.connected ? 'already_running' : 'not_startable',
      detail: device?.connected ? `${device.name} is already connected.` : 'Device is not startable.'
    };
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    this.runFlowRequests.push(request);
    return this.runFlowHandler(request);
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve
  };
}

async function createRunService(options: {
  agentHealth?: ServiceHealth;
  devices?: DeviceInfo[];
  maestroHealth?: ServiceHealth;
  runFlow?: RunFlowHandler;
  runResult?: MaestroRunFlowResult;
} = {}): Promise<{
  provider: MockMaestroProvider;
  runs: TestRunService;
  storage: AppDataStorage;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-runs-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));
  const provider = new MockMaestroProvider({
    devices: options.devices,
    health: options.maestroHealth,
    runFlow: options.runFlow,
    runResult: options.runResult
  });
  const agentService = new AgentSessionService(createAgentProvider(options.agentHealth));
  const deviceService = new DeviceService({ provider });

  tempRoots.push(rootDir);
  await storage.getTestCaseStore().upsert(importedCase);

  return {
    provider,
    runs: new TestRunService({
      agentService,
      deviceService,
      runStore: storage.getRunStore(),
      runTimeoutMs: 1_234,
      testCaseStore: storage.getTestCaseStore()
    }),
    storage
  };
}

async function sleep(ms = 5): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForStatus(
  runs: TestRunService,
  runId: string,
  statuses: TestRunStatus[]
): Promise<Awaited<ReturnType<TestRunService['getStatus']>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const run = await runs.getStatus({ runId });

    if (statuses.includes(run.status)) {
      return run;
    }

    await sleep();
  }

  throw new Error(`Run ${runId} did not reach ${statuses.join(', ')}.`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('TestRunService', () => {
  it('runs a mock flow to succeeded and persists execution metadata', async () => {
    const { provider, runs, storage } = await createRunService();
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke'
    });
    const finalRun = await waitForStatus(runs, run.id, ['succeeded']);

    expect(run.status).toBe('queued');
    expect(provider.runFlowRequests).toHaveLength(1);
    expect(provider.runFlowRequests[0]).toMatchObject({
      deviceId: connectedDevice.id,
      flowPath: importedCase.storedPath,
      timeoutMs: 1_234
    });
    expect(provider.runFlowRequests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(finalRun).toMatchObject({
      caseName: importedCase.name,
      deviceName: connectedDevice.name,
      status: 'succeeded',
      stdout: 'flow passed'
    });
    await expect(storage.getRunStore().get(run.id)).resolves.toMatchObject({
      id: run.id,
      status: 'succeeded'
    });
  });

  it.each([
    {
      expectedStatus: 'failed' as const,
      runResult: {
        status: 'failed' as const,
        stdout: '',
        stderr: 'assertion failed',
        failureReason: 'Flow assertion failed.'
      }
    },
    {
      expectedStatus: 'timeout' as const,
      runResult: {
        status: 'timeout' as const,
        stdout: '',
        stderr: '',
        failureReason: 'Flow timed out.'
      }
    }
  ])('normalizes mock flow $expectedStatus results', async ({ expectedStatus, runResult }) => {
    const { runs } = await createRunService({ runResult });
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke'
    });
    const finalRun = await waitForStatus(runs, run.id, [expectedStatus]);

    expect(finalRun).toMatchObject({
      status: expectedStatus,
      failureReason: runResult.failureReason
    });
  });

  it('keeps cancelled runs cancelled even if the provider later resolves', async () => {
    const deferred = createDeferred<MaestroRunFlowResult>();
    let runSignal: AbortSignal | undefined;
    const { runs } = await createRunService({
      runFlow: async (request) => {
        runSignal = request.signal;

        return deferred.promise;
      }
    });
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke'
    });

    await waitForStatus(runs, run.id, ['running']);
    const cancelledRun = await runs.cancel({ runId: run.id });

    deferred.resolve({
      status: 'succeeded',
      stdout: 'late success',
      stderr: ''
    });
    await sleep(10);

    expect(cancelledRun).toMatchObject({
      status: 'cancelled',
      failureReason: 'Run cancelled by user. Underlying Maestro process termination signal sent.'
    });
    expect(runSignal?.aborted).toBe(true);
    await expect(runs.getStatus({ runId: run.id })).resolves.toMatchObject({
      status: 'cancelled'
    });
  });

  it('keeps cancelled runs cancelled when the provider rejects immediately on abort', async () => {
    let runSignal: AbortSignal | undefined;
    const { runs } = await createRunService({
      runFlow: async (request) => {
        const signal = request.signal;

        if (!signal) {
          throw new Error('Expected run flow to receive an abort signal.');
        }

        runSignal = signal;

        return new Promise<MaestroRunFlowResult>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Provider rejected immediately after abort.'));
            },
            { once: true }
          );
        });
      }
    });
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke'
    });

    await waitForStatus(runs, run.id, ['running']);
    for (let attempt = 0; attempt < 20 && !runSignal; attempt += 1) {
      await sleep();
    }
    const cancelledRun = await runs.cancel({ runId: run.id });
    await sleep(20);

    expect(cancelledRun).toMatchObject({
      status: 'cancelled',
      failureReason: 'Run cancelled by user. Underlying Maestro process termination signal sent.'
    });
    expect(runSignal?.aborted).toBe(true);
    await expect(runs.getStatus({ runId: run.id })).resolves.toMatchObject({
      status: 'cancelled'
    });
  });

  it('allows degraded agent mode when execution still requires manual confirmation', async () => {
    const { runs } = await createRunService({
      agentHealth: {
        status: 'degraded',
        label: 'Agent',
        detail: 'Agent command is installed, but no message transport is configured.'
      }
    });
    const run = await runs.start({
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke'
    });

    expect(run).toMatchObject({
      status: 'queued',
      agentDetail: 'Agent command is installed, but no message transport is configured.'
    });
    await expect(waitForStatus(runs, run.id, ['succeeded'])).resolves.toMatchObject({
      status: 'succeeded'
    });
  });

  it('blocks start when the local agent is unavailable', async () => {
    const { runs } = await createRunService({
      agentHealth: {
        status: 'not_configured',
        label: 'Agent',
        detail: 'Local agent message transport is not available.'
      }
    });

    await expect(
      runs.start({
        caseId: importedCase.id,
        deviceId: connectedDevice.id,
        prompt: 'Run smoke'
      })
    ).rejects.toMatchObject({
      code: 'AGENT_NOT_AVAILABLE',
      message: 'Local agent message transport is not available.'
    });
  });

  it('blocks start when Maestro is unavailable', async () => {
    const { runs } = await createRunService({
      maestroHealth: {
        status: 'disconnected',
        label: 'Maestro',
        detail: 'Maestro MCP/CLI is unavailable.'
      }
    });

    await expect(
      runs.start({
        caseId: importedCase.id,
        deviceId: connectedDevice.id,
        prompt: 'Run smoke'
      })
    ).rejects.toMatchObject({
      code: 'MAESTRO_NOT_AVAILABLE',
      message: 'Maestro MCP/CLI is unavailable.'
    });
  });

  it('blocks start when no connected executable device is available', async () => {
    const { runs } = await createRunService({
      devices: [disconnectedDevice]
    });

    await expect(
      runs.start({
        caseId: importedCase.id,
        deviceId: disconnectedDevice.id,
        prompt: 'Run smoke'
      })
    ).rejects.toMatchObject({
      code: 'DEVICE_NOT_AVAILABLE',
      message: 'No connected Android or iOS device is available for this run.'
    });
  });
});
