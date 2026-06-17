import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerIpcHandlers } from './ipc/ipcHandlers';
import { resolvePreloadPath } from './preloadPath';
import { resolveRendererEntry } from './rendererEntryPolicy';
import { createDefaultServices } from './services';
import { createViewerWindowOpenHandler } from './windowOpenPolicy';

const currentDir = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'App Auto Test',
    show: false,
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: resolvePreloadPath(currentDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(createViewerWindowOpenHandler());

  const rendererEntry = resolveRendererEntry({
    isPackaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL
  });

  if (rendererEntry.kind === 'url') {
    void mainWindow.loadURL(rendererEntry.url);
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  registerIpcHandlers(
    ipcMain,
    createDefaultServices({
      dataRoot: join(app.getPath('appData'), 'app-auto-test-desktop'),
      env: process.env
    })
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
