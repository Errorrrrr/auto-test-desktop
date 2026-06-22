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
}

export type DeviceStartStatus =
  | 'started'
  | 'already_connected'
  | 'unsupported'
  | 'unavailable'
  | 'failed';

export interface DeviceStartResult {
  device?: DeviceInfo;
  devices?: DeviceInfo[];
  status: DeviceStartStatus;
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

export type AgentSessionStatus = 'available' | 'unavailable';
export type AgentMessageRole = 'user' | 'assistant' | 'system';

export interface AgentSession {
  id: string;
  createdAt: string;
  status: AgentSessionStatus;
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
  markdown: string;
  filePath?: string;
}

export interface AppAutoTestApi {
  env: {
    getStatus: () => Promise<EnvironmentStatus>;
  };
  devices: {
    list: () => Promise<DeviceInfo[]>;
    start?: (deviceId: string) => Promise<DeviceStartResult>;
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
  agent: {
    createSession: () => Promise<AgentSession>;
    sendMessage: (request: AgentSendMessageRequest) => Promise<AgentMessage>;
  };
}
