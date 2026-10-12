// Desktop widget: a small frameless window that shows a few numbers from the app.
// The app window sends a summary after each change; the widget never reads your transactions.
const fs = require('fs');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const str = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

// Keep only plain numbers and short strings in the shape the widget draws. Anything else is dropped.
function sanitize(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { asOf: str(s.asOf, 30), sample: !!s.sample, month: str(s.month, 24), daysLeft: Math.max(0, Math.round(num(s.daysLeft))) };
  o.net = s.net && typeof s.net === 'object' ? { net: num(s.net.net), assets: num(s.net.assets), debts: num(s.net.debts) } : null;
  const m = s.spend && typeof s.spend === 'object' ? s.spend : {};
  o.spend = { income: num(m.income), spent: num(m.spent), budgeted: num(m.budgeted), budgetSpent: num(m.budgetSpent), left: num(m.left), perDay: num(m.perDay) };
  o.over = (Array.isArray(s.over) ? s.over : []).slice(0, 3).map((x) => ({ cat: str(x && x.cat, 24), spent: num(x && x.spent), budget: num(x && x.budget) }));
  o.bills = (Array.isArray(s.bills) ? s.bills : []).slice(0, 4).map((x) => ({ name: str(x && x.name, 28), amount: num(x && x.amount), days: Math.round(num(x && x.days)) }));
  o.goal = s.goal && typeof s.goal === 'object' ? { name: str(s.goal.name, 28), pct: Math.min(100, Math.max(0, Math.round(num(s.goal.pct)))) } : null;
  return o;
}

const DEFAULTS = { visible: false, onTop: false, hideAmounts: false, x: null, y: null };

function createWidget({ BrowserWindow, screen, file, preload, html, nativeFile }) {
  let win = null, state = { ...DEFAULTS }, summary = null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { ...DEFAULTS, ...(j.state || {}) };
    summary = sanitize(j.summary);
  } catch (e) { /* first run */ }

  // The macOS desktop widget (a separate sandboxed extension) reads this file. Written even when the floating widget is closed.
  function writeNative() {
    if (!nativeFile || !summary) return;
    try {
      fs.mkdirSync(require('path').dirname(nativeFile), { recursive: true });
      const tmp = nativeFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ...summary, hideAmounts: state.hideAmounts, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      fs.renameSync(tmp, nativeFile);
    } catch (e) { /* non-fatal */ }
  }
  function persist() {
    try { fs.writeFileSync(file, JSON.stringify({ state, summary })); } catch (e) { /* non-fatal */ }
  }
  const alive = () => win && !win.isDestroyed();
  function payload() { return { summary, hideAmounts: state.hideAmounts, onTop: state.onTop }; }
  function send() { if (alive()) win.webContents.send('widget:data', payload()); }
  function applyLevel() {
    if (!alive()) return;
    win.setAlwaysOnTop(!!state.onTop, 'floating');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); } catch (e) { /* not on every platform */ }
  }
  function fit(x, y) {
    const d = screen.getDisplayNearestPoint({ x, y }).workArea;
    return { x: Math.min(Math.max(x, d.x), d.x + d.width - 120), y: Math.min(Math.max(y, d.y), d.y + d.height - 80) };
  }
  function open() {
    if (alive()) { win.showInactive(); return; }
    const wa = screen.getPrimaryDisplay().workArea;
    const pos = state.x == null ? { x: wa.x + wa.width - 340, y: wa.y + 48 } : fit(state.x, state.y);
    win = new BrowserWindow({
      width: 310, height: 372, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: true, show: false, title: 'Tally widget', focusable: true,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(html);
    win.once('ready-to-show', () => { applyLevel(); win.showInactive(); send(); });
    win.webContents.on('did-finish-load', send);
    win.on('moved', () => { const b = win.getBounds(); state.x = b.x; state.y = b.y; persist(); });
    win.on('closed', () => { win = null; });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
  }
  return {
    show() { state.visible = true; persist(); open(); },
    hide() { state.visible = false; persist(); if (alive()) win.close(); },
    toggle() { return state.visible && alive() ? (this.hide(), false) : (this.show(), true); },
    update(raw) { const s = sanitize(raw); if (!s) return false; summary = s; persist(); writeNative(); send(); return true; },
    setOnTop(v) { state.onTop = !!v; persist(); applyLevel(); send(); },
    setHideAmounts(v) { state.hideAmounts = !!v; persist(); writeNative(); send(); },
    status() { return { visible: !!(state.visible && alive()), onTop: state.onTop, hideAmounts: state.hideAmounts }; },
    wantsOpen() { return !!state.visible; },
    isWidgetContents(wc) { return alive() && wc === win.webContents; },
    get() { return payload(); },
    _win() { return win; },
  };
}

module.exports = { createWidget, sanitize };
