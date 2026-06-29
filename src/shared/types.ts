export type ViewerConfigSource = 'env' | 'default';

export interface ViewerConfig {
  url: string;
  source: ViewerConfigSource;
  originalRequirementUrl: string;
  maestroObservedUrl: string;
  allowed: boolean;
  warning?: string;
}

export type ServiceStatus = 'ready' | 'degraded' | 'disconnected' | 'not_configured';

export interface ServiceHealth {
  status: ServiceStatus;
  label: string;
  detail: string;
}

export type DevicePlatform = 'android' | 'ios' | 'web' | 'unknown';
export type DeviceType = 'emulator' | 'simulator' | 'physical' | 'unknown';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: DevicePlatform;
  type: DeviceType;
  connected: boolean;
  launchable?: boolean;
  source?: 'adb' | 'android-avd' | 'simctl' | 'xctrace';
  state?: string;
}

export interface DeviceStartRequest {
  deviceId: string;
}

export interface DeviceStopRequest {
  deviceId: string;
}

export type DeviceStartStatus =
  | 'already_running'
  | 'failed'
  | 'not_startable'
  | 'started'
  | 'starting';

export interface DeviceStartResult {
  deviceId: string;
  device?: DeviceInfo;
  status: DeviceStartStatus;
  detail: string;
}

export type DeviceStopStatus =
  | 'already_stopped'
  | 'failed'
  | 'not_stoppable'
  | 'stopped';

export interface DeviceStopResult {
  deviceId: string;
  device?: DeviceInfo;
  status: DeviceStopStatus;
  detail: string;
}

export interface EnvironmentStatus {
  generatedAt: string;
  agent: ServiceHealth;
  maestro: ServiceHealth;
  viewer: ServiceHealth & {
    url: string;
    source: ViewerConfigSource;
  };
  canStartRun: boolean;
  blockers: string[];
  capabilities: {
    uploads: string[];
    reports: string[];
    execution: 'mock_disabled' | 'ready';
  };
}

export interface RuntimeSnapshot {
  generatedAt: string;
  environment: {
    agent: ServiceHealth;
    maestro: ServiceHealth;
    viewer: ServiceHealth & {
      url: string;
      source: ViewerConfigSource;
    };
  };
  devices: DeviceInfo[];
  canStartRun: boolean;
  blockers: string[];
  capabilities: {
    uploads: string[];
    reports: string[];
    execution: 'mock_disabled' | 'ready';
  };
}

export type CodexModelSource = 'app_default' | 'preset' | 'custom';

export interface CodexModelPreset {
  id: string;
  label: string;
  modelName: string;
  recommended?: boolean;
}

export interface CodexModelSettings {
  modelName: string;
  source: CodexModelSource;
  presetId?: string;
  updatedAt: string;
}

export interface CodexModelSettingsSaveRequest {
  modelName: string;
  source: CodexModelSource;
  presetId?: string;
}

export interface CodexModelSnapshot {
  modelName: string;
  source: CodexModelSource;
  presetId?: string;
  capturedAt: string;
  settingsUpdatedAt?: string;
}

export interface CodexModelSettingsResponse {
  settings?: CodexModelSettings;
  effective: CodexModelSnapshot;
  presets: CodexModelPreset[];
  defaultModelName: string;
  warning?: string;
}

export type ViewerReachability = 'unchecked' | 'reachable' | 'unreachable';

export interface ViewerProbeRequest {
  url: string;
}

export interface ViewerProbeResult {
  url: string;
  allowed: boolean;
  reachable: ViewerReachability;
  detail: string;
}

export type TestCaseFormat = 'yaml';
export type TestCaseStatus = 'imported' | 'invalid';

export interface TestCaseImportRequest {
  sourcePath: string;
  displayName?: string;
}

export interface TestCaseManifest {
  id: string;
  name: string;
  sourcePath: string;
  storedPath?: string;
  originalSourcePath?: string;
  sizeBytes?: number;
  format: TestCaseFormat;
  importedAt: string;
  status: TestCaseStatus;
  validationMessages: string[];
}

export type TaskInputMode = 'empty' | 'natural_language' | 'test_case' | 'mixed';

export interface NaturalLanguageInput {
  prompt: string;
  updatedAt: string;
}

export interface TaskCaseInput {
  caseId: string;
  name: string;
  storedPath: string;
  format: TestCaseFormat;
  source: 'uploaded' | 'agent_generated';
  importedAt: string;
}

export interface TaskInput {
  mode: TaskInputMode;
  naturalLanguage?: NaturalLanguageInput;
  testCase?: TaskCaseInput;
  blockers: string[];
}

export type TestTaskStatus =
  | 'draft'
  | 'ready'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'blocked';

export type TaskLogEntryKind =
  | 'task_created'
  | 'input_updated'
  | 'case_imported'
  | 'model_snapshot_captured'
  | 'run_started'
  | 'run_completed'
  | 'report_generated';

export interface TaskLogEntry {
  id: string;
  kind: TaskLogEntryKind;
  message: string;
  createdAt: string;
  runId?: string;
  reportPath?: string;
  status?: TestTaskStatus;
}

export interface TestTask {
  id: string;
  name: string;
  description?: string;
  status: TestTaskStatus;
  input: TaskInput;
  targetAppId?: string;
  deviceId?: string;
  deviceSnapshot?: DeviceInfo;
  latestRunId?: string;
  reportPath?: string;
  reportPaths?: string[];
  runIds?: string[];
  logs?: TaskLogEntry[];
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  modelSnapshot?: CodexModelSnapshot;
}

export interface TaskCreateRequest {
  name: string;
  description?: string;
}

export interface TaskIdRequest {
  taskId: string;
}

export interface TaskUpdateInputRequest extends TaskIdRequest {
  prompt?: string;
  targetAppId?: string;
}

export interface TaskImportCaseRequest extends TaskIdRequest, TestCaseImportRequest {}

export interface TaskStartRequest extends TaskIdRequest {
  deviceId: string;
  targetAppId?: string;
}

export interface TaskReportExportRequest extends TaskIdRequest {
  format: ReportFormat;
}

export interface TaskReportArtifact {
  label: string;
  path: string;
  kind: 'log' | 'report' | 'transcript' | 'flow';
}

export interface TaskReport {
  taskId: string;
  runId?: string;
  title: string;
  status: TestTaskStatus;
  inputMode: TaskInputMode;
  inputSummary: string;
  targetDevice: string;
  startedAt: string;
  endedAt: string;
  conclusion: string;
  failureReason?: string;
  modelSummary?: string;
  modelSnapshot?: CodexModelSnapshot;
  artifacts: TaskReportArtifact[];
  markdown: string;
  filePath?: string;
}

export type AgentSessionStatus = 'available' | 'unavailable';
export type AgentMessageRole = 'user' | 'assistant' | 'system';

export interface AgentSession {
  id: string;
  createdAt: string;
  status: AgentSessionStatus;
  modelSnapshot?: CodexModelSnapshot;
}

export interface AgentSendMessageRequest {
  sessionId: string;
  content: string;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

export type TestRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'blocked';

export interface TestRunStartRequest {
  caseId: string;
  deviceId: string;
  prompt: string;
}

export interface TestRunStatusRequest {
  runId: string;
}

export interface TestRun {
  id: string;
  taskId?: string;
  caseId: string;
  caseName?: string;
  casePath?: string;
  agentDetail?: string;
  deviceId: string;
  deviceName?: string;
  devicePlatform?: DevicePlatform;
  deviceType?: DeviceType;
  prompt: string;
  status: TestRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  stdout?: string;
  stderr?: string;
  modelSnapshot?: CodexModelSnapshot;
}

export type ReportFormat = 'page' | 'markdown';

export interface ReportGetRequest {
  runId: string;
}

export interface ReportExportRequest {
  runId: string;
  format: ReportFormat;
}

export interface TestReport {
  runId: string;
  title: string;
  status: TestRunStatus;
  generatedAt: string;
  summary: string;
  targetDevice: string;
  testCase: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  conclusion: string;
  failureReason?: string;
  modelSummary?: string;
  modelSnapshot?: CodexModelSnapshot;
  markdown: string;
  filePath?: string;
}

export interface AppAutoTestApi {
  env: {
    getStatus: () => Promise<EnvironmentStatus>;
  };
  devices: {
    list: () => Promise<DeviceInfo[]>;
    start: (deviceId: string) => Promise<DeviceStartResult>;
    stop: (deviceId: string) => Promise<DeviceStopResult>;
  };
  viewer: {
    getConfig: () => Promise<ViewerConfig>;
    probe: (url: string) => Promise<ViewerProbeResult>;
  };
  cases: {
    import: (request: TestCaseImportRequest) => Promise<TestCaseManifest>;
  };
  runs: {
    start: (request: TestRunStartRequest) => Promise<TestRun>;
    cancel: (runId: string) => Promise<TestRun>;
    getStatus: (runId: string) => Promise<TestRun>;
  };
  reports: {
    get: (runId: string) => Promise<TestReport>;
    export: (request: ReportExportRequest) => Promise<TestReport>;
  };
  tasks: {
    create: (request: TaskCreateRequest) => Promise<TestTask>;
    list: () => Promise<TestTask[]>;
    get: (taskId: string) => Promise<TestTask>;
    delete: (taskId: string) => Promise<TestTask>;
    updateInput: (request: TaskUpdateInputRequest) => Promise<TestTask>;
    importCase: (request: TaskImportCaseRequest) => Promise<TestTask>;
    start: (request: TaskStartRequest) => Promise<TestTask>;
    cancel: (taskId: string) => Promise<TestTask>;
    getReport: (taskId: string) => Promise<TaskReport>;
    exportReport: (request: TaskReportExportRequest) => Promise<TaskReport>;
  };
  agent: {
    createSession: () => Promise<AgentSession>;
    getModelSettings: () => Promise<CodexModelSettingsResponse>;
    saveModelSettings: (request: CodexModelSettingsSaveRequest) => Promise<CodexModelSettingsResponse>;
    sendMessage: (request: AgentSendMessageRequest) => Promise<AgentMessage>;
  };
}
