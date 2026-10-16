// A private wallet for photos and scans of IDs, passports and records. Every file is encrypted with Electron's safeStorage
// (the macOS Keychain on a Mac) before it is written, so the files on disk are unreadable without this user account.
// Layout: <root>/<owner>/<category>/<file id>.bin  (the page keeps the names and dates; the disk only holds opaque ids).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
const ID_RE = /^[a-z0-9]{1,16}$/;

function typeOf(name) {
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  return TYPES[ext] || null;
}

function createWallet({ root, safeStorage }) {
  const ok = () => { try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };
  const chk = (v, what) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw new Error('Unknown ' + what + '.'); return v; };
  const dirOf = (owner, cat, make) => {
    const d = path.join(root, chk(owner, 'user'), chk(cat, 'category'));
    if (make) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  };
  const fileOf = (owner, cat, id) => path.join(dirOf(owner, cat, false), chk(id, 'file') + '.bin');
  return {
    available: ok,
    save(owner, cat, name, buf) {
      if (!ok()) throw new Error('This computer cannot encrypt files, so the wallet is turned off.');
      const type = typeOf(name);
      if (!type) throw new Error('Choose a photo (PNG, JPG, WEBP) or a PDF.');
      if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('The file is empty.');
      if (buf.length > MAX_BYTES) throw new Error('Choose a file under 15 MB.');
      const id = crypto.randomBytes(8).toString('hex');
      const dir = dirOf(owner, cat, true);
      fs.writeFileSync(path.join(dir, id + '.bin'), safeStorage.encryptString(buf.toString('base64')), { mode: 0o600 });
      return { id, size: buf.length, type };
    },
    read(owner, cat, id) {
      if (!ok()) throw new Error('This computer cannot decrypt files.');
      const p = fileOf(owner, cat, id);
      if (!fs.existsSync(p)) throw new Error('That file is not on this computer.');
      return Buffer.from(safeStorage.decryptString(fs.readFileSync(p)), 'base64');
    },
    remove(owner, cat, id) { try { fs.unlinkSync(fileOf(owner, cat, id)); } catch (e) { /* already gone */ } return true; },
    removeCategory(owner, cat) { try { fs.rmSync(dirOf(owner, cat, false), { recursive: true, force: true }); } catch (e) { /* already gone */ } return true; },
    removeOwner(owner) { try { fs.rmSync(path.join(root, chk(owner, 'user')), { recursive: true, force: true }); } catch (e) { /* already gone */ } return true; },
  };
}

module.exports = { createWallet, typeOf, MAX_BYTES };
