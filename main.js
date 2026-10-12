const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage } = require('electron');
const path = require('path');
const http = require('http');
const { createSecretStore } = require('./secrets');
const { createPlaid } = require('./plaid');
const { createAI } = require('./ai');

let store, plaid, ai, mainWin = null, linkState = null;

let LINK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Link a bank</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;margin:24px;color:#141b34"><p id="m">Opening the secure bank connection…</p>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" onerror="linkBridge.exit('Could not load Plaid Link. Check your internet connection.')"></script>
<script>
linkBridge.getToken().then(function (token) {
  var h = Plaid.create({
    token: token,
    onSuccess: function (pt, meta) { linkBridge.success(pt, meta); },
    onExit: function (err, meta) { linkBridge.exit(err ? (err.display_message || err.error_message || '') : ''); }
  });
  h.open();
}).catch(function () {
  document.getElementById('m').textContent = 'Could not start the bank connection.';
  linkBridge.exit('Could not start the bank connection.');
});
</script></body></html>`;

// Every renderer call returns {ok, data} or {ok:false, error, code} so messages stay readable.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = (event.senderFrame && event.senderFrame.url) || '';
    if (!url.startsWith('file://')) return { ok: false, error: 'Blocked.' };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Something went wrong.', code: e && e.code };
    }
  });
}

async function runLink(itemId) {
  if (linkState) throw new Error('A bank connection window is already open.');
  const token = await plaid.createLinkToken(itemId);
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(LINK_HTML);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const result = await new Promise((resolve) => {
    const win = new BrowserWindow({
      parent: mainWin || undefined, modal: !!mainWin, width: 520, height: 740, title: 'Link a bank',
      webPreferences: { preload: path.join(__dirname, 'link-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let done = false;
    const finish = (v) => { if (done) return; done = true; linkState = null; resolve(v); if (!win.isDestroyed()) win.close(); };
    linkState = { win, token, finish };
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => finish({ cancelled: true }));
    win.loadURL('http://localhost:' + port + '/');
  });
  server.close();
  return result;
}

function wireIpc() {
  // Link window channels: only the window we opened may call them.
  const fromLink = (e) => linkState && e.sender === linkState.win.webContents;
  ipcMain.handle('link:token', (e) => (fromLink(e) ? linkState.token : ''));
  ipcMain.handle('link:success', (e, r) => { if (fromLink(e)) linkState.finish({ publicToken: String(r.publicToken || ''), institution: String(r.institution || '') }); });
  ipcMain.handle('link:exit', (e, msg) => { if (fromLink(e)) linkState.finish(msg ? { error: String(msg) } : { cancelled: true }); });

  handle('plaid:status', () => plaid.status());
  handle('plaid:saveKeys', (k) => plaid.saveKeys(k));
  handle('plaid:clearKeys', () => plaid.clearKeys());
  handle('plaid:link', async (itemId) => {
    const r = await runLink(itemId || null);
    if (r.cancelled) return { cancelled: true };
    if (r.error) throw new Error(r.error);
    if (itemId) return { itemId };
    const id = await plaid.exchange(r.publicToken);
    return { itemId: id, name: r.institution || 'Bank' };
  });
  handle('plaid:sync', (itemId, cursor) => plaid.sync(String(itemId), cursor ? String(cursor) : ''));
  handle('plaid:remove', (itemId) => plaid.removeItem(String(itemId)));

  handle('ai:status', () => ai.status());
  handle('ai:saveKey', (k) => ai.saveKey(k));
  handle('ai:clearKey', () => ai.clearKey());
  handle('ai:analyze', (payload) => ai.analyze(payload));
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1240, height: 860, minWidth: 420, minHeight: 600, title: 'Tally Money', backgroundColor: '#eceff5',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  mainWin.on('closed', () => { mainWin = null; });

  // The app never needs to leave its own page. Send any link to the default browser.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  store = createSecretStore({ file: path.join(app.getPath('userData'), 'secrets.bin'), safeStorage });
  plaid = createPlaid({ store });
  ai = createAI({ store });
  wireIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Test hooks (used by test/link-window.smoke.js).
module.exports = { _test: { wireIpc, runLink, setup(p, html) { plaid = p; if (html) LINK_HTML = html; } } };
