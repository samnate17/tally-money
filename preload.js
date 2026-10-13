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
  loan: {
    readFile: inv('loan:text'),
  },
  localAi: {
    status: inv('localai:status'),
    chat: inv('localai:chat'),
    cancel: inv('localai:cancel'),
    onToken: (cb) => ipcRenderer.on('localai:token', (_e, m) => cb(m)),
  },
  update: {
    status: inv('update:status'),
    setToken: inv('update:setToken'),
    clearToken: inv('update:clearToken'),
    check: inv('update:check'),
    install: inv('update:install'),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  },
  onNav: (cb) => ipcRenderer.on('nav', (_e, where) => cb(String(where))),
  plaid: {
    status: inv('plaid:status'),
    saveKeys: inv('plaid:saveKeys'),
    clearKeys: inv('plaid:clearKeys'),
    link: inv('plaid:link'),
    sync: inv('plaid:sync'),
    remove: inv('plaid:remove'),
    linkLoan: inv('plaid:linkLoan'),
    loans: inv('plaid:loans'),
  },
  ai: {
    status: inv('ai:status'),
    saveKey: inv('ai:saveKey'),
    clearKey: inv('ai:clearKey'),
    analyze: inv('ai:analyze'),
    statement: inv('ai:statement'),
    statementPdf: inv('ai:statementPdf'),
    test: inv('ai:test'),
    categorize: inv('ai:categorize'),
    loans: inv('ai:loans'),
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
