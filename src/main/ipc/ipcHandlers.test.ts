import { describe, expect, it } from 'vitest';

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

function createTestServices() {
  return createDefaultServices({
    agentProvider: testAgentProvider,
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
    const handlers = createIpcHandlers(createTestServices());

    await expect(invokeIpcHandler(handlers, 'shell:exec', {})).rejects.toMatchObject({
      code: 'IPC_CHANNEL_NOT_ALLOWED',
      message: expect.stringContaining('not allowed')
    });
  });

  it('rejects non-localhost viewer URLs with an understandable error', async () => {
    const handlers = createIpcHandlers(createTestServices());

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
    const handlers = createIpcHandlers(createTestServices());

    await expect(
      invokeIpcHandler(handlers, IPC_CHANNELS.cases.import, {})
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('sourcePath')
    });
  });

  it('exposes environment and device state through service-backed handlers', async () => {
    const handlers = createIpcHandlers(createTestServices());

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
});
