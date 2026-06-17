import { describe, expect, it } from 'vitest';

import type { ExecFile } from '../exec';
import { LocalAgentProvider } from './LocalAgentProvider';

describe('LocalAgentProvider', () => {
  it('supports an explicit manual-ready mode without auto-launching local agents', async () => {
    const provider = new LocalAgentProvider({ provider: 'manual-ready' });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'ready',
      detail: expect.stringContaining('Manual-ready Agent mode')
    });
    await expect(provider.createSession()).resolves.toMatchObject({
      status: 'available'
    });
  });

  it('does not auto-launch local agents when no command is configured', async () => {
    const provider = new LocalAgentProvider({ provider: 'manual' });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'not_configured',
      detail: expect.stringContaining('will not auto-launch')
    });
    await expect(provider.createSession()).resolves.toMatchObject({
      status: 'unavailable'
    });
  });

  it('detects an installed agent command without treating it as a message transport', async () => {
    const execFile: ExecFile = async () => ({ stdout: '/usr/local/bin/codex\n', stderr: '' });
    const provider = new LocalAgentProvider({
      command: 'codex',
      execFile,
      provider: 'codex'
    });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'degraded',
      detail: expect.stringContaining('no message transport')
    });
    await expect(provider.sendMessage({ sessionId: 'session-1', content: 'Run smoke' })).resolves.toMatchObject({
      sessionId: 'session-1',
      content: expect.stringContaining('does not auto-launch')
    });
  });
});
