import type { DeviceInfo } from '../../shared/types';
import type { AgentProvider } from '../adapters/agent/AgentProvider';
import { LocalAgentProvider } from '../adapters/agent/LocalAgentProvider';
import { LocalCliMaestroProvider } from '../adapters/maestro/LocalCliMaestroProvider';
import type { MaestroProvider } from '../adapters/maestro/MaestroProvider';
import { StaticMaestroProvider } from '../adapters/maestro/MaestroProvider';
import { createRuntimeConfig, type RuntimeEnv } from '../config/runtimeConfig';
import { AppDataStorage } from '../storage/AppDataStorage';
import { AgentModelSettingsService } from './AgentModelSettingsService';
import { AgentSessionService } from './AgentSessionService';
import { DeviceService } from './DeviceService';
import { EnvironmentService } from './EnvironmentService';
import { ReportService } from './ReportService';
import { TaskService } from './TaskService';
import { TestCaseService } from './TestCaseService';
import { TestRunService } from './TestRunService';
import { ViewerService } from './ViewerService';

export interface AppAutoTestServices {
  agent: AgentSessionService;
  cases: TestCaseService;
  devices: DeviceService;
  env: EnvironmentService;
  modelSettings: AgentModelSettingsService;
  reports: ReportService;
  runs: TestRunService;
  tasks: TaskService;
  viewer: ViewerService;
}

export function createDefaultServices(options: {
  agentProvider?: AgentProvider;
  dataRoot?: string;
  env: RuntimeEnv;
  devices?: DeviceInfo[];
  maestroProvider?: MaestroProvider;
}): AppAutoTestServices {
  const config = createRuntimeConfig(options.env, { dataRoot: options.dataRoot });
  const storage = new AppDataStorage(config.dataRoot);
  const modelSettings = new AgentModelSettingsService({
    defaultModelName: config.agentCodexModelName,
    storage
  });
  const maestroProvider =
    options.maestroProvider ??
    (options.devices
      ? new StaticMaestroProvider(options.devices)
      : new LocalCliMaestroProvider({
          adbCommand: config.adbPath,
          emulatorCommand: config.androidEmulatorPath,
          maestroCommand: config.maestroCliPath,
          providerMode: config.maestroProvider,
          xcrunCommand: config.xcrunPath
        }));
  const agentProvider =
    options.agentProvider ??
    new LocalAgentProvider({
      codexServiceTier: config.agentCodexServiceTier,
      command: config.agentCommand,
      maestroMcpCommand: config.maestroCliPath,
      provider: config.agentProvider
    });
  const viewer = new ViewerService({ env: options.env });
  const devices = new DeviceService({
    provider: maestroProvider,
    webDeviceProvider: () => {
      const viewerConfig = viewer.getConfig();

      if (!viewerConfig.allowed) {
        return undefined;
      }

      return {
        id: 'web-viewer',
        name: 'Web Viewer',
        platform: 'web',
        type: 'unknown',
        connected: true,
        state: viewerConfig.url
      };
    }
  });
  const agent = new AgentSessionService(agentProvider, {
    modelSettings
  });
  const cases = new TestCaseService({
    maxUploadSizeBytes: config.maxUploadSizeBytes,
    storage
  });
  const runs = new TestRunService({
    agentService: agent,
    deviceService: devices,
    runStore: storage.getRunStore(),
    runTimeoutMs: config.runTimeoutMs,
    testCaseStore: storage.getTestCaseStore()
  });
  const reports = new ReportService({
    storage,
    testRunService: runs
  });
  const tasks = new TaskService({
    modelSettings,
    naturalLanguageAppId: config.maestroAppId,
    reports,
    runService: runs,
    storage,
    testCaseService: cases
  });
  const env = new EnvironmentService({
    agentService: agent,
    deviceService: devices,
    viewerService: viewer
  });

  return {
    agent,
    cases,
    devices,
    env,
    modelSettings,
    reports,
    runs,
    tasks,
    viewer
  };
}
