import type { RuntimeSnapshot, ViewerConfig } from './types';

export function createRuntimeSnapshot(
  viewerConfig: ViewerConfig,
  generatedAt: Date = new Date()
): RuntimeSnapshot {
  return {
    generatedAt: generatedAt.toISOString(),
    environment: {
      agent: {
        status: 'not_configured',
        label: 'Agent adapter',
        detail: 'Local agent adapter is reserved for the next implementation task.'
      },
      maestro: {
        status: 'not_configured',
        label: 'Maestro MCP',
        detail: 'Maestro provider is not wired in this baseline.'
      },
      viewer: {
        status: viewerConfig.allowed ? 'degraded' : 'disconnected',
        label: 'Device viewer',
        detail: viewerConfig.allowed
          ? 'Configured but not probed in the skeleton baseline.'
          : viewerConfig.warning ?? 'Viewer URL is not allowed.',
        url: viewerConfig.url,
        source: viewerConfig.source
      }
    },
    devices: [],
    canStartRun: false,
    blockers: [
      'No connected Android or iOS device is available in this baseline.',
      'Maestro and local agent adapters are pending follow-up implementation.'
    ],
    capabilities: {
      uploads: ['.yaml', '.yml'],
      reports: ['page', 'markdown'],
      execution: 'mock_disabled'
    }
  };
}
