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

function createBrowserFallbackApi(language: Language): AppAutoTestApi {
  const copy = COPY[language];

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
      get: async (runId) => {
        const generatedAt = new Date().toISOString();
        const summary = localizeText('Report generation requires the Electron main process.', language);

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
          conclusion: localizeText('Blocked before execution', language),
          failureReason: summary,
          markdown: `# ${copy.report.fallbackTitle}\n\n${summary}`
        };
      },
      export: async (request) => {
        const generatedAt = new Date().toISOString();
        const summary = localizeText('Report export requires the Electron main process.', language);

        return {
          runId: request.runId,
          title: `${getReportFormatLabel(request.format, language)} ${copy.report.fallbackTitle}`,
          status: 'blocked',
          generatedAt,
          summary,
          targetDevice: 'browser-device',
          testCase: 'browser-case',
          prompt: '',
          startedAt: generatedAt,
          endedAt: generatedAt,
          conclusion: localizeText('Blocked before execution', language),
          failureReason: summary,
          markdown: `# ${copy.report.fallbackTitle}\n\n${summary}`
        };
      }
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
        content: localizeText('Browser fallback cannot reach local agents.', language),
        createdAt: new Date().toISOString()
      })
    }
  };
}

function getApi(language: Language): AppAutoTestApi {
  return window.appAutoTest ?? createBrowserFallbackApi(language);
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
  language = 'en'
}: {
  devices: DeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  language?: Language;
}): ReactElement {
  const executableDevices = getExecutableDevices(devices);
  const copy = COPY[language];

  return (
    <article className="panel device-panel" id="devices">
      <div className="panel-heading split">
        <div>
          <Smartphone size={20} aria-hidden="true" />
          <h2>{copy.titles.devices}</h2>
        </div>
        <StatusPill
          status={executableDevices.length ? 'ready' : 'disconnected'}
          language={language}
        />
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
                <StatusPill
                  status={device.connected ? 'ready' : 'disconnected'}
                  language={language}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyDeviceState language={language} />
      )}

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
  report: TestReport | null;
  run: TestRun | null;
  context: ReportContext | null;
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
          <dd>{report.testCase}</dd>
        </div>
        <div>
          <dt>{copy.fields.duration}</dt>
          <dd>{formatDuration(report.startedAt, report.endedAt, language)}</dd>
        </div>
        <div>
          <dt>{copy.fields.generated}</dt>
          <dd>{formatDateTime(report.generatedAt, language)}</dd>
        </div>
      </dl>

      <p>{localizeText(report.summary, language)}</p>
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
  const [viewerProbe, setViewerProbe] = useState<ViewerProbeState>(() => createInitialViewerProbeState(language));
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>(() => createInitialUploadState(language));
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

  const copy = COPY[language];
  const api = useMemo(() => getApi(language), [language]);
  const readiness = useMemo(
    () =>
      getRunReadiness({
        environment,
        devices,
        selectedDeviceId,
        importedCase,
        prompt
      }, language),
    [devices, environment, importedCase, language, prompt, selectedDeviceId]
  );
  const selectedDevice = getSelectedDevice(devices, selectedDeviceId);
  const runtimeGeneratedAt = environment ? formatDateTime(environment.generatedAt, language) : copy.runtime.notLoaded;
  const trimmedViewerUrl = viewerUrl.trim();
  const canOpenViewer = isAllowedLocalViewerUrl(trimmedViewerUrl);

  useEffect(() => {
    persistLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

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
        detail: `Last refreshed ${formatDateTime(nextEnvironment.generatedAt, 'en')}.`
      });
    } catch (error) {
      setRuntimeState({
        status: 'error',
        detail: getErrorMessage(error, language)
      });
    }
  }

  useEffect(() => {
    void refreshRuntime();
  }, []);

  async function handleViewerProbe(): Promise<void> {
    const blocked = validateViewerUrl(trimmedViewerUrl, language);

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
      setViewerProbe(mapViewerProbeResult(result, language));
    } catch (error) {
      setViewerProbe({
        status: 'error',
        detail: getErrorMessage(error, language)
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
        detail: localizeText('Viewer URL must point to localhost, 127.0.0.1, or ::1.', language)
      });
    }
  }

  async function handleCaseUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileCandidate = file as File & { path?: string };
    const validation = validateCaseFile(fileCandidate, language);

    setImportedCase(null);
    setCurrentRun(null);
    setReport(null);
    setReportExport({
      status: 'idle',
      detail: localizeText('Report has not been exported.', language)
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
        detail: localizeText('Importing through the preload case API.', language)
      });

    try {
      const manifest = await api.cases.import(createCaseImportRequest(fileCandidate));
      setImportedCase(manifest);
      setUploadState({
        name: manifest.name,
        status: manifest.status === 'imported' ? 'accepted' : 'rejected',
        detail: manifest.validationMessages[0]
          ? localizeText(manifest.validationMessages[0], language)
          : localizeText(`${manifest.format.toUpperCase()} case imported.`, language)
      });
    } catch (error) {
      setUploadState({
        name: file.name,
        status: 'rejected',
        detail: getErrorMessage(error, language)
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
        error: error ?? getErrorMessage(reportError, language)
      }, language);
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
          detail: `Run ${latestRun.id} finished as ${formatStatusLabel(latestRun.status, 'en')}.`
        });
        return;
      }

      setRunAction({
        status: 'busy',
        detail: `Run ${latestRun.id} is ${formatStatusLabel(latestRun.status, 'en')}.`
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
        detail: localizeText('Report has not been exported.', language)
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
        detail: `Run ${run.id} is ${formatStatusLabel(run.status, 'en')}.`
      });
      await pollRunUntilSettled(run.id, context);
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error, language)
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
        detail: `Run ${cancelledRun.id} is ${formatStatusLabel(cancelledRun.status, 'en')}.`
      });
    } catch (error) {
      setRunAction({
        status: 'error',
        detail: getErrorMessage(error, language)
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
        detail: getErrorMessage(error, language)
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
          <a className="nav-item" href="#viewer">
            <MonitorSmartphone size={18} aria-hidden="true" />
            {copy.nav.viewer}
          </a>
          <a className="nav-item" href="#devices">
            <Smartphone size={18} aria-hidden="true" />
            {copy.nav.devices}
          </a>
          <a className="nav-item" href="#cases">
            <UploadCloud size={18} aria-hidden="true" />
            {copy.nav.cases}
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

        <section className="panel-grid two">
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
                setViewerProbe(createInitialViewerProbeState(language));
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

          <DeviceListPanel
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            language={language}
          />
        </section>

        <section className="panel-grid two">
          <article className="panel" id="cases">
            <div className="panel-heading split">
              <div>
                <UploadCloud size={20} aria-hidden="true" />
                <h2>{copy.titles.testCase}</h2>
              </div>
              <StatusPill status={uploadState.status} language={language} />
            </div>
            <label className="upload-dropzone" htmlFor="case-upload">
              <UploadCloud size={24} aria-hidden="true" />
              <strong>{uploadState.name || copy.copy.defaultCaseLabel}</strong>
              <span>{localizeText(uploadState.detail, language)}</span>
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
                  <dt>{copy.fields.format}</dt>
                  <dd>{importedCase.format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>{copy.fields.imported}</dt>
                  <dd>{formatDateTime(importedCase.importedAt, language)}</dd>
                </div>
              </dl>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel-heading split">
              <div>
                <MessageSquare size={20} aria-hidden="true" />
                <h2>{copy.titles.agentTrigger}</h2>
              </div>
              <StatusPill status={readiness.canStart ? 'ready' : 'blocked'} language={language} />
            </div>
            <textarea
              className="prompt-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={copy.copy.promptPlaceholder}
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
              {copy.actions.startRun}
            </button>
            <ul className="blocker-list compact">
              {(readiness.canStart
                ? [
                    localizeText(
                      `Ready for ${selectedDevice?.name ?? copy.runtime.selectedDevice}.`,
                      language
                    )
                  ]
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
                <h2>{copy.titles.runStatus}</h2>
              </div>
              <StatusPill status={currentRun?.status ?? runAction.status} language={language} />
            </div>
            <p>{localizeText(runAction.detail, language)}</p>
            {currentRun && !isTerminalRunStatus(currentRun.status) ? (
              <button
                className="icon-button"
                onClick={() => void handleCancelRun()}
                title={copy.titlesAttr.cancelRun}
              >
                <Ban size={18} aria-hidden="true" />
                {copy.actions.cancel}
              </button>
            ) : null}
            {currentRun ? (
              <dl className="metric-grid">
                <div>
                  <dt>{copy.fields.run}</dt>
                  <dd>{currentRun.id}</dd>
                </div>
                <div>
                  <dt>{copy.fields.case}</dt>
                  <dd>{currentRun.caseId}</dd>
                </div>
                <div>
                  <dt>{copy.fields.device}</dt>
                  <dd>{currentRun.deviceId}</dd>
                </div>
                <div>
                  <dt>{copy.fields.updated}</dt>
                  <dd>{formatDateTime(currentRun.updatedAt, language)}</dd>
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

          <ReportPanel
            report={report}
            run={currentRun}
            context={reportContext}
            exportState={reportExport}
            onExportMarkdown={() => void handleExportReport()}
            language={language}
          />
        </section>
      </section>
    </main>
  );
}
