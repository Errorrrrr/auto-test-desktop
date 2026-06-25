import type {
  DeviceInfo,
  DeviceStartResult,
  EnvironmentStatus,
  ReportFormat,
  ServiceStatus,
  TestCaseImportRequest,
  TestCaseManifest,
  TestReport,
  TestTask,
  TaskInputMode,
  TestRun,
  TestRunStatus,
  ViewerProbeResult,
  ViewerReachability
} from '../../shared/types';
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

export function mapDeviceStartResultToAction(
  result: DeviceStartResult,
  fallbackDeviceName: string
): DeviceStartActionState {
  const statusByResult: Record<DeviceStartResult['status'], AsyncStatus> = {
    already_running: 'success',
    failed: 'error',
    not_startable: 'error',
    started: 'success',
    starting: 'busy'
  };

  return {
    status: statusByResult[result.status],
    detail: result.detail || `Device ${fallbackDeviceName} start returned ${result.status}.`,
    deviceId: result.deviceId
  };
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
  if (currentDeviceId && devices.some((device) => device.id === currentDeviceId)) {
    return currentDeviceId;
  }

  return getExecutableDevices(devices)[0]?.id ?? devices[0]?.id ?? '';
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

export function getRunReadiness(input: {
  environment: EnvironmentStatus | null;
  devices: DeviceInfo[];
  selectedDeviceId: string;
  task: TestTask | null;
  prompt: string;
}): RunReadiness {
  const selectedDevice = getSelectedDevice(input.devices, input.selectedDeviceId);
  const inputMode = getTaskInputMode(input.task, input.prompt);
  const reasons: string[] = [];

  if (!input.environment) {
    reasons.push('Runtime status is still loading.');
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

  if (inputMode === 'empty') {
    reasons.push(...(input.task?.input.blockers.length ? input.task.input.blockers : [
      'Task input is required before execution.'
    ]));
  }

  if (input.task?.latestRunId || input.task?.status === 'queued' || input.task?.status === 'running') {
    reasons.push(`Task ${input.task.id} has already been started.`);
  }

  if (
    input.task &&
    ['blocked', 'cancelled', 'failed', 'succeeded', 'timeout'].includes(input.task.status)
  ) {
    reasons.push(`Task ${input.task.id} is already ${input.task.status}.`);
  }

  const uniqueReasons = uniqueMessages(reasons);

  return {
    canStart: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    selectedDevice,
    inputMode
  };
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
    markdown: [
      `# ${copy.report.markdownHeading}`,
      '',
      `- ${markdownLabels.run}: ${run.id}`,
      `- ${markdownLabels.status}: ${formatStatusLabel(run.status, language)}`,
      `- ${markdownLabels.target}: ${safeTarget}`,
      `- ${markdownLabels.case}: ${safeTestCaseName}`,
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
