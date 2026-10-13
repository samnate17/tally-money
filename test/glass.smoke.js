// Run on a Mac: node_modules/.bin/electron test/glass.smoke.js <path-to-glass.node>
// Loads the addon in Electron, adds glass to a transparent window and lists the content view's subviews.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('GLASS {"ok":false,"error":"timed out"}'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const out = { os: process.getSystemVersion(), arch: process.arch };
  try {
    const mod = { exports: {} };
    process.dlopen(mod, process.argv[2] || process.env.GLASS_NODE);
    const addon = mod.exports;
    out.loaded = Object.keys(addon).sort();
    out.supported = addon.isSupported();
    const win = new BrowserWindow({ width: 600, height: 400, show: true, transparent: true, backgroundColor: '#00000000', titleBarStyle: 'hiddenInset' });
    win.loadURL('data:text/html,<body style="background:transparent;font:20px system-ui">glass test</body>');
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    out.before = addon.describe(win.getNativeWindowHandle());
    out.id = addon.addGlass(win.getNativeWindowHandle(), { cornerRadius: 0, style: 'regular', tint: '#ffffff10' });
    await wait(500);
    out.after = addon.describe(win.getNativeWindowHandle());
    out.removed = addon.removeGlass(out.id);
    out.afterRemove = addon.describe(win.getNativeWindowHandle());
    out.ok = out.supported ? (out.id >= 0 && out.after.length === out.before.length + 1 && out.afterRemove.length === out.before.length) : out.id === -1;
  } catch (e) { out.error = String(e && e.stack || e); out.ok = false; }
  console.log('GLASS', JSON.stringify(out));
  app.exit(out.ok ? 0 : 1);
});
