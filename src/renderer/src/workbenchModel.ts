import type {
  DeviceInfo,
  EnvironmentStatus,
  ReportFormat,
  ServiceStatus,
  TestCaseImportRequest,
  TestCaseManifest,
  TestReport,
  TestRun,
  TestRunStatus,
  ViewerProbeResult,
  ViewerReachability
} from '../../shared/types';
import { redactReportText } from '../../shared/redaction';
import { isAllowedLocalViewerUrl, normalizeViewerUrl } from '../../shared/viewerConfig';

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
};

export type FileCandidate = {
  name: string;
  size: number;
  path?: string;
};

export const INITIAL_UPLOAD_STATE: UploadState = {
  name: '',
  status: 'idle',
  detail: `Supported formats: .yaml, .yml. Maximum size: ${MAX_UPLOAD_SIZE_MB} MB.`
};

export const INITIAL_VIEWER_PROBE_STATE: ViewerProbeState = {
  status: 'unchecked',
  detail: 'Local viewer reachability has not been checked in this session.'
};

const EXECUTABLE_PLATFORMS = new Set(['android', 'ios']);

export function isExecutableDevice(device: DeviceInfo): boolean {
  return EXECUTABLE_PLATFORMS.has(device.platform) && device.connected;
}

export function getExecutableDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter(isExecutableDevice);
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

export function getRunReadiness(input: {
  environment: EnvironmentStatus | null;
  devices: DeviceInfo[];
  selectedDeviceId: string;
  importedCase: TestCaseManifest | null;
  prompt: string;
}): RunReadiness {
  const selectedDevice = getSelectedDevice(input.devices, input.selectedDeviceId);
  const reasons: string[] = [];

  if (!input.environment) {
    reasons.push('Runtime status is still loading.');
  }

  if (!selectedDevice) {
    reasons.push('Select a connected Android or iOS device.');
  } else if (!isExecutableDevice(selectedDevice)) {
    reasons.push('Selected device is not connected for execution.');
  }

  if (!input.importedCase || input.importedCase.status !== 'imported') {
    reasons.push('Import a valid Maestro test case.');
  }

  if (!input.prompt.trim()) {
    reasons.push('Enter an Agent instruction.');
  }

  if (input.environment && !input.environment.canStartRun) {
    reasons.push(...input.environment.blockers);
  }

  const uniqueReasons = uniqueMessages(reasons);

  return {
    canStart: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    selectedDevice
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

export function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(timestamp);
}

export function formatDuration(start: string, end: string): string {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 'Pending';
  }

  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));

  return `${seconds}s`;
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
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
}): TestReport {
  const { run, device, testCase, error } = input;
  const failureReason = redactReportText(run.failureReason);
  const summary = redactReportText(error) ?? failureReason ?? 'Run accepted by the local runtime.';
  const target = device ? `${device.name} (${device.platform})` : run.deviceId;
  const testCaseName = testCase?.name ?? run.caseId;
  const safeTarget = redactReportText(target) ?? '';
  const safeTestCaseName = redactReportText(testCaseName) ?? '';
  const prompt = redactReportText(run.prompt) ?? '';

  return {
    runId: run.id,
    title: `Test report for ${safeTestCaseName}`,
    status: run.status,
    generatedAt: run.updatedAt,
    summary,
    targetDevice: safeTarget,
    testCase: safeTestCaseName,
    prompt,
    startedAt: run.startedAt ?? run.createdAt,
    endedAt: run.completedAt ?? run.updatedAt,
    conclusion: formatStatusLabel(run.status),
    failureReason,
    markdown: [
      '# Test report',
      '',
      `- Run: ${run.id}`,
      `- Status: ${run.status}`,
      `- Target: ${safeTarget}`,
      `- Case: ${safeTestCaseName}`,
      `- Prompt: ${prompt}`,
      `- Duration: ${formatDuration(run.createdAt, run.updatedAt)}`,
      ...(failureReason ? [`- Failure: ${failureReason}`] : [])
    ].join('\n')
  };
}

export function getReportFormatLabel(format: ReportFormat): string {
  return format === 'markdown' ? 'Markdown' : 'Page';
}

export function normalizeViewerInput(value: string): string {
  return normalizeViewerUrl(value);
}
