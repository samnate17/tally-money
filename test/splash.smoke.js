// Run with: xvfb-run -a npx electron --no-sandbox test/splash.smoke.js
// Checks the splash window shows first, the main window is hidden until the splash minimum has passed,
// and the splash closes once the main window is revealed.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.setPath('userData', '/tmp/tally-splash-' + process.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL().split('/').pop(), visible: w.isVisible(), opacity: w.getOpacity() }));
app.whenReady().then(async () => {
  require('../main.js');
  await sleep(900);
  const early = state();
  const sp = BrowserWindow.getAllWindows().find((w) => /splash\.html$/.test(w.webContents.getURL()));
  if (sp && process.env.SPLASH_SHOT) fs.writeFileSync(process.env.SPLASH_SHOT, (await sp.webContents.capturePage()).toPNG());
  const size = sp ? sp.getSize() : null;
  await sleep(2400);
  const late = state();
  console.log('SPLASH early', JSON.stringify(early));
  console.log('SPLASH size', JSON.stringify(size));
  console.log('SPLASH late', JSON.stringify(late));
  const ok = early.some((w) => w.url === 'splash.html' && w.visible) && early.some((w) => w.url === 'index.html' && !w.visible)
    && late.length === 1 && late[0].url === 'index.html' && late[0].visible;
  console.log(ok ? 'SPLASH OK' : 'SPLASH FAIL');
  app.exit(ok ? 0 : 1);
});
