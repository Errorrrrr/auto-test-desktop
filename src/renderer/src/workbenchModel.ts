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
};

export type FileCandidate = {
  name: string;
  size: number;
  path?: string;
};

export function createInitialUploadState(language: Language = DEFAULT_LANGUAGE): UploadState {
  return {
    name: '',
    status: 'idle',
    detail: localizeText(`Supported formats: .yaml, .yml. Maximum size: ${MAX_UPLOAD_SIZE_MB} MB.`, language)
  };
}

export function createInitialViewerProbeState(language: Language = DEFAULT_LANGUAGE): ViewerProbeState {
  return {
    status: 'unchecked',
    detail: localizeText('Local viewer reachability has not been checked in this session.', language)
  };
}

export const INITIAL_UPLOAD_STATE: UploadState = createInitialUploadState('en');
export const INITIAL_VIEWER_PROBE_STATE: ViewerProbeState = createInitialViewerProbeState('en');

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
}, language: Language = DEFAULT_LANGUAGE): RunReadiness {
  const selectedDevice = getSelectedDevice(input.devices, input.selectedDeviceId);
  const reasons: string[] = [];

  if (!input.environment) {
    reasons.push(localizeText('Runtime status is still loading.', language));
  }

  if (!selectedDevice) {
    reasons.push(localizeText('Select a connected Android or iOS device.', language));
  } else if (!isExecutableDevice(selectedDevice)) {
    reasons.push(localizeText('Selected device is not connected for execution.', language));
  }

  if (!input.importedCase || input.importedCase.status !== 'imported') {
    reasons.push(localizeText('Import a valid Maestro test case.', language));
  }

  if (!input.prompt.trim()) {
    reasons.push(localizeText('Enter an Agent instruction.', language));
  }

  if (input.environment && !input.environment.canStartRun) {
    reasons.push(...input.environment.blockers.map((blocker) => localizeText(blocker, language)));
  }

  const uniqueReasons = uniqueMessages(reasons);

  return {
    canStart: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    selectedDevice
  };
}

export function validateViewerUrl(value: string, language: Language = DEFAULT_LANGUAGE): ViewerProbeState | null {
  if (isAllowedLocalViewerUrl(value)) {
    return null;
  }

  return {
    status: 'blocked',
    detail: localizeText('Viewer URL must point to localhost, 127.0.0.1, or ::1.', language)
  };
}

export function mapViewerProbeResult(
  result: ViewerProbeResult,
  language: Language = DEFAULT_LANGUAGE
): ViewerProbeState {
  if (!result.allowed) {
    return {
      status: 'blocked',
      detail: localizeText(result.detail, language)
    };
  }

  const reachableToStatus: Record<ViewerReachability, ViewerProbeState['status']> = {
    unchecked: 'accepted',
    reachable: 'reachable',
    unreachable: 'unreachable'
  };

  return {
    status: reachableToStatus[result.reachable],
    detail: localizeText(result.detail, language)
  };
}

export function validateCaseFile(
  file: FileCandidate,
  language: Language = DEFAULT_LANGUAGE
): { valid: true } | { valid: false; detail: string } {
  if (!/\.ya?ml$/i.test(file.name)) {
    return {
      valid: false,
      detail: localizeText('Supported formats: .yaml, .yml.', language)
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      detail: localizeText('The selected file is empty.', language)
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      detail: localizeText(`File is larger than ${MAX_UPLOAD_SIZE_MB} MB.`, language)
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

export function getErrorMessage(error: unknown, language: Language = DEFAULT_LANGUAGE): string {
  if (error instanceof Error && error.message) {
    return localizeText(error.message, language);
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message) {
      return localizeText(message, language);
    }
  }

  return localizeText('Unexpected local runtime error.', language);
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
}, language: Language = DEFAULT_LANGUAGE): TestReport {
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
