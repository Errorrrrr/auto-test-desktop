import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';

import type {
  DeviceInfo,
  TaskInput,
  TaskInputMode,
  TaskLogEntry,
  TaskLogEntryKind,
  TaskReport,
  TestCaseManifest,
  TestRun,
  TestTask,
  TestTaskStatus
} from '../../shared/types';
import type { AppDataStorage } from '../storage/AppDataStorage';
import type { AgentModelSettingsService } from './AgentModelSettingsService';
import { AppError } from './AppError';
import { optionalStringField, requireRecord, requireStringField } from './validation';
import type { ReportService } from './ReportService';
import type { TestCaseService } from './TestCaseService';
import type { TestRunService } from './TestRunService';

type TaskServiceOptions = {
  naturalLanguageAppId?: string;
  modelSettings?: AgentModelSettingsService;
  reports?: ReportService;
  runService?: TestRunService;
  storage: AppDataStorage;
  testCaseService?: TestCaseService;
};

const EMPTY_INPUT_BLOCKER = 'Task input is required before execution.';
const MAX_TASK_LOGS = 100;
const TASK_TERMINAL_STATUSES = new Set<TestTaskStatus>([
  'blocked',
  'cancelled',
  'failed',
  'succeeded',
  'timeout'
]);

const RUN_TO_TASK_STATUS: Record<TestRun['status'], TestTaskStatus> = {
  blocked: 'blocked',
  cancelled: 'cancelled',
  failed: 'failed',
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  timeout: 'timeout'
};

function getInputMode(input: Pick<TaskInput, 'naturalLanguage' | 'testCase'>): TaskInputMode {
  if (input.naturalLanguage && input.testCase) {
    return 'mixed';
  }

  if (input.naturalLanguage) {
    return 'natural_language';
  }

  if (input.testCase) {
    return 'test_case';
  }

  return 'empty';
}

function buildInput(options: Pick<TaskInput, 'naturalLanguage' | 'testCase'> = {}): TaskInput {
  const mode = getInputMode(options);

  return {
    ...options,
    mode,
    blockers: mode === 'empty' ? [EMPTY_INPUT_BLOCKER] : []
  };
}

function getTaskStatus(input: TaskInput): TestTaskStatus {
  return input.mode === 'empty' ? 'draft' : 'ready';
}

function toTaskCaseInput(
  manifest: TestCaseManifest,
  source: NonNullable<TaskInput['testCase']>['source'] = 'uploaded'
): NonNullable<TaskInput['testCase']> {
  return {
    caseId: manifest.id,
    name: manifest.name,
    storedPath: manifest.storedPath ?? manifest.sourcePath,
    format: manifest.format,
    source,
    importedAt: manifest.importedAt
  };
}

function getDeviceSnapshot(run: TestRun): DeviceInfo {
  return {
    id: run.deviceId,
    name: run.deviceName ?? run.deviceId,
    platform: run.devicePlatform ?? 'unknown',
    type: run.deviceType ?? 'unknown',
    connected: true
  };
}

function getTaskRecencyTime(task: TestTask): number {
  const updatedAt = Date.parse(task.updatedAt);

  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(task.createdAt);

  return Number.isFinite(createdAt) ? createdAt : 0;
}

function compareTasksByRecency(left: TestTask, right: TestTask): number {
  const timeDiff = getTaskRecencyTime(right) - getTaskRecencyTime(left);

  if (timeDiff !== 0) {
    return timeDiff;
  }

  return right.id.localeCompare(left.id);
}

function createTaskLogEntry(
  kind: TaskLogEntryKind,
  message: string,
  options: Partial<Omit<TaskLogEntry, 'id' | 'kind' | 'message'>> = {}
): TaskLogEntry {
  return {
    id: `task-log-${randomUUID()}`,
    kind,
    message,
    createdAt: new Date().toISOString(),
    ...options
  };
}

function appendTaskLog(
  task: TestTask,
  kind: TaskLogEntryKind,
  message: string,
  options: Partial<Omit<TaskLogEntry, 'id' | 'kind' | 'message'>> = {}
): TestTask {
  return {
    ...task,
    logs: [...(task.logs ?? []), createTaskLogEntry(kind, message, options)].slice(-MAX_TASK_LOGS)
  };
}

function hasTaskLog(task: TestTask, kind: TaskLogEntryKind, runId?: string): boolean {
  return Boolean(
    task.logs?.some((entry) => entry.kind === kind && (!runId || entry.runId === runId))
  );
}

function appendUniqueRunLog(
  task: TestTask,
  kind: TaskLogEntryKind,
  runId: string,
  message: string,
  options: Partial<Omit<TaskLogEntry, 'id' | 'kind' | 'message' | 'runId'>> = {}
): TestTask {
  if (hasTaskLog(task, kind, runId)) {
    return task;
  }

  return appendTaskLog(task, kind, message, {
    ...options,
    runId
  });
}

function addUniqueValue(values: string[] | undefined, value: string | undefined): string[] {
  if (!value) {
    return values ?? [];
  }

  return Array.from(new Set([...(values ?? []), value]));
}

function clearCurrentRunFields(task: TestTask): TestTask {
  const {
    completedAt: _completedAt,
    failureReason: _failureReason,
    latestRunId: _latestRunId,
    reportPath: _reportPath,
    startedAt: _startedAt,
    ...taskWithoutCurrentRun
  } = task;

  return taskWithoutCurrentRun;
}

export class TaskService {
  private readonly naturalLanguageAppId?: string;
  private readonly modelSettings?: AgentModelSettingsService;
  private readonly reports?: ReportService;
  private readonly runService?: TestRunService;
  private readonly storage: AppDataStorage;
  private readonly testCaseService?: TestCaseService;

  constructor(options: TaskServiceOptions) {
    this.naturalLanguageAppId = options.naturalLanguageAppId;
    this.modelSettings = options.modelSettings;
    this.reports = options.reports;
    this.runService = options.runService;
    this.storage = options.storage;
    this.testCaseService = options.testCaseService;
  }

  async create(request: unknown): Promise<TestTask> {
    const name = requireStringField(request, 'name');
    const description = optionalStringField(request, 'description');
    const id = `task-${randomUUID()}`;
    const workspace = this.storage.getTaskWorkspace(id);
    const now = new Date().toISOString();
    const input = buildInput();
    const modelSnapshot = await this.requireModelSettings().getEffectiveSnapshot();
    const task: TestTask = {
      id,
      name,
      ...(description ? { description } : {}),
      status: getTaskStatus(input),
      input,
      ...(this.naturalLanguageAppId ? { targetAppId: this.naturalLanguageAppId } : {}),
      logs: [
        createTaskLogEntry('task_created', `Task ${id} created.`, {
          createdAt: now,
          status: getTaskStatus(input)
        })
      ],
      reportPaths: [],
      runIds: [],
      modelSnapshot,
      workspacePath: workspace.rootDir,
      createdAt: now,
      updatedAt: now
    };

    await this.persistTask(task, workspace);

    return task;
  }

  async list(): Promise<TestTask[]> {
    const tasks = await this.storage.getTaskStore().list();
    const syncedTasks = await Promise.all(tasks.map((task) => this.syncTaskWithLatestRun(task)));

    return [...syncedTasks].sort(compareTasksByRecency);
  }

  async get(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');

    return this.syncTaskWithLatestRun(await this.getTask(taskId));
  }

  async delete(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');
    const task = await this.getTask(taskId);

    if (task.status === 'queued' || task.status === 'running') {
      throw new AppError(
        'TASK_DELETE_BLOCKED',
        `Task ${task.id} is ${task.status}; stop the running task before deleting it.`
      );
    }

    await this.storage.ensure();
    await this.storage.getTaskStore().delete(task.id);
    await rm(this.storage.getTaskWorkspace(task.id).rootDir, { force: true, recursive: true });

    return task;
  }

  async updateInput(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');
    const prompt = optionalStringField(request, 'prompt');
    const record = requireRecord(request, 'Request');
    const hasTargetAppId = Object.prototype.hasOwnProperty.call(record, 'targetAppId');
    const task = await this.getTask(taskId);
    const targetAppId = hasTargetAppId ? optionalStringField(request, 'targetAppId') : task.targetAppId;
    const shouldDropGeneratedCase = !prompt && task.input.testCase?.source === 'agent_generated';
    const input = buildInput({
      naturalLanguage: prompt
        ? {
            prompt,
            updatedAt: new Date().toISOString()
          }
        : undefined,
      testCase: shouldDropGeneratedCase ? undefined : task.input.testCase
    });
    const taskWithTargetAppId = {
      ...clearCurrentRunFields(task)
    };

    if (targetAppId) {
      taskWithTargetAppId.targetAppId = targetAppId;
    } else {
      delete taskWithTargetAppId.targetAppId;
    }

    const nextTask = appendTaskLog({
      ...taskWithTargetAppId,
      input,
      status: getTaskStatus(input),
      updatedAt: new Date().toISOString()
    }, 'input_updated', 'Task input updated.', {
      status: getTaskStatus(input)
    });

    await this.persistTask(nextTask);

    return nextTask;
  }

  async importCase(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');
    requireStringField(request, 'sourcePath');
    const testCaseService = this.requireTestCaseService();
    const task = await this.getTask(taskId);
    const workspace = this.storage.getTaskWorkspace(task.id);
    const manifest = await testCaseService.importCaseForTask(request, workspace);
    const input = buildInput({
      naturalLanguage: task.input.naturalLanguage,
      testCase: toTaskCaseInput(manifest)
    });
    const nextTask = appendTaskLog({
      ...clearCurrentRunFields(task),
      input,
      status: getTaskStatus(input),
      updatedAt: new Date().toISOString()
    }, 'case_imported', 'Test case imported.', {
      status: getTaskStatus(input)
    });

    await this.persistTask(nextTask);

    return nextTask;
  }

  async start(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');
    const deviceId = requireStringField(request, 'deviceId');
    const targetAppId = optionalStringField(request, 'targetAppId');
    const storedTask = await this.syncTaskWithLatestRun(await this.getTask(taskId));
    const task = targetAppId ? { ...storedTask, targetAppId } : storedTask;

    if (task.status === 'queued' || task.status === 'running') {
      throw new AppError('TASK_ALREADY_STARTED', `Task ${task.id} is ${task.status}.`);
    }

    if (task.input.mode === 'empty') {
      throw new AppError('TASK_INPUT_REQUIRED', EMPTY_INPUT_BLOCKER);
    }

    const taskForRun = await this.ensureTaskModelSnapshot(task);
    const testCase = task.input.testCase;
    const prompt = task.input.naturalLanguage?.prompt;

    if (!testCase && !prompt?.trim()) {
      throw new AppError('TASK_INPUT_REQUIRED', EMPTY_INPUT_BLOCKER);
    }

    const runService = this.requireRunService();
    const run = await runService.startForTask({
      taskId: taskForRun.id,
      ...(testCase
        ? {
            caseId: testCase.caseId,
            caseName: testCase.name,
            flowPath: testCase.storedPath
          }
        : {}),
      deviceId,
      prompt,
      modelSnapshot: taskForRun.modelSnapshot,
      targetAppId: taskForRun.targetAppId ?? this.naturalLanguageAppId
    });
    const {
      completedAt: _completedAt,
      failureReason: _failureReason,
      reportPath: _reportPath,
      ...taskWithoutTerminal
    } = taskForRun;
    const nextTask = appendTaskLog({
      ...taskWithoutTerminal,
      deviceId,
      deviceSnapshot: getDeviceSnapshot(run),
      latestRunId: run.id,
      runIds: addUniqueValue(taskForRun.runIds, run.id),
      startedAt: run.startedAt ?? run.createdAt,
      status: RUN_TO_TASK_STATUS[run.status],
      updatedAt: new Date().toISOString()
    }, 'run_started', 'Run started.', {
      createdAt: run.createdAt,
      runId: run.id,
      status: RUN_TO_TASK_STATUS[run.status]
    });

    await this.persistTask(nextTask);

    return nextTask;
  }

  async cancel(request: unknown): Promise<TestTask> {
    const taskId = requireStringField(request, 'taskId');
    const task = await this.getTask(taskId);

    if (!task.latestRunId) {
      throw new AppError('RUN_NOT_FOUND', `Task ${task.id} does not have a run to cancel.`);
    }

    await this.requireRunService().cancel({ runId: task.latestRunId });

    return this.syncTaskWithLatestRun(task);
  }

  async getReport(request: unknown): Promise<TaskReport> {
    const taskId = requireStringField(request, 'taskId');
    const { task, run } = await this.getTaskReportContext(taskId);

    return this.requireReportService().generateForTask(task, run);
  }

  async exportReport(request: unknown): Promise<TaskReport> {
    const taskId = requireStringField(request, 'taskId');
    const format = requireStringField(request, 'format');
    const { task, run } = await this.getTaskReportContext(taskId);

    if (format === 'page') {
      return this.requireReportService().generateForTask(task, run);
    }

    if (format !== 'markdown') {
      throw new AppError('UNSUPPORTED_REPORT_FORMAT', 'Task reports support page and markdown formats.');
    }

    const report = await this.requireReportService().exportTaskMarkdown(task, run);

    if (report.filePath) {
      const nextTask = appendTaskLog({
        ...task,
        reportPath: report.filePath,
        reportPaths: addUniqueValue(task.reportPaths, report.filePath),
        updatedAt: new Date().toISOString()
      }, 'report_generated', 'Markdown report exported.', {
        reportPath: report.filePath,
        runId: report.runId,
        status: report.status
      });

      await this.persistTask(nextTask);
    }

    return report;
  }

  private async getTask(taskId: string): Promise<TestTask> {
    const task = await this.storage.getTaskStore().get(taskId);

    if (!task) {
      throw new AppError('TASK_NOT_FOUND', `Task ${taskId} was not found.`);
    }

    return task;
  }

  private async getTaskReportContext(taskId: string): Promise<{
    task: TestTask;
    run?: TestRun;
  }> {
    const task = await this.syncTaskWithLatestRun(await this.getTask(taskId));
    const run = task.latestRunId ? await this.requireRunService().getRun(task.latestRunId) : undefined;

    return {
      task,
      ...(run ? { run } : {})
    };
  }

  private requireReportService(): ReportService {
    if (!this.reports) {
      throw new AppError('TASK_REPORT_NOT_CONFIGURED', 'Task report service is not configured.');
    }

    return this.reports;
  }

  private requireRunService(): TestRunService {
    if (!this.runService) {
      throw new AppError('TASK_RUN_NOT_CONFIGURED', 'Task run service is not configured.');
    }

    return this.runService;
  }

  private requireTestCaseService(): TestCaseService {
    if (!this.testCaseService) {
      throw new AppError('TASK_CASE_IMPORT_NOT_CONFIGURED', 'Task test case import is not configured.');
    }

    return this.testCaseService;
  }

  private requireModelSettings(): AgentModelSettingsService {
    if (!this.modelSettings) {
      throw new AppError(
        'CODEX_MODEL_SETTINGS_NOT_CONFIGURED',
        'Codex model settings service is not configured.'
      );
    }

    return this.modelSettings;
  }

  private async ensureTaskModelSnapshot(task: TestTask): Promise<TestTask> {
    if (task.modelSnapshot) {
      return task;
    }

    const modelSnapshot = await this.requireModelSettings().getEffectiveSnapshot();
    const nextTask = appendTaskLog({
      ...task,
      modelSnapshot,
      updatedAt: new Date().toISOString()
    }, 'model_snapshot_captured', `Codex model ${modelSnapshot.modelName} captured for task execution.`, {
      status: task.status
    });

    await this.persistTask(nextTask);

    return nextTask;
  }

  private async syncTaskWithLatestRun(task: TestTask): Promise<TestTask> {
    if (!task.latestRunId || !this.runService) {
      return task;
    }

    const run = await this.runService.getRun(task.latestRunId);

    if (!run) {
      return task;
    }

    const nextStatus = RUN_TO_TASK_STATUS[run.status];
    const nextCompletedAt = TASK_TERMINAL_STATUSES.has(nextStatus)
      ? run.completedAt ?? run.updatedAt
      : task.completedAt;
    let nextTask: TestTask = {
      ...task,
      deviceSnapshot: task.deviceSnapshot ?? getDeviceSnapshot(run),
      modelSnapshot: task.modelSnapshot ?? run.modelSnapshot,
      runIds: addUniqueValue(task.runIds, run.id),
      status: nextStatus,
      updatedAt: run.updatedAt,
      ...(nextCompletedAt ? { completedAt: nextCompletedAt } : {}),
      ...(run.failureReason ? { failureReason: run.failureReason } : {})
    };

    nextTask = appendUniqueRunLog(nextTask, 'run_started', run.id, 'Run started.', {
      createdAt: run.startedAt ?? run.createdAt,
      status: nextStatus
    });

    if (TASK_TERMINAL_STATUSES.has(nextStatus)) {
      nextTask = appendUniqueRunLog(nextTask, 'run_completed', run.id, 'Run finished.', {
        createdAt: nextCompletedAt ?? run.updatedAt,
        status: nextStatus
      });
    }

    if (JSON.stringify(nextTask) === JSON.stringify(task)) {
      return task;
    }

    await this.persistTask(nextTask);

    return nextTask;
  }

  private async persistTask(task: TestTask, workspace = this.storage.getTaskWorkspace(task.id)): Promise<void> {
    await this.storage.ensure();
    await workspace.ensure();
    await this.storage.getTaskStore().upsert(task);
    await writeJson(workspace.taskPath, task);
    await writeJson(workspace.inputPath, task.input);
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
