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
  weather: {
    search: inv('weather:search'),
    months: inv('weather:months'),
  },
  phone: {
    start: inv('phone:start'),
    stop: inv('phone:stop'),
    status: inv('phone:status'),
    onImage: (cb) => ipcRenderer.on('phone:image', (_e, m) => cb(m)),
  },
  bio: {
    status: inv('bio:status'),
    enable: inv('bio:enable'),
    unlock: inv('bio:unlock'),
    disable: inv('bio:disable'),
  },
  file: {
    save: (name, text) => ipcRenderer.invoke('file:save', { name, text }),
  },
  loan: {
    readFile: inv('loan:text'),
    parse: inv('loan:parse'),
  },
  localAi: {
    status: inv('localai:status'),
    chat: inv('localai:chat'),
    pull: inv('localai:pull'),
    loans: inv('localai:loans'),
    cancel: inv('localai:cancel'),
    onProgress: (cb) => ipcRenderer.on('localai:progress', (_e, m) => cb(m)),
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
    carArt: inv('ai:carArt'),
    creditShot: inv('ai:creditShot'),
    receipt: inv('ai:receipt'),
    assetValue: inv('ai:assetValue'),
    energy: inv('ai:energy'),
    energyAdvice: inv('ai:energyAdvice'),
    service: inv('ai:service'),
    test: inv('ai:test'),
    categorize: inv('ai:categorize'),
    loans: inv('ai:loans'),
  },
  pdf: {
    parse: inv('pdf:parse'),
  },
  quotes: {
    get: inv('quotes:get'),
    details: inv('quotes:details'),
  },
  widget: {
    push: inv('widget:push'),
    status: inv('widget:status'),
    set: inv('widget:set'),
  },
});
