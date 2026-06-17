import { IPC_CHANNELS, type IpcChannel } from '../shared/ipcChannels';
import type {
  AgentMessage,
  AgentSendMessageRequest,
  AgentSession,
  AppAutoTestApi,
  DeviceInfo,
  EnvironmentStatus,
  ReportExportRequest,
  TestCaseImportRequest,
  TestCaseManifest,
  TestReport,
  TestRun,
  TestRunStartRequest,
  ViewerConfig,
  ViewerProbeResult
} from '../shared/types';

export type IpcInvoker = <T>(channel: IpcChannel, payload?: unknown) => Promise<T>;

export function createAppAutoTestApi(invoke: IpcInvoker): AppAutoTestApi {
  return {
    env: {
      getStatus: () => invoke<EnvironmentStatus>(IPC_CHANNELS.env.getStatus)
    },
    devices: {
      list: () => invoke<DeviceInfo[]>(IPC_CHANNELS.devices.list)
    },
    viewer: {
      getConfig: () => invoke<ViewerConfig>(IPC_CHANNELS.viewer.getConfig),
      probe: (url: string) => invoke<ViewerProbeResult>(IPC_CHANNELS.viewer.probe, { url })
    },
    cases: {
      import: (request: TestCaseImportRequest) =>
        invoke<TestCaseManifest>(IPC_CHANNELS.cases.import, request)
    },
    runs: {
      start: (request: TestRunStartRequest) => invoke<TestRun>(IPC_CHANNELS.runs.start, request),
      cancel: (runId: string) => invoke<TestRun>(IPC_CHANNELS.runs.cancel, { runId }),
      getStatus: (runId: string) => invoke<TestRun>(IPC_CHANNELS.runs.getStatus, { runId })
    },
    reports: {
      get: (runId: string) => invoke<TestReport>(IPC_CHANNELS.reports.get, { runId }),
      export: (request: ReportExportRequest) =>
        invoke<TestReport>(IPC_CHANNELS.reports.export, request)
    },
    agent: {
      createSession: () => invoke<AgentSession>(IPC_CHANNELS.agent.createSession),
      sendMessage: (request: AgentSendMessageRequest) =>
        invoke<AgentMessage>(IPC_CHANNELS.agent.sendMessage, request)
    }
  };
}
