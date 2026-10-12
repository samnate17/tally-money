const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  get: () => ipcRenderer.invoke('widget:get'),
  onData: (cb) => { ipcRenderer.on('widget:data', (_e, d) => cb(d)); },
  action: (name) => ipcRenderer.invoke('widget:action', String(name)),
});
