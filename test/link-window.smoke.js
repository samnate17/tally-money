// Run with: xvfb-run -a npx electron --no-sandbox test/link-window.smoke.js
// Exercises the bank-link window (local server, sandboxed preload, IPC) with a fake Plaid page.
const { app } = require('electron');
app.setPath('userData', '/tmp/tally-link-' + process.pid);
const FAKE = (mode) => `<!doctype html><meta charset="utf-8"><body><script>
window.Plaid = { create: function (o) { return { open: function () { setTimeout(function () {
  ${mode === 'success' ? "o.onSuccess('public-sandbox-xyz', { institution: { name: 'Fake Bank' } });" : mode === 'exit-error' ? "o.onExit({ display_message: 'Bank is down' }, {});" : "o.onExit(null, {});"}
}, 100); } }; } };
linkBridge.getToken().then(function (token) { var h = Plaid.create({ token: token, onSuccess: function (pt, m) { linkBridge.success(pt, m); }, onExit: function (e, m) { linkBridge.exit(e ? (e.display_message || e.error_message || '') : ''); } }); h.open(); });
</script>`;
app.whenReady().then(async () => {
  const { _test } = require('../main.js');
  _test.wireIpc();
  let tokenSeen = null;
  const stub = { createLinkToken: async (id) => { tokenSeen = id || 'new'; return 'link-sandbox-tok'; } };
  const results = [];
  for (const mode of ['success', 'exit-error', 'exit-cancel']) {
    _test.setup(stub, FAKE(mode));
    results.push([mode, JSON.stringify(await _test.runLink(null))]);
  }
  _test.setup(stub, FAKE('success'));
  results.push(['update-mode', JSON.stringify(await _test.runLink('item1')), 'token request for ' + tokenSeen]);
  results.forEach((r) => console.log('LINK', r.join(' | ')));
  app.exit(0);
});
