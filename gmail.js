// Reads receipts and bank alerts from Gmail over IMAP, read-only, using a Gmail "app password" the owner creates.
// It only ever sends LOGIN, EXAMINE (read-only), UID SEARCH, UID FETCH with BODY.PEEK (does not mark mail as read) and LOGOUT. The app password is kept in
// the encrypted secret store and never goes back to the page. Raw messages are returned to the page in memory and are not saved.
const net = require('net');
const tls = require('tls');

const HOST = 'imap.gmail.com', PORT = 993;
const MAX_BYTES = 30 * 1024 * 1024, PART_BYTES = 150000, CMD_TIMEOUT = 60000;

// One IMAP quoted string. CR, LF and NUL are refused so a value can never end the command and start another.
function q(s) {
  s = String(s);
  if (/[\r\n\0]/.test(s)) throw new Error('That contains a character that is not allowed.');
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function cleanEmail(e) {
  e = String(e || '').trim();
  if (!/^[^\s@"\\]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,}$/.test(e)) throw new Error('Type the email address you use with Gmail.');
  return e;
}
function cleanPassword(p) {
  p = String(p || '').replace(/\s+/g, '');
  if (p.length < 8 || p.length > 64 || /[^\x21-\x7e]/.test(p)) throw new Error('Paste the 16-letter app password Google gave you (not your normal password).');
  return p;
}
// What to look for: recent mail that talks about money moving, leaving out promotions and social mail.
function searchQuery(days) {
  const d = Math.max(1, Math.min(365, Math.round(+days) || 30));
  const words = ['receipt', 'payment', 'charged', 'purchase', 'order', 'deposit', 'refund', 'debited', 'invoice', '"card ending"', '"transaction alert"', '"direct deposit"'];
  return 'newer_than:' + d + 'd -category:promotions -category:social (' + words.join(' OR ') + ')';
}

// Finds where the reply to `tag` ends, stepping over {n} literals so a message that happens to contain "A3 OK" cannot fool it.
function replyEnd(buf, tag) {
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf('\r\n', pos, 'latin1');
    if (nl < 0) return -1;
    const line = buf.slice(pos, nl).toString('latin1');
    const lit = /\{(\d+)\}$/.exec(line);
    if (lit) {
      const after = nl + 2 + (+lit[1]);
      if (buf.length < after) return -1;
      pos = after;                       // the rest of that response line follows the literal
      continue;
    }
    if (line.startsWith(tag + ' ')) return nl + 2;
    pos = nl + 2;
  }
  return -1;
}
function literalsOf(buf) {
  const out = [], s = buf.toString('latin1'), re = /\{(\d+)\}\r\n/g;
  let m;
  while ((m = re.exec(s))) {
    const n = +m[1], start = m.index + m[0].length;
    out.push(buf.slice(start, start + n).toString('utf8'));
    re.lastIndex = start + n;
  }
  return out;
}

function createGmail({ store, host = HOST, port = PORT, secure = true, timeout = CMD_TIMEOUT }) {
  const keyOf = (owner) => 'gmail:' + String(owner || 'main').replace(/[^a-z0-9]/g, '').slice(0, 12);

  function open() {
    return new Promise((resolve, reject) => {
      const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      let buf = Buffer.alloc(0), waiter = null, total = 0, closed = false;
      const fail = (err) => { closed = true; if (waiter) { const w = waiter; waiter = null; w.reject(err); } reject(err); };
      sock.setTimeout(timeout, () => { sock.destroy(); fail(new Error('Gmail took too long to answer.')); });
      sock.on('error', (e) => fail(new Error('Could not reach Gmail: ' + ((e && e.message) || 'connection problem'))));
      sock.on('close', () => fail(new Error('Gmail closed the connection.')));
      sock.on('data', (d) => {
        total += d.length;
        if (total > MAX_BYTES) { sock.destroy(); fail(new Error('That is more mail than the app will read at once. Try fewer days.')); return; }
        buf = Buffer.concat([buf, d]);
        if (waiter) check();
      });
      function check() {
        if (!waiter) return;
        const { tag } = waiter;
        if (tag === '*') {                           // the greeting
          const nl = buf.indexOf('\r\n', 0, 'latin1');
          if (nl < 0) return;
          const w = waiter; waiter = null; const line = buf.slice(0, nl).toString('latin1'); buf = buf.slice(nl + 2);
          w.resolve(line);
          return;
        }
        const end = replyEnd(buf, tag);
        if (end < 0) return;
        const w = waiter; waiter = null; const reply = buf.slice(0, end); buf = buf.slice(end);
        w.resolve(reply);
      }
      let n = 0;
      const api = {
        greeting() { return new Promise((res, rej) => { waiter = { tag: '*', resolve: res, reject: rej }; check(); }); },
        cmd(text) {
          return new Promise((res, rej) => {
            if (closed) { rej(new Error('Gmail closed the connection.')); return; }
            const tag = 'T' + (++n);
            waiter = { tag, resolve: (reply) => {
              const last = reply.slice(reply.lastIndexOf('\r\n' + tag + ' ') + 2 || 0).toString('latin1');
              const lastLine = reply.toString('latin1').split('\r\n').filter((l) => l.startsWith(tag + ' ')).pop() || '';
              if (/^\S+ OK/.test(lastLine)) res(reply); else rej(Object.assign(new Error(lastLine.replace(/^\S+\s+/, '') || 'Gmail said no.'), { imap: true }));
            }, reject: rej };
            sock.write(tag + ' ' + text + '\r\n');
            check();
          });
        },
        close() { try { sock.write('T99 LOGOUT\r\n'); } catch (e) { /* closing anyway */ } try { sock.end(); } catch (e) { /* closing anyway */ } },
      };
      sock.once(secure ? 'secureConnect' : 'connect', () => api.greeting().then(() => resolve(api), reject));
    });
  }
  async function login(c, email, pw) {
    try { await c.cmd('LOGIN ' + q(email) + ' ' + q(pw)); }
    catch (e) {
      if (e.imap) throw new Error('Gmail did not accept that. Use a 16-letter app password (Google Account, Security, 2-Step Verification, App passwords), and make sure IMAP is on in Gmail settings.');
      throw e;
    }
  }
  function saved(owner) {
    let v = null;
    try { v = store.get(keyOf(owner)); } catch (e) { v = null; }
    if (typeof v !== 'string') return null;
    try { const o = JSON.parse(v); return o && o.email && o.pw ? o : null; } catch (e) { return null; }
  }
  return {
    status(owner) { const s = saved(owner); return { available: !!store && store.isAvailable(), connected: !!s, email: s ? s.email : '' }; },
    async connect(owner, email, password) {
      if (!store || !store.isAvailable()) throw new Error('Secure storage is not available on this computer, so the password cannot be kept safely. Nothing was saved.');
      const e = cleanEmail(email), pw = cleanPassword(password), c = await open();
      try { await login(c, e, pw); } finally { c.close(); }
      store.set(keyOf(owner), JSON.stringify({ email: e, pw }));
      return { connected: true, email: e };
    },
    disconnect(owner) { try { store.del(keyOf(owner)); } catch (e) { /* nothing saved */ } return { connected: false }; },
    async scan(owner, opts) {
      const s = saved(owner);
      if (!s) throw new Error('Connect Gmail first.');
      const max = Math.max(1, Math.min(500, Math.round(+(opts && opts.max)) || 300));
      const c = await open();
      try {
        await login(c, s.email, s.pw);
        await c.cmd('EXAMINE INBOX');                                   // read-only
        const sr = (await c.cmd('UID SEARCH X-GM-RAW ' + q(searchQuery(opts && opts.days)))).toString('latin1');
        const ids = ((/\* SEARCH([\d ]*)\r\n/.exec(sr) || [])[1] || '').trim().split(/\s+/).filter(Boolean).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
        const take = ids.slice(-max), messages = [];
        for (let i = 0; i < take.length; i += 25) {
          const part = take.slice(i, i + 25).join(',');
          const r = await c.cmd('UID FETCH ' + part + ' (BODY.PEEK[]<0.' + PART_BYTES + '>)');
          literalsOf(r).forEach((m) => { if (m.trim()) messages.push(m); });
        }
        return { messages, found: ids.length, fetched: messages.length };
      } finally { c.close(); }
    },
  };
}

module.exports = { createGmail, q, cleanEmail, cleanPassword, searchQuery, replyEnd, literalsOf };
