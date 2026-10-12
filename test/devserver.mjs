// Local stand-in for Cloudflare Pages + D1, used by the browser test: serves index.html and runs the real API code over node:sqlite.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../server/api.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(path.join(here, '..', 'migrations', '0001_init.sql'), 'utf8'));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  first: async () => sql.prepare(q).get(...args) || null,
  all: async () => ({ results: sql.prepare(q).all(...args) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
const env = { DB: { prepare: (q) => stmt(q) }, ADMIN_TOKEN: 'x'.repeat(32) };

const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request('http://localhost:' + srv.address().port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const csp = /Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(here, '..', '_headers'), 'utf8'))[1];
  res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': csp }); res.end(fs.readFileSync(path.join(here, '..', 'index.html')));
});
srv.listen(+process.env.PORT || 8799, () => console.log('listening'));
