const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('tally', {
  glassActive: process.argv.some((a) => a === '--tally-glass=1'),
  glass: {
    status: inv('glass:status'),
    set: inv('glass:set'),
  },
  theme: {
    mode: inv('theme:mode'),
  },
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
    statement: inv('ai:statement'),
    statementPdf: inv('ai:statementPdf'),
    test: inv('ai:test'),
  },
  pdf: {
    parse: inv('pdf:parse'),
  },
  quotes: {
    get: inv('quotes:get'),
  },
  widget: {
    push: inv('widget:push'),
    status: inv('widget:status'),
    set: inv('widget:set'),
  },
});
