import type { DeviceInfo } from '../../shared/types';
import type { AgentProvider } from '../adapters/agent/AgentProvider';
import { LocalAgentProvider } from '../adapters/agent/LocalAgentProvider';
import { LocalCliMaestroProvider } from '../adapters/maestro/LocalCliMaestroProvider';
import type { MaestroProvider } from '../adapters/maestro/MaestroProvider';
import { StaticMaestroProvider } from '../adapters/maestro/MaestroProvider';
import { createRuntimeConfig, type RuntimeEnv } from '../config/runtimeConfig';
import { AppDataStorage } from '../storage/AppDataStorage';
import { AgentSessionService } from './AgentSessionService';
import { DeviceService } from './DeviceService';
import { EnvironmentService } from './EnvironmentService';
import { ReportService } from './ReportService';
import { TestCaseService } from './TestCaseService';
import { TestRunService } from './TestRunService';
import { ViewerService } from './ViewerService';

export interface AppAutoTestServices {
  agent: AgentSessionService;
  cases: TestCaseService;
  devices: DeviceService;
  env: EnvironmentService;
  reports: ReportService;
  runs: TestRunService;
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
      command: config.agentCommand,
      provider: config.agentProvider
    });
  const devices = new DeviceService({ provider: maestroProvider });
  const viewer = new ViewerService({ env: options.env });
  const agent = new AgentSessionService(agentProvider);
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
  const env = new EnvironmentService({
    agentService: agent,
    deviceService: devices,
    viewerService: viewer
  });

  return {
    agent,
    cases: new TestCaseService({
      maxUploadSizeBytes: config.maxUploadSizeBytes,
      storage
    }),
    devices,
    env,
    reports,
    runs,
    viewer
  };
}
