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
        detail: 'Codex CLI test executor is not available in the browser fallback.'
      },
      maestro: {
        status: 'not_configured',
        label: 'Maestro MCP',
        detail: 'Maestro MCP execution requires the Electron main process and Codex CLI.'
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
      'Codex CLI and Maestro MCP execution require the Electron main process.'
    ],
    capabilities: {
      uploads: ['.yaml', '.yml'],
      reports: ['page', 'markdown'],
      execution: 'mock_disabled'
    }
  };
}
