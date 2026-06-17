import { randomUUID } from 'node:crypto';

import type {
  AgentMessage,
  AgentSendMessageRequest,
  AgentSession,
  AgentSessionStatus,
  ServiceHealth
} from '../../../shared/types';
import { describeCommandError, type ExecFile, nodeExecFile } from '../exec';
import type { AgentProvider } from './AgentProvider';

interface LocalAgentProviderOptions {
  command?: string;
  execFile?: ExecFile;
  provider?: string;
}

export class LocalAgentProvider implements AgentProvider {
  private readonly command?: string;
  private readonly execFile: ExecFile;
  private readonly provider: string;

  constructor(options: LocalAgentProviderOptions = {}) {
    this.command = options.command;
    this.execFile = options.execFile ?? nodeExecFile;
    this.provider = options.provider ?? 'manual';
  }

  async health(): Promise<ServiceHealth> {
    if (this.provider === 'manual-ready') {
      return {
        status: 'ready',
        label: 'Agent adapter',
        detail:
          'Manual-ready Agent mode is enabled. The user must confirm the local Agent dialogue outside this app; no Codex/Cursor process is auto-launched.'
      };
    }

    if (!this.command || this.provider === 'manual') {
      return {
        status: 'not_configured',
        label: 'Agent adapter',
        detail: 'Local agent command is not configured. The desktop client will not auto-launch Codex or Cursor.'
      };
    }

    try {
      await this.execFile('/usr/bin/which', [this.command], { timeout: 3_000 });

      return {
        status: 'degraded',
        label: 'Agent adapter',
        detail: `Agent command "${this.command}" is installed, but no message transport is configured. Auto-launch is disabled.`
      };
    } catch (error) {
      return {
        status: 'disconnected',
        label: 'Agent adapter',
        detail: `Agent command "${this.command}" is unavailable: ${describeCommandError(error)}`
      };
    }
  }

  async createSession(): Promise<AgentSession> {
    const health = await this.health();
    const status: AgentSessionStatus =
      health.status === 'disconnected' || health.status === 'not_configured' ? 'unavailable' : 'available';

    return {
      id: `session-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      status
    };
  }

  async sendMessage(request: AgentSendMessageRequest): Promise<AgentMessage> {
    return {
      id: `message-${randomUUID()}`,
      sessionId: request.sessionId,
      role: 'assistant',
      content:
        'Local agent command detection is available, but P0 does not auto-launch Codex/Cursor or open a message transport.',
      createdAt: new Date().toISOString()
    };
  }
}
