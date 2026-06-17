import { contextBridge, ipcRenderer } from 'electron';

import { createAppAutoTestApi } from './createAppAutoTestApi';

const api = createAppAutoTestApi((channel, payload) => ipcRenderer.invoke(channel, payload));

contextBridge.exposeInMainWorld('appAutoTest', api);
