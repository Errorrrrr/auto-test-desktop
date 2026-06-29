import { IPC_CHANNELS, type IpcChannel } from '../shared/ipcChannels';
import type {
  AgentMessage,
  AgentSendMessageRequest,
  AgentSession,
  AppAutoTestApi,
  DeviceInfo,
  DeviceStartResult,
  DeviceStopResult,
  EnvironmentStatus,
  ReportExportRequest,
  TaskCreateRequest,
  TaskImportCaseRequest,
  TaskReport,
  TaskReportExportRequest,
  TaskStartRequest,
  TaskUpdateInputRequest,
  TestCaseImportRequest,
  TestCaseManifest,
  TestReport,
  TestTask,
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
      list: () => invoke<DeviceInfo[]>(IPC_CHANNELS.devices.list),
      start: (deviceId: string) => invoke<DeviceStartResult>(IPC_CHANNELS.devices.start, { deviceId }),
      stop: (deviceId: string) => invoke<DeviceStopResult>(IPC_CHANNELS.devices.stop, { deviceId })
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
    tasks: {
      create: (request: TaskCreateRequest) => invoke<TestTask>(IPC_CHANNELS.tasks.create, request),
      list: () => invoke<TestTask[]>(IPC_CHANNELS.tasks.list),
      get: (taskId: string) => invoke<TestTask>(IPC_CHANNELS.tasks.get, { taskId }),
      delete: (taskId: string) => invoke<TestTask>(IPC_CHANNELS.tasks.delete, { taskId }),
      updateInput: (request: TaskUpdateInputRequest) =>
        invoke<TestTask>(IPC_CHANNELS.tasks.updateInput, request),
      importCase: (request: TaskImportCaseRequest) =>
        invoke<TestTask>(IPC_CHANNELS.tasks.importCase, request),
      start: (request: TaskStartRequest) => invoke<TestTask>(IPC_CHANNELS.tasks.start, request),
      cancel: (taskId: string) => invoke<TestTask>(IPC_CHANNELS.tasks.cancel, { taskId }),
      getReport: (taskId: string) => invoke<TaskReport>(IPC_CHANNELS.tasks.getReport, { taskId }),
      exportReport: (request: TaskReportExportRequest) =>
        invoke<TaskReport>(IPC_CHANNELS.tasks.exportReport, request)
    },
    agent: {
      createSession: () => invoke<AgentSession>(IPC_CHANNELS.agent.createSession),
      sendMessage: (request: AgentSendMessageRequest) =>
        invoke<AgentMessage>(IPC_CHANNELS.agent.sendMessage, request)
    }
  };
}
