import {
  Activity,
  Apple,
  Ban,
  Bot,
  Cable,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileText,
  History,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Settings2,
  Smartphone,
  Trash2,
  UploadCloud
} from 'lucide-react';
import { ChangeEvent, FormEvent, ReactElement, useEffect, useMemo, useState } from 'react';

import { createRuntimeSnapshot } from '../../shared/runtimeSnapshot';
import type {
  AgentMessage,
  AgentSession,
  AppAutoTestApi,
  DeviceInfo,
  DevicePlatform,
  EnvironmentStatus,
  ServiceHealth,
  TaskReport,
  TestTask,
  ViewerConfig
} from '../../shared/types';
import { getViewerConfig, isAllowedLocalViewerUrl } from '../../shared/viewerConfig';
import {
  COPY,
  Language,
  localizeText,
  persistLanguage,
  readStoredLanguage
} from './rendererI18n';
import {
  AsyncStatus,
  UploadState,
  ViewerProbeState,
  createInitialUploadState,
  createInitialViewerProbeState,
  createCaseImportRequest,
  formatDateTime,
  formatDuration,
  getDeviceInspectionSummary,
  buildTaskRunLogSummaries,
  formatStatusLabel,
  getErrorMessage,
  getExecutableDevices,
  getPreferredDeviceId,
  getRunActionStatusForTaskStatus,
  getReportFormatLabel,
  getRunReadiness,
  getSelectedTaskAfterRefresh,
  getSelectedDevice,
  getStatusTone,
  hasStartedDeviceAppeared,
  isExecutableDevice,
  isStartableDevice,
  isStoppableDevice,
  mapDeviceStartResultToAction,
  mapDeviceStopResultToAction,
  mapViewerProbeResult,
  normalizeViewerInput,
  upsertTaskList,
  validateCaseFile,
  validateViewerUrl
} from './workbenchModel';
import type { RunReadiness } from './workbenchModel';

type ViewerOpener = (url: string, target: string, features: string) => Window | null;

type RunActionState = {
  status: AsyncStatus;
  detail: string;
};

type DeviceActionState = RunActionState & {
  deviceId?: string;
};

type DevicePanelDensity = 'comfortable' | 'compact';
type DevicePlatformGroup = {
  platform: DevicePlatform;
  label: string;
  devices: DeviceInfo[];
};

type TaskWorkspaceState = {
  selectedDeviceId: string;
  prompt: string;
  targetAppId: string;
  uploadState: UploadState;
  runAction: RunActionState;
  reportExport: RunActionState;
  report: TaskReport | null;
  agentMessages: AgentMessage[];
};

const DEVICE_START_REFRESH_DELAYS_MS = [1200, 2500, 5000];

type MenuPage = 'overview' | 'task' | 'devices' | 'viewer';

const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout', 'blocked']);
const ACTIVE_TASK_STATUSES = new Set(['queued', 'running']);
const RUN_STATUS_POLL_INTERVAL_MS = 1_000;
const RUN_STATUS_POLL_TIMEOUT_MS = 10 * 60_000;

function createIdleRunAction(): RunActionState {
  return {
    status: 'idle',
    detail: 'No run has been started.'
  };
}

function createIdleReportExportAction(): RunActionState {
  return {
    status: 'idle',
    detail: 'Report has not been exported.'
  };
}

function createInitialTaskWorkspaceState(task?: TestTask): TaskWorkspaceState {
  return {
    selectedDeviceId: task?.deviceId ?? '',
    prompt: task?.input.naturalLanguage?.prompt ?? '',
    targetAppId: task?.targetAppId ?? '',
    uploadState: createInitialUploadState(),
    runAction: createIdleRunAction(),
    reportExport: createIdleReportExportAction(),
    report: null,
    agentMessages: []
  };
}

function isTerminalTaskStatus(status: TestTask['status']): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

function isActiveTaskStatus(status: TestTask['status']): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

function createBrowserFallbackTask(options: {
  id?: string;
  name?: string;
  description?: string;
  prompt?: string;
  status?: TestTask['status'];
  targetAppId?: string;
  failureReason?: string;
} = {}): TestTask {
  const now = new Date().toISOString();
  const prompt = options.prompt?.trim();

  return {
    id: options.id ?? `browser-task-${Date.now()}`,
    name: options.name ?? 'Browser fallback task',
    ...(options.description ? { description: options.description } : {}),
    ...(options.targetAppId ? { targetAppId: options.targetAppId } : {}),
    status: options.status ?? (prompt ? 'ready' : 'draft'),
    input: {
      mode: prompt ? 'natural_language' : 'empty',
      ...(prompt
        ? {
            naturalLanguage: {
              prompt,
              updatedAt: now
            }
          }
        : {}),
      blockers: prompt ? [] : ['Task input is required before execution.']
    },
    workspacePath: 'browser-fallback/tasks',
    createdAt: now,
    updatedAt: now,
    ...(options.failureReason ? { failureReason: options.failureReason } : {})
  };
}

function createBrowserFallbackTaskReport(taskId: string, summary: string): TaskReport {
  const now = new Date().toISOString();

  return {
    taskId,
    title: 'Task report unavailable',
    status: 'blocked',
    inputMode: 'empty',
    inputSummary: 'Browser fallback cannot read task workspace state.',
    targetDevice: 'browser-device',
    startedAt: now,
    endedAt: now,
    conclusion: 'Blocked before execution',
    failureReason: summary,
    artifacts: [],
    markdown: `# Task report unavailable\n\n${summary}`
  };
}

function createBrowserFallbackWebDevice(): DeviceInfo {
  return {
    id: 'web-viewer',
    name: 'Web Viewer',
    platform: 'web',
    type: 'unknown',
    connected: true,
    state: getViewerConfig({}).url
  };
}

function createBrowserFallbackApi(): AppAutoTestApi {
  const copy = COPY.en;

  return {
    env: {
      getStatus: async () => {
        const snapshot = createRuntimeSnapshot(getViewerConfig({}));

        return {
          generatedAt: snapshot.generatedAt,
          ...snapshot.environment,
          canStartRun: snapshot.canStartRun,
          blockers: snapshot.blockers,
          capabilities: snapshot.capabilities
        };
      }
    },
    devices: {
      list: async () => [createBrowserFallbackWebDevice()],
      start: async (deviceId: string) => ({
        deviceId,
        status: 'failed',
        detail: 'Device launch is only available in the Electron desktop runtime.'
      }),
      stop: async (deviceId: string) => ({
        deviceId,
        status: 'failed',
        detail: 'Device shutdown is only available in the Electron desktop runtime.'
      })
    },
    viewer: {
      getConfig: async () => getViewerConfig({}),
      probe: async (url: string) => ({
        url: normalizeViewerInput(url),
        allowed: isAllowedLocalViewerUrl(url),
        reachable: 'unchecked',
        detail: isAllowedLocalViewerUrl(url)
          ? 'Local viewer target accepted by the renderer fallback.'
          : 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
      })
    },
    cases: {
      import: async (request) => ({
        id: `browser-case-${Date.now()}`,
        name: request.displayName ?? request.sourcePath,
        sourcePath: request.sourcePath,
        format: 'yaml',
        importedAt: new Date().toISOString(),
        status: 'imported',
        validationMessages: []
      })
    },
    runs: {
      start: async (request) => ({
        id: `browser-run-${Date.now()}`,
        caseId: request.caseId,
        deviceId: request.deviceId,
        prompt: request.prompt,
        status: 'blocked',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        failureReason: 'Browser fallback cannot start local runs.'
      }),
      cancel: async (runId) => ({
        id: runId,
        caseId: 'browser-case',
        deviceId: 'browser-device',
        prompt: '',
        status: 'cancelled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      getStatus: async (runId) => ({
        id: runId,
        caseId: 'browser-case',
        deviceId: 'browser-device',
        prompt: '',
        status: 'blocked',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        failureReason: 'Browser fallback cannot poll local runs.'
      })
    },
    reports: {
      get: async (runId) => {
        const generatedAt = new Date().toISOString();
        const summary = 'Report generation requires the Electron main process.';

        return {
          runId,
          title: copy.report.fallbackTitle,
          status: 'blocked',
          generatedAt,
          summary,
          targetDevice: 'browser-device',
          testCase: 'browser-case',
          prompt: '',
          startedAt: generatedAt,
          endedAt: generatedAt,
          conclusion: 'Blocked before execution',
          failureReason: summary,
          markdown: `# ${copy.report.fallbackTitle}\n\n${summary}`
        };
      },
      export: async (request) => {
        const generatedAt = new Date().toISOString();
        const summary = 'Report export requires the Electron main process.';

        return {
          runId: request.runId,
          title: `${getReportFormatLabel(request.format, 'en')} ${copy.report.fallbackTitle}`,
          status: 'blocked',
          generatedAt,
          summary,
          targetDevice: 'browser-device',
          testCase: 'browser-case',
          prompt: '',
          startedAt: generatedAt,
          endedAt: generatedAt,
          conclusion: 'Blocked before execution',
          failureReason: summary,
          markdown: `# ${copy.report.fallbackTitle}\n\n${summary}`
        };
      }
    },
    tasks: {
      create: async (request) =>
        createBrowserFallbackTask({
          name: request.name,
          description: request.description
        }),
      list: async () => [],
      get: async (taskId) =>
        createBrowserFallbackTask({
          id: taskId
        }),
      delete: async (taskId) =>
        createBrowserFallbackTask({
          id: taskId,
          status: 'cancelled'
        }),
      updateInput: async (request) =>
        createBrowserFallbackTask({
          id: request.taskId,
          prompt: request.prompt,
          targetAppId: request.targetAppId
        }),
      importCase: async (request) =>
        createBrowserFallbackTask({
          id: request.taskId,
          status: 'blocked',
          failureReason: 'Task-scoped imports require the Electron main process.'
        }),
      start: async (request) =>
        createBrowserFallbackTask({
          id: request.taskId,
          status: 'blocked',
          failureReason: 'Task execution requires the Electron main process.'
        }),
      cancel: async (taskId) =>
        createBrowserFallbackTask({
          id: taskId,
          status: 'cancelled',
          failureReason: 'Browser fallback cannot cancel local task execution.'
        }),
      getReport: async (taskId) =>
        createBrowserFallbackTaskReport(
          taskId,
          'Task report generation requires the Electron main process.'
        ),
      exportReport: async (request) =>
        createBrowserFallbackTaskReport(
          request.taskId,
          `${getReportFormatLabel(request.format, 'en')} task report export requires the Electron main process.`
        )
    },
    agent: {
      createSession: async () => ({
        id: `browser-session-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: 'unavailable'
      }),
      sendMessage: async (request) => ({
        id: `browser-message-${Date.now()}`,
        sessionId: request.sessionId,
        role: 'assistant',
        content: 'Browser fallback cannot reach local agents.',
        createdAt: new Date().toISOString()
      })
    }
  };
}

function getApi(): AppAutoTestApi {
  return window.appAutoTest ?? createBrowserFallbackApi();
}

function replaceDeviceInList(
  currentDevices: DeviceInfo[],
  previousDeviceId: string,
  nextDevice: DeviceInfo
): DeviceInfo[] {
  let replaced = false;
  const nextDevices = currentDevices.map((device) => {
    if (device.id === previousDeviceId || device.id === nextDevice.id) {
      replaced = true;
      return nextDevice;
    }

    return device;
  });
  const mergedDevices = replaced ? nextDevices : [...nextDevices, nextDevice];
  const byId = new Map<string, DeviceInfo>();

  for (const device of mergedDevices) {
    byId.set(device.id, device);
  }

  return Array.from(byId.values());
}

function StatusPill({ status, language }: { status: string; language: Language }): ReactElement {
  return (
    <span className={`status-pill status-${getStatusTone(status)}`}>
      {formatStatusLabel(status, language)}
    </span>
  );
}

function EmptyDeviceState({ language }: { language: Language }): ReactElement {
  const copy = COPY[language];

  return (
    <div className="empty-state">
      <Ban aria-hidden="true" size={20} />
      <div>
        <strong>{copy.empty.noExecutableDevicesTitle}</strong>
        <span>{copy.empty.noExecutableDevicesDetail}</span>
      </div>
    </div>
  );
}

function isDeviceInspectionActionDetail(detail: string): boolean {
  return /^Found \d+ supported device\(s\): \d+ connected, \d+ virtual, \d+ physical\.$/.test(detail);
}

const DEVICE_PLATFORM_ORDER: DevicePlatform[] = ['android', 'ios', 'web', 'unknown'];

function getDevicePlatformLabel(platform: DevicePlatform): string {
  const labels: Record<DevicePlatform, string> = {
    android: 'Android',
    ios: 'iOS',
    unknown: 'Other',
    web: 'Web'
  };

  return labels[platform];
}

function getDeviceSubtitle(device: DeviceInfo): string {
  const platformLabel = getDevicePlatformLabel(device.platform);
  const detail = device.state ?? (device.type === 'unknown' ? '' : device.type);

  return detail ? `${platformLabel} / ${detail}` : platformLabel;
}

function renderDevicePlatformIcon(platform: DevicePlatform, size = 20): ReactElement {
  const iconProps = {
    'aria-hidden': true,
    className: 'device-platform-icon',
    size
  };

  if (platform === 'android') {
    return <Bot {...iconProps} />;
  }

  if (platform === 'ios') {
    return <Apple {...iconProps} />;
  }

  if (platform === 'web') {
    return <MonitorSmartphone {...iconProps} />;
  }

  return <Smartphone {...iconProps} />;
}

function groupDevicesByPlatform(devices: DeviceInfo[]): DevicePlatformGroup[] {
  const groupedDevices = devices.reduce<Map<DevicePlatform, DeviceInfo[]>>((groups, device) => {
    groups.set(device.platform, [...(groups.get(device.platform) ?? []), device]);
    return groups;
  }, new Map());

  return DEVICE_PLATFORM_ORDER
    .map((platform) => ({
      platform,
      label: getDevicePlatformLabel(platform),
      devices: groupedDevices.get(platform) ?? []
    }))
    .filter((group) => group.devices.length > 0);
}

function ServiceStatusCard({
  icon,
  title,
  health,
  footer,
  language
}: {
  icon: ReactElement;
  title: string;
  health?: ServiceHealth;
  footer?: string;
  language: Language;
}): ReactElement {
  return (
    <article className="panel status-card">
      <div className="panel-heading split">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        <StatusPill status={health?.status ?? 'not_configured'} language={language} />
      </div>
      <p>{localizeText(health?.detail ?? 'Loading runtime status.', language)}</p>
      {footer ? <span className="subtle-line">{footer}</span> : null}
    </article>
  );
}

export function openAllowedViewerUrl(value: string, opener: ViewerOpener): boolean {
  const url = value.trim();

  if (!isAllowedLocalViewerUrl(url)) {
    return false;
  }

  opener(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function DeviceListPanel({
  devices,
  density = 'comfortable',
  framed = true,
  selectedDeviceId,
  onSelectDevice,
  onCheckDevices,
  onStartDevice,
  onStopDevice,
  deviceAction,
  language = 'en',
  selectionMode = 'select'
}: {
  devices: DeviceInfo[];
  density?: DevicePanelDensity;
  framed?: boolean;
  selectedDeviceId?: string;
  onSelectDevice?: (deviceId: string) => void;
  onCheckDevices?: () => void;
  onStartDevice?: (device: DeviceInfo) => void;
  onStopDevice?: (device: DeviceInfo) => void;
  deviceAction?: DeviceActionState;
  language?: Language;
  selectionMode?: 'manage' | 'select';
}): ReactElement {
  const executableDevices = getExecutableDevices(devices);
  const summary = getDeviceInspectionSummary(devices);
  const copy = COPY[language];
  const checkingDevices = deviceAction?.status === 'busy' && !deviceAction.deviceId;
  const selectable = selectionMode === 'select';
  const compact = selectable && density === 'compact';
  const [compactPickerOpen, setCompactPickerOpen] = useState(false);
  const selectedDevice = getSelectedDevice(devices, selectedDeviceId ?? '');
  const showDeviceActionDetail = Boolean(
    deviceAction &&
      !isDeviceInspectionActionDetail(deviceAction.detail) &&
      (!compact || deviceAction.status === 'error' || deviceAction.deviceId)
  );
  const panelClassName = [
    framed ? 'panel device-panel' : 'device-panel',
    compact ? 'compact-device-panel' : ''
  ].filter(Boolean).join(' ');
  const devicePlatformGroups = groupDevicesByPlatform(devices);
  const compactOptionsId = 'task-device-options';
  const renderDeviceRow = (device: DeviceInfo): ReactElement => {
    const executable = isExecutableDevice(device);
    const startable = isStartableDevice(device);
    const stoppable = isStoppableDevice(device);
    const busyDevice = deviceAction?.status === 'busy' && deviceAction.deviceId === device.id;
    const selected = selectedDeviceId === device.id;

    return (
      <li
        key={device.id}
        className={[
          'device-row',
          selected ? 'selected' : '',
          executable ? '' : 'disabled-row'
        ].filter(Boolean).join(' ')}
      >
        {selectable ? (
          <label className="device-row-main">
            <input
              type="radio"
              name="target-device"
              checked={selectedDeviceId === device.id}
              disabled={!executable}
              onChange={() => onSelectDevice?.(device.id)}
            />
            {renderDevicePlatformIcon(device.platform, 18)}
            <span>
              <strong>{device.name}</strong>
              <small>{getDeviceSubtitle(device)}</small>
            </span>
          </label>
        ) : (
          <div className="device-row-info">
            {renderDevicePlatformIcon(device.platform, 18)}
            <span>
              <strong>{device.name}</strong>
              <small>{getDeviceSubtitle(device)}</small>
            </span>
          </div>
        )}
        <div className="device-actions">
          <StatusPill
            status={device.connected ? 'ready' : 'disconnected'}
            language={language}
          />
          {startable && onStartDevice ? (
            <button
              className="icon-button compact-button"
              disabled={deviceAction?.status === 'busy'}
              onClick={() => onStartDevice(device)}
              title={copy.titlesAttr.startVirtualDevice}
              type="button"
            >
              {busyDevice ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Power size={16} aria-hidden="true" />
              )}
              {copy.actions.startDevice}
            </button>
          ) : null}
          {stoppable && onStopDevice ? (
            <button
              className="icon-button compact-button"
              disabled={deviceAction?.status === 'busy'}
              onClick={() => onStopDevice(device)}
              title={copy.titlesAttr.stopVirtualDevice}
              type="button"
            >
              {busyDevice ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <PowerOff size={16} aria-hidden="true" />
              )}
              {copy.actions.stopDevice}
            </button>
          ) : null}
        </div>
      </li>
    );
  };
  const renderCompactDeviceOption = (device: DeviceInfo): ReactElement => {
    const executable = isExecutableDevice(device);
    const selected = selectedDeviceId === device.id;
    const startable = isStartableDevice(device);
    const stoppable = isStoppableDevice(device);
    const busyDevice = deviceAction?.status === 'busy' && deviceAction.deviceId === device.id;

    return (
      <li
        key={device.id}
        className={[
          'device-picker-option-item',
          selected ? 'selected' : '',
          executable ? '' : 'disabled-row'
        ].filter(Boolean).join(' ')}
      >
        <button
          aria-pressed={selected}
          className="device-picker-option"
          disabled={!executable}
          onClick={() => {
            onSelectDevice?.(device.id);
            setCompactPickerOpen(false);
          }}
          type="button"
        >
          {renderDevicePlatformIcon(device.platform)}
          <span>
            <strong>{device.name}</strong>
            <small>{getDeviceSubtitle(device)}</small>
          </span>
        </button>
        {startable && onStartDevice ? (
          <button
            className="icon-button compact-button"
            disabled={deviceAction?.status === 'busy'}
            onClick={() => onStartDevice(device)}
            title={copy.titlesAttr.startVirtualDevice}
            type="button"
          >
            {busyDevice ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <Power size={16} aria-hidden="true" />
            )}
            {copy.actions.startDevice}
          </button>
        ) : null}
        {stoppable && onStopDevice ? (
          <button
            className="icon-button compact-button"
            disabled={deviceAction?.status === 'busy'}
            onClick={() => onStopDevice(device)}
            title={copy.titlesAttr.stopVirtualDevice}
            type="button"
          >
            {busyDevice ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <PowerOff size={16} aria-hidden="true" />
            )}
            {copy.actions.stopDevice}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <article className={panelClassName} id={selectable ? 'task-devices' : 'devices'}>
      <div className="panel-heading split">
        <div>
          <Smartphone size={20} aria-hidden="true" />
          <h2>{selectable ? copy.titles.devices : copy.titles.deviceManagement}</h2>
        </div>
        <div className="heading-actions">
          {onCheckDevices ? (
            <button
              className="icon-button"
              disabled={checkingDevices}
              onClick={onCheckDevices}
              title={copy.titlesAttr.checkDevices}
              type="button"
            >
              {checkingDevices ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <RefreshCw size={18} aria-hidden="true" />
              )}
              {copy.actions.checkDevices}
            </button>
          ) : null}
          <StatusPill
            status={executableDevices.length ? 'ready' : 'disconnected'}
            language={language}
          />
        </div>
      </div>

      {compact && devices.length ? (
        <div className="compact-device-control">
          <button
            aria-controls={compactOptionsId}
            aria-expanded={compactPickerOpen}
            className="device-select-trigger"
            onClick={() => setCompactPickerOpen((open) => !open)}
            type="button"
          >
            <span className={selectedDevice ? '' : 'device-select-placeholder'}>
              {selectedDevice?.name ?? copy.runtime.notSelected}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={compactPickerOpen ? 'device-select-chevron expanded' : 'device-select-chevron'}
              size={20}
            />
          </button>
          <div className="device-picker-menu" hidden={!compactPickerOpen} id={compactOptionsId}>
            {devicePlatformGroups.map((group) => (
              <section key={group.platform} className="device-picker-group" aria-label={group.label}>
                <div className="device-picker-heading">{group.label}</div>
                <ul className="device-picker-list">{group.devices.map(renderCompactDeviceOption)}</ul>
              </section>
            ))}
          </div>
        </div>
      ) : devices.length ? (
        <div className="device-platform-groups">
          {devicePlatformGroups.map((group) => (
            <section key={group.platform} className="device-platform-group" aria-label={group.label}>
              <div className="device-platform-heading">
                <span>{group.label}</span>
                <small>{group.devices.length}</small>
              </div>
              <ul className="device-list">{group.devices.map(renderDeviceRow)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyDeviceState language={language} />
      )}

      {devices.length ? (
        <p className="muted">
          {copy.runtime.deviceInspectionSummary(
            summary.totalSupported,
            summary.connected,
            summary.virtual,
            summary.physical
          )}
        </p>
      ) : null}
      {showDeviceActionDetail && deviceAction ? (
        <p className={deviceAction.status === 'error' ? 'validation-message' : 'muted'}>
          {localizeText(deviceAction.detail, language)}
        </p>
      ) : null}
      {devices.length && !executableDevices.length ? <EmptyDeviceState language={language} /> : null}
    </article>
  );
}

export function ReportPanel({
  framed = true,
  report,
  exportState,
  onExportMarkdown,
  language = 'en'
}: {
  framed?: boolean;
  report: TaskReport | null;
  exportState: RunActionState;
  onExportMarkdown: () => void;
  language?: Language;
}): ReactElement {
  const copy = COPY[language];

  if (!report) {
    return (
      <article className={framed ? 'panel' : ''} id="report">
        <div className="panel-heading">
          <FileText size={20} aria-hidden="true" />
          <h2>{copy.titles.report}</h2>
        </div>
        <div className="empty-state">
          <FileText size={20} aria-hidden="true" />
          <div>
            <strong>{copy.empty.noReportTitle}</strong>
            <span>{copy.empty.noReportDetail}</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={framed ? 'panel report-panel' : 'report-panel'} id="report">
      <div className="panel-heading split">
        <div>
          <FileText size={20} aria-hidden="true" />
          <h2>{localizeText(report.title, language)}</h2>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            disabled={exportState.status === 'busy'}
            onClick={onExportMarkdown}
            title={copy.titlesAttr.exportMarkdown}
          >
            {exportState.status === 'busy' ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <FileText size={18} aria-hidden="true" />
            )}
            {copy.actions.export}
          </button>
          <StatusPill status={report.status} language={language} />
        </div>
      </div>

      <dl className="metric-grid">
        <div>
          <dt>{copy.fields.target}</dt>
          <dd>{report.targetDevice}</dd>
        </div>
        <div>
          <dt>{copy.fields.case}</dt>
          <dd>{report.inputSummary}</dd>
        </div>
        <div>
          <dt>{copy.fields.duration}</dt>
          <dd>{formatDuration(report.startedAt, report.endedAt, language)}</dd>
        </div>
        <div>
          <dt>{copy.fields.generated}</dt>
          <dd>{formatDateTime(report.endedAt, language)}</dd>
        </div>
      </dl>

      <p>{localizeText(report.conclusion, language)}</p>
      {exportState.status !== 'idle' ? (
        <p className="muted">{localizeText(exportState.detail, language)}</p>
      ) : null}
      {report.failureReason ? (
        <p className="validation-message">{localizeText(report.failureReason, language)}</p>
      ) : null}
      <pre className="report-markdown">{report.markdown}</pre>
    </article>
  );
}

export function TaskWorkspacePanel({
  agentMessages = [],
  currentTaskCase,
  currentTask,
  deletingTaskId,
  deviceAction,
  devices = [],
  report = null,
  reportExport = createIdleReportExportAction(),
  language = 'en',
  onCancelRun,
  onCaseUpload,
  onCreateTask,
  onDeleteTask,
  onExportMarkdown,
  onCheckDevices,
  onPromptChange,
  onSelectDevice,
  onSelectTask,
  onStartDevice,
  onStartRun,
  onStopDevice,
  onTargetAppIdChange,
  onTaskDescriptionChange,
  onTaskNameChange,
  prompt = '',
  readiness,
  runAction = createIdleRunAction(),
  selectedDevice,
  selectedDeviceId = '',
  taskAction,
  taskDescription,
  taskEditable = Boolean(currentTask),
  targetAppId = '',
  taskName,
  uploadState = createInitialUploadState(),
  tasks
}: {
  agentMessages?: AgentMessage[];
  currentTaskCase?: NonNullable<TestTask['input']['testCase']>;
  currentTask: TestTask | null;
  deletingTaskId?: string;
  deviceAction?: DeviceActionState;
  devices?: DeviceInfo[];
  report?: TaskReport | null;
  reportExport?: RunActionState;
  language?: Language;
  onCancelRun?: () => void;
  onCaseUpload?: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteTask?: (taskId: string) => void;
  onExportMarkdown?: () => void;
  onNavigate?: (page: MenuPage) => void;
  onCheckDevices?: () => void;
  onPromptChange?: (value: string) => void;
  onSelectDevice?: (deviceId: string) => void;
  onSelectTask: (taskId: string) => void;
  onStartDevice?: (device: DeviceInfo) => void;
  onStartRun?: () => void;
  onStopDevice?: (device: DeviceInfo) => void;
  onTargetAppIdChange?: (value: string) => void;
  onTaskDescriptionChange: (value: string) => void;
  onTaskNameChange: (value: string) => void;
  prompt?: string;
  readiness?: RunReadiness;
  runAction?: RunActionState;
  selectedDevice?: DeviceInfo;
  selectedDeviceId?: string;
  taskAction: RunActionState;
  taskDescription: string;
  taskEditable?: boolean;
  targetAppId?: string;
  taskName: string;
  uploadState?: UploadState;
  tasks: TestTask[];
}): ReactElement {
  const copy = COPY[language];
  const taskInputMode = currentTask?.input.mode ?? 'empty';
  const executionReadiness: RunReadiness =
    readiness ?? {
      canStart: false,
      inputMode: taskInputMode,
      reasons: [currentTask ? 'Select a connected Android or iOS device.' : 'Create a test task before execution.'],
      ...(selectedDevice ? { selectedDevice } : {})
    };
  const taskRunLogs = buildTaskRunLogSummaries(currentTask);
  const runButtonLabel =
    currentTask && (currentTask.latestRunId || currentTask.runIds?.length) && !isActiveTaskStatus(currentTask.status)
      ? copy.actions.retest
      : copy.actions.startRun;

  return (
    <section className="task-workspace-layout" id="task">
      <article className="panel task-list-panel">
        <div className="panel-heading split">
          <div>
            <ClipboardList size={20} aria-hidden="true" />
            <h2>{copy.titles.taskList}</h2>
          </div>
          <StatusPill status={currentTask?.status ?? taskAction.status} language={language} />
        </div>

        <form className="task-form" onSubmit={onCreateTask}>
          <label className="field-label" htmlFor="task-name">
            {copy.fields.name}
          </label>
          <input
            id="task-name"
            className="text-input"
            value={taskName}
            onChange={(event) => onTaskNameChange(event.target.value)}
            placeholder={copy.copy.taskNamePlaceholder}
          />
          <label className="field-label" htmlFor="task-description">
            {copy.fields.description}
          </label>
          <textarea
            id="task-description"
            className="text-input task-description-input"
            value={taskDescription}
            onChange={(event) => onTaskDescriptionChange(event.target.value)}
            placeholder={copy.copy.taskDescriptionPlaceholder}
          />
          <button
            className="primary-button"
            disabled={taskAction.status === 'busy'}
            type="submit"
          >
            {taskAction.status === 'busy' ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <ClipboardList size={18} aria-hidden="true" />
            )}
            {copy.actions.createTask}
          </button>
        </form>

        <p className={taskAction.status === 'error' ? 'validation-message' : 'muted'}>
          {localizeText(taskAction.detail, language)}
        </p>

        {tasks.length ? (
          <ol className="task-list" aria-label={copy.titles.taskList}>
            {tasks.map((task) => {
              const selected = currentTask?.id === task.id;
              const deleting = deletingTaskId === task.id;
              const deleteBlocked = isActiveTaskStatus(task.status);

              return (
                <li key={task.id}>
                  <div className={selected ? 'task-list-item active' : 'task-list-item'}>
                    <button
                      className="task-list-main"
                      type="button"
                      aria-pressed={selected}
                      data-task-id={task.id}
                      onClick={() => onSelectTask(task.id)}
                    >
                      <span className="task-list-copy">
                        <strong>{task.name}</strong>
                        <small>{formatDateTime(task.updatedAt, language)}</small>
                      </span>
                      <StatusPill status={task.status} language={language} />
                    </button>
                    <button
                      className="icon-button compact-button danger-button"
                      data-delete-task-id={task.id}
                      disabled={!onDeleteTask || deleting || deleteBlocked}
                      onClick={() => onDeleteTask?.(task.id)}
                      title={deleteBlocked ? copy.titlesAttr.deleteRunningTask : copy.titlesAttr.deleteTask}
                      type="button"
                    >
                      {deleting ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : (
                        <Trash2 size={16} aria-hidden="true" />
                      )}
                      {copy.actions.deleteTask}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="empty-state">
            <ClipboardList aria-hidden="true" size={20} />
            <div>
              <strong>{copy.empty.noTasksTitle}</strong>
              <span>{copy.empty.noTasksDetail}</span>
            </div>
          </div>
        )}
      </article>

      <article className="panel task-detail-panel">
        <div className="panel-heading split">
          <div>
            <Activity size={20} aria-hidden="true" />
            <h2>{currentTask ? currentTask.name : copy.titles.taskDetailWorkspace}</h2>
          </div>
          <div className="heading-actions">
            {currentTask ? (
              <button
                className="icon-button compact-button danger-button"
                disabled={!onDeleteTask || deletingTaskId === currentTask.id || isActiveTaskStatus(currentTask.status)}
                onClick={() => onDeleteTask?.(currentTask.id)}
                title={
                  isActiveTaskStatus(currentTask.status)
                    ? copy.titlesAttr.deleteRunningTask
                    : copy.titlesAttr.deleteTask
                }
                type="button"
              >
                {deletingTaskId === currentTask.id ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
                {copy.actions.deleteTask}
              </button>
            ) : null}
            <StatusPill status={currentTask?.status ?? 'idle'} language={language} />
          </div>
        </div>

        {currentTask ? (
          <>
            {currentTask.description ? <p>{currentTask.description}</p> : null}
            <dl className="metric-grid">
              <div>
                <dt>{copy.fields.task}</dt>
                <dd>{currentTask.id}</dd>
              </div>
              <div>
                <dt>{copy.fields.status}</dt>
                <dd>{formatStatusLabel(currentTask.status, language)}</dd>
              </div>
              <div>
                <dt>{copy.fields.input}</dt>
                <dd>{formatStatusLabel(currentTask.input.mode, language)}</dd>
              </div>
              <div>
                <dt>{copy.fields.created}</dt>
                <dd>{formatDateTime(currentTask.createdAt, language)}</dd>
              </div>
              <div>
                <dt>{copy.fields.run}</dt>
                <dd>{currentTask.latestRunId ?? copy.runtime.notStarted}</dd>
              </div>
              <div>
                <dt>{copy.fields.device}</dt>
                <dd>{currentTask.deviceSnapshot?.name ?? currentTask.deviceId ?? copy.runtime.notSelected}</dd>
              </div>
            </dl>

            <div className="task-detail-sections">
              <section className="task-detail-section" data-task-detail-section="devices">
                <DeviceListPanel
                  devices={devices}
                  density="compact"
                  framed={false}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={onSelectDevice}
                  onCheckDevices={onCheckDevices}
                  onStartDevice={onStartDevice}
                  onStopDevice={onStopDevice}
                  deviceAction={deviceAction}
                  language={language}
                  selectionMode="select"
                />
              </section>

              <section className="task-detail-section" data-task-detail-section="input">
                <div className="panel-heading split">
                  <div>
                    <UploadCloud size={20} aria-hidden="true" />
                    <h2>{copy.titles.taskInput}</h2>
                  </div>
                  <StatusPill status={executionReadiness.inputMode} language={language} />
                </div>
                <p className="muted">{copy.copy.inputHelp}</p>
                <div className="input-method-grid">
                  <div className="input-method">
                    <div className="method-title">
                      <UploadCloud size={18} aria-hidden="true" />
                      <strong>{copy.copy.uploadLabel}</strong>
                      <StatusPill status={uploadState.status} language={language} />
                    </div>
                    <label
                      className={taskEditable ? 'upload-dropzone' : 'upload-dropzone disabled-dropzone'}
                      htmlFor="case-upload"
                    >
                      <UploadCloud size={24} aria-hidden="true" />
                      <strong>{uploadState.name || copy.copy.defaultCaseLabel}</strong>
                      <span>{localizeText(uploadState.detail, language)}</span>
                    </label>
                    <input
                      id="case-upload"
                      className="visually-hidden"
                      type="file"
                      accept=".yaml,.yml"
                      disabled={!taskEditable || !onCaseUpload}
                      onChange={(event) => onCaseUpload?.(event)}
                    />
                  </div>

                  <div className="input-method">
                    <label className="method-title" htmlFor="prompt-input">
                      <MessageSquare size={18} aria-hidden="true" />
                      <strong>{copy.copy.naturalLanguageLabel}</strong>
                    </label>
                    <label className="field-label" htmlFor="target-app-id-input">
                      {copy.fields.targetAppId}
                    </label>
                    <input
                      id="target-app-id-input"
                      className="text-input"
                      value={targetAppId}
                      disabled={!taskEditable}
                      onChange={(event) => onTargetAppIdChange?.(event.target.value)}
                      placeholder={copy.copy.targetAppIdPlaceholder}
                    />
                    <textarea
                      id="prompt-input"
                      className="prompt-input"
                      value={prompt}
                      disabled={!taskEditable}
                      onChange={(event) => onPromptChange?.(event.target.value)}
                      placeholder={copy.copy.promptPlaceholder}
                    />
                    <span className="subtle-line">{copy.copy.promptOnlyLimit}</span>
                  </div>
                </div>
                {currentTaskCase ? (
                  <dl className="metric-grid compact">
                    <div>
                      <dt>{copy.fields.format}</dt>
                      <dd>{currentTaskCase.format.toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt>{copy.fields.imported}</dt>
                      <dd>{formatDateTime(currentTaskCase.importedAt, language)}</dd>
                    </div>
                  </dl>
                ) : null}
              </section>

              <section className="task-detail-section" data-task-detail-section="progress">
                <div className="panel-heading split">
                  <div>
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <h2>{copy.titles.runStatus}</h2>
                  </div>
                  <StatusPill status={currentTask.status} language={language} />
                </div>
                <div className="action-row">
                  <button
                    className="primary-button"
                    disabled={!executionReadiness.canStart || runAction.status === 'busy' || !onStartRun}
                    onClick={() => onStartRun?.()}
                    type="button"
                  >
                    {runAction.status === 'busy' ? (
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Play size={18} aria-hidden="true" />
                    )}
                    {runButtonLabel}
                  </button>
                  {isActiveTaskStatus(currentTask.status) ? (
                    <button
                      className="icon-button"
                      onClick={() => onCancelRun?.()}
                      title={copy.titlesAttr.cancelRun}
                      type="button"
                    >
                      <Ban size={18} aria-hidden="true" />
                      {copy.actions.cancel}
                    </button>
                  ) : null}
                </div>
                <ul className="blocker-list compact">
                  {(executionReadiness.canStart
                    ? [`Ready for ${selectedDevice?.name ?? copy.runtime.selectedDevice}.`]
                    : executionReadiness.reasons
                  ).map((reason) => (
                    <li key={reason}>{localizeText(reason, language)}</li>
                  ))}
                </ul>
                <p>{localizeText(runAction.detail, language)}</p>
                {agentMessages.length ? (
                  <ol className="message-list">
                    {agentMessages.map((message) => (
                      <li key={message.id} className={`message-row message-${message.role}`}>
                        <strong>{copy.roles[message.role]}</strong>
                        <span>{localizeText(message.content, language)}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>

              <section className="task-detail-section" data-task-detail-section="logs">
                <div className="panel-heading split">
                  <div>
                    <History size={20} aria-hidden="true" />
                    <h2>{copy.titles.taskLogs}</h2>
                  </div>
                </div>
                {taskRunLogs.length ? (
                  <ol className="task-run-log-list" aria-label={copy.titles.taskLogs}>
                    {taskRunLogs.map((runLog) => {
                      const summaryMeta = [
                        formatDateTime(runLog.updatedAt, language),
                        runLog.status ? formatStatusLabel(runLog.status, language) : '',
                        copy.runtime.runRecordCount(runLog.detailCount),
                        runLog.reportPath ?? ''
                      ].filter(Boolean);

                      return (
                        <li key={runLog.runId} data-task-run-log-id={runLog.runId}>
                          <details className="task-run-log-details">
                            <summary className="task-run-log-summary">
                              <span className="task-run-log-summary-copy">
                                <strong>{copy.runtime.runSummary(runLog.runId)}</strong>
                                <small>{summaryMeta.join(' / ')}</small>
                              </span>
                              {runLog.status ? (
                                <StatusPill status={runLog.status} language={language} />
                              ) : null}
                            </summary>
                            {runLog.entries.length ? (
                              <ol className="task-log-detail-list">
                                {runLog.entries.map((entry) => {
                                  const detailMeta = [
                                    formatDateTime(entry.createdAt, language),
                                    entry.status ? formatStatusLabel(entry.status, language) : '',
                                    entry.reportPath ?? ''
                                  ].filter(Boolean);

                                  return (
                                    <li key={entry.id}>
                                      <strong>{localizeText(entry.message, language)}</strong>
                                      <small>{detailMeta.join(' / ')}</small>
                                    </li>
                                  );
                                })}
                              </ol>
                            ) : (
                              <p className="muted task-run-log-empty">{copy.empty.noTaskRunDetails}</p>
                            )}
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="empty-state">
                    <History aria-hidden="true" size={20} />
                    <div>
                      <strong>{copy.empty.noTaskLogsTitle}</strong>
                      <span>{copy.empty.noTaskLogsDetail}</span>
                    </div>
                  </div>
                )}
              </section>

              <section className="task-detail-section" data-task-detail-section="report">
                <ReportPanel
                  framed={false}
                  report={report}
                  exportState={reportExport}
                  onExportMarkdown={() => onExportMarkdown?.()}
                  language={language}
                />
              </section>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <ClipboardList aria-hidden="true" size={20} />
            <div>
              <strong>{copy.empty.noSelectedTaskTitle}</strong>
              <span>{copy.empty.noSelectedTaskDetail}</span>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

export function App(): ReactElement {
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [activePage, setActivePage] = useState<MenuPage>('overview');
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | null>(null);
  const [viewerUrl, setViewerUrl] = useState(getViewerConfig({}).url);
  const [viewerProbe, setViewerProbe] = useState<ViewerProbeState>(() => createInitialViewerProbeState());
  const [tasks, setTasks] = useState<TestTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskWorkspaceById, setTaskWorkspaceById] = useState<Record<string, TaskWorkspaceState>>({});
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAction, setTaskAction] = useState<RunActionState>({
    status: 'idle',
    detail: 'Task has not been created.'
  });
  const [deletingTaskId, setDeletingTaskId] = useState('');
  const [agentSession] = useState<AgentSession | null>(null);
  const [runtimeState, setRuntimeState] = useState<RunActionState>({
    status: 'idle',
    detail: 'Runtime status has not been refreshed yet.'
  });
  const [deviceAction, setDeviceAction] = useState<DeviceActionState>({
    status: 'idle',
    detail: 'Local device discovery has not been checked yet.'
  });

  const copy = COPY[language];
  const api = useMemo(() => getApi(), []);
  const currentTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );
  const currentTaskWorkspace = currentTask
    ? taskWorkspaceById[currentTask.id] ?? createInitialTaskWorkspaceState(currentTask)
    : null;
  const selectedDeviceId = currentTaskWorkspace?.selectedDeviceId ?? '';
  const prompt = currentTaskWorkspace?.prompt ?? '';
  const targetAppId = currentTaskWorkspace?.targetAppId ?? '';
  const uploadState = currentTaskWorkspace?.uploadState ?? createInitialUploadState();
  const runAction = currentTaskWorkspace?.runAction ?? createIdleRunAction();
  const reportExport = currentTaskWorkspace?.reportExport ?? createIdleReportExportAction();
  const report = currentTaskWorkspace?.report ?? null;
  const agentMessages = currentTaskWorkspace?.agentMessages ?? [];
  const readiness = useMemo(
    () =>
      getRunReadiness({
        environment,
        devices,
        selectedDeviceId,
        task: currentTask,
        prompt,
        targetAppId
      }),
    [currentTask, devices, environment, prompt, selectedDeviceId, targetAppId]
  );
  const selectedDevice = getSelectedDevice(devices, selectedDeviceId);
  const currentTaskCase = currentTask?.input.testCase;
  const deviceSummary = getDeviceInspectionSummary(devices);
  const activeTaskCount = tasks.filter((task) => isActiveTaskStatus(task.status)).length;
  const finishedTaskCount = tasks.filter((task) => isTerminalTaskStatus(task.status)).length;
  const latestTask = tasks[0] ?? null;
  const runtimeGeneratedAt = environment ? formatDateTime(environment.generatedAt, language) : copy.runtime.notLoaded;
  const trimmedViewerUrl = viewerUrl.trim();
  const canOpenViewer = isAllowedLocalViewerUrl(trimmedViewerUrl);
  const taskEditable = canReuseTask(currentTask);
  const dashboardMetrics: Array<{
    detail: string;
    icon: ReactElement;
    key: string;
    label: string;
    status: string;
    value: string;
  }> = [
    {
      detail: copy.dashboard.tasksDetail(activeTaskCount, finishedTaskCount),
      icon: <ClipboardList size={20} aria-hidden="true" />,
      key: 'tasks-total',
      label: copy.dashboard.tasks,
      status: activeTaskCount ? 'running' : tasks.length ? 'ready' : 'idle',
      value: String(tasks.length)
    },
    {
      detail: copy.runtime.deviceInspectionSummary(
        deviceSummary.totalSupported,
        deviceSummary.connected,
        deviceSummary.virtual,
        deviceSummary.physical
      ),
      icon: <Smartphone size={20} aria-hidden="true" />,
      key: 'devices-connected',
      label: copy.dashboard.devices,
      status: deviceSummary.connected ? 'ready' : 'disconnected',
      value: String(deviceSummary.connected)
    },
    {
      detail: latestTask ? latestTask.name : copy.empty.noTasksDetail,
      icon: <FileText size={20} aria-hidden="true" />,
      key: 'latest-report',
      label: copy.dashboard.latestReport,
      status: latestTask?.status ?? 'idle',
      value: formatStatusLabel(latestTask?.status ?? 'idle', language)
    },
    {
      detail: environment?.canStartRun ? copy.dashboard.readyToRun : (environment?.blockers[0] ?? copy.runtime.notLoaded),
      icon: <Activity size={20} aria-hidden="true" />,
      key: 'runtime-readiness',
      label: copy.dashboard.runtime,
      status: environment?.canStartRun ? 'ready' : runtimeState.status,
      value: environment?.canStartRun ? copy.dashboard.ready : copy.dashboard.blocked
    }
  ];
  const navigationItems: Array<{
    page: MenuPage;
    label: string;
    icon: ReactElement;
  }> = [
    {
      page: 'overview',
      label: copy.nav.overview,
      icon: <Activity size={18} aria-hidden="true" />
    },
    {
      page: 'task',
      label: copy.nav.task,
      icon: <ClipboardList size={18} aria-hidden="true" />
    },
    {
      page: 'devices',
      label: copy.nav.devices,
      icon: <Smartphone size={18} aria-hidden="true" />
    },
    {
      page: 'viewer',
      label: copy.nav.viewer,
      icon: <MonitorSmartphone size={18} aria-hidden="true" />
    }
  ];

  function canReuseTask(task: TestTask | null): task is TestTask {
    return Boolean(task && !isActiveTaskStatus(task.status));
  }

  function mergeTaskWorkspaceState(
    previous: TaskWorkspaceState | undefined,
    task: TestTask
  ): TaskWorkspaceState {
    const fallback = previous ?? createInitialTaskWorkspaceState(task);

    return {
      ...fallback,
      selectedDeviceId: fallback.selectedDeviceId || task.deviceId || '',
      prompt: fallback.prompt || task.input.naturalLanguage?.prompt || '',
      targetAppId: fallback.targetAppId || task.targetAppId || ''
    };
  }

  function updateTaskWorkspaceState(
    taskId: string,
    updater: Partial<TaskWorkspaceState> | ((previous: TaskWorkspaceState) => TaskWorkspaceState)
  ): void {
    setTaskWorkspaceById((current) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      const previous = current[taskId] ?? createInitialTaskWorkspaceState(task);
      const next = typeof updater === 'function' ? updater(previous) : { ...previous, ...updater };

      return {
        ...current,
        [taskId]: next
      };
    });
  }

  function updateCurrentTaskWorkspaceState(
    updater: Partial<TaskWorkspaceState> | ((previous: TaskWorkspaceState) => TaskWorkspaceState)
  ): void {
    if (!currentTask) {
      return;
    }

    updateTaskWorkspaceState(currentTask.id, updater);
  }

  function upsertTask(task: TestTask, options: { select?: boolean } = {}): void {
    setTasks((currentTasks) => upsertTaskList(currentTasks, task));
    setTaskWorkspaceById((current) => ({
      ...current,
      [task.id]: mergeTaskWorkspaceState(current[task.id], task)
    }));

    if (options.select) {
      setSelectedTaskId(task.id);
    }
  }

  function hydrateTaskWorkspaces(
    refreshedTasks: TestTask[],
    selectedTask: TestTask | null,
    nextDevices: DeviceInfo[]
  ): void {
    setTaskWorkspaceById((current) => {
      const next = { ...current };

      for (const task of refreshedTasks) {
        next[task.id] = mergeTaskWorkspaceState(next[task.id], task);
      }

      if (selectedTask) {
        const selectedWorkspace = next[selectedTask.id] ?? createInitialTaskWorkspaceState(selectedTask);
        next[selectedTask.id] = {
          ...selectedWorkspace,
          selectedDeviceId: getPreferredDeviceId(
            nextDevices,
            selectedWorkspace.selectedDeviceId || selectedTask.deviceId || ''
          )
        };
      }

      return next;
    });
  }

  function handleSelectTask(taskId: string): void {
    setSelectedTaskId(taskId);
    setActivePage('task');
  }

  function handleSelectDevice(deviceId: string): void {
    updateCurrentTaskWorkspaceState({
      selectedDeviceId: deviceId
    });
  }

  async function syncTaskInput(
    task: TestTask,
    nextPrompt: string,
    nextTargetAppId: string
  ): Promise<TestTask> {
    const normalizedPrompt = nextPrompt.trim();
    const currentPrompt = task.input.naturalLanguage?.prompt ?? '';
    const normalizedTargetAppId = nextTargetAppId.trim();
    const currentTargetAppId = task.targetAppId ?? '';

    if (normalizedPrompt === currentPrompt && normalizedTargetAppId === currentTargetAppId) {
      return task;
    }

    const updatedTask = await api.tasks.updateInput({
      taskId: task.id,
      ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
      targetAppId: normalizedTargetAppId
    });

    upsertTask(updatedTask);
    updateTaskWorkspaceState(updatedTask.id, {
      prompt: updatedTask.input.naturalLanguage?.prompt ?? '',
      targetAppId: updatedTask.targetAppId ?? normalizedTargetAppId,
      report: null,
      reportExport: createIdleReportExportAction()
    });
    return updatedTask;
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = taskName.trim();
    const description = taskDescription.trim();

    if (!name) {
      setTaskAction({
        status: 'error',
        detail: 'Enter a task name.'
      });
      return;
    }

    setTaskAction({
      status: 'busy',
      detail: 'Creating test task.'
    });

    try {
      const task = await api.tasks.create({
        name,
        ...(description ? { description } : {})
      });

      upsertTask(task, { select: true });
      setTaskAction({
        status: 'success',
        detail: `Task ${task.id} created.`
      });
      setTaskName('');
      setTaskDescription('');
    } catch (error) {
      setTaskAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleDeleteTask(taskId: string): Promise<void> {
    const task = tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      return;
    }

    if (isActiveTaskStatus(task.status)) {
      setTaskAction({
        status: 'error',
        detail: `Task ${task.id} is ${formatStatusLabel(task.status, 'en')}.`
      });
      return;
    }

    const confirmed =
      typeof window.confirm === 'function' ? window.confirm(copy.copy.deleteTaskConfirm(task.name)) : true;

    if (!confirmed) {
      return;
    }

    setDeletingTaskId(task.id);
    setTaskAction({
      status: 'busy',
      detail: `Deleting ${task.id}.`
    });

    try {
      const deletedTask = await api.tasks.delete(task.id);
      const nextTasks = tasks.filter((candidate) => candidate.id !== deletedTask.id);

      setTasks(nextTasks);
      setSelectedTaskId((currentSelectedTaskId) =>
        currentSelectedTaskId === deletedTask.id ? nextTasks[0]?.id ?? '' : currentSelectedTaskId
      );
      setTaskWorkspaceById((current) => {
        const next = { ...current };

        delete next[deletedTask.id];
        return next;
      });
      setTaskAction({
        status: 'success',
        detail: `Task ${deletedTask.id} deleted.`
      });
    } catch (error) {
      setTaskAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    } finally {
      setDeletingTaskId('');
    }
  }

  useEffect(() => {
    persistLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  async function refreshRuntime(): Promise<void> {
    setRuntimeState({ status: 'busy', detail: 'Refreshing local runtime status.' });

    try {
      const [nextEnvironment, nextDevices, nextViewerConfig, tasks] = await Promise.all([
        api.env.getStatus(),
        api.devices.list(),
        api.viewer.getConfig(),
        api.tasks.list()
      ]);
      const nextTask = getSelectedTaskAfterRefresh(selectedTaskId, tasks);

      setEnvironment(nextEnvironment);
      setDevices(nextDevices);
      setViewerConfig(nextViewerConfig);
      setViewerUrl(nextViewerConfig.url);
      setTasks(tasks);
      setSelectedTaskId(nextTask?.id ?? '');
      hydrateTaskWorkspaces(tasks, nextTask, nextDevices);
      if (nextTask) {
        setTaskAction({
          status: 'success',
          detail: `Task ${nextTask.id} is ${formatStatusLabel(nextTask.status, 'en')}.`
        });
      }
      setRuntimeState({
        status: 'success',
        detail: `Last refreshed ${formatDateTime(nextEnvironment.generatedAt, 'en')}.`
      });
    } catch (error) {
      setRuntimeState({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  useEffect(() => {
    void refreshRuntime();
  }, []);

  function applyDevicesAfterRefresh(
    nextDevices: DeviceInfo[],
    options: { updateTaskSelection: boolean }
  ): void {
    setDevices(nextDevices);
    if (options.updateTaskSelection && currentTask) {
      updateTaskWorkspaceState(currentTask.id, (current) => ({
        ...current,
        selectedDeviceId: getPreferredDeviceId(nextDevices, current.selectedDeviceId)
      }));
    }
  }

  async function waitForDeviceRefresh(delayMs: number): Promise<void> {
    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  async function refreshDevicesAfterStart(
    startedDevice: DeviceInfo,
    previouslyConnectedDeviceIds: ReadonlySet<string>,
    options: { updateTaskSelection: boolean }
  ): Promise<void> {
    for (const delayMs of DEVICE_START_REFRESH_DELAYS_MS) {
      await waitForDeviceRefresh(delayMs);
      const nextDevices = await api.devices.list();

      applyDevicesAfterRefresh(nextDevices, options);

      if (hasStartedDeviceAppeared(nextDevices, startedDevice, previouslyConnectedDeviceIds)) {
        return;
      }
    }
  }

  async function refreshDevices(options: { updateTaskSelection: boolean }): Promise<void> {
    setDeviceAction({
      status: 'busy',
      detail: 'Checking Android/iOS physical and virtual devices.'
    });

    try {
      const nextDevices = await api.devices.list();
      const summary = getDeviceInspectionSummary(nextDevices);

      applyDevicesAfterRefresh(nextDevices, options);
      setDeviceAction({
        status: 'success',
        detail: `Found ${summary.totalSupported} supported device(s): ${summary.connected} connected, ${summary.virtual} virtual, ${summary.physical} physical.`
      });
    } catch (error) {
      setDeviceAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleCheckDevices(): Promise<void> {
    await refreshDevices({ updateTaskSelection: true });
  }

  async function handleManageCheckDevices(): Promise<void> {
    await refreshDevices({ updateTaskSelection: false });
  }

  async function startDevice(device: DeviceInfo, options: { updateTaskSelection: boolean }): Promise<void> {
    if (!isStartableDevice(device)) {
      setDeviceAction({
        status: 'error',
        detail: `${device.name} cannot be started from the desktop client.`,
        deviceId: device.id
      });
      return;
    }

    setDeviceAction({
      status: 'busy',
      detail: `Starting ${device.name}.`,
      deviceId: device.id
    });

    try {
      const previouslyConnectedDeviceIds = new Set(
        devices
          .filter((currentDevice) => currentDevice.connected)
          .map((currentDevice) => currentDevice.id)
      );
      const result = await api.devices.start(device.id);
      const nextDevices = result.device
        ? replaceDeviceInList(devices, device.id, result.device)
        : await api.devices.list();

      applyDevicesAfterRefresh(nextDevices, options);
      setDeviceAction(mapDeviceStartResultToAction(result, device.name));
      if (result.status === 'starting') {
        await refreshDevicesAfterStart(device, previouslyConnectedDeviceIds, options);
      }
    } catch (error) {
      setDeviceAction({
        status: 'error',
        detail: getErrorMessage(error),
        deviceId: device.id
      });
    }
  }

  async function handleStartDevice(device: DeviceInfo): Promise<void> {
    await startDevice(device, { updateTaskSelection: true });
  }

  async function handleManageStartDevice(device: DeviceInfo): Promise<void> {
    await startDevice(device, { updateTaskSelection: false });
  }

  async function stopDevice(device: DeviceInfo, options: { updateTaskSelection: boolean }): Promise<void> {
    if (!isStoppableDevice(device)) {
      setDeviceAction({
        status: 'error',
        detail: `${device.name} cannot be stopped from the desktop client.`,
        deviceId: device.id
      });
      return;
    }

    setDeviceAction({
      status: 'busy',
      detail: `Stopping ${device.name}.`,
      deviceId: device.id
    });

    try {
      const result = await api.devices.stop(device.id);
      const nextDevices = result.device
        ? replaceDeviceInList(devices, device.id, result.device)
        : await api.devices.list();

      applyDevicesAfterRefresh(nextDevices, options);
      setDeviceAction(mapDeviceStopResultToAction(result, device.name));
    } catch (error) {
      setDeviceAction({
        status: 'error',
        detail: getErrorMessage(error),
        deviceId: device.id
      });
    }
  }

  async function handleStopDevice(device: DeviceInfo): Promise<void> {
    await stopDevice(device, { updateTaskSelection: true });
  }

  async function handleManageStopDevice(device: DeviceInfo): Promise<void> {
    await stopDevice(device, { updateTaskSelection: false });
  }

  async function handleViewerProbe(): Promise<void> {
    const blocked = validateViewerUrl(trimmedViewerUrl);

    if (blocked) {
      setViewerProbe(blocked);
      return;
    }

    setViewerProbe({
      status: 'checking',
      detail: 'Checking local viewer target.'
    });

    try {
      const result = await api.viewer.probe(trimmedViewerUrl);
      setViewerUrl(result.url);
      setViewerProbe(mapViewerProbeResult(result));
    } catch (error) {
      setViewerProbe({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  function handleViewerOpen(): void {
    const opened = openAllowedViewerUrl(viewerUrl, (url, target, features) =>
      window.open(url, target, features)
    );

    if (!opened) {
      setViewerProbe({
        status: 'blocked',
        detail: 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
      });
    }
  }

  async function handleCaseUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileCandidate = file as File & { path?: string };
    const validation = validateCaseFile(fileCandidate);

    updateCurrentTaskWorkspaceState({
      report: null,
      reportExport: createIdleReportExportAction()
    });

    if (!canReuseTask(currentTask)) {
      updateCurrentTaskWorkspaceState({
        uploadState: {
          name: file.name,
          status: 'rejected',
          detail: 'Create a test task before uploading a case.'
        }
      });
      event.target.value = '';
      return;
    }

    if (!validation.valid) {
      updateCurrentTaskWorkspaceState({
        uploadState: {
          name: file.name,
          status: 'rejected',
          detail: validation.detail
        }
      });
      return;
    }

    updateCurrentTaskWorkspaceState({
      uploadState: {
        name: file.name,
        status: 'importing',
        detail: 'Importing through the task workspace API.'
      }
    });

    try {
      const task = await syncTaskInput(currentTask, prompt, targetAppId);
      const updatedTask = await api.tasks.importCase({
        taskId: task.id,
        ...createCaseImportRequest(fileCandidate)
      });
      const taskCase = updatedTask.input.testCase;

      upsertTask(updatedTask);
      updateTaskWorkspaceState(updatedTask.id, {
        report: null,
        reportExport: createIdleReportExportAction(),
        uploadState: {
          name: taskCase?.name ?? file.name,
          status: taskCase ? 'accepted' : 'rejected',
          detail: taskCase
            ? `${taskCase.format.toUpperCase()} case imported into ${updatedTask.name}.`
            : updatedTask.failureReason ?? 'Task import did not produce a test case.'
        }
      });
    } catch (error) {
      updateCurrentTaskWorkspaceState({
        uploadState: {
          name: file.name,
          status: 'rejected',
          detail: getErrorMessage(error)
        }
      });
    }
  }

  async function pollTaskUntilSettled(taskId: string): Promise<void> {
    const startedPollingAt = Date.now();

    while (Date.now() - startedPollingAt < RUN_STATUS_POLL_TIMEOUT_MS) {
      const latestTask = await api.tasks.get(taskId);
      const latestReport = await api.tasks.getReport(taskId);

      upsertTask(latestTask);
      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        report: latestReport
      }));

      if (isTerminalTaskStatus(latestTask.status)) {
        updateTaskWorkspaceState(taskId, (current) => ({
          ...current,
          runAction: {
            status: getRunActionStatusForTaskStatus(latestTask.status),
            detail: `Task ${latestTask.id} finished as ${formatStatusLabel(latestTask.status, 'en')}.`
          }
        }));
        return;
      }

      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        runAction: {
          status: 'busy',
          detail: `Task ${latestTask.id} is ${formatStatusLabel(latestTask.status, 'en')}.`
        }
      }));

      await new Promise((resolve) => {
        window.setTimeout(resolve, RUN_STATUS_POLL_INTERVAL_MS);
      });
    }

    updateTaskWorkspaceState(taskId, (current) => ({
      ...current,
      runAction: {
        status: 'error',
        detail: 'Run status polling timed out before the local runtime reached a terminal state.'
      }
    }));
  }

  async function handleStartRun(): Promise<void> {
    if (!readiness.canStart || !readiness.selectedDevice || !currentTask) {
      updateCurrentTaskWorkspaceState({
        runAction: {
          status: 'error',
          detail: readiness.reasons.join(' ')
        }
      });
      return;
    }

    const taskId = currentTask.id;

    updateTaskWorkspaceState(taskId, (current) => ({
      ...current,
      runAction: {
        status: 'busy',
        detail: 'Starting the task-scoped local run.'
      },
      reportExport: createIdleReportExportAction()
    }));

    try {
      const task = await syncTaskInput(currentTask, prompt, targetAppId);
      const startedTask = await api.tasks.start({
        taskId: task.id,
        deviceId: readiness.selectedDevice.id,
        targetAppId: targetAppId.trim()
      });
      const nextReport = await api.tasks.getReport(startedTask.id);

      if (prompt.trim()) {
        updateTaskWorkspaceState(startedTask.id, (current) => ({
          ...current,
          agentMessages: [
            ...current.agentMessages,
            {
              id: `local-user-${Date.now()}`,
              sessionId: startedTask.id,
              role: 'user',
              content: prompt.trim(),
              createdAt: new Date().toISOString()
            }
          ]
        }));
      }

      upsertTask(startedTask);
      updateTaskWorkspaceState(startedTask.id, (current) => ({
        ...current,
        report: nextReport,
        runAction: {
          status: getRunActionStatusForTaskStatus(startedTask.status),
          detail: `Task ${startedTask.id} is ${formatStatusLabel(startedTask.status, 'en')}.`
        }
      }));
      await pollTaskUntilSettled(startedTask.id);
    } catch (error) {
      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        runAction: {
          status: 'error',
          detail: getErrorMessage(error)
        }
      }));
    }
  }

  async function handleCancelRun(): Promise<void> {
    if (!currentTask) {
      return;
    }

    const taskId = currentTask.id;

    updateTaskWorkspaceState(taskId, (current) => ({
      ...current,
      runAction: {
        status: 'busy',
        detail: `Cancelling ${currentTask.id}.`
      }
    }));

    try {
      const cancelledTask = await api.tasks.cancel(currentTask.id);
      const nextReport = await api.tasks.getReport(cancelledTask.id);

      upsertTask(cancelledTask);
      updateTaskWorkspaceState(cancelledTask.id, (current) => ({
        ...current,
        report: nextReport,
        runAction: {
          status: 'success',
          detail: `Task ${cancelledTask.id} is ${formatStatusLabel(cancelledTask.status, 'en')}.`
        }
      }));
    } catch (error) {
      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        runAction: {
          status: 'error',
          detail: getErrorMessage(error)
        }
      }));
    }
  }

  async function handleExportReport(): Promise<void> {
    if (!currentTask) {
      return;
    }

    const taskId = currentTask.id;

    updateTaskWorkspaceState(taskId, (current) => ({
      ...current,
      reportExport: {
        status: 'busy',
        detail: 'Exporting Markdown report.'
      }
    }));

    try {
      const exportedReport = await api.tasks.exportReport({
        taskId: currentTask.id,
        format: 'markdown'
      });

      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        report: exportedReport,
        reportExport: {
          status: 'success',
          detail: exportedReport.filePath
            ? `Markdown exported to ${exportedReport.filePath}.`
            : 'Markdown report exported.'
        }
      }));
    } catch (error) {
      updateTaskWorkspaceState(taskId, (current) => ({
        ...current,
        reportExport: {
          status: 'error',
          detail: getErrorMessage(error)
        }
      }));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label={copy.shell.navigationLabel}>
        <div className="brand-lockup">
          <span className="brand-mark">
            <MonitorSmartphone aria-hidden="true" size={22} />
          </span>
          <div>
            <strong>{copy.shell.brand}</strong>
            <span>{copy.shell.subtitle}</span>
          </div>
        </div>
        <nav className="nav-list">
          {navigationItems.map((item) => (
            <button
              key={item.page}
              className={activePage === item.page ? 'nav-item active' : 'nav-item'}
              data-target-page={item.page}
              type="button"
              onClick={() => setActivePage(item.page)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{copy.shell.title}</h1>
            <p className="topbar-subtitle">{copy.shell.description}</p>
          </div>
          <div className="topbar-actions">
            <div className="language-switcher" role="group" aria-label={copy.language.label}>
              <button
                className={language === 'zh' ? 'segment-button active' : 'segment-button'}
                type="button"
                aria-pressed={language === 'zh'}
                onClick={() => setLanguage('zh')}
              >
                {copy.language.zh}
              </button>
              <button
                className={language === 'en' ? 'segment-button active' : 'segment-button'}
                type="button"
                aria-pressed={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                {copy.language.en}
              </button>
            </div>
            <button
              className="icon-button"
              disabled={runtimeState.status === 'busy'}
              onClick={() => void refreshRuntime()}
              title={copy.titlesAttr.refreshRuntime}
            >
              {runtimeState.status === 'busy' ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <RefreshCw size={18} aria-hidden="true" />
              )}
              {copy.actions.refresh}
            </button>
          </div>
        </header>

        <div className={`runtime-banner banner-${runtimeState.status}`}>
          <span>{localizeText(runtimeState.detail, language)}</span>
          <small>{copy.runtime.generated(runtimeGeneratedAt)}</small>
        </div>

        {activePage === 'overview' ? (
          <section className="workspace-page overview-page" data-page="overview">
            <section className="dashboard-grid" aria-label={copy.dashboard.label}>
              {dashboardMetrics.map((metric) => (
                <article
                  key={metric.key}
                  className="panel dashboard-card"
                  data-dashboard-metric={metric.key}
                >
                  <div className="panel-heading split">
                    <div>
                      {metric.icon}
                      <h2>{metric.label}</h2>
                    </div>
                    <StatusPill status={metric.status} language={language} />
                  </div>
                  <strong className="dashboard-value">{metric.value}</strong>
                  <p>{localizeText(metric.detail, language)}</p>
                </article>
              ))}
            </section>

            <section className="panel-grid three">
              <ServiceStatusCard
                icon={<Cable size={20} aria-hidden="true" />}
                title={copy.titles.agent}
                health={environment?.agent}
                footer={copy.runtime.session(agentSession?.status ?? copy.runtime.notStarted)}
                language={language}
              />
              <ServiceStatusCard
                icon={<Smartphone size={20} aria-hidden="true" />}
                title={copy.titles.maestro}
                health={environment?.maestro}
                footer={copy.runtime.executableDevices(getExecutableDevices(devices).length)}
                language={language}
              />
              <ServiceStatusCard
                icon={<MonitorSmartphone size={20} aria-hidden="true" />}
                title={copy.titles.viewer}
                health={environment?.viewer}
                footer={
                  viewerConfig
                    ? copy.runtime.viewerConfig(viewerConfig.source, viewerConfig.url)
                    : copy.runtime.viewerConfigLoading
                }
                language={language}
              />
            </section>
          </section>
        ) : null}

        {activePage === 'task' ? (
          <section className="workspace-page" data-page="task">
            <TaskWorkspacePanel
              currentTask={currentTask}
              currentTaskCase={currentTaskCase}
              deletingTaskId={deletingTaskId}
              deviceAction={deviceAction}
              devices={devices}
              report={report}
              reportExport={reportExport}
              language={language}
              onCancelRun={() => void handleCancelRun()}
              onCaseUpload={(event) => void handleCaseUpload(event)}
              onCreateTask={(event) => void handleCreateTask(event)}
              onCheckDevices={() => void handleCheckDevices()}
              onDeleteTask={(taskId) => void handleDeleteTask(taskId)}
              onExportMarkdown={() => void handleExportReport()}
              onPromptChange={(value) => updateCurrentTaskWorkspaceState({ prompt: value })}
              onSelectDevice={handleSelectDevice}
              onSelectTask={handleSelectTask}
              onStartDevice={(device) => void handleStartDevice(device)}
              onStartRun={() => void handleStartRun()}
              onStopDevice={(device) => void handleStopDevice(device)}
              onTargetAppIdChange={(value) => updateCurrentTaskWorkspaceState({ targetAppId: value })}
              onTaskDescriptionChange={setTaskDescription}
              onTaskNameChange={setTaskName}
              prompt={prompt}
              readiness={readiness}
              runAction={runAction}
              selectedDevice={selectedDevice}
              selectedDeviceId={selectedDeviceId}
              taskAction={taskAction}
              taskDescription={taskDescription}
              taskEditable={taskEditable}
              targetAppId={targetAppId}
              taskName={taskName}
              uploadState={uploadState}
              agentMessages={agentMessages}
              tasks={tasks}
            />
          </section>
        ) : null}

        {activePage === 'devices' ? (
          <section className="workspace-page" data-page="devices">
            <DeviceListPanel
              devices={devices}
              onCheckDevices={() => void handleManageCheckDevices()}
              onStartDevice={(device) => void handleManageStartDevice(device)}
              onStopDevice={(device) => void handleManageStopDevice(device)}
              deviceAction={deviceAction}
              language={language}
              selectionMode="manage"
            />
          </section>
        ) : null}

        {activePage === 'viewer' ? (
          <section className="workspace-page" data-page="viewer">
          <article className="panel" id="viewer">
            <div className="panel-heading split">
              <div>
                <Settings2 size={20} aria-hidden="true" />
                <h2>{copy.titles.viewerUrl}</h2>
              </div>
              <StatusPill status={viewerProbe.status} language={language} />
            </div>
            <label className="field-label" htmlFor="viewer-url">
              {copy.fields.localTarget}
            </label>
            <input
              id="viewer-url"
              className="text-input"
              value={viewerUrl}
              onChange={(event) => {
                setViewerUrl(event.target.value);
                setViewerProbe(createInitialViewerProbeState());
              }}
              aria-describedby="viewer-url-message"
              aria-invalid={!canOpenViewer}
              spellCheck={false}
            />
            <p
              id="viewer-url-message"
              className={canOpenViewer ? 'muted' : 'validation-message'}
              role={canOpenViewer ? undefined : 'alert'}
            >
              {canOpenViewer
                ? localizeText(viewerProbe.detail, language)
                : copy.copy.viewerUrlMustBeLocal}
            </p>
            <div className="action-row">
              <button
                className="icon-button"
                disabled={viewerProbe.status === 'checking'}
                onClick={() => void handleViewerProbe()}
                title={copy.titlesAttr.probeViewer}
              >
                {viewerProbe.status === 'checking' ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Activity size={18} aria-hidden="true" />
                )}
                {copy.actions.probe}
              </button>
              <button
                className="icon-button"
                disabled={!canOpenViewer}
                onClick={handleViewerOpen}
                title={canOpenViewer ? copy.titlesAttr.openLocalViewer : copy.titlesAttr.viewerUrlMustBeLocal}
              >
                <MonitorSmartphone size={18} aria-hidden="true" />
                {copy.actions.open}
              </button>
            </div>
            <span className="subtle-line">{copy.copy.requirementHint}</span>
          </article>
          </section>
        ) : null}
      </section>
    </main>
  );
}
