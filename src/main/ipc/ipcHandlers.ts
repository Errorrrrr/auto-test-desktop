import type { IpcMain } from 'electron';

import { IPC_CHANNELS, type IpcChannel } from '../../shared/ipcChannels';
import { AppError } from '../services/AppError';
import type { AppAutoTestServices } from '../services';

type IpcHandler = (payload?: unknown) => Promise<unknown> | unknown;
type IpcHandlers = Record<IpcChannel, IpcHandler>;

export function createIpcHandlers(services: AppAutoTestServices): IpcHandlers {
  return {
    [IPC_CHANNELS.env.getStatus]: () => services.env.getStatus(),
    [IPC_CHANNELS.devices.list]: () => services.devices.listDevices(),
    [IPC_CHANNELS.viewer.getConfig]: () => services.viewer.getConfig(),
    [IPC_CHANNELS.viewer.probe]: (payload: unknown) => services.viewer.probe(payload),
    [IPC_CHANNELS.cases.import]: (payload: unknown) => services.cases.importCase(payload),
    [IPC_CHANNELS.runs.start]: (payload: unknown) => services.runs.start(payload),
    [IPC_CHANNELS.runs.cancel]: (payload: unknown) => services.runs.cancel(payload),
    [IPC_CHANNELS.runs.getStatus]: (payload: unknown) => services.runs.getStatus(payload),
    [IPC_CHANNELS.reports.get]: (payload: unknown) => services.reports.get(payload),
    [IPC_CHANNELS.reports.export]: (payload: unknown) => services.reports.exportReport(payload),
    [IPC_CHANNELS.agent.createSession]: () => services.agent.createSession(),
    [IPC_CHANNELS.agent.sendMessage]: (payload: unknown) => services.agent.sendMessage(payload)
  };
}

export async function invokeIpcHandler(
  handlers: IpcHandlers,
  channel: string,
  payload?: unknown
): Promise<unknown> {
  const handler = (handlers as Record<string, IpcHandler | undefined>)[channel];

  if (!handler) {
    throw new AppError('IPC_CHANNEL_NOT_ALLOWED', `IPC channel "${channel}" is not allowed.`);
  }

  return handler(payload);
}

export function registerIpcHandlers(ipcMain: IpcMain, services: AppAutoTestServices): IpcHandlers {
  const handlers = createIpcHandlers(services);

  for (const [channel, handler] of Object.entries(handlers) as Array<[IpcChannel, IpcHandler]>) {
    ipcMain.handle(channel, (_event, payload) => handler(payload));
  }

  return handlers;
}
