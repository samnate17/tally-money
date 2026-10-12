// Run with: xvfb-run -a npx electron --no-sandbox test/pdf-ipc.smoke.js
// Sends real fixture PDFs through the real preload bridge and IPC handler.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
process.env.TALLY_NO_SPLASH = '1';
app.setPath('userData', '/tmp/tally-pdf-' + process.pid);
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
app.whenReady().then(async () => {
  require('../main.js');
  await new Promise((r) => setTimeout(r, 2000));
  const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
  const out = await w.webContents.executeJavaScript(`(async () => {
    const buf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
    const r = {};
    const a = await window.tally.pdf.parse(buf('${fx('checking-balance.pdf')}'), null);
    r.balance = a.ok ? { rows: a.data.rows.length, first: a.data.rows[0], type: a.data.meta.type, textId: !!a.data.textId, chars: a.data.chars } : a;
    const c = await window.tally.pdf.parse(buf('${fx('credit-card.pdf')}'), 'credit');
    r.credit = c.ok ? { rows: c.data.rows.length, payment: c.data.rows[2] } : c;
    const s = await window.tally.pdf.parse(buf('${fx('scanned.pdf')}'), null);
    r.scanned = s.ok ? { rows: s.data.rows.length, noText: s.data.meta.noText } : s;
    r.notPdf = await window.tally.pdf.parse(new TextEncoder().encode('hello world').buffer, null);
    r.empty = await window.tally.pdf.parse(new ArrayBuffer(0), null);
    r.aiNoKey = await window.tally.ai.statement(a.data.textId, 'checking');
    r.aiGone = await window.tally.ai.statement('t999', 'checking');
    return JSON.stringify(r, null, 1);
  })()`);
  console.log('PDFIPC', out);
  app.exit(0);
});
