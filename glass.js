// Native Liquid Glass (macOS 26+): decides whether to use it and applies it to the main window.
// The addon (native-glass/glass.mm) is compiled by CI and copied into the app; if it is missing or the system
// is older, everything falls back to the CSS glass look and nothing else changes.
const fs = require('fs');
const path = require('path');

function readPrefs(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { native: j.native !== false };      // on by default where available
  } catch (e) { return { native: true }; }
}
function writePrefs(file, prefs) {
  try { fs.writeFileSync(file, JSON.stringify({ native: !!prefs.native })); return true; } catch (e) { return false; }
}

// "26.0.1" -> 26. Anything else -> 0.
function macMajor(v) {
  const m = /^(\d+)/.exec(String(v || ''));
  return m ? parseInt(m[1], 10) : 0;
}

function loadAddon({ resourcesPath, devDir, fsImpl = fs, dlopen }) {
  const candidates = [resourcesPath && path.join(resourcesPath, 'glass.node'), devDir && path.join(devDir, 'out', 'glass.node')].filter(Boolean);
  for (const p of candidates) {
    if (!fsImpl.existsSync(p)) continue;
    try {
      const mod = { exports: {} };
      (dlopen || process.dlopen)(mod, p);
      if (mod.exports && typeof mod.exports.isSupported === 'function') return mod.exports;
    } catch (e) { /* fall through */ }
  }
  return null;
}

// Decision: why glass is or is not used. `reason` is shown to the user.
function decide({ platform, osVersion, prefs, addon }) {
  if (platform !== 'darwin') return { available: false, active: false, reason: 'Native Liquid Glass is only available on macOS.' };
  const major = macMajor(osVersion);
  if (major < 26) return { available: false, active: false, reason: `Native Liquid Glass needs macOS 26 (Tahoe) or newer. This Mac has macOS ${osVersion || 'unknown'}.` };
  if (!addon) return { available: false, active: false, reason: 'This build does not include the native glass module, so the CSS glass look is used.' };
  let ok = false;
  try { ok = !!addon.isSupported(); } catch (e) { ok = false; }
  if (!ok) return { available: false, active: false, reason: 'macOS did not provide the glass material, so the CSS glass look is used.' };
  return prefs.native ? { available: true, active: true, reason: '' } : { available: true, active: false, reason: 'Turned off in Appearance.' };
}

function applyGlass(addon, win, options) {
  const id = addon.addGlass(win.getNativeWindowHandle(), options || {});
  return typeof id === 'number' && id >= 0 ? id : -1;
}

module.exports = { readPrefs, writePrefs, macMajor, loadAddon, decide, applyGlass };
