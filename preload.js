const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('tally', {
  plaid: {
    status: inv('plaid:status'),
    saveKeys: inv('plaid:saveKeys'),
    clearKeys: inv('plaid:clearKeys'),
    link: inv('plaid:link'),
    sync: inv('plaid:sync'),
    remove: inv('plaid:remove'),
  },
  ai: {
    status: inv('ai:status'),
    saveKey: inv('ai:saveKey'),
    clearKey: inv('ai:clearKey'),
    analyze: inv('ai:analyze'),
  },
});
