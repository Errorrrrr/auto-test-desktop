import type { AgentMessage, AgentSendMessageRequest, AgentSession, ServiceHealth } from '../../../shared/types';

export interface AgentProvider {
  health(): Promise<ServiceHealth>;
  createSession(): Promise<AgentSession>;
  sendMessage(request: AgentSendMessageRequest): Promise<AgentMessage>;
}
