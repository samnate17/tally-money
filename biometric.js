// Touch ID unlock for the app password (Mac only; no Mac has Face ID).
// The app password is kept in the secret store (the macOS Keychain through Electron's safeStorage) and is handed to the page
// only after the system Touch ID prompt succeeds. The password itself stays the real key: Touch ID is a shortcut to it.
const KEY = 'vaultPw';

function createBiometric({ store, systemPreferences, platform = process.platform }) {
  const available = () => {
    try { return platform === 'darwin' && !!systemPreferences && typeof systemPreferences.canPromptTouchID === 'function' && !!systemPreferences.canPromptTouchID() && !!store && store.isAvailable(); } catch (e) { return false; }
  };
  const prompt = async (reason) => {
    try { await systemPreferences.promptTouchID(reason); } catch (e) { throw new Error('Touch ID was cancelled or did not recognise you.'); }
  };
  return {
    status() { return { available: available(), enabled: available() && typeof store.get(KEY) === 'string' && store.get(KEY).length > 0 }; },
    // The page has already checked the password against the vault before calling this.
    async enable(password) {
      if (!available()) throw new Error('Touch ID is not available on this computer.');
      const pw = String(password || '');
      if (!pw || pw.length > 500) throw new Error('Enter your password first.');
      await prompt('Turn on Touch ID for Tally Money');
      store.set(KEY, pw);
      return true;
    },
    async unlock() {
      if (!available()) throw new Error('Touch ID is not available on this computer.');
      const pw = store.get(KEY);
      if (typeof pw !== 'string' || !pw) throw new Error('Touch ID is not turned on.');
      await prompt('Unlock Tally Money');
      return pw;
    },
    disable() { try { if (store.isAvailable()) store.del(KEY); } catch (e) { /* nothing to remove */ } return true; },
  };
}

module.exports = { createBiometric, KEY };
