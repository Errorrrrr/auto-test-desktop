import type {
  AgentMessage,
  AgentSendMessageRequest,
  AgentSession,
  DeviceInfo,
  ServiceHealth,
  TestRunStatus
} from '../../../shared/types';

export interface AgentTestExecutionRequest {
  caseId?: string;
  caseName?: string;
  casePath?: string;
  device: DeviceInfo;
  prompt?: string;
  signal?: AbortSignal;
  targetAppId?: string;
  taskId?: string;
  timeoutMs?: number;
}

export interface AgentTestExecutionResult {
  status: Extract<TestRunStatus, 'succeeded' | 'failed' | 'timeout'>;
  stdout: string;
  stderr: string;
  failureReason?: string;
}

export interface AgentProvider {
  health(): Promise<ServiceHealth>;
  createSession(): Promise<AgentSession>;
  sendMessage(request: AgentSendMessageRequest): Promise<AgentMessage>;
  runTest(request: AgentTestExecutionRequest): Promise<AgentTestExecutionResult>;
}
