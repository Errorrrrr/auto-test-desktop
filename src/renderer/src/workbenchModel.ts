import type {
  CodexModelSettingsResponse,
  CodexModelSnapshot,
  DeviceInfo,
  DeviceStartResult,
  DeviceStopResult,
  EnvironmentStatus,
  ReportFormat,
  ServiceStatus,
  TaskLogEntry,
  TestCaseImportRequest,
  TestCaseManifest,
  TestReport,
  TestTask,
  TaskInputMode,
  TestRun,
  TestRunStatus,
  TestTaskStatus,
  ViewerProbeResult,
  ViewerReachability
} from '../../shared/types';
import { CODEX_MODEL_PRESETS } from '../../shared/codexModels';
import { redactReportText } from '../../shared/redaction';
import { isAllowedLocalViewerUrl, normalizeViewerUrl } from '../../shared/viewerConfig';
import {
  COPY,
  DATE_LOCALES,
  DEFAULT_LANGUAGE,
  Language,
  getStatusLabel,
  localizeText
} from './rendererI18n';

export const MAX_UPLOAD_SIZE_MB = 25;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
export const LEGACY_CODEX_MODEL_LABEL = 'Not recorded (legacy run)';

export type AsyncStatus = 'idle' | 'busy' | 'success' | 'error';

export type ViewerProbeState = {
  status: 'unchecked' | 'checking' | 'accepted' | 'reachable' | 'unreachable' | 'blocked' | 'error';
  detail: string;
};

export type UploadState = {
  name: string;
  status: 'idle' | 'importing' | 'accepted' | 'rejected';
  detail: string;
};

export type RunReadiness = {
  canStart: boolean;
  reasons: string[];
  selectedDevice?: DeviceInfo;
  inputMode: TaskInputMode;
};

export type DeviceInspectionSummary = {
  totalSupported: number;
  connected: number;
  virtual: number;
  physical: number;
  startable: number;
};

export type DeviceStartActionState = {
  status: AsyncStatus;
  detail: string;
  deviceId: string;
};

export type FileCandidate = {
  name: string;
  size: number;
  path?: string;
};

export type TaskRunLogSummary = {
  runId: string;
  entries: TaskLogEntry[];
  startedAt: string;
  updatedAt: string;
  status?: TestTaskStatus;
  reportPath?: string;
  detailCount: number;
};

export function createInitialUploadState(): UploadState {
  return {
    name: '',
    status: 'idle',
    detail: `Supported formats: .yaml, .yml. Maximum size: ${MAX_UPLOAD_SIZE_MB} MB.`
  };
}

export function createInitialViewerProbeState(): ViewerProbeState {
  return {
    status: 'unchecked',
    detail: 'Local viewer reachability has not been checked in this session.'
  };
}

export const INITIAL_UPLOAD_STATE: UploadState = createInitialUploadState();
export const INITIAL_VIEWER_PROBE_STATE: ViewerProbeState = createInitialViewerProbeState();

const EXECUTABLE_PLATFORMS = new Set(['android', 'ios']);
const VIRTUAL_DEVICE_TYPES = new Set(['emulator', 'simulator']);
const ACTIVE_TASK_STATUSES = new Set<TestTaskStatus>(['queued', 'running']);
const SUCCESS_TASK_STATUSES = new Set<TestTaskStatus>(['succeeded', 'cancelled']);
const ERROR_TASK_STATUSES = new Set<TestTaskStatus>(['failed', 'timeout', 'blocked']);

export function isExecutableDevice(device: DeviceInfo): boolean {
  return EXECUTABLE_PLATFORMS.has(device.platform) && device.connected;
}

export function isSupportedMobileDevice(device: DeviceInfo): boolean {
  return EXECUTABLE_PLATFORMS.has(device.platform);
}

export function isVirtualDevice(device: DeviceInfo): boolean {
  return isSupportedMobileDevice(device) && VIRTUAL_DEVICE_TYPES.has(device.type);
}

export function isStartableDevice(device: DeviceInfo): boolean {
  return isVirtualDevice(device) && !device.connected && device.launchable === true;
}

export function getRunActionStatusForTaskStatus(status: TestTaskStatus): AsyncStatus {
  if (ACTIVE_TASK_STATUSES.has(status)) {
    return 'busy';
  }

  if (SUCCESS_TASK_STATUSES.has(status)) {
    return 'success';
  }

  if (ERROR_TASK_STATUSES.has(status)) {
    return 'error';
  }

  return 'idle';
}

export function isStoppableDevice(device: DeviceInfo): boolean {
  return isVirtualDevice(device) && device.connected;
}

export function mapDeviceStartResultToAction(
  result: DeviceStartResult,
  fallbackDeviceName: string
): DeviceStartActionState {
  const statusByResult: Record<DeviceStartResult['status'], AsyncStatus> = {
    already_running: 'success',
    failed: 'error',
    not_startable: 'error',
    started: 'success',
    starting: 'success'
  };

  return {
    status: statusByResult[result.status],
    detail: result.detail || `Device ${fallbackDeviceName} start returned ${result.status}.`,
    deviceId: result.deviceId
  };
}

export function mapDeviceStopResultToAction(
  result: DeviceStopResult,
  fallbackDeviceName: string
): DeviceStartActionState {
  const statusByResult: Record<DeviceStopResult['status'], AsyncStatus> = {
    already_stopped: 'success',
    failed: 'error',
    not_stoppable: 'error',
    stopped: 'success'
  };

  return {
    status: statusByResult[result.status],
    detail: result.detail || `Device ${fallbackDeviceName} stop returned ${result.status}.`,
    deviceId: result.deviceId
  };
}

export function hasStartedDeviceAppeared(
  devices: DeviceInfo[],
  startedDevice: DeviceInfo,
  previouslyConnectedDeviceIds: ReadonlySet<string>
): boolean {
  return devices.some((device) => {
    const sameVirtualDevice =
      device.id === startedDevice.id ||
      device.name === startedDevice.name ||
      !previouslyConnectedDeviceIds.has(device.id);

    return (
      device.connected &&
      device.platform === startedDevice.platform &&
      device.type === startedDevice.type &&
      sameVirtualDevice
    );
  });
}

export function getExecutableDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter(isExecutableDevice);
}

export function getDeviceInspectionSummary(devices: DeviceInfo[]): DeviceInspectionSummary {
  const supportedDevices = devices.filter(isSupportedMobileDevice);

  return supportedDevices.reduce<DeviceInspectionSummary>(
    (summary, device) => ({
      totalSupported: summary.totalSupported + 1,
      connected: summary.connected + (device.connected ? 1 : 0),
      virtual: summary.virtual + (isVirtualDevice(device) ? 1 : 0),
      physical: summary.physical + (device.type === 'physical' ? 1 : 0),
      startable: summary.startable + (isStartableDevice(device) ? 1 : 0)
    }),
    {
      totalSupported: 0,
      connected: 0,
      virtual: 0,
      physical: 0,
      startable: 0
    }
  );
}

export function getPreferredDeviceId(devices: DeviceInfo[], currentDeviceId: string): string {
  if (
    currentDeviceId &&
    devices.some((device) => device.id === currentDeviceId && isExecutableDevice(device))
  ) {
    return currentDeviceId;
  }

  return getExecutableDevices(devices)[0]?.id ?? '';
}

export function getSelectedDevice(
  devices: DeviceInfo[],
  selectedDeviceId: string
): DeviceInfo | undefined {
  return devices.find((device) => device.id === selectedDeviceId);
}

function uniqueMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.filter(Boolean)));
}

function isUsableServiceStatus(status: ServiceStatus): boolean {
  return status === 'ready' || status === 'degraded';
}

export function getTaskInputMode(task: TestTask | null, prompt: string): TaskInputMode {
  const hasPrompt = Boolean(prompt.trim() || task?.input.naturalLanguage?.prompt?.trim());
  const hasTestCase = Boolean(task?.input.testCase);

  if (hasPrompt && hasTestCase) {
    return 'mixed';
  }

  if (hasTestCase) {
    return 'test_case';
  }

  if (hasPrompt) {
    return 'natural_language';
  }

  return 'empty';
}

function getTaskRecencyTime(task: TestTask): number {
  const updatedAt = Date.parse(task.updatedAt);

  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(task.createdAt);

  return Number.isFinite(createdAt) ? createdAt : 0;
}

export function getMostRecentTask(tasks: TestTask[]): TestTask | undefined {
  return [...tasks].sort((left, right) => {
    const timeDiff = getTaskRecencyTime(right) - getTaskRecencyTime(left);

    if (timeDiff !== 0) {
      return timeDiff;
    }

    return right.id.localeCompare(left.id);
  })[0];
}

export function getCurrentTaskAfterRefresh(
  currentTask: TestTask | null,
  refreshedTasks: TestTask[]
): TestTask | null {
  return currentTask ?? getMostRecentTask(refreshedTasks) ?? null;
}

export function getSelectedTaskAfterRefresh(
  selectedTaskId: string,
  refreshedTasks: TestTask[]
): TestTask | null {
  return (
    refreshedTasks.find((task) => task.id === selectedTaskId) ??
    getMostRecentTask(refreshedTasks) ??
    null
  );
}

export function upsertTaskList(tasks: TestTask[], nextTask: TestTask): TestTask[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  taskById.set(nextTask.id, nextTask);

  return Array.from(taskById.values()).sort((left, right) => {
    const timeDiff = getTaskRecencyTime(right) - getTaskRecencyTime(left);

    if (timeDiff !== 0) {
      return timeDiff;
    }

    return right.id.localeCompare(left.id);
  });
}

function getSortableTime(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function addUniqueRunId(runIds: string[], runId: string | undefined): void {
  if (runId && !runIds.includes(runId)) {
    runIds.push(runId);
  }
}

export function buildTaskRunLogSummaries(task: TestTask | null): TaskRunLogSummary[] {
  if (!task) {
    return [];
  }

  const logs = task.logs ?? [];
  const runIds: string[] = [];

  for (const runId of task.runIds ?? []) {
    addUniqueRunId(runIds, runId);
  }

  addUniqueRunId(runIds, task.latestRunId);

  for (const entry of logs) {
    addUniqueRunId(runIds, entry.runId);
  }

  const runOrder = new Map(runIds.map((runId, index) => [runId, index]));

  return runIds
    .map((runId): TaskRunLogSummary => {
      const entries = logs
        .filter((entry) => entry.runId === runId)
        .sort((left, right) => getSortableTime(left.createdAt) - getSortableTime(right.createdAt));
      const latestEntry = entries[entries.length - 1];
      const latestStatusEntry = [...entries].reverse().find((entry) => entry.status);
      const latestReportEntry = [...entries].reverse().find((entry) => entry.reportPath);
      const isLatestTaskRun = runId === task.latestRunId;
      const latestLiveStatus =
        isLatestTaskRun && ACTIVE_TASK_STATUSES.has(task.status) ? task.status : undefined;
      const startedAt = entries[0]?.createdAt ?? (isLatestTaskRun ? task.startedAt : undefined) ?? task.createdAt;
      const updatedAt =
        latestEntry?.createdAt ??
        (isLatestTaskRun ? task.completedAt ?? task.updatedAt : undefined) ??
        startedAt;

      return {
        runId,
        entries,
        startedAt,
        updatedAt,
        status: latestLiveStatus ?? latestStatusEntry?.status ?? (isLatestTaskRun ? task.status : undefined),
        reportPath: latestReportEntry?.reportPath,
        detailCount: entries.length
      };
    })
    .sort((left, right) => {
      const timeDiff = getSortableTime(right.updatedAt) - getSortableTime(left.updatedAt);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return (runOrder.get(right.runId) ?? 0) - (runOrder.get(left.runId) ?? 0);
    });
}

export function getRunReadiness(input: {
  environment: EnvironmentStatus | null;
  devices: DeviceInfo[];
  modelSettings?: CodexModelSettingsResponse | null;
  selectedDeviceId: string;
  task: TestTask | null;
  prompt: string;
  targetAppId?: string;
}): RunReadiness {
  const selectedDevice = getSelectedDevice(input.devices, input.selectedDeviceId);
  const inputMode = getTaskInputMode(input.task, input.prompt);
  const reasons: string[] = [];

  if (!input.environment) {
    reasons.push('Runtime status is still loading.');
  }

  if ('modelSettings' in input && !input.modelSettings && !input.task?.modelSnapshot) {
    reasons.push('Codex model settings are still loading.');
  }

  if (!input.task) {
    reasons.push('Create a test task before execution.');
  }

  if (!selectedDevice) {
    reasons.push('Select a connected Android or iOS device.');
  } else if (!isExecutableDevice(selectedDevice)) {
    reasons.push('Selected device is not connected for execution.');
  }

  if (input.environment && !isUsableServiceStatus(input.environment.maestro.status)) {
    reasons.push(input.environment.maestro.detail || 'Maestro provider is not available.');
  }

  if (input.environment && !isUsableServiceStatus(input.environment.agent.status)) {
    reasons.push(input.environment.agent.detail || 'Codex CLI test executor is not available.');
  }

  if (inputMode === 'empty') {
    reasons.push(...(input.task?.input.blockers.length ? input.task.input.blockers : [
      'Task input is required before execution.'
    ]));
  }

  if (input.task?.status === 'queued' || input.task?.status === 'running') {
    reasons.push(`Task ${input.task.id} is ${input.task.status}.`);
  }

  const uniqueReasons = uniqueMessages(reasons);

  return {
    canStart: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    selectedDevice,
    inputMode
  };
}

const CODEX_MODEL_SOURCE_LABELS: Record<CodexModelSnapshot['source'], string> = {
  app_default: 'local Codex default',
  codex_config: 'Codex config',
  custom: 'custom',
  preset: 'preset'
};

function getCodexModelSnapshotLabel(snapshot: CodexModelSnapshot): string {
  if (snapshot.source !== 'preset') {
    return CODEX_MODEL_SOURCE_LABELS[snapshot.source];
  }

  return (
    CODEX_MODEL_PRESETS.find((preset) => preset.id === snapshot.presetId)?.label ??
    CODEX_MODEL_PRESETS.find((preset) => preset.modelName === snapshot.modelName)?.label ??
    CODEX_MODEL_SOURCE_LABELS.preset
  );
}

export function formatCodexModelSnapshot(
  snapshot: CodexModelSnapshot | undefined,
  fallback = LEGACY_CODEX_MODEL_LABEL
): string {
  if (!snapshot) {
    return fallback;
  }

  return `${snapshot.modelName} (${getCodexModelSnapshotLabel(snapshot)})`;
}

export function getTaskModelChangeNotice(
  taskSnapshot: CodexModelSnapshot | undefined,
  settings: CodexModelSettingsResponse | null
): string | undefined {
  if (!taskSnapshot || !settings || taskSnapshot.modelName === settings.effective.modelName) {
    return undefined;
  }

  return `This task keeps ${taskSnapshot.modelName}. New model settings apply only to new tasks.`;
}

export function validateViewerUrl(value: string): ViewerProbeState | null {
  if (isAllowedLocalViewerUrl(value)) {
    return null;
  }

  return {
    status: 'blocked',
    detail: 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
  };
}

export function mapViewerProbeResult(result: ViewerProbeResult): ViewerProbeState {
  if (!result.allowed) {
    return {
      status: 'blocked',
      detail: result.detail
    };
  }

  const reachableToStatus: Record<ViewerReachability, ViewerProbeState['status']> = {
    unchecked: 'accepted',
    reachable: 'reachable',
    unreachable: 'unreachable'
  };

  return {
    status: reachableToStatus[result.reachable],
    detail: result.detail
  };
}

export function validateCaseFile(file: FileCandidate): { valid: true } | { valid: false; detail: string } {
  if (!/\.ya?ml$/i.test(file.name)) {
    return {
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      detail: 'The selected file is empty.'
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      detail: `File is larger than ${MAX_UPLOAD_SIZE_MB} MB.`
    };
  }

  return { valid: true };
}

export function createCaseImportRequest(file: FileCandidate): TestCaseImportRequest {
  return {
    sourcePath: file.path?.trim() || file.name,
    displayName: file.name
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message) {
      return message;
    }
  }

  return 'Unexpected local runtime error.';
}

export function formatDateTime(value: string, language: Language = DEFAULT_LANGUAGE): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(DATE_LOCALES[language], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(timestamp);
}

export function formatDuration(start: string, end: string, language: Language = DEFAULT_LANGUAGE): string {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return localizeText('Pending', language);
  }

  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));

  return `${seconds}s`;
}

export function formatStatusLabel(status: string, language: Language = DEFAULT_LANGUAGE): string {
  return getStatusLabel(status, language);
}

export function getStatusTone(status: ServiceStatus | TestRunStatus | string): string {
  if (status === 'ready' || status === 'succeeded' || status === 'reachable' || status === 'accepted') {
    return 'success';
  }

  if (
    status === 'degraded' ||
    status === 'queued' ||
    status === 'running' ||
    status === 'unchecked' ||
    status === 'app_default' ||
    status === 'codex_config' ||
    status === 'default'
  ) {
    return 'warning';
  }

  if (
    status === 'disconnected' ||
    status === 'not_configured' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timeout' ||
    status === 'blocked' ||
    status === 'unreachable' ||
    status === 'error' ||
    status === 'rejected'
  ) {
    return 'danger';
  }

  return 'neutral';
}

export function createReportPlaceholder(input: {
  run: TestRun;
  device?: DeviceInfo;
  testCase?: TestCaseManifest;
  error?: string;
}, language: Language = 'en'): TestReport {
  const { run, device, testCase, error } = input;
  const copy = COPY[language];
  const failureReason = redactReportText(run.failureReason);
  const summary =
    localizeText(redactReportText(error) ?? failureReason ?? 'Run accepted by the local runtime.', language);
  const target = device ? `${device.name} (${device.platform})` : run.deviceId;
  const testCaseName = testCase?.name ?? run.caseId;
  const safeTarget = redactReportText(target) ?? '';
  const safeTestCaseName = redactReportText(testCaseName) ?? '';
  const prompt = redactReportText(run.prompt) ?? '';
  const markdownLabels = copy.report.markdownLabels;
  const localizedFailureReason = failureReason ? localizeText(failureReason, language) : failureReason;
  const modelSummary = formatCodexModelSnapshot(run.modelSnapshot);

  return {
    runId: run.id,
    title: copy.report.placeholderTitle(safeTestCaseName),
    status: run.status,
    generatedAt: run.updatedAt,
    summary,
    targetDevice: safeTarget,
    testCase: safeTestCaseName,
    prompt,
    startedAt: run.startedAt ?? run.createdAt,
    endedAt: run.completedAt ?? run.updatedAt,
    conclusion: formatStatusLabel(run.status, language),
    failureReason: localizedFailureReason,
    modelSummary,
    ...(run.modelSnapshot ? { modelSnapshot: run.modelSnapshot } : {}),
    markdown: [
      `# ${copy.report.markdownHeading}`,
      '',
      `- ${markdownLabels.run}: ${run.id}`,
      `- ${markdownLabels.status}: ${formatStatusLabel(run.status, language)}`,
      `- ${markdownLabels.target}: ${safeTarget}`,
      `- ${markdownLabels.case}: ${safeTestCaseName}`,
      `- ${markdownLabels.model}: ${localizeText(modelSummary, language)}`,
      `- ${markdownLabels.prompt}: ${prompt}`,
      `- ${markdownLabels.duration}: ${formatDuration(run.createdAt, run.updatedAt, language)}`,
      ...(localizedFailureReason ? [`- ${markdownLabels.failure}: ${localizedFailureReason}`] : [])
    ].join('\n')
  };
}

export function getReportFormatLabel(
  format: ReportFormat,
  language: Language = DEFAULT_LANGUAGE
): string {
  return format === 'markdown' ? COPY[language].report.markdown : COPY[language].report.page;
}

export function normalizeViewerInput(value: string): string {
  return normalizeViewerUrl(value);
}
