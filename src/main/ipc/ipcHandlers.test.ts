import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { AgentProvider } from '../adapters/agent/AgentProvider';
import { StaticMaestroProvider } from '../adapters/maestro/MaestroProvider';
import { createDefaultServices } from '../services';
import { createIpcHandlers, invokeIpcHandler } from './ipcHandlers';

const testAgentProvider: AgentProvider = {
  async health() {
    return {
      status: 'not_configured',
      label: 'Agent adapter',
      detail: 'Agent provider is disabled for IPC tests.'
    };
  },
  async createSession() {
    return {
      id: 'session-test',
      createdAt: '2026-06-12T06:00:00Z',
      status: 'unavailable'
    };
  },
  async sendMessage(request) {
    return {
      id: 'message-test',
      sessionId: request.sessionId,
      role: 'assistant',
      content: 'Agent provider is disabled for IPC tests.',
      createdAt: '2026-06-12T06:00:00Z'
    };
  }
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

async function createTestServices() {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-ipc-'));

  tempRoots.push(rootDir);

  return createDefaultServices({
    agentProvider: testAgentProvider,
    dataRoot: join(rootDir, 'data'),
    env: {},
    maestroProvider: new StaticMaestroProvider([], {
      status: 'disconnected',
      label: 'Maestro test provider',
      detail: 'Maestro provider is disabled for IPC tests.'
    })
  });
}

describe('main process IPC handlers', () => {
  it('rejects channels outside the explicit whitelist', async () => {
    const handlers = createIpcHandlers(await createTestServices());

    await expect(invokeIpcHandler(handlers, 'shell:exec', {})).rejects.toMatchObject({
      code: 'IPC_CHANNEL_NOT_ALLOWED',
      message: expect.stringContaining('not allowed')
    });
  });

  it('rejects non-localhost viewer URLs with an understandable error', async () => {
    const handlers = createIpcHandlers(await createTestServices());

    await expect(
      invokeIpcHandler(handlers, IPC_CHANNELS.viewer.probe, {
        url: 'https://example.com:10000/'
      })
    ).rejects.toMatchObject({
      code: 'INVALID_VIEWER_URL',
      message: expect.stringContaining('localhost')
    });
  });

  it('rejects missing required arguments before touching local capabilities', async () => {
    const handlers = createIpcHandlers(await createTestServices());

    await expect(
      invokeIpcHandler(handlers, IPC_CHANNELS.cases.import, {})
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('sourcePath')
    });
  });

  it('exposes environment and device state through service-backed handlers', async () => {
    const handlers = createIpcHandlers(await createTestServices());

    await expect(invokeIpcHandler(handlers, IPC_CHANNELS.env.getStatus)).resolves.toMatchObject({
      maestro: {
        status: 'disconnected'
      },
      viewer: {
        url: 'http://127.0.0.1:10000/'
      },
      canStartRun: false
    });
    await expect(invokeIpcHandler(handlers, IPC_CHANNELS.devices.list)).resolves.toEqual([]);
    await expect(
      invokeIpcHandler(handlers, IPC_CHANNELS.devices.start, { deviceId: 'ios-shutdown' })
    ).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('ios-shutdown')
    });
  });

  it('exposes task workspace contract handlers while preserving the legacy IPC surface', async () => {
    const handlers = createIpcHandlers(await createTestServices());
    const task = await invokeIpcHandler(handlers, IPC_CHANNELS.tasks.create, {
      name: 'Smoke task',
      description: 'Verify launch'
    });

    expect(Object.keys(handlers).sort()).toEqual(
      [
        IPC_CHANNELS.agent.createSession,
        IPC_CHANNELS.agent.sendMessage,
        IPC_CHANNELS.cases.import,
        IPC_CHANNELS.devices.list,
        IPC_CHANNELS.devices.start,
        IPC_CHANNELS.env.getStatus,
        IPC_CHANNELS.reports.export,
        IPC_CHANNELS.reports.get,
        IPC_CHANNELS.runs.cancel,
        IPC_CHANNELS.runs.getStatus,
        IPC_CHANNELS.runs.start,
        IPC_CHANNELS.tasks.cancel,
        IPC_CHANNELS.tasks.create,
        IPC_CHANNELS.tasks.exportReport,
        IPC_CHANNELS.tasks.get,
        IPC_CHANNELS.tasks.getReport,
        IPC_CHANNELS.tasks.importCase,
        IPC_CHANNELS.tasks.list,
        IPC_CHANNELS.tasks.start,
        IPC_CHANNELS.tasks.updateInput,
        IPC_CHANNELS.viewer.getConfig,
        IPC_CHANNELS.viewer.probe
      ].sort()
    );
    expect(task).toMatchObject({
      id: expect.stringMatching(/^task-/),
      name: 'Smoke task',
      status: 'draft',
      input: {
        mode: 'empty'
      }
    });
    await expect(invokeIpcHandler(handlers, IPC_CHANNELS.tasks.list)).resolves.toEqual([
      expect.objectContaining({
        name: 'Smoke task'
      })
    ]);
    await expect(
      invokeIpcHandler(handlers, IPC_CHANNELS.tasks.start, {
        taskId: (task as { id: string }).id,
        deviceId: 'android-connected'
      })
    ).rejects.toMatchObject({
      code: 'TASK_INPUT_REQUIRED'
    });
  });
});
