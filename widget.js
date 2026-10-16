// Desktop widget: a small frameless window that shows a few numbers from the app.
// The app window sends a summary after each change; the widget never reads your transactions.
const fs = require('fs');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const str = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

// Keep only plain numbers and short strings in the shape the widget draws. Anything else is dropped.
function sanitize(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { asOf: str(s.asOf, 30), sample: !!s.sample, month: str(s.month, 24), daysLeft: Math.max(0, Math.round(num(s.daysLeft))) };
  o.accent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? String(s.accent).toLowerCase() : '';
  o.net = s.net && typeof s.net === 'object' ? { net: num(s.net.net), assets: num(s.net.assets), debts: num(s.net.debts) } : null;
  const m = s.spend && typeof s.spend === 'object' ? s.spend : {};
  o.spend = { income: num(m.income), spent: num(m.spent), budgeted: num(m.budgeted), budgetSpent: num(m.budgetSpent), left: num(m.left), perDay: num(m.perDay) };
  o.over = (Array.isArray(s.over) ? s.over : []).slice(0, 3).map((x) => ({ cat: str(x && x.cat, 24), spent: num(x && x.spent), budget: num(x && x.budget) }));
  o.bills = (Array.isArray(s.bills) ? s.bills : []).slice(0, 4).map((x) => ({ name: str(x && x.name, 28), amount: num(x && x.amount), days: Math.round(num(x && x.days)) }));
  const iv = s.invest && typeof s.invest === 'object' ? s.invest : null;
  o.invest = iv ? { value: num(iv.value), dayChg: num(iv.dayChg), dayPct: iv.dayPct == null ? null : num(iv.dayPct), gain: num(iv.gain), gainPct: iv.gainPct == null ? null : num(iv.gainPct), count: Math.max(0, Math.round(num(iv.count))),
    top: (Array.isArray(iv.top) ? iv.top : []).slice(0, 3).map((x) => ({ sym: str(x && x.sym, 12), pct: num(x && x.pct) })) } : null;
  o.pay = s.pay && typeof s.pay === 'object' ? { date: str(s.pay.date, 12), days: Math.round(num(s.pay.days)), net: num(s.pay.net), job: str(s.pay.job, 28) } : null;
  o.subs = s.subs && typeof s.subs === 'object' ? { monthly: num(s.subs.monthly), count: Math.max(0, Math.round(num(s.subs.count))) } : null;
  o.debt = s.debt && typeof s.debt === 'object' ? { total: num(s.debt.total), monthly: num(s.debt.monthly) } : null;
  o.credit = s.credit && typeof s.credit === 'object' ? { score: Math.round(num(s.credit.score)), diff: s.credit.diff == null ? null : Math.round(num(s.credit.diff)), date: str(s.credit.date, 12) } : null;
  o.goal = s.goal && typeof s.goal === 'object' ? { name: str(s.goal.name, 28), pct: Math.min(100, Math.max(0, Math.round(num(s.goal.pct)))) } : null;
  return o;
}

// requireAuth: showing blurred amounts asks for Touch ID (only on a Mac that has it; elsewhere there is nothing to ask, so it never gets in the way).
// What the widget can show, in the order they are offered. The owner picks which ones and in what order.
const SECTIONS = [
  ['networth', 'Net worth', 'What you own minus what you owe'],
  ['invest', 'Investments', 'Value of your stocks, today\'s change and the biggest movers'],
  ['budgets', 'Budgets', 'How much of this month\'s budgets you have used, and what is over'],
  ['bills', 'Due soon', 'Bills and subscriptions due in the next 7 days'],
  ['paycheck', 'Next paycheck', 'The date and amount of your next paycheck'],
  ['spending', 'This month', 'Income, spending and what is left'],
  ['goal', 'Goal', 'Your closest savings goal'],
  ['debts', 'Debts', 'What you owe and your monthly payments'],
  ['subs', 'Subscriptions', 'Monthly cost of your subscriptions'],
  ['credit', 'Credit score', 'Your latest score and the change'],
];
const DEFAULT_SECTIONS = ['networth', 'invest', 'budgets', 'bills', 'goal'];
// Keep only known sections, once each, in the order given. An empty or invalid list falls back to the defaults.
function cleanSections(v) {
  const ok = new Set(SECTIONS.map((x) => x[0])), seen = new Set(), out = [];
  (Array.isArray(v) ? v : []).forEach((id) => { if (typeof id === 'string' && ok.has(id) && !seen.has(id)) { seen.add(id); out.push(id); } });
  return out.length ? out : DEFAULT_SECTIONS.slice();
}
const DEFAULTS = { visible: false, onTop: false, hideAmounts: false, requireAuth: true, sections: DEFAULT_SECTIONS, w: null, h: null, x: null, y: null };

function createWidget({ BrowserWindow, screen, file, preload, html, nativeFile, canAuth = () => false }) {
  let win = null, state = { ...DEFAULTS }, summary = null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { ...DEFAULTS, ...(j.state || {}) };
    state.sections = cleanSections(state.sections);
    summary = sanitize(j.summary);
  } catch (e) { /* first run */ }

  // The macOS desktop widget (a separate sandboxed extension) reads this file. Written even when the floating widget is closed.
  function writeNative() {
    if (!nativeFile || !summary) return;
    try {
      fs.mkdirSync(require('path').dirname(nativeFile), { recursive: true });
      const tmp = nativeFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ...summary, sections: state.sections, hideAmounts: state.hideAmounts, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      fs.renameSync(tmp, nativeFile);
    } catch (e) { /* non-fatal */ }
  }
  function persist() {
    try { fs.writeFileSync(file, JSON.stringify({ state, summary })); } catch (e) { /* non-fatal */ }
  }
  const alive = () => win && !win.isDestroyed();
  const touchId = () => { try { return !!canAuth(); } catch (e) { return false; } };
  function payload() { return { summary, hideAmounts: state.hideAmounts, onTop: state.onTop, askAuth: !!(state.requireAuth && touchId()), sections: state.sections }; }
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
      width: Math.min(700, Math.max(260, Math.round(state.w) || 310)), height: Math.min(1200, Math.max(200, Math.round(state.h) || 372)), minWidth: 260, minHeight: 200, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: true, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: true, show: false, title: 'Tally widget', focusable: true,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(html);
    win.once('ready-to-show', () => { applyLevel(); win.showInactive(); send(); });
    win.webContents.on('did-finish-load', send);
    win.on('moved', () => { const b = win.getBounds(); state.x = b.x; state.y = b.y; persist(); });
    win.on('resized', () => { const b = win.getBounds(); state.w = b.width; state.h = b.height; persist(); });
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
    // Forget the numbers (when another user takes over the app, so the last user's totals do not stay on the desktop).
    clear() { summary = null; persist(); try { if (nativeFile) fs.unlinkSync(nativeFile); } catch (e) { /* none yet */ } send(); },
    setSections(v) { state.sections = cleanSections(v); persist(); writeNative(); send(); },
    setRequireAuth(v) { state.requireAuth = !!v; persist(); send(); },
    // True when the change would reveal amounts (or remove the lock) and Touch ID must be checked first.
    needsAuth(what, value) {
      if (!(state.requireAuth && touchId())) return false;
      if (what === 'hideAmounts') return !value && state.hideAmounts;
      if (what === 'requireAuth') return !value;
      return false;
    },
    status() { return { visible: !!(state.visible && alive()), onTop: state.onTop, hideAmounts: state.hideAmounts, requireAuth: !!state.requireAuth, touchId: touchId(), sections: state.sections }; },
    wantsOpen() { return !!state.visible; },
    isWidgetContents(wc) { return alive() && wc === win.webContents; },
    get() { return payload(); },
    _win() { return win; },
  };
}

module.exports = { createWidget, sanitize, cleanSections, SECTIONS, DEFAULT_SECTIONS };
