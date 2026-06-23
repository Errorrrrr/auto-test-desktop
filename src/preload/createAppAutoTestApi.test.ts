import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { IpcChannel } from '../shared/ipcChannels';
import { createAppAutoTestApi } from './createAppAutoTestApi';

describe('preload appAutoTest API', () => {
  it('exposes only the renderer-safe whitelist namespaces', () => {
    const api = createAppAutoTestApi(async <T,>() => undefined as T);

    expect(Object.keys(api).sort()).toEqual([
      'agent',
      'cases',
      'devices',
      'env',
      'reports',
      'runs',
      'viewer'
    ]);
    expect('invoke' in api).toBe(false);
    expect('shell' in api).toBe(false);
    expect('fs' in api).toBe(false);
  });

  it('maps public methods to fixed IPC channels, not renderer-supplied channel names', async () => {
    const calls: Array<{ channel: string; payload: unknown }> = [];
    const api = createAppAutoTestApi(async <T,>(
      channel: IpcChannel,
      payload: unknown
    ): Promise<T> => {
      calls.push({ channel, payload });
      return undefined as T;
    });

    await api.viewer.probe('http://127.0.0.1:10000/');
    await api.devices.start('ios-shutdown');
    await api.cases.import({ sourcePath: '/tmp/smoke.yaml' });
    await api.runs.getStatus('run-1');
    await api.agent.sendMessage({ sessionId: 'session-1', content: 'Run smoke flow' });

    expect(calls).toEqual([
      {
        channel: IPC_CHANNELS.viewer.probe,
        payload: { url: 'http://127.0.0.1:10000/' }
      },
      {
        channel: IPC_CHANNELS.devices.start,
        payload: { deviceId: 'ios-shutdown' }
      },
      {
        channel: IPC_CHANNELS.cases.import,
        payload: { sourcePath: '/tmp/smoke.yaml' }
      },
      {
        channel: IPC_CHANNELS.runs.getStatus,
        payload: { runId: 'run-1' }
      },
      {
        channel: IPC_CHANNELS.agent.sendMessage,
        payload: { sessionId: 'session-1', content: 'Run smoke flow' }
      }
    ]);
  });
});
