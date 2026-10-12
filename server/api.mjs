// Tally Money hosted API. Runs as a Cloudflare Pages Function with a D1 database bound as DB.
//
// Design: the browser derives two independent keys from the password (PBKDF2). One proves who you are
// (`auth`, sent to the server, which stores only a salted hash of it). The other encrypts your data
// (never sent). The server stores only ciphertext, so it cannot read anyone's finances, but a forgotten
// password cannot be recovered. Accounts can only be created with a single-use invite code.

const enc = new TextEncoder();
const SESSION_DAYS = 30;
const MAX_BLOB = 4 * 1024 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { login: 8, register: 10, ipLogin: 40 };
const COOKIE = 'tm_session';

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error, extra) => json({ ok: false, error, ...(extra || {}) }, status);
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validAuth = (a) => typeof a === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a);   // 32 bytes, base64url
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const inviteHash = (code) => sha256('invite:' + normCode(code));

function cookieOf(req, name) {
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function sessionCookie(token, maxAge, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
const clientIp = (req) => req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';

async function tooMany(db, key, limit, now) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, now - WINDOW_MS).first();
  return (r && r.n >= limit);
}
async function noteAttempt(db, key, now) {
  await db.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now).run();
  if (Math.random() < 0.05) await db.prepare('DELETE FROM attempts WHERE at < ?').bind(now - WINDOW_MS * 4).run();
}

async function userFromSession(db, req, now) {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const th = await sha256('session:' + token);
  const row = await db.prepare(
    'SELECT u.id, u.email, u.disabled, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(th).first();
  if (!row || row.expires_at < now || row.disabled) return null;
  return { id: row.id, email: row.email, tokenHash: th };
}
async function startSession(db, userId, now, secure) {
  const token = rand(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256('session:' + token), userId, now, now + SESSION_DAYS * 86400000).run();
  return sessionCookie(token, SESSION_DAYS * 86400, secure);
}
const authHash = (salt, auth) => sha256('auth:' + salt + ':' + auth);

async function readJson(req) {
  try { const t = await req.text(); if (t.length > MAX_BLOB + 4096) return { __big: true }; return JSON.parse(t || '{}'); } catch (e) { return null; }
}

export async function handle(req, env, opts) {
  const now = (opts && opts.now) || Date.now();
  const db = env.DB;
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const secure = url.protocol === 'https:';
  const method = req.method;
  if (!db) return fail(500, 'The database is not connected.');

  if (path === '/api/health') return json({ ok: true, hosted: true });

  // Cross-site request protection on top of SameSite=Strict: every write must carry this header,
  // which a cross-site form or image request cannot add.
  if (method !== 'GET' && req.headers.get('x-tally') !== '1') return fail(400, 'Bad request.');

  // ---------- admin (invite and user management, bearer ADMIN_TOKEN) ----------
  if (path.startsWith('/api/admin/')) {
    const tok = String(env.ADMIN_TOKEN || '');
    const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const ipKey = 'admin:' + clientIp(req);
    if (tok.length < 24) return fail(503, 'Admin access is not configured. Set the ADMIN_TOKEN secret (24+ characters).');
    if (await tooMany(db, ipKey, 10, now)) return fail(429, 'Too many attempts. Try again later.');
    if (!same(given, tok)) { await noteAttempt(db, ipKey, now); return fail(401, 'Not authorized.'); }

    if (path === '/api/admin/invite' && method === 'POST') {
      const body = (await readJson(req)) || {};
      const days = Math.min(90, Math.max(1, Math.floor(+body.days || 7)));
      const bytes = crypto.getRandomValues(new Uint8Array(10));            // 80 bits
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '', code = '';
      bytes.forEach((b) => { bits += b.toString(2).padStart(8, '0'); });
      for (let i = 0; i < 16; i++) code += A[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
      const id = rand(9);
      await db.prepare('INSERT INTO invites (id, code_hash, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, await inviteHash(code), String(body.note || '').slice(0, 80), now, now + days * 86400000).run();
      return json({ ok: true, id, code: code.match(/.{4}/g).join('-'), expiresInDays: days });
    }
    if (path === '/api/admin/invites' && method === 'GET') {
      const r = await db.prepare('SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, i.revoked, u.email AS used_by FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 200').all();
      return json({ ok: true, invites: r.results || [] });
    }
    let m = path.match(/^\/api\/admin\/invite\/([\w-]+)$/);
    if (m && method === 'DELETE') {
      await db.prepare('UPDATE invites SET revoked = 1 WHERE id = ? AND used_by IS NULL').bind(m[1]).run();
      return json({ ok: true });
    }
    if (path === '/api/admin/users' && method === 'GET') {
      const r = await db.prepare('SELECT u.id, u.email, u.created_at, u.disabled, b.updated_at AS last_sync, LENGTH(b.data) AS bytes FROM users u LEFT JOIN blobs b ON b.user_id = u.id ORDER BY u.created_at DESC LIMIT 500').all();
      return json({ ok: true, users: r.results || [] });
    }
    m = path.match(/^\/api\/admin\/user\/([\w-]+)$/);
    if (m && method === 'DELETE') {                       // remove the account and its data
      await deleteUser(db, m[1]);
      return json({ ok: true });
    }
    m = path.match(/^\/api\/admin\/user\/([\w-]+)\/(disable|enable)$/);
    if (m && method === 'POST') {
      await db.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(m[2] === 'disable' ? 1 : 0, m[1]).run();
      if (m[2] === 'disable') await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(m[1]).run();
      return json({ ok: true });
    }
    return fail(404, 'Not found.');
  }

  // ---------- register (invite required) ----------
  if (path === '/api/register' && method === 'POST') {
    const ip = clientIp(req);
    if (await tooMany(db, 'register:' + ip, LIMITS.register, now)) return fail(429, 'Too many attempts. Try again later.');
    const body = await readJson(req);
    if (!body || body.__big) return fail(400, 'Bad request.');
    const email = normEmail(body.email);
    if (!validEmail(email) || !validAuth(body.auth)) return fail(400, 'Enter a valid email and password.');
    const bad = async () => { await noteAttempt(db, 'register:' + ip, now); return fail(403, 'That invite code is not valid, has expired or was already used.'); };
    if (normCode(body.invite).length !== 16) return bad();
    const inv = await db.prepare('SELECT id, expires_at, used_by, revoked FROM invites WHERE code_hash = ?').bind(await inviteHash(body.invite)).first();
    if (!inv || inv.used_by || inv.revoked || inv.expires_at < now) return bad();
    if (await db.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first()) return fail(409, 'An account with that email already exists. Sign in instead.');

    const id = rand(12), salt = rand(16);
    // Claim the invite first with a conditional update so two simultaneous sign-ups cannot both use it.
    const claim = await db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_by IS NULL AND revoked = 0').bind(id, now, inv.id).run();
    if (!claim.meta || claim.meta.changes !== 1) return bad();
    try {
      await db.prepare('INSERT INTO users (id, email, salt, auth_hash, invite_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, email, salt, await authHash(salt, body.auth), inv.id, now).run();
    } catch (e) {
      await db.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE id = ?').bind(inv.id).run();
      return fail(409, 'An account with that email already exists. Sign in instead.');
    }
    return json({ ok: true, email }, 200, { 'set-cookie': await startSession(db, id, now, secure) });
  }

  // ---------- login ----------
  if (path === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    if (!body || body.__big) return fail(400, 'Bad request.');
    const email = normEmail(body.email), ip = clientIp(req);
    if (!validEmail(email) || !validAuth(body.auth)) return fail(401, 'Email or password is wrong.');
    if (await tooMany(db, 'login:' + email, LIMITS.login, now) || await tooMany(db, 'loginip:' + ip, LIMITS.ipLogin, now)) {
      return fail(429, 'Too many failed attempts. Wait 15 minutes and try again.');
    }
    const u = await db.prepare('SELECT id, salt, auth_hash, disabled FROM users WHERE email = ?').bind(email).first();
    const expect = u ? u.auth_hash : await authHash('x', 'y');                 // same work whether or not the account exists
    const ok = same(expect, await authHash(u ? u.salt : 'x', body.auth)) && u && !u.disabled;
    if (!ok) {
      await noteAttempt(db, 'login:' + email, now); await noteAttempt(db, 'loginip:' + ip, now);
      return fail(401, 'Email or password is wrong.');
    }
    return json({ ok: true, email }, 200, { 'set-cookie': await startSession(db, u.id, now, secure) });
  }

  // ---------- everything below needs a session ----------
  const me = await userFromSession(db, req, now);
  if (!me) return fail(401, 'Signed out.', { signedOut: true });

  if (path === '/api/session' && method === 'GET') return json({ ok: true, email: me.email });

  if (path === '/api/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.tokenHash).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });
  }

  if (path === '/api/data' && method === 'GET') {
    const b = await db.prepare('SELECT version, data, updated_at FROM blobs WHERE user_id = ?').bind(me.id).first();
    return json({ ok: true, version: b ? b.version : 0, data: b ? b.data : null, updatedAt: b ? b.updated_at : null });
  }

  if (path === '/api/data' && method === 'PUT') {
    const body = await readJson(req);
    if (!body || body.__big || typeof body.data !== 'string' || !Number.isInteger(body.baseVersion) || body.baseVersion < 0) return fail(400, 'Bad request.');
    if (body.data.length > MAX_BLOB) return fail(413, 'Your data is too large to sync.');
    const done = await writeBlob(db, me.id, body.baseVersion, body.data, now);
    if (!done) return fail(409, 'Changed somewhere else.', { conflict: true });
    return json({ ok: true, version: body.baseVersion + 1 });
  }

  // Change password: new auth proof plus the data re-encrypted under the new key, applied together.
  if (path === '/api/password' && method === 'POST') {
    const body = await readJson(req);
    if (!body || body.__big || !validAuth(body.auth) || !validAuth(body.newAuth) || typeof body.data !== 'string' || !Number.isInteger(body.baseVersion)) return fail(400, 'Bad request.');
    if (await tooMany(db, 'login:' + me.email, LIMITS.login, now)) return fail(429, 'Too many failed attempts. Wait 15 minutes and try again.');
    const u = await db.prepare('SELECT salt, auth_hash FROM users WHERE id = ?').bind(me.id).first();
    if (!same(u.auth_hash, await authHash(u.salt, body.auth))) { await noteAttempt(db, 'login:' + me.email, now); return fail(401, 'Current password is wrong.'); }
    if (!(await writeBlob(db, me.id, body.baseVersion, body.data, now))) return fail(409, 'Changed somewhere else.', { conflict: true });
    const salt = rand(16);
    await db.prepare('UPDATE users SET salt = ?, auth_hash = ? WHERE id = ?').bind(salt, await authHash(salt, body.newAuth), me.id).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(me.id, me.tokenHash).run();   // sign out everywhere else
    return json({ ok: true, version: body.baseVersion + 1 });
  }

  if (path === '/api/account' && method === 'DELETE') {
    const body = await readJson(req);
    if (!body || !validAuth(body.auth)) return fail(400, 'Bad request.');
    const u = await db.prepare('SELECT salt, auth_hash FROM users WHERE id = ?').bind(me.id).first();
    if (!same(u.auth_hash, await authHash(u.salt, body.auth))) return fail(401, 'Password is wrong.');
    await deleteUser(db, me.id);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, secure) });
  }

  return fail(404, 'Not found.');
}

async function writeBlob(db, userId, baseVersion, data, now) {
  if (baseVersion === 0) {
    const r = await db.prepare('INSERT OR IGNORE INTO blobs (user_id, version, data, updated_at) VALUES (?, 1, ?, ?)').bind(userId, data, now).run();
    return !!(r.meta && r.meta.changes === 1);
  }
  const r = await db.prepare('UPDATE blobs SET version = version + 1, data = ?, updated_at = ? WHERE user_id = ? AND version = ?').bind(data, now, userId, baseVersion).run();
  return !!(r.meta && r.meta.changes === 1);
}
async function deleteUser(db, id) {
  await db.prepare('DELETE FROM blobs WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}
