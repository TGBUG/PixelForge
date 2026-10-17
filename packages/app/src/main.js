import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverPlugins,
  installPlugin,
  removeWorkdir,
  runPlugin,
  saveOutputs,
  uninstallPlugin,
} from '@pixelforge/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep user data under `…/PixelForge` (the userData default would otherwise
// follow the scoped npm package name).
app.setName('PixelForge');

// Installed plugins live under the user data directory. `PIXELFORGE_PLUGINS_DIR`
// overrides it for tests and the smoke harness.
function pluginsDir() {
  if (process.env.PIXELFORGE_PLUGINS_DIR) {
    return path.resolve(process.env.PIXELFORGE_PLUGINS_DIR);
  }
  return path.join(app.getPath('userData'), 'plugins');
}

// T8 will surface this in Settings; until then an env hook keeps it configurable.
function maxRuntimeMs() {
  const value = Number(process.env.PIXELFORGE_MAX_RUNTIME_MS);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Completed runs keep their workdir alive so the preview can be saved.
const previewRuns = new Map();
const activeControllers = new Map();

async function discardFinishedRuns() {
  for (const run of previewRuns.values()) await removeWorkdir(run.workdir);
  previewRuns.clear();
}

ipcMain.handle('plugins:list', () => discoverPlugins(pluginsDir()));

ipcMain.handle('dialog:pickZip', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '插件包', extensions: ['zip'] }],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('plugins:install', async (_event, { zipPath }) =>
  installPlugin({ zipPath, pluginsDir: pluginsDir() }),
);

ipcMain.handle('plugins:uninstall', async (event, { id }) => {
  if (!process.env.PIXELFORGE_SKIP_CONFIRM) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '卸载'],
      defaultId: 0,
      cancelId: 0,
      message: `确定卸载插件「${id}」吗？`,
    });
    if (response !== 1) return { status: 'cancelled' };
  }
  return uninstallPlugin({ pluginsDir: pluginsDir(), id });
});

ipcMain.handle('dialog:pickFile', async (event, { accept } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const extensions = Array.isArray(accept)
    ? accept.map((extension) => String(extension).replace(/^\./, ''))
    : [];
  const filters = extensions.length > 0 ? [{ name: '支持的文件', extensions }] : [];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters,
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('run:start', async (event, { runId, pluginId, params }) => {
  const { plugins } = discoverPlugins(pluginsDir());
  const plugin = plugins.find((item) => item.id === pluginId);
  if (!plugin) {
    return { status: 'error', error: { kind: 'not-found', message: '插件不存在' } };
  }

  await discardFinishedRuns();

  const controller = new AbortController();
  activeControllers.set(runId, controller);

  const result = await runPlugin({
    manifest: plugin.manifest,
    pluginDir: plugin.dir,
    params,
    timeoutMs: maxRuntimeMs(),
    signal: controller.signal,
    // Run the plugin on Electron's binary as plain Node. Scoped to this child
    // so Electron's own renderer/GPU processes are unaffected.
    env: { ELECTRON_RUN_AS_NODE: '1' },
    onEvent: (runEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('run:event', { runId, ...runEvent });
      }
    },
  });

  activeControllers.delete(runId);

  if (result.status !== 'success') {
    await removeWorkdir(result.workdir);
    return { status: result.status, error: result.error };
  }

  previewRuns.set(runId, { workdir: result.workdir, outputs: result.outputs });

  // Preview only; the bytes stay in the temp workdir until the user saves.
  const outputs = result.outputs.map((output) => {
    const image = nativeImage.createFromPath(output.absolutePath);
    return {
      name: path.basename(output.absolutePath),
      dataUrl: image.isEmpty() ? null : image.toDataURL(),
    };
  });

  return { status: 'success', outputs };
});

ipcMain.handle('run:cancel', (_event, { runId }) => {
  activeControllers.get(runId)?.abort();
  return { status: 'cancelling' };
});

ipcMain.handle('run:save', async (event, { runId }) => {
  const run = previewRuns.get(runId);
  if (!run) return { status: 'error', message: '没有可保存的结果' };

  // Test hook: the smoke run skips the native dialog.
  const override = process.env.PIXELFORGE_SAVE_DIR;
  if (override) {
    return { status: 'saved', saved: saveOutputs(run.outputs, override) };
  }

  const win = BrowserWindow.fromWebContents(event.sender);

  if (run.outputs.length === 1) {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(run.outputs[0].absolutePath),
    });
    if (canceled || !filePath) return { status: 'cancelled' };
    fs.copyFileSync(run.outputs[0].absolutePath, filePath);
    return { status: 'saved', saved: [filePath] };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || filePaths.length === 0) return { status: 'cancelled' };
  return { status: 'saved', saved: saveOutputs(run.outputs, filePaths[0]) };
});

ipcMain.on('app:ready', (_event, info) => {
  if (!process.env.PIXELFORGE_SMOKE) return;
  console.log(`[smoke] plugins=${info.plugins} errors=${info.errors}`);
  if (info.detail) console.log(`[smoke] detail=${JSON.stringify(info.detail)}`);
  if (info.run) console.log(`[smoke] run=${JSON.stringify(info.run)}`);
  app.quit();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
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
    query: smoke
      ? {
          smoke,
          input: process.env.PIXELFORGE_SMOKE_INPUT || '',
          zip: process.env.PIXELFORGE_SMOKE_ZIP || '',
        }
      : undefined,
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

app.on('will-quit', () => {
  for (const controller of activeControllers.values()) controller.abort();
  activeControllers.clear();
  for (const run of previewRuns.values()) {
    try {
      fs.rmSync(run.workdir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
  previewRuns.clear();
});
