// Encrypted key store. Everything secret (Plaid keys and bank tokens, Anthropic API key)
// lives in one file encrypted with Electron's safeStorage (the macOS Keychain on a Mac).
// The renderer never receives these values.
const fs = require('fs');
const path = require('path');

function createSecretStore({ file, safeStorage }) {
  function isAvailable() {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  }
  function all() {
    if (!isAvailable() || !fs.existsSync(file)) return {};
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch (e) {
      return {};
    }
  }
  function write(obj) {
    if (!isAvailable()) {
      throw new Error('Secure storage is not available on this system, so nothing was saved.');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(obj)), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  return {
    isAvailable,
    all,
    get(key) { return all()[key]; },
    set(key, value) { const o = all(); o[key] = value; write(o); },
    del(key) { const o = all(); delete o[key]; write(o); },
  };
}

module.exports = { createSecretStore };
