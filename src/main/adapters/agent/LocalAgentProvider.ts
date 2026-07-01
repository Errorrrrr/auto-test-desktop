import { randomUUID } from 'node:crypto';

import type {
  AgentMessage,
  AgentSendMessageRequest,
  AgentSession,
  AgentSessionStatus,
  ServiceHealth
} from '../../../shared/types';
import { describeCommandError, type CommandError, type ExecFile, nodeExecFile } from '../exec';
import type { AgentProvider, AgentTestExecutionRequest, AgentTestExecutionResult } from './AgentProvider';

interface LocalAgentProviderOptions {
  codexServiceTier?: 'fast' | 'flex';
  command?: string;
  execFile?: ExecFile;
  maestroMcpCommand?: string;
  provider?: string;
}

export class LocalAgentProvider implements AgentProvider {
  private readonly codexServiceTier: 'fast' | 'flex';
  private readonly command?: string;
  private readonly execFile: ExecFile;
  private readonly maestroMcpCommand: string;
  private readonly provider: string;

  constructor(options: LocalAgentProviderOptions = {}) {
    this.provider = options.provider ?? 'codex';
    this.command = options.command ?? (this.provider === 'codex' ? 'codex' : undefined);
    this.codexServiceTier = options.codexServiceTier ?? 'fast';
    this.execFile = options.execFile ?? nodeExecFile;
    this.maestroMcpCommand = options.maestroMcpCommand ?? 'maestro';
  }

  async health(): Promise<ServiceHealth> {
    if (this.provider === 'manual-ready') {
      return {
        status: 'not_configured',
        label: 'Agent adapter',
        detail:
          'Manual-ready Agent mode cannot execute task tests. Configure AGENT_PROVIDER=codex so Codex CLI can call Maestro MCP.'
      };
    }

    if (!this.command || this.provider === 'manual') {
      return {
        status: 'not_configured',
        label: 'Agent adapter',
        detail: 'Codex CLI is not configured. Configure AGENT_PROVIDER=codex and AGENT_COMMAND=codex.'
      };
    }

    if (this.provider !== 'codex') {
      return {
        status: 'not_configured',
        label: 'Agent adapter',
        detail: `Agent provider "${this.provider}" is not supported for task execution. Use AGENT_PROVIDER=codex.`
      };
    }

    try {
      await this.execFile('/usr/bin/which', [this.command], { timeout: 3_000 });

      return {
        status: 'ready',
        label: 'Agent adapter',
        detail: `Codex CLI command "${this.command}" is installed. Task execution will be delegated to Codex, which should call Maestro MCP.`
      };
    } catch (error) {
      return {
        status: 'disconnected',
        label: 'Agent adapter',
        detail: `Codex CLI command "${this.command}" is unavailable: ${describeCommandError(error)}`
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
        this.provider === 'codex'
          ? 'Codex CLI is configured for non-interactive task execution through Maestro MCP.'
          : 'Codex CLI is not configured for task execution.',
      createdAt: new Date().toISOString()
    };
  }

  async runTest(request: AgentTestExecutionRequest): Promise<AgentTestExecutionResult> {
    if (this.provider !== 'codex' || !this.command) {
      return {
        status: 'failed',
        stdout: '',
        stderr: '',
        failureReason: 'Codex CLI is not configured for task execution.'
      };
    }

    if (!request.modelSnapshot?.modelName) {
      return {
        status: 'failed',
        stdout: '',
        stderr: '',
        failureReason: 'Codex model snapshot is required before task execution.'
      };
    }

    const prompt = buildCodexExecutionPrompt(request);
    const executionWorkspace = request.workspacePath?.trim() || process.cwd();
    const maestroMcpArgs = ['mcp', '--no-viewer', `--working-dir=${executionWorkspace}`];
    // Maestro MCP controls local devices and is cancelled by Codex's workspace sandbox.
    // Disable shell tools so bypassing the sandbox only exposes the explicit MCP server.
    const args = [
      '-c',
      `service_tier="${this.codexServiceTier}"`,
      '-c',
      'mcp_servers.maestro.enabled=true',
      '-c',
      `mcp_servers.maestro.command=${toTomlString(this.maestroMcpCommand)}`,
      '-c',
      `mcp_servers.maestro.args=${toTomlStringArray(maestroMcpArgs)}`,
      '--disable',
      'apps',
      '--disable',
      'plugins',
      '--disable',
      'tool_suggest',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      'exec',
      '-m',
      request.modelSnapshot.modelName,
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--cd',
      executionWorkspace,
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-'
    ];

    try {
      const { stdout, stderr } = await this.execFile(this.command, args, {
        input: prompt,
        signal: request.signal,
        timeout: request.timeoutMs
      });

      return {
        ...parseCodexResult(stdout),
        stdout,
        stderr
      };
    } catch (error) {
      const commandError = error as CommandError;
      const aborted = commandError.name === 'AbortError' || commandError.code === 'ABORT_ERR';
      const timedOut = !aborted && (commandError.killed || commandError.signal === 'SIGTERM');

      return {
        status: timedOut ? 'timeout' : 'failed',
        stdout: commandError.stdout ?? '',
        stderr: commandError.stderr ?? '',
        failureReason: aborted ? 'Codex task execution was cancelled.' : describeCommandError(error)
      };
    }
  }
}

function buildCodexExecutionPrompt(request: AgentTestExecutionRequest): string {
  const lines = [
    'You are executing a mobile app automation test for the desktop test client.',
    'This is not a software development, code review, build, deployment, or bugfix task.',
    'Do not invoke development workflow skills, repository AGENTS instructions, codebase analysis, or CodeGraph.',
    'Use the configured Maestro MCP tools to run the test. Do not execute the local maestro CLI.',
    'The app will read your final answer to determine the run result.',
    'Do not report success after only launching or opening the app.',
    'If the app was only launched/opened, no Maestro-driven instruction steps ran, or the requested outcome was not verified, report TEST_RESULT: failed.',
    'Before the final TEST_RESULT marker, include these evidence markers:',
    'TEST_NON_LAUNCH_ACTIONS_EXECUTED: <number of Maestro-driven user interactions completed after app launch/open>',
    'TEST_ASSERTIONS_PASSED: <number of explicit assertions or observations verifying the requested non-launch outcome>',
    'TEST_INSTRUCTION_COMPLETED: yes or no',
    'Launch/open/wait steps do not count toward TEST_NON_LAUNCH_ACTIONS_EXECUTED or TEST_ASSERTIONS_PASSED.',
    'For TEST_RESULT: passed, TEST_NON_LAUNCH_ACTIONS_EXECUTED and TEST_ASSERTIONS_PASSED must both be greater than zero, and TEST_INSTRUCTION_COMPLETED must be yes.',
    'End your final answer with exactly one result marker: TEST_RESULT: passed or TEST_RESULT: failed.',
    'Keep the run bounded. Prefer one complete Maestro flow after inspecting the current screen.',
    'For every maestro/run inline YAML flow, include the required top-level config section before ---.',
    'Use appId from Target App ID when it is provided; otherwise use the foreground app package if Maestro screen context exposes it.',
    'Do not call maestro/cheat_sheet unless a syntax-valid inline flow fails twice.',
    'After the final observation or assertion, stop calling tools and immediately emit the evidence markers and final TEST_RESULT.',
    '',
    'Target device:',
    `- id: ${request.device.id}`,
    `- name: ${request.device.name}`,
    `- platform: ${request.device.platform}`,
    `- type: ${request.device.type}`,
    `- connected: ${request.device.connected ? 'true' : 'false'}`
  ];

  if (request.targetAppId) {
    lines.push('', `Target App ID: ${request.targetAppId}`);
  }

  if (request.casePath) {
    lines.push(
      '',
      'Uploaded test case:',
      `- id: ${request.caseId ?? 'not provided'}`,
      `- name: ${request.caseName ?? 'not provided'}`,
      `- path: ${request.casePath}`,
      '',
      'Read the test case file from the path above and execute its steps through Maestro MCP. The file may contain YAML intended for MCP-assisted execution; do not reject it only because it is not directly runnable by maestro CLI.'
    );
  }

  if (request.prompt?.trim()) {
    lines.push(
      '',
      'Natural-language test instruction:',
      request.prompt.trim(),
      '',
      'Interpret the natural-language instruction and execute the corresponding flow through Maestro MCP.'
    );
  }

  if (!request.casePath && !request.prompt?.trim()) {
    lines.push('', 'No test case file or natural-language instruction was provided. Report TEST_RESULT: failed.');
  }

  return lines.join('\n');
}

function parseCodexResult(stdout: string): Pick<AgentTestExecutionResult, 'status' | 'failureReason'> {
  const output = stdout.trim();
  const failed = output.match(/TEST_RESULT:\s*(failed|fail|failure|blocked|error)\b/i);

  if (failed) {
    return {
      status: 'failed',
      failureReason: 'Codex reported TEST_RESULT: failed.'
    };
  }

  if (/TEST_RESULT:\s*(passed|pass|success|succeeded)\b/i.test(output)) {
    const evidenceFailureReason = getExecutionEvidenceFailureReason(output);

    if (evidenceFailureReason) {
      return {
        status: 'failed',
        failureReason: evidenceFailureReason
      };
    }

    return {
      status: 'succeeded'
    };
  }

  return {
    status: 'failed',
    failureReason: 'Codex did not report a TEST_RESULT marker, so the test outcome is unknown.'
  };
}

function getExecutionEvidenceFailureReason(output: string): string | undefined {
  const actions = parseNonNegativeIntegerMarker(output, 'TEST_NON_LAUNCH_ACTIONS_EXECUTED');
  const assertions = parseNonNegativeIntegerMarker(output, 'TEST_ASSERTIONS_PASSED');
  const instructionCompleted = output.match(/TEST_INSTRUCTION_COMPLETED:\s*(yes|no)\b/i)?.[1]?.toLowerCase();

  if (actions === undefined || assertions === undefined || !instructionCompleted) {
    return 'Codex reported TEST_RESULT: passed without required non-launch execution evidence.';
  }

  if (actions < 1 || assertions < 1 || instructionCompleted !== 'yes') {
    return 'Codex reported TEST_RESULT: passed, but the non-launch execution evidence does not show completed actions and verification.';
  }

  return undefined;
}

function parseNonNegativeIntegerMarker(output: string, marker: string): number | undefined {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(new RegExp(`${escapedMarker}:\\s*(\\d+)\\b`, 'i'));

  return match ? Number.parseInt(match[1], 10) : undefined;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlStringArray(values: string[]): string {
  return JSON.stringify(values);
}
