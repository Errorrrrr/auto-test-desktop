import {
  Activity,
  AlertTriangle,
  Ban,
  Cable,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Play,
  RefreshCw,
  Settings2,
  Smartphone,
  UploadCloud
} from 'lucide-react';
import { ChangeEvent, ReactElement, useEffect, useMemo, useState } from 'react';

import { createRuntimeSnapshot } from '../../shared/runtimeSnapshot';
import type {
  AgentMessage,
  AgentSession,
  AppAutoTestApi,
  DeviceInfo,
  EnvironmentStatus,
  ServiceHealth,
  TestCaseManifest,
  TestReport,
  TestRun,
  ViewerConfig
} from '../../shared/types';
import { getViewerConfig, isAllowedLocalViewerUrl } from '../../shared/viewerConfig';
import {
  AsyncStatus,
  INITIAL_UPLOAD_STATE,
  INITIAL_VIEWER_PROBE_STATE,
  UploadState,
  ViewerProbeState,
  createCaseImportRequest,
  createReportPlaceholder,
  formatDateTime,
  formatDuration,
  formatStatusLabel,
  getErrorMessage,
  getExecutableDevices,
  getPreferredDeviceId,
  getReportFormatLabel,
  getRunReadiness,
  getSelectedDevice,
  getStatusTone,
  isExecutableDevice,
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

type ReportContext = {
  device?: DeviceInfo;
  testCase?: TestCaseManifest;
};

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout', 'blocked']);
const RUN_STATUS_POLL_INTERVAL_MS = 1_000;
const RUN_STATUS_MAX_POLLS = 120;

function isTerminalRunStatus(status: TestRun['status']): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

const browserFallbackApi: AppAutoTestApi = {
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
    list: async () => []
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
    get: async (runId) => ({
      runId,
      title: 'Browser fallback report',
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      summary: 'Report generation requires the Electron main process.',
      targetDevice: 'browser-device',
      testCase: 'browser-case',
      prompt: '',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      conclusion: 'Blocked before execution',
      failureReason: 'Report generation requires the Electron main process.',
      markdown: '# Browser fallback report\n\nReport generation requires the Electron main process.'
    }),
    export: async (request) => ({
      runId: request.runId,
      title: `${getReportFormatLabel(request.format)} browser fallback report`,
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      summary: 'Report export requires the Electron main process.',
      targetDevice: 'browser-device',
      testCase: 'browser-case',
      prompt: '',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      conclusion: 'Blocked before execution',
      failureReason: 'Report export requires the Electron main process.',
      markdown: '# Browser fallback report\n\nReport export requires the Electron main process.'
    })
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

function getApi(): AppAutoTestApi {
  return window.appAutoTest ?? browserFallbackApi;
}

function StatusPill({ status }: { status: string }): ReactElement {
  return (
    <span className={`status-pill status-${getStatusTone(status)}`}>
      {formatStatusLabel(status)}
    </span>
  );
}

function EmptyDeviceState(): ReactElement {
  return (
    <div className="empty-state">
      <Ban aria-hidden="true" size={20} />
      <div>
        <strong>No executable devices</strong>
        <span>Android and iOS execution remains disabled until Maestro reports connected=true.</span>
      </div>
    </div>
  );
}

function ServiceStatusCard({
  icon,
  title,
  health,
  footer
}: {
  icon: ReactElement;
  title: string;
  health?: ServiceHealth;
  footer?: string;
}): ReactElement {
  return (
    <article className="panel status-card">
      <div className="panel-heading split">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        <StatusPill status={health?.status ?? 'not_configured'} />
      </div>
      <p>{health?.detail ?? 'Loading runtime status.'}</p>
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
  onSelectDevice
}: {
  devices: DeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
}): ReactElement {
  const executableDevices = getExecutableDevices(devices);

  return (
    <article className="panel device-panel" id="devices">
      <div className="panel-heading split">
        <div>
          <Smartphone size={20} aria-hidden="true" />
          <h2>Devices</h2>
        </div>
        <StatusPill status={executableDevices.length ? 'ready' : 'disconnected'} />
      </div>

      {devices.length ? (
        <ul className="device-list">
          {devices.map((device) => {
            const executable = isExecutableDevice(device);

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
                <StatusPill status={device.connected ? 'ready' : 'disconnected'} />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyDeviceState />
      )}

      {devices.length && !executableDevices.length ? <EmptyDeviceState /> : null}
    </article>
  );
}

export function ReportPanel({
  report,
  exportState,
  onExportMarkdown
}: {
  report: TestReport | null;
  run: TestRun | null;
  context: ReportContext | null;
  exportState: RunActionState;
  onExportMarkdown: () => void;
}): ReactElement {
  if (!report) {
    return (
      <article className="panel" id="report">
        <div className="panel-heading">
          <FileText size={20} aria-hidden="true" />
          <h2>Report</h2>
        </div>
        <div className="empty-state">
          <FileText size={20} aria-hidden="true" />
          <div>
            <strong>No report yet</strong>
            <span>A report appears after the local runtime accepts a run.</span>
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
          <h2>{report.title}</h2>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            disabled={exportState.status === 'busy'}
            onClick={onExportMarkdown}
            title="Export Markdown report"
          >
            {exportState.status === 'busy' ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <FileText size={18} aria-hidden="true" />
            )}
            Export
          </button>
          <StatusPill status={report.status} />
        </div>
      </div>

      <dl className="metric-grid">
        <div>
          <dt>Target</dt>
          <dd>{report.targetDevice}</dd>
        </div>
        <div>
          <dt>Case</dt>
          <dd>{report.testCase}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(report.startedAt, report.endedAt)}</dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>{formatDateTime(report.generatedAt)}</dd>
        </div>
      </dl>

      <p>{report.summary}</p>
      {exportState.status !== 'idle' ? <p className="muted">{exportState.detail}</p> : null}
      {report.failureReason ? (
        <p className="validation-message">{report.failureReason}</p>
      ) : null}
      <pre className="report-markdown">{report.markdown}</pre>
    </article>
  );
}

export function App(): ReactElement {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | null>(null);
  const [viewerUrl, setViewerUrl] = useState(getViewerConfig({}).url);
  const [viewerProbe, setViewerProbe] = useState<ViewerProbeState>(INITIAL_VIEWER_PROBE_STATE);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>(INITIAL_UPLOAD_STATE);
  const [importedCase, setImportedCase] = useState<TestCaseManifest | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [runtimeState, setRuntimeState] = useState<RunActionState>({
    status: 'idle',
    detail: 'Runtime status has not been refreshed yet.'
  });
  const [runAction, setRunAction] = useState<RunActionState>({
    status: 'idle',
    detail: 'No run has been started.'
  });
  const [reportExport, setReportExport] = useState<RunActionState>({
    status: 'idle',
    detail: 'Report has not been exported.'
  });
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [report, setReport] = useState<TestReport | null>(null);
  const [reportContext, setReportContext] = useState<ReportContext | null>(null);

  const api = useMemo(() => getApi(), []);
  const readiness = useMemo(
    () =>
      getRunReadiness({
        environment,
        devices,
        selectedDeviceId,
        importedCase,
        prompt
      }),
    [devices, environment, importedCase, prompt, selectedDeviceId]
  );
  const selectedDevice = getSelectedDevice(devices, selectedDeviceId);
  const runtimeGeneratedAt = environment ? formatDateTime(environment.generatedAt) : 'Not loaded';
  const trimmedViewerUrl = viewerUrl.trim();
  const canOpenViewer = isAllowedLocalViewerUrl(trimmedViewerUrl);

  async function refreshRuntime(): Promise<void> {
    setRuntimeState({ status: 'busy', detail: 'Refreshing local runtime status.' });

    try {
      const [nextEnvironment, nextDevices, nextViewerConfig] = await Promise.all([
        api.env.getStatus(),
        api.devices.list(),
        api.viewer.getConfig()
      ]);

      setEnvironment(nextEnvironment);
      setDevices(nextDevices);
      setViewerConfig(nextViewerConfig);
      setViewerUrl(nextViewerConfig.url);
      setSelectedDeviceId((current) => getPreferredDeviceId(nextDevices, current));
      setRuntimeState({
        status: 'success',
        detail: `Last refreshed ${formatDateTime(nextEnvironment.generatedAt)}.`
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

    setImportedCase(null);
    setCurrentRun(null);
    setReport(null);
    setReportExport({
      status: 'idle',
      detail: 'Report has not been exported.'
    });

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
      detail: 'Importing through the preload case API.'
    });

    try {
      const manifest = await api.cases.import(createCaseImportRequest(fileCandidate));
      setImportedCase(manifest);
      setUploadState({
        name: manifest.name,
        status: manifest.status === 'imported' ? 'accepted' : 'rejected',
        detail: manifest.validationMessages[0] ?? `${manifest.format.toUpperCase()} case imported.`
      });
    } catch (error) {
      setUploadState({
        name: file.name,
        status: 'rejected',
        detail: getErrorMessage(error)
      });
    }
  }

  async function createRunReport(
    run: TestRun,
    context: ReportContext,
    error?: string
  ): Promise<TestReport> {
    try {
      return await api.reports.get(run.id);
    } catch (reportError) {
      return createReportPlaceholder({
        run,
        ...context,
        error: error ?? getErrorMessage(reportError)
      });
    }
  }

  async function pollRunUntilSettled(runId: string, context: ReportContext): Promise<void> {
    for (let attempt = 0; attempt < RUN_STATUS_MAX_POLLS; attempt += 1) {
      const latestRun = await api.runs.getStatus(runId);
      const latestReport = await createRunReport(latestRun, context);

      setCurrentRun(latestRun);
      setReport(latestReport);

      if (isTerminalRunStatus(latestRun.status)) {
        const completedWithoutFailure =
          latestRun.status === 'succeeded' || latestRun.status === 'cancelled';

        setRunAction({
          status: completedWithoutFailure ? 'success' : 'error',
          detail: `Run ${latestRun.id} finished as ${formatStatusLabel(latestRun.status)}.`
        });
        return;
      }

      setRunAction({
        status: 'busy',
        detail: `Run ${latestRun.id} is ${formatStatusLabel(latestRun.status)}.`
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
    if (!readiness.canStart || !readiness.selectedDevice || !importedCase) {
      setRunAction({
        status: 'error',
        detail: readiness.reasons.join(' ')
      });
      return;
    }

    const instruction = prompt.trim();

    setRunAction({
      status: 'busy',
      detail: 'Sending Agent instruction and starting the local run.'
    });
    setReportExport({
      status: 'idle',
      detail: 'Report has not been exported.'
    });

    try {
      const session = agentSession ?? (await api.agent.createSession());
      const userMessage: AgentMessage = {
        id: `local-user-${Date.now()}`,
        sessionId: session.id,
        role: 'user',
        content: instruction,
        createdAt: new Date().toISOString()
      };
      const agentReply = await api.agent.sendMessage({
        sessionId: session.id,
        content: instruction
      });
      const run = await api.runs.start({
        caseId: importedCase.id,
        deviceId: readiness.selectedDevice.id,
        prompt: instruction
      });
      const context = {
        device: readiness.selectedDevice,
        testCase: importedCase
      };
      const nextReport = await createRunReport(run, context);

      setAgentSession(session);
      setAgentMessages((messages) => [...messages, userMessage, agentReply]);
      setCurrentRun(run);
      setReport(nextReport);
      setReportContext(context);
      setRunAction({
        status: run.status === 'failed' || run.status === 'blocked' ? 'error' : 'success',
        detail: `Run ${run.id} is ${formatStatusLabel(run.status)}.`
      });
      await pollRunUntilSettled(run.id, context);
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleCancelRun(): Promise<void> {
    if (!currentRun) {
      return;
    }

    setRunAction({
      status: 'busy',
      detail: `Cancelling ${currentRun.id}.`
    });

    try {
      const cancelledRun = await api.runs.cancel(currentRun.id);
      const nextReport = await createRunReport(cancelledRun, reportContext ?? {});

      setCurrentRun(cancelledRun);
      setReport(nextReport);
      setRunAction({
        status: 'success',
        detail: `Run ${cancelledRun.id} is ${formatStatusLabel(cancelledRun.status)}.`
      });
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error)
      });
    }
  }

  async function handleExportReport(): Promise<void> {
    if (!currentRun) {
      return;
    }

    setReportExport({
      status: 'busy',
      detail: 'Exporting Markdown report.'
    });

    try {
      const exportedReport = await api.reports.export({
        runId: currentRun.id,
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
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-lockup">
          <MonitorSmartphone aria-hidden="true" size={28} />
          <div>
            <strong>App Auto Test</strong>
            <span>P0 workbench</span>
          </div>
        </div>
        <nav className="nav-list">
          <a className="nav-item active" href="#overview">
            <Activity size={18} aria-hidden="true" />
            Overview
          </a>
          <a className="nav-item" href="#viewer">
            <MonitorSmartphone size={18} aria-hidden="true" />
            Viewer
          </a>
          <a className="nav-item" href="#devices">
            <Smartphone size={18} aria-hidden="true" />
            Devices
          </a>
          <a className="nav-item" href="#cases">
            <UploadCloud size={18} aria-hidden="true" />
            Cases
          </a>
          <a className="nav-item" href="#report">
            <FileText size={18} aria-hidden="true" />
            Report
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">QSC-23</span>
            <h1>Automation Workbench</h1>
          </div>
          <button
            className="icon-button"
            disabled={runtimeState.status === 'busy'}
            onClick={() => void refreshRuntime()}
            title="Refresh runtime"
          >
            {runtimeState.status === 'busy' ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
            Refresh
          </button>
        </header>

        <section id="overview" className="panel-grid three">
          <ServiceStatusCard
            icon={<Cable size={20} aria-hidden="true" />}
            title="Agent"
            health={environment?.agent}
            footer={`Session: ${agentSession?.status ?? 'not started'}`}
          />
          <ServiceStatusCard
            icon={<Smartphone size={20} aria-hidden="true" />}
            title="Maestro"
            health={environment?.maestro}
            footer={`${getExecutableDevices(devices).length} executable device(s)`}
          />
          <ServiceStatusCard
            icon={<MonitorSmartphone size={20} aria-hidden="true" />}
            title="Viewer"
            health={environment?.viewer}
            footer={viewerConfig ? `${viewerConfig.source} URL: ${viewerConfig.url}` : 'Loading viewer config'}
          />
        </section>

        <div className={`runtime-banner banner-${runtimeState.status}`}>
          <span>{runtimeState.detail}</span>
          <small>Generated: {runtimeGeneratedAt}</small>
        </div>

        <section className="panel-grid two">
          <article className="panel" id="viewer">
            <div className="panel-heading split">
              <div>
                <Settings2 size={20} aria-hidden="true" />
                <h2>Viewer URL</h2>
              </div>
              <StatusPill status={viewerProbe.status} />
            </div>
            <label className="field-label" htmlFor="viewer-url">
              Local target
            </label>
            <input
              id="viewer-url"
              className="text-input"
              value={viewerUrl}
              onChange={(event) => {
                setViewerUrl(event.target.value);
                setViewerProbe(INITIAL_VIEWER_PROBE_STATE);
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
                ? viewerProbe.detail
                : 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'}
            </p>
            <div className="action-row">
              <button
                className="icon-button"
                disabled={viewerProbe.status === 'checking'}
                onClick={() => void handleViewerProbe()}
                title="Probe viewer"
              >
                {viewerProbe.status === 'checking' ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Activity size={18} aria-hidden="true" />
                )}
                Probe
              </button>
              <button
                className="icon-button"
                disabled={!canOpenViewer}
                onClick={handleViewerOpen}
                title={canOpenViewer ? 'Open local viewer' : 'Viewer URL must be local'}
              >
                <MonitorSmartphone size={18} aria-hidden="true" />
                Open
              </button>
            </div>
            <span className="subtle-line">Requirement: 9999. Current Maestro hint: 10000.</span>
          </article>

          <DeviceListPanel
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
          />
        </section>

        <section className="panel-grid two">
          <article className="panel" id="cases">
            <div className="panel-heading split">
              <div>
                <UploadCloud size={20} aria-hidden="true" />
                <h2>Test Case</h2>
              </div>
              <StatusPill status={uploadState.status} />
            </div>
            <label className="upload-dropzone" htmlFor="case-upload">
              <UploadCloud size={24} aria-hidden="true" />
              <strong>{uploadState.name || 'Select Maestro YAML'}</strong>
              <span>{uploadState.detail}</span>
            </label>
            <input
              id="case-upload"
              className="visually-hidden"
              type="file"
              accept=".yaml,.yml"
              onChange={(event) => void handleCaseUpload(event)}
            />
            {importedCase ? (
              <dl className="metric-grid compact">
                <div>
                  <dt>Format</dt>
                  <dd>{importedCase.format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Imported</dt>
                  <dd>{formatDateTime(importedCase.importedAt)}</dd>
                </div>
              </dl>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel-heading split">
              <div>
                <MessageSquare size={20} aria-hidden="true" />
                <h2>Agent Trigger</h2>
              </div>
              <StatusPill status={readiness.canStart ? 'ready' : 'blocked'} />
            </div>
            <textarea
              className="prompt-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Run the uploaded smoke flow on the selected device"
            />
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
              Start Run
            </button>
            <ul className="blocker-list compact">
              {(readiness.canStart
                ? [`Ready for ${selectedDevice?.name ?? 'selected device'}.`]
                : readiness.reasons
              ).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </article>
        </section>

        <section className="panel-grid two">
          <article className="panel run-panel">
            <div className="panel-heading split">
              <div>
                <CheckCircle2 size={20} aria-hidden="true" />
                <h2>Run Status</h2>
              </div>
              <StatusPill status={currentRun?.status ?? runAction.status} />
            </div>
            <p>{runAction.detail}</p>
            {currentRun && !isTerminalRunStatus(currentRun.status) ? (
              <button className="icon-button" onClick={() => void handleCancelRun()} title="Cancel run">
                <Ban size={18} aria-hidden="true" />
                Cancel
              </button>
            ) : null}
            {currentRun ? (
              <dl className="metric-grid">
                <div>
                  <dt>Run</dt>
                  <dd>{currentRun.id}</dd>
                </div>
                <div>
                  <dt>Case</dt>
                  <dd>{currentRun.caseId}</dd>
                </div>
                <div>
                  <dt>Device</dt>
                  <dd>{currentRun.deviceId}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(currentRun.updatedAt)}</dd>
                </div>
              </dl>
            ) : (
              <div className="empty-state">
                <AlertTriangle aria-hidden="true" size={20} />
                <div>
                  <strong>Waiting for a run</strong>
                  <span>Start remains disabled while environment, device, case, or prompt checks fail.</span>
                </div>
              </div>
            )}

            {agentMessages.length ? (
              <ol className="message-list">
                {agentMessages.map((message) => (
                  <li key={message.id} className={`message-row message-${message.role}`}>
                    <strong>{message.role}</strong>
                    <span>{message.content}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </article>

          <ReportPanel
            report={report}
            run={currentRun}
            context={reportContext}
            exportState={reportExport}
            onExportMarkdown={() => void handleExportReport()}
          />
        </section>
      </section>
    </main>
  );
}
