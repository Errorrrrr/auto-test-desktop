import { describe, expect, it } from 'vitest';

import type { ExecFile } from '../exec';
import { LocalAgentProvider } from './LocalAgentProvider';

const modelSnapshot = {
  modelName: 'gpt-5',
  source: 'app_default' as const,
  capturedAt: '2026-06-29T07:30:00Z'
};

describe('LocalAgentProvider', () => {
  it('blocks manual-ready mode because task execution requires Codex', async () => {
    const provider = new LocalAgentProvider({ provider: 'manual-ready' });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'not_configured',
      detail: expect.stringContaining('AGENT_PROVIDER=codex')
    });
    await expect(provider.createSession()).resolves.toMatchObject({
      status: 'unavailable'
    });
  });

  it('does not auto-launch local agents when no command is configured', async () => {
    const provider = new LocalAgentProvider({ provider: 'manual' });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'not_configured',
      detail: expect.stringContaining('Codex CLI is not configured')
    });
    await expect(provider.createSession()).resolves.toMatchObject({
      status: 'unavailable'
    });
  });

  it('executes task runs through codex exec with a Maestro MCP prompt', async () => {
    const calls: Array<{ file: string; args: string[]; options?: { input?: string } }> = [];
    const execFile: ExecFile = async (file, args, options) => {
      calls.push({ file, args, options: options as { input?: string } | undefined });

      if (file === '/usr/bin/which') {
        return { stdout: '/usr/local/bin/codex\n', stderr: '' };
      }

      return {
        stdout:
          'Maestro MCP run completed.\nTEST_NON_LAUNCH_ACTIONS_EXECUTED: 3\nTEST_ASSERTIONS_PASSED: 1\nTEST_INSTRUCTION_COMPLETED: yes\nTEST_RESULT: passed\n',
        stderr: ''
      };
    };
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'ready',
      detail: expect.stringContaining('Codex CLI command "codex" is installed')
    });
    await expect(provider.sendMessage({ sessionId: 'session-1', content: 'Run smoke' })).resolves.toMatchObject({
      sessionId: 'session-1',
      content: expect.stringContaining('Codex CLI is configured')
    });
    await expect(
      provider.runTest({
        casePath: '/tmp/smoke.yaml',
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '点击登录',
        targetAppId: 'com.example.app',
        timeoutMs: 1000,
        workspacePath: '/tmp/task-workspace'
      })
    ).resolves.toMatchObject({
      status: 'succeeded',
      stdout: expect.stringContaining('TEST_RESULT: passed')
    });
    expect(calls[1]).toMatchObject({
      file: 'codex',
      args: expect.arrayContaining([
        '-c',
        'service_tier="fast"',
        'mcp_servers.maestro.command="maestro"',
        'mcp_servers.maestro.args=["mcp","--no-viewer","--working-dir=/tmp/task-workspace"]',
        '--disable',
        'apps',
        'plugins',
        'tool_suggest',
        'shell_tool',
        'unified_exec',
        'exec',
        '-m',
        'gpt-5',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox'
      ])
    });
    expect(calls[1]?.args.indexOf('-c')).toBeLessThan(calls[1]?.args.indexOf('exec'));
    expect(calls[1]?.args.indexOf('--ignore-user-config')).toBeGreaterThan(calls[1]?.args.indexOf('exec'));
    expect(calls[1]?.args[calls[1]?.args.indexOf('--cd') + 1]).toBe('/tmp/task-workspace');
    expect(calls[1]?.args.at(-1)).toBe('-');
    expect(calls[1]?.options?.input).toContain('Use the configured Maestro MCP tools');
    expect(calls[1]?.options?.input).toContain('/tmp/smoke.yaml');
    expect(calls[1]?.options?.input).toContain('Do not report success after only launching or opening the app');
    expect(calls[1]?.options?.input).toContain('Launch/open/wait steps do not count');
    expect(calls[1]?.options?.input).toContain('Do not invoke development workflow skills');
    expect(calls[1]?.options?.input).toContain('For every maestro/run inline YAML flow');
    expect(calls[1]?.options?.input).toContain('immediately emit the evidence markers');
  });

  it('injects a custom Maestro MCP command into the isolated Codex execution config', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execFile: ExecFile = async (file, args) => {
      calls.push({ file, args });

      return {
        stdout:
          'TEST_NON_LAUNCH_ACTIONS_EXECUTED: 2\nTEST_ASSERTIONS_PASSED: 1\nTEST_INSTRUCTION_COMPLETED: yes\nTEST_RESULT: passed\n',
        stderr: ''
      };
    };
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      maestroMcpCommand: '/opt/homebrew/bin/maestro',
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '进入我的页面',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'succeeded'
    });

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(['mcp_servers.maestro.command="/opt/homebrew/bin/maestro"'])
    );
  });

  it('does not fall back to the Codex CLI default model when no model snapshot is supplied', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execFile: ExecFile = async (file, args) => {
      calls.push({ file, args });

      return {
        stdout: 'TEST_RESULT: passed',
        stderr: ''
      };
    };
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        prompt: '进入我的页面'
      } as Parameters<LocalAgentProvider['runTest']>[0])
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('model snapshot')
    });
    expect(calls).toEqual([]);
  });

  it('fails Codex runs that report passed without execution evidence', async () => {
    const execFile: ExecFile = async () => ({
      stdout: 'launchApp completed\nTEST_RESULT: passed\n',
      stderr: ''
    });
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '点击登录并确认进入首页',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('execution evidence')
    });
  });

  it('fails Codex runs that count only launchApp as execution evidence', async () => {
    const execFile: ExecFile = async () => ({
      stdout:
        'launchApp completed\nTEST_ACTIONS_EXECUTED: 1\nTEST_ASSERTIONS_PASSED: 1\nTEST_INSTRUCTION_COMPLETED: yes\nTEST_RESULT: passed\n',
      stderr: ''
    });
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '点击登录并确认进入首页',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('non-launch')
    });
  });

  it('fails Codex runs that exit without the required result marker', async () => {
    const execFile: ExecFile = async () => ({
      stdout: '',
      stderr: 'Reading additional input from stdin...\n'
    });
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '进入我的页面',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('TEST_RESULT')
    });
  });

  it('does not treat echoed prompt markers in stderr as the Codex result', async () => {
    const execFile: ExecFile = async () => ({
      stdout: '',
      stderr:
        'user\nEnd your final answer with exactly one result marker: TEST_RESULT: passed or TEST_RESULT: failed.\n'
    });
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(
      provider.runTest({
        device: {
          id: 'emulator-5554',
          name: 'Pixel',
          platform: 'android',
          type: 'emulator',
          connected: true
        },
        modelSnapshot,
        prompt: '设置页面为英文',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'Codex did not report a TEST_RESULT marker, so the test outcome is unknown.'
    });
  });
});
