// Run with: xvfb-run -a node_modules/.bin/electron --no-sandbox test/widget.smoke.js
// Starts the real app, turns the widget on through the preload bridge and reads what the widget window shows.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.setPath('userData', '/tmp/tally-widget-' + process.pid);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  require('../main.js');
  await wait(1800);
  const main = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
  const find = () => BrowserWindow.getAllWindows().find((x) => /widget\.html/.test(x.webContents.getURL()));
  const out = {};
  out.before = await main.webContents.executeJavaScript('window.tally.widget.status()');
  out.show = await main.webContents.executeJavaScript('window.tally.widget.set("visible", true)');
  await wait(1500);
  const w = find();
  out.widgetOpen = !!w;
  // The real path: the app's own save() sends the summary. Example data first, then Start fresh.
  await wait(900);
  out.sampleTitle = (await w.webContents.executeJavaScript('document.getElementById("ttl").textContent'));
  await main.webContents.executeJavaScript('document.querySelector("[data-act=clear]").click()'); await wait(1200);
  out.freshTitle = (await w.webContents.executeJavaScript('document.getElementById("ttl").textContent'));
  out.push2 = await main.webContents.executeJavaScript('window.tally.widget.push({asOf:"2026-10-12",month:"October 2026",daysLeft:20,sample:false,net:{net:5000,assets:7000,debts:2000},spend:{income:2400,spent:900,budgeted:1000,budgetSpent:900,left:100,perDay:5},over:[{cat:"Dining",spent:160,budget:100}],bills:[{name:"Netflix",amount:15,days:2}],goal:{name:"Trip",pct:25}})');
  await wait(600);
  out.text = (await w.webContents.executeJavaScript('document.body.innerText')).replace(/\s+/g, ' ');
  out.bounds = w.getBounds();
  out.frameless = !w.isResizable();
  // blur + on top via the widget's own buttons
  await w.webContents.executeJavaScript('document.getElementById("eye").click()'); await wait(400);
  out.blurClass = await w.webContents.executeJavaScript('document.getElementById("card").className');
  out.status = await main.webContents.executeJavaScript('window.tally.widget.status()');
  // a bogus sender cannot push: the widget window has no tally bridge, and the main-only channels reject it
  out.widgetCannotPush = await w.webContents.executeJavaScript('typeof window.tally');
  const img = await w.webContents.capturePage(); fs.writeFileSync('/tmp/widget.png', img.toPNG());
  // persistence: close, state saved
  await w.webContents.executeJavaScript('document.getElementById("x").click()'); await wait(500);
  out.closed = !find();
  const saved = JSON.parse(fs.readFileSync(app.getPath('userData') + '/widget.json', 'utf8'));
  out.saved = { visible: saved.state.visible, hide: saved.state.hideAmounts, hasSummary: !!saved.summary };
  console.log('WIDGET', JSON.stringify(out, null, 1));
  app.exit(0);
});
