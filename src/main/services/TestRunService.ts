import { randomUUID } from 'node:crypto';

import type { DeviceInfo, ServiceHealth, TestCaseManifest, TestRun } from '../../shared/types';
import type { FileManifestStore } from '../storage/FileManifestStore';
import type { AgentSessionService } from './AgentSessionService';
import { AppError } from './AppError';
import type { DeviceService } from './DeviceService';
import { requireStringField } from './validation';

type TestRunServiceOptions = {
  agentService: AgentSessionService;
  deviceService: DeviceService;
  runStore: FileManifestStore<TestRun>;
  runTimeoutMs: number;
  testCaseStore: FileManifestStore<TestCaseManifest>;
};

export interface TaskRunStartRequest {
  taskId: string;
  caseId: string;
  caseName?: string;
  deviceId: string;
  flowPath: string;
  prompt?: string;
}

const TERMINAL_STATUSES = new Set<TestRun['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
  'blocked'
]);

function isUsableMaestroStatus(status: ServiceHealth['status']): boolean {
  return status === 'ready' || status === 'degraded';
}

function isUsableAgentStatus(status: ServiceHealth['status']): boolean {
  return status === 'ready' || status === 'degraded';
}

function isExecutableDevice(device: DeviceInfo): boolean {
  return (device.platform === 'android' || device.platform === 'ios') && device.connected;
}

function getFlowPath(testCase: TestCaseManifest): string {
  return testCase.storedPath ?? testCase.sourcePath;
}

export class TestRunService {
  private readonly agentService: AgentSessionService;
  private readonly deviceService: DeviceService;
  private readonly runStore: FileManifestStore<TestRun>;
  private readonly runTimeoutMs: number;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly cancelledRunIds = new Set<string>();
  private readonly runs = new Map<string, TestRun>();
  private readonly testCaseStore: FileManifestStore<TestCaseManifest>;

  constructor(options: TestRunServiceOptions) {
    this.agentService = options.agentService;
    this.deviceService = options.deviceService;
    this.runStore = options.runStore;
    this.runTimeoutMs = options.runTimeoutMs;
    this.testCaseStore = options.testCaseStore;
  }

  async start(request: unknown): Promise<TestRun> {
    const caseId = requireStringField(request, 'caseId');
    const deviceId = requireStringField(request, 'deviceId');
    const prompt = requireStringField(request, 'prompt');
    const [agentHealth, maestroHealth] = await Promise.all([
      this.agentService.getHealth(),
      this.deviceService.getHealth()
    ]);

    if (!isUsableAgentStatus(agentHealth.status)) {
      throw new AppError('AGENT_NOT_AVAILABLE', agentHealth.detail);
    }

    if (!isUsableMaestroStatus(maestroHealth.status)) {
      throw new AppError('MAESTRO_NOT_AVAILABLE', maestroHealth.detail);
    }

    const [testCase, devices] = await Promise.all([
      this.testCaseStore.get(caseId),
      this.deviceService.listDevices()
    ]);
    const device = devices.find((candidate) => candidate.id === deviceId);

    if (!device || !isExecutableDevice(device)) {
      throw new AppError(
        'DEVICE_NOT_AVAILABLE',
        'No connected Android or iOS device is available for this run.'
      );
    }

    if (!testCase) {
      throw new AppError('TEST_CASE_NOT_FOUND', `Test case ${caseId} was not found.`);
    }

    const now = new Date().toISOString();
    const run: TestRun = {
      id: `run-${randomUUID()}`,
      caseId,
      caseName: testCase.name,
      casePath: getFlowPath(testCase),
      agentDetail: agentHealth.detail,
      deviceId,
      deviceName: device.name,
      devicePlatform: device.platform,
      deviceType: device.type,
      prompt,
      status: 'queued',
      createdAt: now,
      updatedAt: now
    };

    await this.recordRun(run);
    void this.executeRun(run.id, getFlowPath(testCase));

    return run;
  }

  async startForTask(request: TaskRunStartRequest): Promise<TestRun> {
    const [maestroHealth, devices] = await Promise.all([
      this.deviceService.getHealth(),
      this.deviceService.listDevices()
    ]);

    if (!isUsableMaestroStatus(maestroHealth.status)) {
      throw new AppError('MAESTRO_NOT_AVAILABLE', maestroHealth.detail);
    }

    const device = devices.find((candidate) => candidate.id === request.deviceId);

    if (!device || !isExecutableDevice(device)) {
      throw new AppError(
        'DEVICE_NOT_AVAILABLE',
        'No connected Android or iOS device is available for this run.'
      );
    }

    if (!request.flowPath.trim()) {
      throw new AppError('INVALID_ARGUMENT', 'flowPath is required.');
    }

    const now = new Date().toISOString();
    const run: TestRun = {
      id: `run-${randomUUID()}`,
      taskId: request.taskId,
      caseId: request.caseId,
      caseName: request.caseName,
      casePath: request.flowPath,
      deviceId: request.deviceId,
      deviceName: device.name,
      devicePlatform: device.platform,
      deviceType: device.type,
      prompt: request.prompt ?? '',
      status: 'queued',
      createdAt: now,
      updatedAt: now
    };

    await this.recordRun(run);
    void this.executeRun(run.id, request.flowPath);

    return run;
  }

  async cancel(request: unknown): Promise<TestRun> {
    const runId = requireStringField(request, 'runId');
    const existing = await this.getRun(runId);

    if (!existing) {
      throw new AppError('RUN_NOT_FOUND', `Run ${runId} was not found.`);
    }

    const abortController = this.abortControllers.get(runId);
    const cancelled: TestRun = {
      ...existing,
      status: 'cancelled',
      completedAt: existing.completedAt ?? new Date().toISOString(),
      failureReason:
        existing.failureReason ??
        (abortController
          ? 'Run cancelled by user. Underlying Maestro process termination signal sent.'
          : 'Run cancelled by user before Maestro execution started.'),
      updatedAt: new Date().toISOString()
    };

    if (TERMINAL_STATUSES.has(existing.status)) {
      return existing;
    }

    this.cancelledRunIds.add(runId);
    abortController?.abort();
    await this.recordRun(cancelled);

    return cancelled;
  }

  async getStatus(request: unknown): Promise<TestRun> {
    const runId = requireStringField(request, 'runId');
    const run = await this.getRun(runId);

    if (!run) {
      throw new AppError('RUN_NOT_FOUND', `Run ${runId} was not found.`);
    }

    return run;
  }

  async getRun(runId: string): Promise<TestRun | undefined> {
    const inMemoryRun = this.runs.get(runId);

    if (inMemoryRun) {
      return inMemoryRun;
    }

    const storedRun = await this.runStore.get(runId);

    if (storedRun) {
      this.runs.set(runId, storedRun);
    }

    return storedRun;
  }

  private async executeRun(runId: string, flowPath: string): Promise<void> {
    const startedAt = new Date().toISOString();

    try {
      if (this.cancelledRunIds.has(runId)) {
        return;
      }

      const running = await this.updateRun(runId, {
        startedAt,
        status: 'running'
      });

      if (this.cancelledRunIds.has(runId)) {
        return;
      }

      const abortController = new AbortController();

      this.abortControllers.set(runId, abortController);

      const result = await this.deviceService.runFlow({
        deviceId: running.deviceId,
        flowPath,
        signal: abortController.signal,
        timeoutMs: this.runTimeoutMs
      });
      const current = await this.getRun(runId);

      if (!current || current.status === 'cancelled') {
        return;
      }

      await this.updateRun(runId, {
        completedAt: new Date().toISOString(),
        failureReason: result.failureReason,
        status: result.status,
        stderr: result.stderr,
        stdout: result.stdout
      });
    } catch (error) {
      const current = await this.getRun(runId);

      if (!current || current.status === 'cancelled') {
        return;
      }

      await this.updateRun(runId, {
        completedAt: new Date().toISOString(),
        failureReason: error instanceof Error ? error.message : 'Run execution failed.',
        status: 'failed'
      });
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  private async updateRun(
    runId: string,
    updates: Partial<Omit<TestRun, 'id' | 'createdAt'>>
  ): Promise<TestRun> {
    const existing = await this.getRun(runId);

    if (!existing) {
      throw new AppError('RUN_NOT_FOUND', `Run ${runId} was not found.`);
    }

    const updated: TestRun = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.recordRun(updated);

    return updated;
  }

  private async recordRun(run: TestRun): Promise<void> {
    await this.runStore.upsert(run);
    this.runs.set(run.id, run);
  }
}
