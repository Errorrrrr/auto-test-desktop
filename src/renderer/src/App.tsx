import {
  Activity,
  AlertTriangle,
  Ban,
  Cable,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Play,
  Power,
  RefreshCw,
  Settings2,
  Smartphone,
  UploadCloud
} from 'lucide-react';
import { ChangeEvent, FormEvent, ReactElement, useEffect, useMemo, useState } from 'react';

import { createRuntimeSnapshot } from '../../shared/runtimeSnapshot';
import type {
  AgentMessage,
  AgentSession,
  AppAutoTestApi,
  DeviceInfo,
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
  formatStatusLabel,
  getErrorMessage,
  getExecutableDevices,
  getPreferredDeviceId,
  getReportFormatLabel,
  getRunReadiness,
  getSelectedDevice,
  getStatusTone,
  isExecutableDevice,
  isStartableDevice,
  mapDeviceStartResultToAction,
  mapViewerProbeResult,
  normalizeViewerInput,
  validateCaseFile,
  validateViewerUrl
} from './workbenchModel';

type ViewerOpener = (url: string, target: string, features: string) => Window | null;

type RunActionState = {
  status: AsyncStatus;
  detail: string;
};

type DeviceActionState = RunActionState & {
  deviceId?: string;
};

const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout', 'blocked']);
const ACTIVE_TASK_STATUSES = new Set(['queued', 'running']);
const RUN_STATUS_POLL_INTERVAL_MS = 1_000;
const RUN_STATUS_MAX_POLLS = 120;

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
  failureReason?: string;
} = {}): TestTask {
  const now = new Date().toISOString();
  const prompt = options.prompt?.trim();

  return {
    id: options.id ?? `browser-task-${Date.now()}`,
    name: options.name ?? 'Browser fallback task',
    ...(options.description ? { description: options.description } : {}),
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
      list: async () => [],
      start: async (deviceId: string) => ({
        deviceId,
        status: 'failed',
        detail: 'Device launch is only available in the Electron desktop runtime.'
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
      updateInput: async (request) =>
        createBrowserFallbackTask({
          id: request.taskId,
          prompt: request.prompt
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
  selectedDeviceId,
  onSelectDevice,
  onCheckDevices,
  onStartDevice,
  deviceAction,
  language = 'en'
}: {
  devices: DeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  onCheckDevices?: () => void;
  onStartDevice?: (device: DeviceInfo) => void;
  deviceAction?: DeviceActionState;
  language?: Language;
}): ReactElement {
  const executableDevices = getExecutableDevices(devices);
  const summary = getDeviceInspectionSummary(devices);
  const copy = COPY[language];
  const checkingDevices = deviceAction?.status === 'busy' && !deviceAction.deviceId;

  return (
    <article className="panel device-panel" id="devices">
      <div className="panel-heading split">
        <div>
          <Smartphone size={20} aria-hidden="true" />
          <h2>{copy.titles.devices}</h2>
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

      {devices.length ? (
        <ul className="device-list">
          {devices.map((device) => {
            const executable = isExecutableDevice(device);
            const startable = isStartableDevice(device);
            const startingDevice = deviceAction?.status === 'busy' && deviceAction.deviceId === device.id;

            return (
              <li key={device.id} className={executable ? 'device-row' : 'device-row disabled-row'}>
                <label>
                  <input
                    type="radio"
                    name="target-device"
                    checked={selectedDeviceId === device.id}
                    disabled={!executable}
                    onChange={() => onSelectDevice(device.id)}
                  />
                  <span>
                    <strong>{device.name}</strong>
                    <small>
                      {device.platform} / {device.type}
                    </small>
                  </span>
                </label>
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
                      {startingDevice ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : (
                        <Power size={16} aria-hidden="true" />
                      )}
                      {copy.actions.startDevice}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
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
      {deviceAction ? (
        <p className={deviceAction.status === 'error' ? 'validation-message' : 'muted'}>
          {localizeText(deviceAction.detail, language)}
        </p>
      ) : null}
      {devices.length && !executableDevices.length ? <EmptyDeviceState language={language} /> : null}
    </article>
  );
}

export function ReportPanel({
  report,
  exportState,
  onExportMarkdown,
  language = 'en'
}: {
  report: TaskReport | null;
  exportState: RunActionState;
  onExportMarkdown: () => void;
  language?: Language;
}): ReactElement {
  const copy = COPY[language];

  if (!report) {
    return (
      <article className="panel" id="report">
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
    <article className="panel report-panel" id="report">
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

export function App(): ReactElement {
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | null>(null);
  const [viewerUrl, setViewerUrl] = useState(getViewerConfig({}).url);
  const [viewerProbe, setViewerProbe] = useState<ViewerProbeState>(() => createInitialViewerProbeState());
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>(() => createInitialUploadState());
  const [currentTask, setCurrentTask] = useState<TestTask | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAction, setTaskAction] = useState<RunActionState>({
    status: 'idle',
    detail: 'Task has not been created.'
  });
  const [agentSession] = useState<AgentSession | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [runtimeState, setRuntimeState] = useState<RunActionState>({
    status: 'idle',
    detail: 'Runtime status has not been refreshed yet.'
  });
  const [deviceAction, setDeviceAction] = useState<DeviceActionState>({
    status: 'idle',
    detail: 'Local device discovery has not been checked yet.'
  });
  const [runAction, setRunAction] = useState<RunActionState>({
    status: 'idle',
    detail: 'No run has been started.'
  });
  const [reportExport, setReportExport] = useState<RunActionState>({
    status: 'idle',
    detail: 'Report has not been exported.'
  });
  const [report, setReport] = useState<TaskReport | null>(null);

  const copy = COPY[language];
  const api = useMemo(() => getApi(), []);
  const readiness = useMemo(
    () =>
      getRunReadiness({
        environment,
        devices,
        selectedDeviceId,
        task: currentTask,
        prompt
      }),
    [currentTask, devices, environment, prompt, selectedDeviceId]
  );
  const selectedDevice = getSelectedDevice(devices, selectedDeviceId);
  const currentTaskCase = currentTask?.input.testCase;
  const runtimeGeneratedAt = environment ? formatDateTime(environment.generatedAt, language) : copy.runtime.notLoaded;
  const trimmedViewerUrl = viewerUrl.trim();
  const canOpenViewer = isAllowedLocalViewerUrl(trimmedViewerUrl);
  const taskEditable = canReuseTask(currentTask);
  const flowSteps = [
    {
      href: '#task',
      label: copy.titles.createTask,
      detail: currentTask ? formatStatusLabel(currentTask.status, language) : copy.runtime.noTask,
      done: Boolean(currentTask)
    },
    {
      href: '#devices',
      label: copy.titles.devices,
      detail: selectedDevice?.name ?? copy.runtime.notSelected,
      done: Boolean(readiness.selectedDevice)
    },
    {
      href: '#input',
      label: copy.titles.taskInput,
      detail: formatStatusLabel(readiness.inputMode, language),
      done: readiness.inputMode !== 'empty'
    },
    {
      href: '#run',
      label: copy.titles.executeTest,
      detail: currentTask?.latestRunId ?? copy.runtime.notStarted,
      done: Boolean(currentTask?.latestRunId)
    },
    {
      href: '#report',
      label: copy.titles.report,
      detail: report ? formatStatusLabel(report.status, language) : copy.runtime.notStarted,
      done: Boolean(report)
    }
  ];

  function canReuseTask(task: TestTask | null): task is TestTask {
    return Boolean(task && !task.latestRunId && !isActiveTaskStatus(task.status) && !isTerminalTaskStatus(task.status));
  }

  async function syncTaskPrompt(task: TestTask, nextPrompt: string): Promise<TestTask> {
    const normalizedPrompt = nextPrompt.trim();
    const currentPrompt = task.input.naturalLanguage?.prompt ?? '';

    if (normalizedPrompt === currentPrompt) {
      return task;
    }

    const updatedTask = await api.tasks.updateInput({
      taskId: task.id,
      ...(normalizedPrompt ? { prompt: normalizedPrompt } : {})
    });

    setCurrentTask(updatedTask);
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

      setCurrentTask(task);
      setTaskAction({
        status: 'success',
        detail: `Task ${task.id} created.`
      });
      setPrompt('');
      setUploadState(createInitialUploadState());
      setReport(null);
      setReportExport({
        status: 'idle',
        detail: 'Report has not been exported.'
      });
      setRunAction({
        status: 'idle',
        detail: 'No run has been started.'
      });
      setAgentMessages([]);
      setTaskName('');
      setTaskDescription('');
    } catch (error) {
      setTaskAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
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
      const mostRecentTask = tasks[0];
      const nextTask = currentTask ?? mostRecentTask ?? null;

      setEnvironment(nextEnvironment);
      setDevices(nextDevices);
      setViewerConfig(nextViewerConfig);
      setViewerUrl(nextViewerConfig.url);
      setSelectedDeviceId((current) => getPreferredDeviceId(nextDevices, current));
      setCurrentTask(nextTask);
      if (mostRecentTask?.input.naturalLanguage?.prompt) {
        setPrompt((value) => value || mostRecentTask.input.naturalLanguage?.prompt || '');
      }
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

  async function handleCheckDevices(): Promise<void> {
    setDeviceAction({
      status: 'busy',
      detail: 'Checking Android/iOS physical and virtual devices.'
    });

    try {
      const nextDevices = await api.devices.list();
      const summary = getDeviceInspectionSummary(nextDevices);

      setDevices(nextDevices);
      setSelectedDeviceId((current) => getPreferredDeviceId(nextDevices, current));
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

  async function handleStartDevice(device: DeviceInfo): Promise<void> {
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
      const result = await api.devices.start(device.id);
      const nextDevices = result.device ? devices.map((currentDevice) =>
        currentDevice.id === result.device?.id ? result.device : currentDevice
      ) : await api.devices.list();

      setDevices(nextDevices);
      setSelectedDeviceId((current) => getPreferredDeviceId(nextDevices, current));
      setDeviceAction(mapDeviceStartResultToAction(result, device.name));
    } catch (error) {
      setDeviceAction({
        status: 'error',
        detail: getErrorMessage(error),
        deviceId: device.id
      });
    }
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

    setReport(null);
    setReportExport({
      status: 'idle',
      detail: 'Report has not been exported.'
    });

    if (!canReuseTask(currentTask)) {
      setUploadState({
        name: file.name,
        status: 'rejected',
        detail: 'Create a test task before uploading a case.'
      });
      event.target.value = '';
      return;
    }

    if (!validation.valid) {
      setUploadState({
        name: file.name,
        status: 'rejected',
        detail: validation.detail
      });
      return;
    }

    setUploadState({
      name: file.name,
      status: 'importing',
      detail: 'Importing through the task workspace API.'
    });

    try {
      const task = await syncTaskPrompt(currentTask, prompt);
      const updatedTask = await api.tasks.importCase({
        taskId: task.id,
        ...createCaseImportRequest(fileCandidate)
      });
      const taskCase = updatedTask.input.testCase;

      setCurrentTask(updatedTask);
      setUploadState({
        name: taskCase?.name ?? file.name,
        status: taskCase ? 'accepted' : 'rejected',
        detail: taskCase
          ? `${taskCase.format.toUpperCase()} case imported into ${updatedTask.name}.`
          : updatedTask.failureReason ?? 'Task import did not produce a test case.'
      });
    } catch (error) {
      setUploadState({
        name: file.name,
        status: 'rejected',
        detail: getErrorMessage(error)
      });
    }
  }

  async function pollTaskUntilSettled(taskId: string): Promise<void> {
    for (let attempt = 0; attempt < RUN_STATUS_MAX_POLLS; attempt += 1) {
      const latestTask = await api.tasks.get(taskId);
      const latestReport = await api.tasks.getReport(taskId);

      setCurrentTask(latestTask);
      setReport(latestReport);

      if (isTerminalTaskStatus(latestTask.status)) {
        const completedWithoutFailure =
          latestTask.status === 'succeeded' || latestTask.status === 'cancelled';

        setRunAction({
          status: completedWithoutFailure ? 'success' : 'error',
          detail: `Task ${latestTask.id} finished as ${formatStatusLabel(latestTask.status, 'en')}.`
        });
        return;
      }

      setRunAction({
        status: 'busy',
        detail: `Task ${latestTask.id} is ${formatStatusLabel(latestTask.status, 'en')}.`
      });

      await new Promise((resolve) => {
        window.setTimeout(resolve, RUN_STATUS_POLL_INTERVAL_MS);
      });
    }

    setRunAction({
      status: 'error',
      detail: 'Run status polling timed out before the local runtime reached a terminal state.'
    });
  }

  async function handleStartRun(): Promise<void> {
    if (!readiness.canStart || !readiness.selectedDevice || !currentTask) {
      setRunAction({
        status: 'error',
        detail: readiness.reasons.join(' ')
      });
      return;
    }

    setRunAction({
      status: 'busy',
      detail: 'Starting the task-scoped local run.'
    });
    setReportExport({
      status: 'idle',
      detail: 'Report has not been exported.'
    });

    try {
      const task = await syncTaskPrompt(currentTask, prompt);
      const startedTask = await api.tasks.start({
        taskId: task.id,
        deviceId: readiness.selectedDevice.id
      });
      const nextReport = await api.tasks.getReport(startedTask.id);

      if (prompt.trim()) {
        setAgentMessages((messages) => [
          ...messages,
          {
            id: `local-user-${Date.now()}`,
            sessionId: startedTask.id,
            role: 'user',
            content: prompt.trim(),
            createdAt: new Date().toISOString()
          }
        ]);
      }
      setCurrentTask(startedTask);
      setReport(nextReport);
      setRunAction({
        status: startedTask.status === 'failed' || startedTask.status === 'blocked' ? 'error' : 'success',
        detail: `Task ${startedTask.id} is ${formatStatusLabel(startedTask.status, 'en')}.`
      });
      await pollTaskUntilSettled(startedTask.id);
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleCancelRun(): Promise<void> {
    if (!currentTask) {
      return;
    }

    setRunAction({
      status: 'busy',
      detail: `Cancelling ${currentTask.id}.`
    });

    try {
      const cancelledTask = await api.tasks.cancel(currentTask.id);
      const nextReport = await api.tasks.getReport(cancelledTask.id);

      setCurrentTask(cancelledTask);
      setReport(nextReport);
      setRunAction({
        status: 'success',
        detail: `Task ${cancelledTask.id} is ${formatStatusLabel(cancelledTask.status, 'en')}.`
      });
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleExportReport(): Promise<void> {
    if (!currentTask) {
      return;
    }

    setReportExport({
      status: 'busy',
      detail: 'Exporting Markdown report.'
    });

    try {
      const exportedReport = await api.tasks.exportReport({
        taskId: currentTask.id,
        format: 'markdown'
      });

      setReport(exportedReport);
      setReportExport({
        status: 'success',
        detail: exportedReport.filePath
          ? `Markdown exported to ${exportedReport.filePath}.`
          : 'Markdown report exported.'
      });
    } catch (error) {
      setReportExport({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label={copy.shell.navigationLabel}>
        <div className="brand-lockup">
          <MonitorSmartphone aria-hidden="true" size={28} />
          <div>
            <strong>{copy.shell.brand}</strong>
            <span>{copy.shell.subtitle}</span>
          </div>
        </div>
        <nav className="nav-list">
          <a className="nav-item active" href="#overview">
            <Activity size={18} aria-hidden="true" />
            {copy.nav.overview}
          </a>
          <a className="nav-item" href="#task">
            <ClipboardList size={18} aria-hidden="true" />
            {copy.nav.task}
          </a>
          <a className="nav-item" href="#devices">
            <Smartphone size={18} aria-hidden="true" />
            {copy.nav.devices}
          </a>
          <a className="nav-item" href="#input">
            <UploadCloud size={18} aria-hidden="true" />
            {copy.nav.input}
          </a>
          <a className="nav-item" href="#run">
            <Play size={18} aria-hidden="true" />
            {copy.nav.run}
          </a>
          <a className="nav-item" href="#report">
            <FileText size={18} aria-hidden="true" />
            {copy.nav.report}
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{copy.shell.eyebrow}</span>
            <h1>{copy.shell.title}</h1>
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

        <section id="overview" className="panel-grid three">
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

        <div className={`runtime-banner banner-${runtimeState.status}`}>
          <span>{localizeText(runtimeState.detail, language)}</span>
          <small>{copy.runtime.generated(runtimeGeneratedAt)}</small>
        </div>

        <section className="flow-strip" aria-label={copy.titles.testFlow}>
          {flowSteps.map((step, index) => (
            <a
              key={step.href}
              className={step.done ? 'flow-step complete' : 'flow-step'}
              href={step.href}
            >
              <span className="flow-index">{index + 1}</span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </a>
          ))}
        </section>

        <section className="panel-grid two">
          <article className="panel task-panel" id="task">
            <div className="panel-heading split">
              <div>
                <ClipboardList size={20} aria-hidden="true" />
                <h2>{copy.titles.createTask}</h2>
              </div>
              <StatusPill status={currentTask?.status ?? taskAction.status} language={language} />
            </div>

            <form className="task-form" onSubmit={(event) => void handleCreateTask(event)}>
              <label className="field-label" htmlFor="task-name">
                {copy.fields.name}
              </label>
              <input
                id="task-name"
                className="text-input"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder={copy.copy.taskNamePlaceholder}
              />
              <label className="field-label" htmlFor="task-description">
                {copy.fields.description}
              </label>
              <textarea
                id="task-description"
                className="text-input task-description-input"
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
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
                {currentTask ? copy.actions.newTask : copy.actions.createTask}
              </button>
            </form>

            <p className={taskAction.status === 'error' ? 'validation-message' : 'muted'}>
              {localizeText(taskAction.detail, language)}
            </p>

            {currentTask ? (
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
              </dl>
            ) : (
              <div className="empty-state">
                <ClipboardList aria-hidden="true" size={20} />
                <div>
                  <strong>{copy.runtime.noTask}</strong>
                  <span>{copy.copy.createTaskFirst}</span>
                </div>
              </div>
            )}
          </article>

          <DeviceListPanel
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            onCheckDevices={() => void handleCheckDevices()}
            onStartDevice={(device) => void handleStartDevice(device)}
            deviceAction={deviceAction}
            language={language}
          />
        </section>

        <section className="panel-grid two">
          <article className="panel input-panel" id="input">
            <div className="panel-heading split">
              <div>
                <UploadCloud size={20} aria-hidden="true" />
                <h2>{copy.titles.taskInput}</h2>
              </div>
              <StatusPill status={readiness.inputMode} language={language} />
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
                  disabled={!taskEditable}
                  onChange={(event) => void handleCaseUpload(event)}
                />
              </div>

              <div className="input-method">
                <label className="method-title" htmlFor="prompt-input">
                  <MessageSquare size={18} aria-hidden="true" />
                  <strong>{copy.copy.naturalLanguageLabel}</strong>
                </label>
                <textarea
                  id="prompt-input"
                  className="prompt-input"
                  value={prompt}
                  disabled={!taskEditable}
                  onChange={(event) => setPrompt(event.target.value)}
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
          </article>

          <article className="panel run-panel" id="run">
            <div className="panel-heading split">
              <div>
                <CheckCircle2 size={20} aria-hidden="true" />
                <h2>{copy.titles.executeTest}</h2>
              </div>
              <StatusPill status={currentTask?.status ?? runAction.status} language={language} />
            </div>
            <button
              className="primary-button"
              disabled={!readiness.canStart || runAction.status === 'busy'}
              onClick={() => void handleStartRun()}
            >
              {runAction.status === 'busy' ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" />
              )}
              {copy.actions.startRun}
            </button>
            {currentTask && isActiveTaskStatus(currentTask.status) ? (
              <button
                className="icon-button"
                onClick={() => void handleCancelRun()}
                title={copy.titlesAttr.cancelRun}
              >
                <Ban size={18} aria-hidden="true" />
                {copy.actions.cancel}
              </button>
            ) : null}
            <ul className="blocker-list compact">
              {(readiness.canStart
                ? [`Ready for ${selectedDevice?.name ?? copy.runtime.selectedDevice}.`]
                : readiness.reasons
              ).map((reason) => (
                <li key={reason}>{localizeText(reason, language)}</li>
              ))}
            </ul>
            <p>{localizeText(runAction.detail, language)}</p>
            {currentTask ? (
              <dl className="metric-grid">
                <div>
                  <dt>{copy.fields.task}</dt>
                  <dd>{currentTask.id}</dd>
                </div>
                <div>
                  <dt>{copy.fields.run}</dt>
                  <dd>{currentTask.latestRunId ?? copy.runtime.notStarted}</dd>
                </div>
                <div>
                  <dt>{copy.fields.case}</dt>
                  <dd>{currentTask.input.testCase?.name ?? currentTask.input.mode}</dd>
                </div>
                <div>
                  <dt>{copy.fields.device}</dt>
                  <dd>{currentTask.deviceSnapshot?.name ?? currentTask.deviceId ?? copy.runtime.notSelected}</dd>
                </div>
                <div>
                  <dt>{copy.fields.updated}</dt>
                  <dd>{formatDateTime(currentTask.updatedAt, language)}</dd>
                </div>
              </dl>
            ) : (
              <div className="empty-state">
                <AlertTriangle aria-hidden="true" size={20} />
                <div>
                  <strong>{copy.empty.waitingRunTitle}</strong>
                  <span>{copy.empty.waitingRunDetail}</span>
                </div>
              </div>
            )}

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
          </article>
        </section>

        <section className="panel-grid two">
          <ReportPanel
            report={report}
            exportState={reportExport}
            onExportMarkdown={() => void handleExportReport()}
            language={language}
          />

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
      </section>
    </main>
  );
}
