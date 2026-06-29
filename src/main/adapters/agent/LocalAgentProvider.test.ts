import { describe, expect, it } from 'vitest';

import type { ExecFile } from '../exec';
import { LocalAgentProvider } from './LocalAgentProvider';

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

      return { stdout: 'Maestro MCP run completed.\nTEST_RESULT: passed\n', stderr: '' };
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
        prompt: '点击登录',
        targetAppId: 'com.example.app',
        timeoutMs: 1000
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
        'exec',
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never'
      ])
    });
    expect(calls[1]?.args.indexOf('-c')).toBeLessThan(calls[1]?.args.indexOf('exec'));
    expect(calls[1]?.args.indexOf('--ask-for-approval')).toBeLessThan(calls[1]?.args.indexOf('exec'));
    expect(calls[1]?.args.at(-1)).toBe('-');
    expect(calls[1]?.options?.input).toContain('Use the configured Maestro MCP tools');
    expect(calls[1]?.options?.input).toContain('/tmp/smoke.yaml');
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
        prompt: '进入我的页面',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('TEST_RESULT')
    });
  });
});
