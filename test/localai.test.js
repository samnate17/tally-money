const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createLocalAI } = require('../local-ai');

// A stand-in for Ollama: /api/tags lists models, /api/chat streams newline-delimited JSON, split at awkward places.
function fakeOllama(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => { seen.push({ url: req.url, body: body ? JSON.parse(body) : null }); handler(req, res, body); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, host: 'http://127.0.0.1:' + srv.address().port }));
  });
}

test('local AI: status reports models, or not running', async () => {
  const o = await fakeOllama((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest', size: 2e9 }, { name: 'bad name!', size: 1 }] })); });
  let ai = createLocalAI({ host: o.host });
  assert.deepStrictEqual(await ai.status(), { running: true, models: [{ name: 'llama3.2:latest', size: 2e9 }] });
  o.srv.close();
  ai = createLocalAI({ host: 'http://127.0.0.1:1' });
  assert.deepStrictEqual(await ai.status(), { running: false, models: [] });
});

test('local AI: streams tokens even when JSON lines are split across chunks', async () => {
  const o = await fakeOllama((req, res) => {
    const lines = ['Hel', 'lo ', 'there'].map((t) => JSON.stringify({ message: { role: 'assistant', content: t }, done: false }) + '\n').concat([JSON.stringify({ message: { content: '' }, done: true }) + '\n']);
    const all = lines.join('');
    res.write(all.slice(0, 20)); setTimeout(() => { res.write(all.slice(20, 61)); setTimeout(() => res.end(all.slice(61)), 10); }, 10);
  });
  const ai = createLocalAI({ host: o.host }), got = [];
  const r = await ai.chat({ id: 'a', model: 'llama3.2', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }], onToken: (t) => got.push(t) });
  assert.strictEqual(r.text, 'Hello there'); assert.strictEqual(got.join(''), 'Hello there'); assert.strictEqual(r.stopped, false);
  const sent = o.seen.find((x) => x.url === '/api/chat').body;
  assert.strictEqual(sent.model, 'llama3.2'); assert.strictEqual(sent.stream, true); assert.ok(sent.options.num_ctx >= 8192);
  o.srv.close();
});

test('local AI: friendly errors and stop button', async () => {
  let o = await fakeOllama((req, res) => { res.statusCode = 404; res.end(JSON.stringify({ error: 'model not found' })); });
  let ai = createLocalAI({ host: o.host });
  await assert.rejects(ai.chat({ model: 'nope', messages: [{ role: 'user', content: 'x' }] }), /ollama pull nope/);
  o.srv.close();
  ai = createLocalAI({ host: 'http://127.0.0.1:1' });
  await assert.rejects(ai.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }), /not running/);
  o = await fakeOllama((req, res) => { res.write(JSON.stringify({ message: { content: 'part' } }) + '\n'); /* never ends */ });
  ai = createLocalAI({ host: o.host });
  const p = ai.chat({ id: 'z', model: 'm', messages: [{ role: 'user', content: 'x' }], onToken: () => setTimeout(() => ai.cancel('z'), 5) });
  const r = await p;
  assert.deepStrictEqual([r.text, r.stopped], ['part', true]);
  o.srv.closeAllConnections(); o.srv.close();
});

test('local AI: rejects bad input before anything is sent', async () => {
  const ai = createLocalAI({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(ai.chat({ model: '../../etc', messages: [{ role: 'user', content: 'x' }] }), /Choose a model/);
  await assert.rejects(ai.chat({ model: 'm', messages: [] }), /nothing to send/);
  await assert.rejects(ai.chat({ model: 'm', messages: [{ role: 'tool', content: 'x' }] }), /Invalid message/);
  await assert.rejects(ai.chat({ model: 'm', messages: [{ role: 'user', content: 'x'.repeat(60001) }] }), /too long/);
  await assert.rejects(ai.chat({ model: 'm', messages: Array(41).fill({ role: 'user', content: 'x' }) }), /too long/);
});

test('every local module the app requires is packaged', () => {
  const root = path.join(__dirname, '..');
  const files = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files;
  for (const entry of ['main.js', 'preload.js', 'link-preload.js', 'widget.js', 'ai.js', 'plaid.js', 'updater.js', 'glass.js']) {
    const src = fs.readFileSync(path.join(root, entry), 'utf8');
    for (const m of src.matchAll(/require\('\.\/([\w-]+)'\)/g)) assert.ok(files.includes(m[1] + '.js'), entry + ' requires ' + m[1] + '.js but it is not in build.files');
  }
});
