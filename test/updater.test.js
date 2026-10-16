const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const U = require('../updater');

const TOKEN = 'github_pat_' + 'A'.repeat(30);
const memStore = (init = {}) => { const o = { ...init }; return { get: (k) => o[k], set: (k, v) => { o[k] = v; }, del: (k) => { delete o[k]; }, _o: o }; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

test('updater: version comparison and asset choice', () => {
  assert.ok(U.isNewer('v1.6.2', '1.6.1')); assert.ok(U.isNewer('1.10.0', '1.9.9')); assert.ok(U.isNewer('2.0.0', '1.99.99'));
  assert.ok(!U.isNewer('1.6.1', '1.6.1')); assert.ok(!U.isNewer('1.6.0', '1.6.1')); assert.ok(!U.isNewer('junk', '1.0.0')); assert.ok(!U.isNewer('1.0.0', undefined));
  const assets = ['Tally.Money-1.6.1-arm64-mac.zip', 'Tally.Money-1.6.1-arm64.dmg', 'Tally.Money-1.6.1-mac.zip', 'Tally.Money-1.6.1.dmg'].map((name, id) => ({ name, id }));
  assert.strictEqual(U.pickAsset(assets, 'arm64').name, 'Tally.Money-1.6.1-arm64.dmg');
  assert.strictEqual(U.pickAsset(assets, 'x64').name, 'Tally.Money-1.6.1.dmg');
  assert.strictEqual(U.pickAsset([], 'arm64'), null); assert.strictEqual(U.pickAsset(undefined, 'x64'), null);
});

test('updater: token format is checked and stored only in the secret store', () => {
  const store = memStore(); const u = U.createUpdater({ store, version: '1.6.1', arch: 'arm64', platform: 'darwin', appPath: '', tmpDir: tmp(), resultFile: path.join(tmp(), 'r.json') });
  assert.throws(() => u.setToken('hello'), /does not look like/); assert.throws(() => u.setToken(''), /does not look like/);
  assert.strictEqual(u.status().hasToken, false);
  u.setToken('  ' + TOKEN + '\n'); assert.strictEqual(store.get('github_token'), TOKEN); assert.strictEqual(u.status().hasToken, true);
  assert.ok(!JSON.stringify(u.status()).includes(TOKEN));
  u.clearToken(); assert.strictEqual(u.status().hasToken, false);
});

test('updater: check reports newer or current, picks the asset, and gives plain errors', async () => {
  const calls = [];
  const rel = { tag_name: 'v1.7.0', html_url: 'https://github.com/x/y/releases/tag/v1.7.0', body: 'Notes', assets: [{ name: 'Tally.Money-1.7.0-arm64.dmg', id: 7, size: 5, digest: 'sha256:' + '0'.repeat(64) }] };
  const mk = (resp) => ({ fetchImpl: async (url, opt) => { calls.push({ url, opt }); return resp(url); } });
  const base = { store: memStore({ github_token: TOKEN }), arch: 'arm64', platform: 'darwin', appPath: '', tmpDir: tmp(), resultFile: path.join(tmp(), 'r.json') };
  let u = U.createUpdater({ ...base, version: '1.6.1', ...mk(() => json(rel)) });
  const r = await u.check();
  assert.deepStrictEqual([r.newer, r.latest, r.current, r.hasAsset, r.assetName], [true, '1.7.0', '1.6.1', true, 'Tally.Money-1.7.0-arm64.dmg']);
  assert.strictEqual(calls[0].opt.headers.Authorization, 'Bearer ' + TOKEN); assert.match(calls[0].url, /\/repos\/samnate17\/tally-money\/releases\/latest$/);
  u = U.createUpdater({ ...base, version: '1.7.0', ...mk(() => json(rel)) });
  assert.strictEqual((await u.check()).newer, false);
  for (const [s, re] of [[401, /rejected the token/], [403, /refused/], [404, /cannot tell whether you are up to date[\s\S]*Only select repositories[\s\S]*Contents[\s\S]*samnate17/], [500, /error \(500\)/]]) {
    u = U.createUpdater({ ...base, version: '1.6.1', ...mk(() => json({}, s)) });
    await assert.rejects(u.check(), re);
  }
  u = U.createUpdater({ ...base, version: '1.6.1', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(u.check(), /Could not reach GitHub/);
  u = U.createUpdater({ ...base, store: memStore(), version: '1.6.1', ...mk(() => json(rel)) });
  await assert.rejects(u.check(), /Add a GitHub token/);
  assert.strictEqual(await u.check({ auto: true }), null);                     // automatic checks are silent without a token
});

function releaseWith(bytes, over = {}) {
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  return { tag_name: 'v1.7.0', assets: [{ name: 'Tally.Money-1.7.0-arm64.dmg', id: 7, size: bytes.length, digest: 'sha256:' + sha, ...over }] };
}
function dlUpdater(bytes, handler, over = {}) {
  const log = [];
  const u = U.createUpdater({ store: memStore({ github_token: TOKEN }), version: '1.6.1', arch: 'arm64', platform: 'darwin', appPath: '', tmpDir: tmp(), resultFile: path.join(tmp(), 'r.json'),
    fetchImpl: async (url, opt) => { log.push({ url, opt }); if (/releases\/latest/.test(url)) return json(releaseWith(bytes, over)); return handler(url, opt); } });
  return { u, log };
}

test('updater: download verifies size and SHA-256, never sends the token to the file host, and refuses odd redirects', async () => {
  const bytes = crypto.randomBytes(200000);
  let { u, log } = dlUpdater(bytes, (url) => (/api\.github\.com/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/abc?sig=1' } }) : new Response(bytes)));
  await u.check();
  const seen = []; const file = await u.download((p) => seen.push(p));
  assert.ok(fs.readFileSync(file).equals(bytes)); assert.ok(seen.length && seen[seen.length - 1].received === bytes.length);
  assert.strictEqual(log[1].opt.headers.Accept, 'application/octet-stream'); assert.strictEqual(log[1].opt.redirect, 'manual');
  assert.ok(!('Authorization' in log[2].opt.headers), 'token must not go to the redirected host');

  ({ u } = dlUpdater(bytes, (url) => (/api\.github\.com/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }) : new Response(bytes))));
  await u.check(); await assert.rejects(u.download(), /unexpected host/);
  ({ u } = dlUpdater(bytes, () => new Response(null, { status: 302, headers: { location: 'http://objects.githubusercontent.com/x' } })));
  await u.check(); await assert.rejects(u.download(), /unexpected host/);

  const tampered = Buffer.from(bytes); tampered[10] ^= 1;
  ({ u } = dlUpdater(bytes, (url) => (/api\.github\.com/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/x' } }) : new Response(tampered))));
  await u.check(); await assert.rejects(u.download(), /did not match/);
  assert.strictEqual(u.downloadedPath(), null);
  ({ u } = dlUpdater(bytes, (url) => (/api\.github\.com/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/x' } }) : new Response(bytes.subarray(0, 1000)))));
  await u.check(); await assert.rejects(u.download(), /did not match/);
  ({ u } = dlUpdater(bytes, () => new Response(bytes), { digest: undefined }));
  await u.check(); await assert.rejects(u.download(), /checksum/);
  await assert.rejects(U.createUpdater({ store: memStore({ github_token: TOKEN }), version: '1', arch: 'arm64', platform: 'darwin', tmpDir: tmp() }).download(), /Check for updates first/);
});

test('updater: install only where it can work, hands the script the right arguments, then quits', async () => {
  const bytes = crypto.randomBytes(1000); const dir = tmp(); const appDir = path.join(dir, 'Applications'); fs.mkdirSync(path.join(appDir, 'Tally Money.app'), { recursive: true });
  const spawned = []; let quit = 0;
  const mk = (appPath, platform = 'darwin') => U.createUpdater({ store: memStore({ github_token: TOKEN }), version: '1.6.1', arch: 'arm64', platform, appPath, tmpDir: path.join(dir, 't'), resultFile: path.join(dir, 'r.json'), pid: 4242,
    spawnImpl: (cmd, args, opt) => { spawned.push({ cmd, args, opt }); return { unref() {} }; }, quit: () => { quit++; },
    fetchImpl: async (url) => (/latest/.test(url) ? json(releaseWith(bytes)) : (/api\.github/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/x' } }) : new Response(bytes))) });
  const app = path.join(appDir, 'Tally Money.app');
  const u = mk(app); await u.check(); await u.download();
  u.install();
  assert.strictEqual(quit, 1); assert.strictEqual(spawned[0].cmd, '/bin/bash'); assert.strictEqual(spawned[0].opt.detached, true);
  assert.deepStrictEqual(spawned[0].args.slice(1), [u.downloadedPath(), app, '4242', path.join(dir, 'r.json')]);
  assert.match(fs.readFileSync(spawned[0].args[0], 'utf8'), /rm -rf "\$APP.old"/);
  for (const [p, plat, re] of [['/Applications/X.app', 'linux', /Mac and Windows apps only/], ['', 'darwin', /running from source/], ['/Volumes/Tally/Tally Money.app', 'darwin', /Applications folder/], ['/private/var/folders/x/AppTranslocation/ABC/d/Tally Money.app', 'darwin', /Applications folder/]]) {
    const v = mk(p, plat); await v.check(); await v.download(); assert.throws(() => v.install(), re);
  }
  assert.strictEqual(mk(app).status().canInstall, true);
  const w = mk(app); assert.throws(() => w.install(), /Download the update first/);
});

test('updater: the result of an update is reported once', () => {
  const dir = tmp(); const rf = path.join(dir, 'r.json'); fs.writeFileSync(rf, '{"ok":false,"error":"Could not copy"}');
  const u = U.createUpdater({ store: memStore(), version: '1.6.1', arch: 'arm64', platform: 'darwin', appPath: '', tmpDir: dir, resultFile: rf });
  assert.deepStrictEqual(u.status().lastResult, { ok: false, error: 'Could not copy' }); assert.strictEqual(u.status().lastResult, null);
});

test('updater: on Windows it picks the Setup installer', () => {
  const assets = [{ name: 'Tally.Money-1.7.2.dmg' }, { name: 'Tally.Money-Setup-1.7.2.exe' }, { name: 'Tally.Money-1.7.2-mac.zip' }];
  assert.strictEqual(U.pickAsset(assets, 'x64', 'win32').name, 'Tally.Money-Setup-1.7.2.exe');
  assert.strictEqual(U.pickAsset(assets.slice(0, 1), 'x64', 'win32'), null);
  assert.strictEqual(U.pickAsset(assets, 'x64').name, 'Tally.Money-1.7.2.dmg');       // Mac behaviour is unchanged
});

test('updater: on Windows install opens the verified Setup file, then quits', async () => {
  const bytes = crypto.randomBytes(1000); const dir = tmp(); const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const rel = { tag_name: 'v1.8.4', assets: [{ name: 'Tally.Money-1.8.4-arm64.dmg', id: 1, size: 5, digest: 'sha256:' + '0'.repeat(64) }, { name: 'Tally.Money-Setup-1.8.4.exe', id: 9, size: bytes.length, digest: 'sha256:' + sha }] };
  const spawned = []; let quit = 0;
  const u = U.createUpdater({ store: memStore({ github_token: TOKEN }), version: '1.8.3', arch: 'x64', platform: 'win32', appPath: '', tmpDir: path.join(dir, 't'), resultFile: path.join(dir, 'r.json'),
    spawnImpl: (cmd, args, opt) => { spawned.push({ cmd, args, opt }); return { unref() {}, on() {} }; }, quit: () => { quit++; },
    fetchImpl: async (url) => (/latest/.test(url) ? json(rel) : (/api\.github/.test(url) ? new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/x' } }) : new Response(bytes))) });
  const st = u.status(); assert.strictEqual(st.canInstall, true); assert.strictEqual(st.installBlocker, ''); assert.strictEqual(st.platform, 'win32');
  assert.throws(() => u.install(), /Download the update first/);
  const info = await u.check(); assert.strictEqual(info.assetName, 'Tally.Money-Setup-1.8.4.exe'); assert.ok(info.newer);
  await u.download(); u.install();
  assert.strictEqual(quit, 1); assert.strictEqual(spawned.length, 1);
  assert.strictEqual(spawned[0].cmd, u.downloadedPath()); assert.ok(/Setup-1\.8\.4\.exe$/.test(spawned[0].cmd)); assert.deepStrictEqual(spawned[0].args, []); assert.strictEqual(spawned[0].opt.detached, true);
});

test('updater: going back lists only earlier versions, installs only a chosen earlier one, and never a newer one', async () => {
  const asset = (v) => [{ name: 'Tally.Money-' + v + '-arm64.dmg', id: 1, size: 5, digest: 'sha256:' + 'a'.repeat(64) }];
  const rel = (v, extra) => ({ tag_name: 'v' + v, published_at: '2026-10-1' + (v.length % 9) + 'T00:00:00Z', draft: false, prerelease: false, assets: asset(v), ...(extra || {}) });
  const releases = [rel('1.8.28'), rel('1.8.27'), rel('1.8.26'), rel('1.8.25', { draft: true }), rel('1.8.24', { prerelease: true }), rel('1.8.9'), { tag_name: 'weird-tag', assets: [] }, rel('1.8.23', { assets: [] })];
  const calls = [];
  const base = { store: memStore({ github_token: TOKEN }), arch: 'arm64', platform: 'darwin', appPath: '', tmpDir: tmp(), resultFile: path.join(tmp(), 'r.json'),
    fetchImpl: async (url) => { calls.push(url); if (/releases\?per_page/.test(url)) return json(releases); const m = /releases\/tags\/(.+)$/.exec(url); const r = m && releases.find((x) => x.tag_name === decodeURIComponent(m[1])); return r ? json(r) : json({}, 404); } };
  const u = U.createUpdater({ ...base, version: '1.8.27' });
  const v = await u.versions();
  assert.deepStrictEqual(v.map((x) => x.tag), ['v1.8.27', 'v1.8.26', 'v1.8.9', 'v1.8.23'].sort((a, b) => (U.isNewer(a, b) ? -1 : 1)), 'newest first; the newer one, drafts, pre-releases and odd tags are left out');
  assert.strictEqual(v[0].current, true); assert.strictEqual(v[1].older, true);
  assert.strictEqual(v.find((x) => x.tag === 'v1.8.23').hasAsset, false);
  assert.ok(U.TAG_RE.test('v1.8.26') && !U.TAG_RE.test('v1.8.26; rm -rf') && !U.TAG_RE.test('1.8.26'));
  // choosing
  const p = await u.pick('v1.8.26');
  assert.deepStrictEqual([p.tag, p.assetName], ['v1.8.26', 'Tally.Money-1.8.26-arm64.dmg']);
  await assert.rejects(() => u.pick('v1.8.28'), /newer than this one/);
  await assert.rejects(() => u.pick('v1.8.26/../../x'), /not a version/);
  await assert.rejects(() => u.pick('v1.7.0'), /not available on GitHub/);
  await assert.rejects(() => u.pick('v1.8.23'), /no download/);
  await assert.rejects(() => u.pick('v1.8.24'), /not available/);
  assert.ok(calls.every((c) => c.startsWith('https://api.github.com/repos/samnate17/tally-money/')), 'only the project\'s own releases are asked for');
  // no token: asked to add one
  const none = U.createUpdater({ ...base, store: memStore(), version: '1.8.27' });
  await assert.rejects(() => none.versions(), /GitHub token/);
});
