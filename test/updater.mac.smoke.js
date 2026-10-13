// macOS only: node test/updater.mac.smoke.js
// Runs the real install script against real disk images: success, a corrupt image, and a read-only install folder.
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { writeInstallScript } = require('../updater');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-upd-'));
const home = path.join(root, 'home'); fs.mkdirSync(home);
const script = writeInstallScript(path.join(root, 'scripts'));
function makeApp(dir, marker) {
  const app = path.join(dir, 'Tally Money.app'); fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'marker.txt'), marker); fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'run'), '#!/bin/sh\n', { mode: 0o755 });
  return app;
}
function makeDmg(marker, name) {
  const src = path.join(root, 'src-' + name); fs.mkdirSync(src); makeApp(src, marker);
  const dmg = path.join(root, name + '.dmg');
  execFileSync('hdiutil', ['create', '-volname', 'TallyTest', '-srcfolder', src, '-ov', '-format', 'UDZO', dmg], { stdio: 'ignore' });
  return dmg;
}
function run(dmg, app, result) {
  // Stands in for the running app: a process that exits after 2 seconds, which the script must wait for. It is started from a
  // short-lived shell so launchd adopts and reaps it (a child of this blocked Node process would linger as a zombie).
  const pid = execFileSync('/bin/sh', ['-c', 'sleep 2 >/dev/null 2>&1 & echo $!']).toString().trim();
  const r = spawnSync('/bin/bash', [script, dmg, app, pid, result], { env: { ...process.env, HOME: home, NO_OPEN: '1' }, timeout: 120000 });
  return r.status;
}
const marker = (app) => fs.readFileSync(path.join(app, 'Contents', 'marker.txt'), 'utf8');
const res = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const mounts = () => execFileSync('mount').toString().split('\n').filter((l) => /tally-update\./.test(l)).length;

// 1. success, including quarantine removal and cleanup
let apps = path.join(root, 'A1'); fs.mkdirSync(apps); let app = makeApp(apps, 'OLD');
execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Safari;', app]);
let result = path.join(root, 'r1.json');
assert.strictEqual(run(makeDmg('NEW', 'good'), app, result), 0); assert.strictEqual(marker(app), 'NEW'); assert.deepStrictEqual(res(result), { ok: true });
assert.deepStrictEqual(fs.readdirSync(apps), ['Tally Money.app']);
assert.strictEqual(spawnSync('xattr', ['-p', 'com.apple.quarantine', app]).status !== 0, true, 'quarantine flag removed');
assert.strictEqual(mounts(), 0, 'disk image detached');
console.log('1 success ok');

// 2. corrupt image: old app untouched
apps = path.join(root, 'A2'); fs.mkdirSync(apps); app = makeApp(apps, 'OLD'); result = path.join(root, 'r2.json');
fs.writeFileSync(path.join(root, 'bad.dmg'), 'not a disk image');
assert.notStrictEqual(run(path.join(root, 'bad.dmg'), app, result), 0); assert.strictEqual(marker(app), 'OLD'); assert.strictEqual(res(result).ok, false); assert.match(res(result).error, /disk image/);
console.log('2 corrupt image ok');

// 3. install folder not writable: old app untouched, nothing left behind
apps = path.join(root, 'A3'); fs.mkdirSync(apps); app = makeApp(apps, 'OLD'); result = path.join(root, 'r3.json'); fs.chmodSync(apps, 0o555);
const status = run(makeDmg('NEW', 'good3'), app, result); fs.chmodSync(apps, 0o755);
assert.notStrictEqual(status, 0); assert.strictEqual(marker(app), 'OLD'); assert.strictEqual(res(result).ok, false); assert.deepStrictEqual(fs.readdirSync(apps), ['Tally Money.app']);
assert.strictEqual(mounts(), 0, 'disk image detached after failure');
console.log('3 read-only folder ok:', res(result).error);

// 4. the log is written where we said
assert.ok(fs.readFileSync(path.join(home, 'Library', 'Logs', 'Tally Money update.log'), 'utf8').includes('FAILED'));
console.log('ALL OK');
