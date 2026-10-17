const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelforge', {
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  pickFile: (accept) => ipcRenderer.invoke('dialog:pickFile', { accept }),
  pickZip: () => ipcRenderer.invoke('dialog:pickZip'),
  installPlugin: (zipPath) => ipcRenderer.invoke('plugins:install', { zipPath }),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', { id }),
  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  cancelRun: (runId) => ipcRenderer.invoke('run:cancel', { runId }),
  saveRun: (runId) => ipcRenderer.invoke('run:save', { runId }),
  onRunEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },
  ready: (info) => ipcRenderer.send('app:ready', info),
});
