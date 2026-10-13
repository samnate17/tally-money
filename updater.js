// In-app updates for the Mac app. The repo is private, so the app asks GitHub for the latest release with a read-only
// token the user pastes once (kept in the encrypted store, never sent to the page). The disk image is downloaded straight
// from GitHub, checked against the SHA-256 GitHub publishes for the asset, and then swapped in for the running app by a small
// script that runs after the app quits. Unsigned apps cannot use Squirrel-based auto-updaters, which is why this is hand-rolled.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'samnate17/tally-money';
const API = 'https://api.github.com';
const UA = 'TallyMoney-Updater';
const TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/;
const REDIRECT_HOSTS = [/(^|\.)github\.com$/, /(^|\.)githubusercontent\.com$/, /(^|\.)blob\.core\.windows\.net$/];

function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function isNewer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function pickAsset(assets, arch) {
  const dmgs = (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a.name === 'string' && /\.dmg$/.test(a.name));
  return (arch === 'arm64' ? dmgs.filter((a) => /-arm64\.dmg$/.test(a.name)) : dmgs.filter((a) => !/arm64/.test(a.name)))[0] || null;
}
function friendlyStatus(status) {
  if (status === 401) return 'GitHub rejected the token, so I cannot tell whether you are up to date. It may have expired or been revoked, or it was not copied in full. Create a new one with Repository access: only tally-money and Contents: Read-only, then paste it here.';
  if (status === 403) return 'GitHub refused the request, so I cannot tell whether you are up to date. Either you hit a rate limit (try again in a few minutes) or the token lacks permission: check that Repository permissions has Contents set to Read-only.';
  if (status === 404) return 'GitHub could not find the releases, so I cannot tell whether you are up to date. This almost always means the token cannot see the repository. Check these settings on the token: (1) Repository access is "Only select repositories" with tally-money chosen, not "Public repositories"; (2) Repository permissions has Contents set to Read-only; (3) the Resource owner is samnate17. Fix it, then remove the token here and paste the new one.';
  return 'GitHub returned an error (' + status + ').';
}

const INSTALL_SCRIPT = `#!/bin/bash
# Swaps the downloaded version in for the running one, then reopens it. Rolls back on any failure.
# args: <dmg> <current .app> <pid of the running app> <result json path>
DMG="$1"; APP="$2"; PID="$3"; RESULT="$4"; MNT=""
LOGDIR="$HOME/Library/Logs"; mkdir -p "$LOGDIR"; exec >>"$LOGDIR/Tally Money update.log" 2>&1
echo "== $(date) update $DMG -> $APP"
fail() {
  echo "FAILED: $1"
  printf '{"ok":false,"error":"%s"}' "$1" > "$RESULT"
  if [ -d "$APP.old" ] && [ ! -d "$APP" ]; then mv "$APP.old" "$APP"; fi
  rm -rf "$APP.new"
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -force >/dev/null 2>&1; fi
  if [ -z "$NO_OPEN" ]; then open "$APP"; fi
  exit 1
}
MNT=$(mktemp -d /tmp/tally-update.XXXXXX) || fail "Could not create a temporary folder"
hdiutil attach -nobrowse -readonly -noverify -mountpoint "$MNT" "$DMG" >/dev/null || fail "Could not open the downloaded disk image"
for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then fail "Tally Money did not quit in time"; fi
SRC=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
[ -n "$SRC" ] || fail "The disk image does not contain an app"
rm -rf "$APP.new" "$APP.old"
ditto "$SRC" "$APP.new" || fail "Could not copy the new version"
mv "$APP" "$APP.old" || fail "Could not move the old version aside. Is it in a protected folder?"
mv "$APP.new" "$APP" || { mv "$APP.old" "$APP"; fail "Could not put the new version in place"; }
rm -rf "$APP.old"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
hdiutil detach "$MNT" -force >/dev/null 2>&1; rmdir "$MNT" 2>/dev/null
printf '{"ok":true}' > "$RESULT"
echo "done"
if [ -z "$NO_OPEN" ]; then open "$APP"; fi
`;

function writeInstallScript(dir, fsImpl = fs) {
  fsImpl.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'install-update.sh');
  fsImpl.writeFileSync(file, INSTALL_SCRIPT, { mode: 0o700 });
  return file;
}

function createUpdater({ store, version, arch, platform, appPath, tmpDir, resultFile, fetchImpl, fsImpl = fs, spawnImpl, quit, pid = process.pid, now = Date.now }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  let latest = null, downloaded = null, autoDone = false;

  const token = () => String((store && store.get('github_token')) || '');
  function canInstall() {
    if (platform !== 'darwin' || !appPath || !/\.app$/.test(appPath)) return false;
    if (/\/AppTranslocation\//.test(appPath) || /^\/Volumes\//.test(appPath)) return false;
    try { fsImpl.accessSync(path.dirname(appPath), fs.constants.W_OK); return true; } catch (e) { return false; }
  }
  function installBlocker() {
    if (platform !== 'darwin') return 'In-app install works on the Mac app only.';
    if (!appPath || !/\.app$/.test(appPath)) return 'This copy is not an installed app (it is running from source), so it cannot replace itself.';
    if (/\/AppTranslocation\//.test(appPath) || /^\/Volumes\//.test(appPath)) return 'Move Tally Money into your Applications folder and open it from there first.';
    if (!canInstall()) return 'Tally Money cannot write to the folder it is installed in. Move it to Applications.';
    return '';
  }
  async function gh(url, extra) {
    const t = token();
    if (!t) throw new Error('Add a GitHub token first.');
    let res;
    try {
      res = await doFetch(url, { ...extra, headers: { Authorization: 'Bearer ' + t, 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', ...((extra && extra.headers) || {}) } });
    } catch (e) { throw new Error('Could not reach GitHub. Check your internet connection.'); }
    return res;
  }

  return {
    status() {
      let lastResult = null;
      try { lastResult = JSON.parse(fsImpl.readFileSync(resultFile, 'utf8')); fsImpl.unlinkSync(resultFile); } catch (e) { /* none */ }
      return { version, hasToken: !!token(), canInstall: canInstall(), installBlocker: installBlocker(), lastResult };
    },
    setToken(t) {
      t = String(t || '').trim();
      if (!TOKEN_RE.test(t)) throw new Error('That does not look like a GitHub token. A fine-grained token starts with github_pat_.');
      store.set('github_token', t);
      latest = null; downloaded = null;
      return true;
    },
    clearToken() { store.del('github_token'); latest = null; downloaded = null; return true; },

    async check({ auto } = {}) {
      if (auto) { if (autoDone || !token()) return null; autoDone = true; }
      const res = await gh(API + '/repos/' + REPO + '/releases/latest');
      if (!res.ok) throw new Error(friendlyStatus(res.status));
      const j = await res.json();
      const tag = String(j.tag_name || '');
      const asset = pickAsset(j.assets, arch);
      latest = { tag, asset };
      return { current: version, latest: tag.replace(/^v/, ''), newer: isNewer(tag, version), notes: String(j.body || '').slice(0, 4000), url: String(j.html_url || ''),
        hasAsset: !!asset, size: asset ? asset.size : 0, assetName: asset ? asset.name : '' };
    },

    async download(onProgress) {
      if (!latest || !latest.asset) throw new Error('Check for updates first.');
      const a = latest.asset;
      const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''));
      if (!m) throw new Error('GitHub did not provide a checksum for this download, so it was not installed.');
      let res = await gh(API + '/repos/' + REPO + '/releases/assets/' + a.id, { headers: { Accept: 'application/octet-stream' }, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        let u;
        try { u = new URL(res.headers.get('location')); } catch (e) { throw new Error('GitHub sent an invalid download address.'); }
        if (u.protocol !== 'https:' || !REDIRECT_HOSTS.some((re) => re.test(u.hostname))) throw new Error('GitHub sent the download to an unexpected host, so it was refused.');
        try { res = await doFetch(u.toString(), { headers: { 'User-Agent': UA } }); } catch (e) { throw new Error('The download was interrupted. Check your connection and try again.'); }   // no Authorization header here
      }
      if (!res.ok || !res.body) throw new Error(friendlyStatus(res.status));
      fsImpl.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, path.basename(a.name));
      const out = fsImpl.createWriteStream(file, { mode: 0o600 });
      const hash = crypto.createHash('sha256');
      let got = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value); got += value.length;
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
          if (onProgress) onProgress({ received: got, total: a.size });
        }
        await new Promise((r, j) => { out.end((e) => (e ? j(e) : r())); });
      } catch (e) {
        try { out.destroy(); fsImpl.unlinkSync(file); } catch (x) { /* ignore */ }
        throw new Error('The download was interrupted. Try again.');
      }
      if (got !== a.size || hash.digest('hex') !== m[1]) {
        try { fsImpl.unlinkSync(file); } catch (x) { /* ignore */ }
        throw new Error('The download did not match GitHub\'s checksum, so it was deleted and not installed.');
      }
      downloaded = file;
      return file;
    },

    install() {
      const why = installBlocker();
      if (why) throw new Error(why);
      if (!downloaded || !fsImpl.existsSync(downloaded)) throw new Error('Download the update first.');
      const script = writeInstallScript(tmpDir, fsImpl);
      const child = spawnImpl('/bin/bash', [script, downloaded, appPath, String(pid), resultFile], { detached: true, stdio: 'ignore' });
      if (child && child.unref) child.unref();
      quit();
      return true;
    },
    downloadedPath() { return downloaded; },
  };
}

module.exports = { createUpdater, isNewer, parseVer, pickAsset, friendlyStatus, writeInstallScript, INSTALL_SCRIPT, TOKEN_RE };
