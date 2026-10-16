// Touch ID unlock for the app password (Mac only; no Mac has Face ID).
// The app password is kept in the secret store (the macOS Keychain through Electron's safeStorage) and is handed to the page
// only after the system Touch ID prompt succeeds. The password itself stays the real key: Touch ID is a shortcut to it.
const KEY = 'vaultPw';
const KEYS = { vault: KEY, tabs: 'tabsPw' };          // the app password, and the separate password that protects hiding and showing tabs
// A slot is 'vault' or 'tabs', optionally followed by ':' and a user id (each user of the app has their own Touch ID entry).
const SLOT_RE = /^(vault|tabs)(:[a-z0-9]{1,16})?$/;
const cleanSlot = (slot) => (typeof slot === 'string' && SLOT_RE.test(slot) ? slot : 'vault');
const keyOf = (slot) => {
  const s = cleanSlot(slot), at = s.indexOf(':'), base = at < 0 ? s : s.slice(0, at), who = at < 0 ? '' : s.slice(at);
  return (KEYS[base] || KEY) + who;
};
const isTabs = (slot) => cleanSlot(slot).indexOf('tabs') === 0;

function createBiometric({ store, systemPreferences, platform = process.platform }) {
  const available = () => {
    try { return platform === 'darwin' && !!systemPreferences && typeof systemPreferences.canPromptTouchID === 'function' && !!systemPreferences.canPromptTouchID() && !!store && store.isAvailable(); } catch (e) { return false; }
  };
  const prompt = async (reason) => {
    try { await systemPreferences.promptTouchID(reason); } catch (e) { throw new Error('Touch ID was cancelled or did not recognise you.'); }
  };
  return {
    status(slot) { const k = keyOf(slot); return { available: available(), enabled: available() && typeof store.get(k) === 'string' && store.get(k).length > 0 }; },
    // The page has already checked the password against the vault before calling this.
    async enable(password, slot) {
      if (!available()) throw new Error('Touch ID is not available on this computer.');
      const pw = String(password || '');
      if (!pw || pw.length > 500) throw new Error('Enter your password first.');
      await prompt(isTabs(slot) ? 'Turn on Touch ID for hiding and showing tabs' : 'Turn on Touch ID for Tally Money');
      store.set(keyOf(slot), pw);
      return true;
    },
    async unlock(slot) {
      if (!available()) throw new Error('Touch ID is not available on this computer.');
      const pw = store.get(keyOf(slot));
      if (typeof pw !== 'string' || !pw) throw new Error('Touch ID is not turned on.');
      await prompt(isTabs(slot) ? 'Change which tabs are hidden' : 'Unlock Tally Money');
      return pw;
    },
    disable(slot) { try { if (store.isAvailable()) store.del(keyOf(slot)); } catch (e) { /* nothing to remove */ } return true; },
  };
}

// A plain Touch ID check with nothing stored: used to guard things like un-blurring the widget.
function canTouchId(systemPreferences, platform = process.platform) {
  try { return platform === 'darwin' && !!systemPreferences && typeof systemPreferences.canPromptTouchID === 'function' && !!systemPreferences.canPromptTouchID(); } catch (e) { return false; }
}
async function confirmTouchId(systemPreferences, reason) {
  try { await systemPreferences.promptTouchID(String(reason || 'Confirm it is you')); return true; } catch (e) { return false; }
}

module.exports = { createBiometric, canTouchId, confirmTouchId, cleanSlot, keyOf, KEY, KEYS };
