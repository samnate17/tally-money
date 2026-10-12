const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkBridge', {
  getToken: () => ipcRenderer.invoke('link:token'),
  success: (publicToken, meta) =>
    ipcRenderer.invoke('link:success', { publicToken, institution: meta && meta.institution ? meta.institution.name : '' }),
  exit: (message) => ipcRenderer.invoke('link:exit', String(message || '')),
});
