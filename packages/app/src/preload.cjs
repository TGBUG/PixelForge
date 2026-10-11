const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelforge', {
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  ready: (info) => ipcRenderer.send('app:ready', info),
});
