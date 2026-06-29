import type { AgentMessage, AgentSession, CodexModelSnapshot, ServiceHealth } from '../../shared/types';
import type {
  AgentProvider,
  AgentTestExecutionRequest,
  AgentTestExecutionResult
} from '../adapters/agent/AgentProvider';
import type { AgentModelSettingsService } from './AgentModelSettingsService';
import { AppError } from './AppError';
import { requireStringField } from './validation';

interface AgentSessionServiceOptions {
  modelSettings?: AgentModelSettingsService;
}

export class AgentSessionService {
  private readonly modelSettings?: AgentModelSettingsService;
  private readonly provider: AgentProvider;

  constructor(provider: AgentProvider, options: AgentSessionServiceOptions = {}) {
    this.modelSettings = options.modelSettings;
    this.provider = provider;
  }

  async getHealth(): Promise<ServiceHealth> {
    return this.provider.health();
  }

  async createSession(): Promise<AgentSession> {
    const [session, modelSnapshot] = await Promise.all([
      this.provider.createSession(),
      this.captureModelSnapshot()
    ]);

    return {
      ...session,
      modelSnapshot
    };
  }

  async sendMessage(request: unknown): Promise<AgentMessage> {
    const sessionId = requireStringField(request, 'sessionId');
    const content = requireStringField(request, 'content');

    return this.provider.sendMessage({
      sessionId,
      content
    });
  }

  async runTest(request: AgentTestExecutionRequest): Promise<AgentTestExecutionResult> {
    if (!request.modelSnapshot?.modelName) {
      throw new AppError(
        'CODEX_MODEL_SNAPSHOT_REQUIRED',
        'A Codex model snapshot is required before task execution.'
      );
    }

    return this.provider.runTest(request);
  }

  async captureModelSnapshot(): Promise<CodexModelSnapshot> {
    if (!this.modelSettings) {
      throw new AppError(
        'CODEX_MODEL_SETTINGS_NOT_CONFIGURED',
        'Codex model settings service is not configured.'
      );
    }

    return this.modelSettings.getEffectiveSnapshot();
  }
}
