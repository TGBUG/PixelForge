import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins } from '@pixelforge/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The shell reads plugins from the in-repo fixtures directory during development.
// `PIXELFORGE_PLUGINS_DIR` overrides it (used by tests and, later, the installed
// plugin directory).
function pluginsDir() {
  if (process.env.PIXELFORGE_PLUGINS_DIR) {
    return path.resolve(process.env.PIXELFORGE_PLUGINS_DIR);
  }
  return path.resolve(__dirname, '..', '..', '..', 'fixtures', 'plugins');
}

ipcMain.handle('plugins:list', () => discoverPlugins(pluginsDir()));

// The renderer reports back once it has painted, which lets the smoke script
// assert the shell actually reached a populated list without a display.
ipcMain.on('app:ready', (_event, info) => {
  if (process.env.PIXELFORGE_SMOKE) {
    console.log(`[smoke] plugins=${info.plugins} errors=${info.errors}`);
    if (info.detail) console.log(`[smoke] detail=${JSON.stringify(info.detail)}`);
    app.quit();
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const smoke = process.env.PIXELFORGE_SMOKE;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: smoke ? { smoke } : undefined,
  });
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
