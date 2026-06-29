import type { EnvironmentStatus, ServiceHealth } from '../../shared/types';
import type { AgentSessionService } from './AgentSessionService';
import type { DeviceService } from './DeviceService';
import type { ViewerService } from './ViewerService';

function isUsableMaestroStatus(status: ServiceHealth['status']): boolean {
  return status === 'ready' || status === 'degraded';
}

function isUsableAgentStatus(status: ServiceHealth['status']): boolean {
  return status === 'ready' || status === 'degraded';
}

export class EnvironmentService {
  private readonly agentService: AgentSessionService;
  private readonly deviceService: DeviceService;
  private readonly viewerService: ViewerService;

  constructor(options: {
    agentService: AgentSessionService;
    deviceService: DeviceService;
    viewerService: ViewerService;
  }) {
    this.agentService = options.agentService;
    this.deviceService = options.deviceService;
    this.viewerService = options.viewerService;
  }

  async getStatus(): Promise<EnvironmentStatus> {
    const viewerConfig = this.viewerService.getConfig();
    const [hasConnectedDevice, maestro, agent] = await Promise.all([
      this.deviceService.hasConnectedExecutableDevice(),
      this.deviceService.getHealth(),
      this.agentService.getHealth()
    ]);
    const blockers = [
      ...(hasConnectedDevice ? [] : ['No connected Android or iOS device is available.']),
      ...(isUsableMaestroStatus(maestro.status) ? [] : ['Maestro provider is not available.']),
      ...(isUsableAgentStatus(agent.status) ? [] : ['Codex CLI test executor is not available.'])
    ];

    return {
      generatedAt: new Date().toISOString(),
      agent,
      maestro,
      viewer: {
        status: viewerConfig.allowed ? 'degraded' : 'disconnected',
        label: 'Device viewer',
        detail: viewerConfig.allowed
          ? 'Viewer URL is configured and constrained to a local target.'
          : viewerConfig.warning ?? 'Viewer URL is not allowed.',
        url: viewerConfig.url,
        source: viewerConfig.source
      },
      canStartRun: blockers.length === 0,
      blockers,
      capabilities: {
        uploads: ['.yaml', '.yml'],
        reports: ['page', 'markdown'],
        execution: blockers.length === 0 ? 'ready' : 'mock_disabled'
      }
    };
  }
}
