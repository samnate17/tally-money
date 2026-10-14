const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, screen, nativeTheme, systemPreferences, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { createSecretStore } = require('./secrets');
const { createPlaid } = require('./plaid');
const { createAI } = require('./ai');
const { parsePdf, maskText } = require('./statement');
const { createMarket, SYMBOL } = require('./market');
const { createFundamentals } = require('./fundamentals');
const { createWidget } = require('./widget');
const glassLib = require('./glass');
const { createUpdater } = require('./updater');
const { createBiometric } = require('./biometric');
const { createLocalAI } = require('./local-ai');
const { parseLoanText, parseMortgageText } = require('./loanparse');
const aiMod = require('./ai');
const { spawn } = require('child_process');

let localAi = null;
let store, plaid, ai, market, fundamentals, widget, updater, mainWin = null, linkState = null;
let glassAddon = null, glassState = { available: false, active: false, reason: '' }, glassId = -1, glassPrefsFile = '';
const statementText = new Map();
const statementBytes = new Map(); // PDFs with no text layer, kept briefly so they can be sent to Claude if the user chooses
let textSeq = 0;

let LINK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Link a bank</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;margin:24px;color:#141b34"><p id="m">Opening the secure bank connection…</p>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" onerror="linkBridge.exit('Could not load Plaid Link. Check your internet connection.')"></script>
<script>
linkBridge.getToken().then(function (token) {
  var h = Plaid.create({
    token: token,
    onSuccess: function (pt, meta) { linkBridge.success(pt, meta); },
    onExit: function (err, meta) {
      if (!err) { linkBridge.exit(''); return; }
      var m = err.display_message || err.error_message || 'The bank connection failed.', d = [];
      if (err.error_code) d.push('code ' + err.error_code);
      if (meta && meta.request_id) d.push('request ' + meta.request_id);
      if (meta && meta.institution && meta.institution.name) d.push(meta.institution.name);
      linkBridge.exit(m + (d.length ? ' (Plaid ' + d.join(', ') + ')' : ''));
    }
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

async function runLink(itemId, mode) {
  if (linkState) throw new Error('A bank connection window is already open.');
  const token = await plaid.createLinkToken(itemId, mode);
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

  // Desktop widget. The app window pushes a small summary; the widget window can only ask for it and send a few named actions.
  const fromMain = (e) => mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents;
  ipcMain.handle('widget:push', (e, summary) => ({ ok: !!(fromMain(e) && widget && widget.update(summary)) }));
  ipcMain.handle('widget:status', (e) => (fromMain(e) && widget ? { ok: true, data: { ...widget.status(), native: nativeWidgetBundled() } } : { ok: false }));
  ipcMain.handle('widget:set', (e, what, value) => {
    if (!fromMain(e) || !widget) return { ok: false };
    if (what === 'visible') { value ? widget.show() : widget.hide(); }
    else if (what === 'onTop') widget.setOnTop(!!value);
    else if (what === 'hideAmounts') widget.setHideAmounts(!!value);
    else return { ok: false };
    buildMenu();
    return { ok: true, data: { ...widget.status(), native: nativeWidgetBundled() } };
  });
  ipcMain.handle('widget:get', (e) => (widget && widget.isWidgetContents(e.sender) ? widget.get() : null));
  ipcMain.handle('widget:action', (e, name) => {
    if (!widget || !widget.isWidgetContents(e.sender)) return false;
    if (name === 'toggle-hide') widget.setHideAmounts(!widget.get().hideAmounts);
    else if (name === 'toggle-top') widget.setOnTop(!widget.get().onTop);
    else if (name === 'close') { widget.hide(); buildMenu(); }
    else if (name === 'open') showMain();
    else return false;
    return true;
  });

  // Native Liquid Glass preference and the app's light/dark choice (so the glass matches the in-app mode).
  const fromMain2 = (e) => mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents;
  ipcMain.handle('glass:status', (e) => (fromMain2(e) ? { ok: true, data: { ...glassState, pref: glassLib.readPrefs(glassPrefsFile).native } } : { ok: false }));
  ipcMain.handle('glass:set', (e, on) => {
    if (!fromMain2(e)) return { ok: false };
    glassLib.writePrefs(glassPrefsFile, { native: !!on });
    setTimeout(() => { app.relaunch(); app.exit(0); }, 150);     // the window type is fixed at creation, so restart to switch
    return { ok: true };
  });
  ipcMain.handle('theme:mode', (e, mode) => {
    if (!fromMain2(e)) return { ok: false };
    nativeTheme.themeSource = mode === 'light' || mode === 'dark' ? mode : 'system';
    return { ok: true };
  });

  // App updates (see updater.js). Only the main window may call these.
  const mainOnly = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    if (!mainWin || mainWin.isDestroyed() || e.sender !== mainWin.webContents || !updater) return { ok: false, error: 'Blocked.' };
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: (err && err.message) || 'Something went wrong.' }; }
  });
  // Private assistant on this Mac, through Ollama on localhost (see local-ai.js).
  mainOnly('localai:status', () => localAi.status());
  mainOnly('localai:chat', (r) => {
    const id = String((r && r.id) || '');
    return localAi.chat({ id, model: r && r.model, messages: r && r.messages, onToken: (text) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('localai:token', { id, text }); } });
  });
  mainOnly('localai:pull', (r) => {
    const id = String((r && r.id) || '');
    return localAi.pull({ id, model: r && r.model, onProgress: (p) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('localai:progress', { id, ...p }); } });
  });
  mainOnly('localai:cancel', (id) => localAi.cancel(String(id)));
  // Save dialog for backup and transfer files (works the same on Mac and Windows).
  mainOnly('file:save', async (r) => {
    const name = String((r && r.name) || 'tally-backup.json').replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'tally-backup.json';
    const text = String((r && r.text) || '');
    if (!text || text.length > 200 * 1024 * 1024) throw new Error('Nothing to save.');
    let dir; try { dir = app.getPath('documents'); } catch (e) { dir = app.getPath('home'); }
    const res = await dialog.showSaveDialog(mainWin, { title: 'Save file', defaultPath: path.join(dir, name), filters: [{ name: 'Tally Money file', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { cancelled: true };
    require('fs').writeFileSync(res.filePath, text, { mode: 0o600 });
    return { path: res.filePath };
  });
  // Touch ID unlock for the app password (see biometric.js).
  mainOnly('bio:status', () => createBiometric({ store, systemPreferences }).status());
  mainOnly('bio:enable', (pw) => createBiometric({ store, systemPreferences }).enable(pw));
  mainOnly('bio:unlock', () => createBiometric({ store, systemPreferences }).unlock());
  mainOnly('bio:disable', () => createBiometric({ store, systemPreferences }).disable());
  mainOnly('update:status', () => updater.status());
  mainOnly('update:setToken', (t) => updater.setToken(t));
  mainOnly('update:clearToken', () => updater.clearToken());
  mainOnly('update:check', (opt) => updater.check(opt || {}));
  mainOnly('update:install', async () => {
    const send = (p) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update:progress', p); };
    send({ phase: 'download', received: 0, total: 0 });
    await updater.download((p) => send({ phase: 'download', ...p }));
    send({ phase: 'install' });
    updater.install();                  // quits the app; a script swaps the new version in and reopens it
    return true;
  });

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
  handle('plaid:linkLoan', async () => {
    const r = await runLink(null, 'loan');
    if (r.cancelled) return { cancelled: true };
    if (r.error) throw new Error(r.error);
    const id = await plaid.exchange(r.publicToken);
    return { itemId: id, name: r.institution || 'Loan servicer' };
  });
  handle('plaid:loans', (itemId) => plaid.loans(String(itemId)));
  handle('plaid:sync', (itemId, cursor) => plaid.sync(String(itemId), cursor ? String(cursor) : ''));
  handle('plaid:remove', (itemId) => plaid.removeItem(String(itemId)));

  handle('ai:status', () => ai.status());
  handle('ai:saveKey', (k) => ai.saveKey(k));
  handle('ai:clearKey', () => ai.clearKey());
  handle('ai:analyze', (payload) => ai.analyze(payload));

  // PDF statements: parsed locally; the masked text is kept in memory so the AI fallback can reuse it without resending the file.
  handle('pdf:parse', async (bytes, type) => {
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error('Choose a PDF under 25 MB.');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('That file is not a PDF.');
    let r;
    try { r = await parsePdf(buf, { type: type === 'credit' || type === 'checking' ? type : undefined }); }
    catch (e) {
      const why = String((e && (e.message || e.name)) || 'unknown error').replace(/\s+/g, ' ').slice(0, 160);
      console.error('[pdf:parse]', e);
      throw new Error(/password/i.test(why) ? 'This PDF is password protected. Open it in Preview, export a copy without the password, and try again.' : 'Could not read this PDF (' + why + ').');
    }
    const masked = maskText(r.text || '');
    const textId = 't' + (++textSeq);
    statementText.set(textId, masked);
    if (r.meta.noText && buf.length <= 20 * 1024 * 1024) statementBytes.set(textId, buf);
    while (statementText.size > 12) statementText.delete(statementText.keys().next().value);
    while (statementBytes.size > 3) statementBytes.delete(statementBytes.keys().next().value);
    return {
      rows: r.rows,
      meta: { type: r.meta.type, mode: r.meta.mode, pages: r.meta.pages, noText: !!r.meta.noText, rows: r.rows.length, endBalance: Number.isFinite(r.meta.endBalance) ? r.meta.endBalance : undefined },
      textId, chars: masked.length, bytes: buf.length,
      preview: (r.lines || []).slice(0, 120).map((l) => maskText(l)),
    };
  });
  handle('quotes:details', (symbol) => {
    const s = String(symbol || '').trim().toUpperCase();
    if (!SYMBOL.test(s)) throw new Error('not a valid ticker symbol');
    return fundamentals.details(s);
  });
  handle('quotes:get', (symbols) => {
    if (!Array.isArray(symbols) || symbols.length > 40) throw new Error('Too many symbols.');
    const list = symbols.map((s) => String(s).trim()).filter((s) => SYMBOL.test(s));
    return market.quotes(list);
  });
  handle('ai:test', () => ai.testKey());
  handle('ai:categorize', (p) => ai.categorize(p));
  // A servicer statement for the loan tabs: a PDF (read locally, then masked) or a plain text/CSV file. The text stays in memory until the AI call.
  handle('loan:text', async (bytes, name) => {
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error('Choose a file under 25 MB.');
    let text;
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      try { text = (await parsePdf(buf, {})).text || ''; }
      catch (e) { throw new Error(/password/i.test(String(e && e.message)) ? 'This PDF is password protected. Export a copy without the password and try again.' : 'Could not read this PDF.'); }
      if (!text.trim()) throw new Error('This PDF has no text I can read (it may be a scan). Try the text download from the servicer, or type the loan in by hand.');
    } else {
      text = buf.toString('utf8');
      if (/\u0000/.test(text.slice(0, 2000))) throw new Error('That does not look like a text file or PDF.');
    }
    const masked = maskText(text).slice(0, 200000);
    const textId = 'l' + (++textSeq);
    statementText.set(textId, masked);
    while (statementText.size > 12) statementText.delete(statementText.keys().next().value);
    return { textId, chars: masked.length, name: String(name || '').slice(0, 80) };
  });
  // Reading a loan statement without a paid key: by matching labels (always), or with a model running on this computer.
  const loanKind = (k) => (['student', 'auto', 'credit', 'loan'].includes(k) ? k : 'auto');
  handle('loan:parse', (textId, kind) => {
    const text = statementText.get(String(textId));
    if (!text) throw new Error('That file is no longer in memory. Choose it again.');
    if (kind === 'mortgage') return parseMortgageText(text);
    return parseLoanText(text, loanKind(kind));
  });
  ipcMain.handle('localai:loans', async (e, r) => {
    if (!mainWin || mainWin.isDestroyed() || e.sender !== mainWin.webContents || !localAi) return { ok: false, error: 'Blocked.' };
    try {
      const text = statementText.get(String(r && r.textId));
      if (!text) throw new Error('That file is no longer in memory. Choose it again.');
      const kind = loanKind(r.kind);
      const out = await localAi.chat({ id: 'loans' + Date.now(), model: r.model, messages: [{ role: 'system', content: aiMod.LOANS_LOCAL_SYSTEM }, { role: 'user', content: 'Kind of loan: ' + kind + '\n\n' + text.slice(0, 14000) }] });
      return { ok: true, data: aiMod.parseLocalLoans(out.text) };
    } catch (err) { return { ok: false, error: (err && err.message) || 'Something went wrong.' }; }
  });
  handle('ai:loans', (textId, kind) => {
    const text = statementText.get(String(textId));
    if (!text) throw new Error('That file is no longer in memory. Choose it again.');
    return ai.loansFromText(text, loanKind(kind) === 'student' ? 'student' : loanKind(kind) === 'auto' ? 'auto' : loanKind(kind));
  });
  handle('ai:carArt', (r) => ai.carArt(r));
  handle('ai:statementPdf', (textId, type) => {
    const buf = statementBytes.get(String(textId));
    if (!buf) throw new Error('That statement is no longer in memory. Choose the file again.');
    return ai.statementPdf(buf, type);
  });
  handle('ai:statement', (textId, type) => {
    const text = statementText.get(String(textId));
    if (!text) throw new Error('That statement is no longer in memory. Choose the file again.');
    return ai.statement(text, type);
  });
}

function createWindow(quiet) {
  const glass = glassState.active;
  mainWin = new BrowserWindow({
    show: !quiet,
    width: 1240, height: 860, minWidth: 420, minHeight: 600, title: 'Tally Money',
    // With native glass the window must be transparent from the start and the title bar hidden so the glass reaches the top edge.
    ...(glass ? { transparent: true, backgroundColor: '#00000000', vibrancy: undefined, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 18 } } : { backgroundColor: '#eceff5' }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: glass ? ['--tally-glass=1'] : [] },
  });
  if (glass) {
    mainWin.webContents.once('did-finish-load', () => {
      try { glassId = glassLib.applyGlass(glassAddon, mainWin, { cornerRadius: 0, style: 'regular' }); } catch (e) { glassId = -1; }
      if (glassId < 0) mainWin.webContents.executeJavaScript("document.documentElement.removeAttribute('data-native')").catch(() => {});
    });
  }
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

// True when this build has the macOS desktop widget embedded (see scripts/after-pack.js).
function nativeWidgetBundled() {
  try { return process.platform === 'darwin' && require('fs').existsSync(path.join(path.dirname(app.getPath('exe')), '..', 'PlugIns', 'TallyWidget.appex')); } catch (e) { return false; }
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function buildMenu() {
  const st = widget ? widget.status() : { visible: false, onTop: false };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ role: 'fileMenu' }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Widget',
      submenu: [
        { label: 'Show desktop widget', type: 'checkbox', checked: st.visible, click: (i) => { i.checked ? widget.show() : widget.hide(); buildMenu(); } },
        { label: 'Keep widget on top of other windows', type: 'checkbox', checked: st.onTop, click: (i) => { widget.setOnTop(i.checked); buildMenu(); } },
        { type: 'separator' },
        { label: 'Open Tally when I log in', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      ],
    },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => { showMain(); if (mainWin) mainWin.webContents.send('nav', 'update'); } }] },
  ]));
}

app.whenReady().then(() => {
  store = createSecretStore({ file: path.join(app.getPath('userData'), 'secrets.bin'), safeStorage });
  localAi = createLocalAI();
  plaid = createPlaid({ store });
  ai = createAI({ store });
  market = createMarket();
  fundamentals = createFundamentals();
  glassPrefsFile = path.join(app.getPath('userData'), 'appearance.json');
  glassAddon = glassLib.loadAddon({ resourcesPath: process.resourcesPath, devDir: path.join(__dirname, 'native-glass') });
  glassState = glassLib.decide({ platform: process.platform, osVersion: process.getSystemVersion && process.getSystemVersion(), prefs: glassLib.readPrefs(glassPrefsFile), addon: glassAddon });
  updater = createUpdater({
    store, version: app.getVersion(), arch: process.arch, platform: process.platform,
    appPath: app.isPackaged && process.platform === 'darwin' ? path.resolve(app.getPath('exe'), '../../..') : '',
    tmpDir: path.join(app.getPath('temp'), 'tally-money-update'), resultFile: path.join(app.getPath('userData'), 'update-result.json'),
    spawnImpl: spawn, quit: () => app.quit(),
  });
  wireIpc();
  widget = createWidget({ BrowserWindow, screen, file: path.join(app.getPath('userData'), 'widget.json'), preload: path.join(__dirname, 'widget-preload.js'), html: path.join(__dirname, 'widget.html'), nativeFile: path.join(app.getPath('userData'), 'native-widget.json') });
  buildMenu();
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (e) { /* dev-only nicety */ }
  }
  const atLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin && widget.wantsOpen();
  createWindow(atLogin);
  if (widget.wantsOpen()) widget.show();
  app.on('activate', () => showMain());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Test hooks (used by test/link-window.smoke.js).
module.exports = { _test: { wireIpc, runLink, setup(p, html) { plaid = p; if (html) LINK_HTML = html; } } };
