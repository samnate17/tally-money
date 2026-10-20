// A folder of the documents you add to the app, sorted by kind and year: Documents/Tally Money/<kind>/<year>/<file>.
const fs = require('fs');
const path = require('path');

const CATEGORIES = ['Pay statements', 'Tax documents', 'Bank and card statements', 'Vehicle records', 'Energy bills', 'Receipts', 'Other'];
const EXT = new Set(['pdf', 'csv', 'txt', 'ofx', 'qfx', 'xlsx', 'xls', 'doc', 'docx', 'rtf', 'pages', 'numbers', 'png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'tif', 'tiff']);
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

// A folder inside a kind folder: '' (the kind folder itself), '2025', or a folder you made yourself such as 'Chase/2025'. Never anything that climbs out.
function cleanSub(sub) {
  const raw = String(sub == null ? '' : sub);
  if (!raw) return '';
  const parts = raw.split('/');
  if (parts.length > 3 || parts.some((x) => !x || x.length > 100 || x === '.' || x === '..' || x.startsWith('.') || /[\u0000-\u001f\\:*?"<>|]/.test(x))) throw new Error('Unknown folder.');
  return parts.join('/');
}
// A file name as it sits on disk: just a name, no folders, nothing hidden. Files you put in yourself keep whatever type they have.
function diskName(name) {
  const n = String(name == null ? '' : name);
  if (!n || n.length > 255 || n !== path.basename(n) || n.startsWith('.') || /[\u0000-\u001f/\\]/.test(n)) return null;
  return n;
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
  // Every file in a kind folder, however it got there: filed by the app, dropped into a year folder, or put straight into the folder by hand.
  function list() {
    return CATEGORIES.map((cat) => {
      const files = [];
      const walk = (sub, depth) => {
        let names = [];
        try { names = fs.readdirSync(path.join(root, cat, sub)); } catch (e) { return; }
        for (const f of names) {
          if (f.startsWith('.')) continue;                                  // .DS_Store and other hidden files
          const full = path.join(root, cat, sub, f);
          let st;
          try { st = fs.lstatSync(full); } catch (e) { continue; }
          if (st.isSymbolicLink()) continue;
          if (st.isFile()) files.push({ year: sub, name: f, size: st.size, mtime: st.mtimeMs });
          else if (st.isDirectory() && depth < 3) walk(sub ? sub + '/' + f : f, depth + 1);
        }
      };
      walk('', 1);
      files.sort((a, b) => b.year.localeCompare(a.year) || b.mtime - a.mtime);
      return { category: cat, files };
    });
  }
  async function open(cat, year, name) {
    if (!CATEGORIES.includes(cat)) throw new Error('Unknown folder.');
    const sub = cleanSub(year);
    let target = path.join(root, cat, sub);
    if (!name) {
      if (!fs.existsSync(target)) {
        if (sub === '' || /^\d{4}$/.test(sub)) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        else throw new Error('That folder is no longer there.');
      }
    } else {
      const clean = diskName(name);
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
    if (!CATEGORIES.includes(cat)) throw new Error('Unknown folder.');
    const clean = diskName(name);
    if (!clean) throw new Error('Unknown file.');
    const p = path.join(root, cat, cleanSub(year), clean);
    if (!inside(p) || !fs.lstatSync(p).isFile()) throw new Error('Blocked.');
    fs.unlinkSync(p);
    return true;
  }
  return { CATEGORIES, save, list, open, remove, root: () => root };
}

module.exports = { createDocs, CATEGORIES, cleanName };
