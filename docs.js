// A folder of the documents you add to the app, sorted by kind and year: Documents/Tally Money/<kind>/<year>/<file>.
const fs = require('fs');
const path = require('path');

const CATEGORIES = ['Pay statements', 'Tax documents', 'Bank and card statements', 'Vehicle records', 'Energy bills', 'Receipts', 'Other'];
const EXT = new Set(['pdf', 'csv', 'txt', 'ofx', 'qfx', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'heic']);
const MAX_BYTES = 30 * 1024 * 1024;

function cleanName(name) {
  const base = path.basename(String(name || 'document')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const ext = path.extname(base).slice(1).toLowerCase();
  if (!EXT.has(ext)) return null;
  return base.slice(0, 120);
}
function cleanYear(y) {
  const n = Math.round(Number(y));
  return n >= 1990 && n <= 2100 ? String(n) : String(new Date().getFullYear());
}

function createDocs({ root, shell }) {
  const dirOf = (cat, year, make) => {
    if (!CATEGORIES.includes(cat)) throw new Error('Unknown folder.');
    const d = year ? path.join(root, cat, cleanYear(year)) : path.join(root, cat);
    if (make) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  };
  const inside = (p) => { const r = path.resolve(p), b = path.resolve(root); return r === b || r.startsWith(b + path.sep); };
  function save(cat, name, buf, year) {
    const clean = cleanName(name);
    if (!clean) throw new Error('That kind of file cannot be stored here.');
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('The file is empty.');
    if (buf.length > MAX_BYTES) throw new Error('Choose a file under 30 MB.');
    const dir = dirOf(cat, year, true), ext = path.extname(clean), stem = clean.slice(0, clean.length - ext.length);
    let final = clean, n = 1;
    while (fs.existsSync(path.join(dir, final))) {
      // The same file added twice is not stored twice.
      try { if (fs.statSync(path.join(dir, final)).size === buf.length && fs.readFileSync(path.join(dir, final)).equals(buf)) return { category: cat, year: cleanYear(year), name: final, size: buf.length, duplicate: true }; } catch (e) { /* fall through to a new name */ }
      final = stem + ' (' + (++n) + ')' + ext;
      if (n > 200) throw new Error('Too many files with that name.');
    }
    fs.writeFileSync(path.join(dir, final), buf, { mode: 0o600 });
    return { category: cat, year: cleanYear(year), name: final, size: buf.length, duplicate: false };
  }
  function list() {
    return CATEGORIES.map((cat) => {
      const files = [];
      let years = [];
      try { years = fs.readdirSync(path.join(root, cat)).filter((y) => /^\d{4}$/.test(y)); } catch (e) { years = []; }
      for (const y of years) {
        let names = [];
        try { names = fs.readdirSync(path.join(root, cat, y)); } catch (e) { names = []; }
        for (const f of names) {
          try { const st = fs.statSync(path.join(root, cat, y, f)); if (st.isFile()) files.push({ year: y, name: f, size: st.size, mtime: st.mtimeMs }); } catch (e) { /* skip */ }
        }
      }
      files.sort((a, b) => b.year.localeCompare(a.year) || b.mtime - a.mtime);
      return { category: cat, files };
    });
  }
  async function open(cat, year, name) {
    let target = dirOf(cat, year && /^\d{4}$/.test(String(year)) ? year : '', true);
    if (name) {
      const clean = cleanName(name);
      if (!clean) throw new Error('Unknown file.');
      target = path.join(target, clean);
      if (!fs.existsSync(target)) throw new Error('That file is no longer there.');
    }
    if (!inside(target)) throw new Error('Blocked.');
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return true;
  }
  function remove(cat, year, name) {
    const clean = cleanName(name);
    if (!clean) throw new Error('Unknown file.');
    const p = path.join(dirOf(cat, year, false), clean);
    if (!inside(p)) throw new Error('Blocked.');
    fs.unlinkSync(p);
    return true;
  }
  return { CATEGORIES, save, list, open, remove, root: () => root };
}

module.exports = { createDocs, CATEGORIES, cleanName };
