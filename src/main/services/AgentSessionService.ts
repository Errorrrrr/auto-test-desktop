import type { AgentMessage, AgentSession, ServiceHealth } from '../../shared/types';
import type { AgentProvider } from '../adapters/agent/AgentProvider';
import { requireStringField } from './validation';

export class AgentSessionService {
  private readonly provider: AgentProvider;

  constructor(provider: AgentProvider) {
    this.provider = provider;
  }

  async getHealth(): Promise<ServiceHealth> {
    return this.provider.health();
  }

  async createSession(): Promise<AgentSession> {
    return this.provider.createSession();
  }

  async sendMessage(request: unknown): Promise<AgentMessage> {
    const sessionId = requireStringField(request, 'sessionId');
    const content = requireStringField(request, 'content');

    return this.provider.sendMessage({
      sessionId,
      content
    });
  }
}
