const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createPhoneCapture, lanAddresses, MAGIC } = require('../phonecapture');

const req = (url, opt = {}) => new Promise((resolve, reject) => {
  const u = new URL(url), r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: opt.method || 'GET', headers: opt.headers || {} }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() })); });
  r.on('error', reject); if (opt.body) r.write(opt.body); r.end();
});
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

test('phone capture: lists only private network addresses', () => {
  const a = lanAddresses({ en0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }], lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], utun: [{ family: 'IPv4', address: '100.64.1.1', internal: false }, { family: 'IPv4', address: '8.8.8.8', internal: false }], en1: [{ family: 'IPv4', address: '10.0.0.7', internal: false }, { family: 'IPv4', address: '172.20.3.4', internal: false }] });
  assert.deepStrictEqual(a, ['192.168.1.20', '10.0.0.7', '172.20.3.4']);
  assert.strictEqual(MAGIC(JPEG), 'image/jpeg'); assert.strictEqual(MAGIC(Buffer.from('<html>')), '');
});

test('phone capture: only the one-time link works, only photos are accepted, and it stops when asked', async () => {
  const got = []; let t = 1000;
  const pc = createPhoneCapture({ onImage: (i) => got.push(i), qr: (u) => '<svg>' + u + '</svg>', addresses: () => ['127.0.0.1'], maxBytes: 5000, ttlMs: 60000, now: () => t });
  const s = await pc.start();
  try {
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/r\/[0-9a-f]{32}$/); assert.ok(s.qr.includes(s.url)); assert.ok(pc.status().on);
  const page = await req(s.url);
  assert.strictEqual(page.status, 200); assert.match(page.body, /capture="environment"/); assert.match(page.headers['content-security-policy'], /default-src 'none'/); assert.strictEqual(page.headers['cache-control'], 'no-store');
  const wrong = s.url.replace(/[0-9a-f]{32}$/, '0'.repeat(32)); assert.strictEqual((await req(wrong)).status, 404); assert.strictEqual((await req(s.url.replace(/\/r\/.*/, '/'))).status, 404);
  const up = await req(s.url + '/up', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: JPEG });
  assert.strictEqual(up.status, 200); assert.strictEqual(JSON.parse(up.body).ok, true); assert.strictEqual(got.length, 1); assert.strictEqual(got[0].type, 'image/jpeg'); assert.ok(got[0].buf.equals(JPEG));
  assert.strictEqual((await req(s.url + '/up', { method: 'POST', body: Buffer.from('<script>alert(1)</script>') })).status, 415);       // not a photo
  assert.strictEqual((await req(s.url + '/up', { method: 'POST', body: Buffer.concat([JPEG, Buffer.alloc(6000)]) })).status, 413);          // too big
  assert.strictEqual((await req(wrong + '/up', { method: 'POST', body: JPEG })).status, 404);                                                // wrong link cannot upload
  assert.strictEqual((await req(s.url + '/up')).status, 405); assert.strictEqual(got.length, 1);
  t += 61000; assert.strictEqual((await req(s.url)).status, 404);                                                                           // the link expires
  const s2 = await pc.start(); assert.notStrictEqual(s2.url, s.url); assert.ok(await req(s.url).then((r) => r.status === 404, () => true));               // a new session has a new link
  pc.stop(); assert.strictEqual(pc.status().on, false); await assert.rejects(req(s2.url));
  } finally { pc.stop(); }
});

test('phone capture: says so when there is no local network', async () => {
  const pc = createPhoneCapture({ onImage() {}, addresses: () => [] });
  await assert.rejects(pc.start(), /not on a Wi-Fi/);
});
