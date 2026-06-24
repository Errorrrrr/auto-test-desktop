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
      'tasks',
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
    await api.tasks.create({ name: 'Smoke task', description: 'Verify launch' });
    await api.tasks.list();
    await api.tasks.get('task-1');
    await api.tasks.updateInput({
      taskId: 'task-1',
      prompt: 'Run launch smoke'
    });
    await api.tasks.importCase({
      taskId: 'task-1',
      sourcePath: '/tmp/smoke.yaml'
    });
    await api.tasks.start({ taskId: 'task-1', deviceId: 'android-1' });
    await api.tasks.cancel('task-1');
    await api.tasks.getReport('task-1');
    await api.tasks.exportReport({ taskId: 'task-1', format: 'markdown' });
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
        channel: IPC_CHANNELS.tasks.create,
        payload: { name: 'Smoke task', description: 'Verify launch' }
      },
      {
        channel: IPC_CHANNELS.tasks.list,
        payload: undefined
      },
      {
        channel: IPC_CHANNELS.tasks.get,
        payload: { taskId: 'task-1' }
      },
      {
        channel: IPC_CHANNELS.tasks.updateInput,
        payload: {
          taskId: 'task-1',
          prompt: 'Run launch smoke'
        }
      },
      {
        channel: IPC_CHANNELS.tasks.importCase,
        payload: {
          taskId: 'task-1',
          sourcePath: '/tmp/smoke.yaml'
        }
      },
      {
        channel: IPC_CHANNELS.tasks.start,
        payload: { taskId: 'task-1', deviceId: 'android-1' }
      },
      {
        channel: IPC_CHANNELS.tasks.cancel,
        payload: { taskId: 'task-1' }
      },
      {
        channel: IPC_CHANNELS.tasks.getReport,
        payload: { taskId: 'task-1' }
      },
      {
        channel: IPC_CHANNELS.tasks.exportReport,
        payload: { taskId: 'task-1', format: 'markdown' }
      },
      {
        channel: IPC_CHANNELS.agent.sendMessage,
        payload: { sessionId: 'session-1', content: 'Run smoke flow' }
      }
    ]);
  });
});
