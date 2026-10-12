const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// A small D1 look-alike over node:sqlite so the real SQL in migrations/ and server/api.mjs is exercised.
function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (q) => stmt(q), raw: sql };
}

let api;
const ADMIN = 'a'.repeat(32);
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const AUTH = (n) => b64u(Buffer.alloc(32, n));          // a valid 32-byte auth proof
let T = Date.UTC(2026, 9, 12);

function client(env) {
  let cookie = '';
  async function call(method, p, body, { admin, noHeader } = {}) {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' };
    if (!noHeader) headers['x-tally'] = '1';
    if (admin) headers.authorization = 'Bearer ' + (admin === true ? ADMIN : admin);
    if (cookie) headers.cookie = cookie;
    const res = await api.handle(new Request('https://t.example' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { now: T });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.startsWith('tm_session=;') || /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie: sc };
  }
  return { call, get cookie() { return cookie; }, clear: () => { cookie = ''; } };
}
async function invite(env, days) {
  const r = await client(env).call('POST', '/api/admin/invite', { days }, { admin: true });
  assert.strictEqual(r.status, 200); return r.body.code;
}

test.before(async () => { api = await import('../server/api.mjs'); });

test('registration needs a valid, unused invite; the code works once', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env);
  assert.strictEqual((await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: 'AAAA-AAAA-AAAA-AAAA' })).status, 403);
  assert.strictEqual((await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1) })).status, 403);
  const code = await invite(env);
  assert.match(code, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  const ok = await c.call('POST', '/api/register', { email: 'A@X.com ', auth: AUTH(1), invite: code.toLowerCase().replace(/-/g, ' ') });
  assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.email, 'a@x.com');
  assert.match(ok.setCookie, /HttpOnly/); assert.match(ok.setCookie, /SameSite=Strict/); assert.match(ok.setCookie, /Secure/);
  const second = await client(env).call('POST', '/api/register', { email: 'b@x.com', auth: AUTH(2), invite: code });
  assert.strictEqual(second.status, 403);
  assert.strictEqual(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});

test('invite codes and sessions are stored only as hashes; the server stores no password material in the clear', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const code = await invite(env); const c = client(env);
  await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: code });
  const dump = JSON.stringify([env.DB.raw.prepare('SELECT * FROM invites').all(), env.DB.raw.prepare('SELECT * FROM users').all(), env.DB.raw.prepare('SELECT * FROM sessions').all()]);
  assert.ok(!dump.includes(code.replace(/-/g, '')) && !dump.includes(AUTH(1)) && !dump.includes(c.cookie.split('=')[1]));
});

test('expired, revoked and taken-email invites are refused and not consumed wrongly', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env);
  const old = await invite(env, 1);
  T += 2 * 86400000;
  assert.strictEqual((await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: old })).status, 403);
  const rev = await invite(env);
  const list = await c.call('GET', '/api/admin/invites', undefined, { admin: true });
  const id = list.body.invites.find((i) => !i.used_at && i.expires_at > T).id;
  await c.call('DELETE', '/api/admin/invite/' + id, undefined, { admin: true });
  assert.strictEqual((await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: rev })).status, 403);
  const c1 = await invite(env), c2 = await invite(env);
  assert.strictEqual((await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: c1 })).status, 200);
  const dup = await client(env).call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(9), invite: c2 });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual((await client(env).call('POST', '/api/register', { email: 'b@x.com', auth: AUTH(3), invite: c2 })).status, 200);   // c2 was not burned by the failed attempt
});

test('login: right proof works, wrong proof and unknown email give the same answer, repeated failures lock out', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  await client(env).call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  const c = client(env);
  const wrong = await c.call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(2) });
  const ghost = await c.call('POST', '/api/login', { email: 'nobody@x.com', auth: AUTH(2) });
  assert.deepStrictEqual([wrong.status, wrong.body.error], [ghost.status, ghost.body.error]);
  assert.strictEqual((await c.call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) })).status, 200);
  assert.strictEqual((await c.call('GET', '/api/session')).body.email, 'a@x.com');
  for (let i = 0; i < 8; i++) await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(5) });
  const locked = await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) });
  assert.strictEqual(locked.status, 429);
  T += 16 * 60 * 1000;
  assert.strictEqual((await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) })).status, 200);
});

test('data: needs a session, versions guard against overwrites, oversize is refused', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  assert.strictEqual((await client(env).call('GET', '/api/data')).status, 401);
  const c = client(env);
  await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  assert.deepStrictEqual((await c.call('GET', '/api/data')).body.version, 0);
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 0, data: 'cipher1' })).body.version, 1);
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 0, data: 'stale' })).status, 409);
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 1, data: 'cipher2' })).body.version, 2);
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 1, data: 'stale' })).status, 409);
  assert.strictEqual((await c.call('GET', '/api/data')).body.data, 'cipher2');
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 2, data: 'x'.repeat(4 * 1024 * 1024 + 1) })).status >= 400, true);
  // another account cannot see it
  const d = client(env);
  await d.call('POST', '/api/register', { email: 'b@x.com', auth: AUTH(2), invite: await invite(env) });
  assert.strictEqual((await d.call('GET', '/api/data')).body.data, null);
});

test('writes without the anti-forgery header are refused; logout ends the session', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env);
  await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  assert.strictEqual((await c.call('PUT', '/api/data', { baseVersion: 0, data: 'x' }, { noHeader: true })).status, 400);
  const cookie = c.cookie;
  await c.call('POST', '/api/logout', {});
  const again = client(env); again.clear();
  const r = await api.handle(new Request('https://t.example/api/data', { headers: { cookie } }), env, { now: T });
  assert.strictEqual(r.status, 401);
});

test('changing the password swaps the proof, re-writes the data and signs out other devices', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env), other = client(env);
  await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  await other.call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) });
  await c.call('PUT', '/api/data', { baseVersion: 0, data: 'old' });
  assert.strictEqual((await c.call('POST', '/api/password', { auth: AUTH(9), newAuth: AUTH(2), baseVersion: 1, data: 'new' })).status, 401);
  assert.strictEqual((await c.call('POST', '/api/password', { auth: AUTH(1), newAuth: AUTH(2), baseVersion: 1, data: 'new' })).status, 200);
  assert.strictEqual((await other.call('GET', '/api/data')).status, 401);
  assert.strictEqual((await c.call('GET', '/api/data')).body.data, 'new');
  assert.strictEqual((await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) })).status, 401);
  assert.strictEqual((await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(2) })).status, 200);
});

test('deleting an account removes the user, sessions and data', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env);
  await c.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  await c.call('PUT', '/api/data', { baseVersion: 0, data: 'secret' });
  assert.strictEqual((await c.call('DELETE', '/api/account', { auth: AUTH(7) })).status, 401);
  assert.strictEqual((await c.call('DELETE', '/api/account', { auth: AUTH(1) })).status, 200);
  for (const t of ['users', 'blobs', 'sessions']) assert.strictEqual(env.DB.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0);
});

test('admin: needs the token, is off without one, lists and removes users, can disable them', async () => {
  const env = { DB: makeDb(), ADMIN_TOKEN: ADMIN };
  const c = client(env);
  assert.strictEqual((await c.call('GET', '/api/admin/users')).status, 401);
  assert.strictEqual((await c.call('GET', '/api/admin/users', undefined, { admin: 'wrong' })).status, 401);
  assert.strictEqual((await client({ DB: makeDb() }).call('GET', '/api/admin/users', undefined, { admin: true })).status, 503);
  assert.strictEqual((await client({ DB: makeDb(), ADMIN_TOKEN: 'short' }).call('GET', '/api/admin/users', undefined, { admin: 'short' })).status, 503);
  const u = client(env);
  await u.call('POST', '/api/register', { email: 'a@x.com', auth: AUTH(1), invite: await invite(env) });
  const users = (await c.call('GET', '/api/admin/users', undefined, { admin: true })).body.users;
  assert.strictEqual(users.length, 1); assert.ok(!('auth_hash' in users[0]) && !('salt' in users[0]));
  await c.call('POST', `/api/admin/user/${users[0].id}/disable`, {}, { admin: true });
  assert.strictEqual((await u.call('GET', '/api/data')).status, 401);
  assert.strictEqual((await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) })).status, 401);
  await c.call('POST', `/api/admin/user/${users[0].id}/enable`, {}, { admin: true });
  assert.strictEqual((await client(env).call('POST', '/api/login', { email: 'a@x.com', auth: AUTH(1) })).status, 200);
  await c.call('DELETE', `/api/admin/user/${users[0].id}`, undefined, { admin: true });
  assert.strictEqual((await c.call('GET', '/api/admin/users', undefined, { admin: true })).body.users.length, 0);
  for (let i = 0; i < 10; i++) await c.call('GET', '/api/admin/users', undefined, { admin: 'nope-nope-nope-nope-nope-nope' });
  assert.strictEqual((await c.call('GET', '/api/admin/users', undefined, { admin: true })).status, 429);   // admin guessing is rate-limited
});
