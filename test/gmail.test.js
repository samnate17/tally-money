const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { createGmail, q, cleanEmail, cleanPassword, searchQuery, literalsOf, replyEnd } = require('../gmail');

const PW = 'abcdefghijklmnop';
function fakeStore() {
  const m = new Map();
  return { isAvailable: () => true, get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), del: (k) => m.delete(k), m };
}
// A tiny IMAP server: records every command and answers like Gmail would.
function server(mails, opts = {}) {
  const cmds = [];
  const srv = net.createServer((sock) => {
    sock.write('* OK Fake IMAP ready\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, ...rest] = line.split(' '), cmd = rest.join(' ');
        cmds.push(cmd);
        if (/^LOGIN /.test(cmd)) sock.write(cmd.includes(PW) ? tag + ' OK logged in\r\n' : tag + ' NO [AUTHENTICATIONFAILED] Invalid credentials\r\n');
        else if (/^EXAMINE /.test(cmd)) sock.write('* 3 EXISTS\r\n' + tag + ' OK [READ-ONLY] done\r\n');
        else if (/^UID SEARCH /.test(cmd)) sock.write('* SEARCH ' + mails.map((_, n) => n + 1).join(' ') + '\r\n' + tag + ' OK done\r\n');
        else if (/^UID FETCH /.test(cmd)) {
          const ids = cmd.split(' ')[2].split(',').map(Number);
          let out = '';
          ids.forEach((id) => { const body = mails[id - 1]; out += '* ' + id + ' FETCH (UID ' + id + ' BODY[]<0> {' + Buffer.byteLength(body) + '}\r\n' + body + ')\r\n'; });
          sock.write(out + tag + ' OK done\r\n');
        } else if (/^LOGOUT/.test(cmd)) { sock.write('* BYE\r\n' + tag + ' OK bye\r\n'); sock.end(); }
        else sock.write(tag + ' BAD unknown\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, cmds, port: srv.address().port })));
}
const svc = (store, port) => createGmail({ store, host: '127.0.0.1', port, secure: false, timeout: 3000 });

test('gmail: quoting refuses anything that could start a second command', () => {
  assert.strictEqual(q('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => q('x\r\nA1 DELETE INBOX'));
  assert.throws(() => q('x\0'));
  assert.throws(() => cleanEmail('a b@c.com'));
  assert.throws(() => cleanEmail('x"@y.com'));
  assert.strictEqual(cleanPassword('abcd efgh ijkl mnop'), PW);
  assert.throws(() => cleanPassword('short'));
  assert.throws(() => cleanPassword('has\x01control1234567'));
});

test('gmail: search leaves out promotions and clamps the range', () => {
  assert.match(searchQuery(30), /newer_than:30d -category:promotions -category:social/);
  assert.match(searchQuery(99999), /newer_than:365d/);
  assert.match(searchQuery('x'), /newer_than:30d/);
});

test('gmail: literals are read by length, so a body that looks like a reply cannot end it early', () => {
  const body = 'Subject: x\r\n\r\nT1 OK fake\r\n* 2 FETCH {5}\r\nabc';
  const raw = Buffer.from('* 1 FETCH (BODY[] {' + Buffer.byteLength(body) + '}\r\n' + body + ')\r\nT1 OK done\r\n');
  assert.strictEqual(literalsOf(raw)[0], body);
  assert.ok(replyEnd(raw, 'T1') === raw.length);
  assert.strictEqual(replyEnd(raw.slice(0, 20), 'T1'), -1);
});

test('gmail: connect keeps the password in the store, reports status, and disconnect removes it', async () => {
  const { srv, cmds, port } = await server([]);
  const store = fakeStore(), g = svc(store, port);
  try {
    assert.deepStrictEqual(g.status('u1'), { available: true, connected: false, email: '' });
    await assert.rejects(g.connect('u1', 'me@gmail.com', 'wrongwrongwrong1'), /app password/);
    assert.strictEqual(store.m.size, 0);
    const r = await g.connect('u1', 'me@gmail.com', PW);
    assert.deepStrictEqual(r, { connected: true, email: 'me@gmail.com' });
    assert.ok(!JSON.stringify(r).includes(PW));
    assert.ok(!JSON.stringify(g.status('u1')).includes(PW));
    assert.strictEqual(g.status('u1').connected, true);
    assert.strictEqual(g.status('u2').connected, false);
    g.disconnect('u1');
    assert.strictEqual(g.status('u1').connected, false);
    assert.ok(cmds.every((c) => /^(LOGIN|LOGOUT)/.test(c)));
  } finally { srv.close(); }
});

test('gmail: scan is read-only, peeks, takes the newest messages and returns them', async () => {
  const mails = [];
  for (let i = 0; i < 60; i++) mails.push('Subject: Receipt ' + i + '\r\n\r\nYou paid $' + i + '.00 at Test Shop\r\nT9 OK not a reply\r\n');
  const { srv, cmds, port } = await server(mails);
  const store = fakeStore(), g = svc(store, port);
  try {
    await assert.rejects(g.scan('u1', {}), /Connect Gmail first/);
    await g.connect('u1', 'me@gmail.com', PW);
    cmds.length = 0;
    const r = await g.scan('u1', { days: 7 });
    assert.strictEqual(r.found, 60);
    assert.strictEqual(r.fetched, 60);
    assert.ok(r.messages[0].startsWith('Subject: Receipt 0'));
    assert.ok(r.messages[59].includes('Receipt 59'));
    assert.ok(r.messages[3].includes('T9 OK not a reply'));
    const verbs = cmds.map((c) => c.split(' ').slice(0, 2).join(' '));
    assert.ok(verbs.every((v) => /^(LOGIN|EXAMINE INBOX|UID SEARCH|UID FETCH|LOGOUT)/.test(v)), verbs.join(','));
    assert.ok(cmds.some((c) => /^EXAMINE INBOX$/.test(c)));
    assert.ok(!cmds.some((c) => /^SELECT|STORE|EXPUNGE|DELETE|APPEND|COPY|MOVE/.test(c)));
    assert.ok(cmds.filter((c) => c.startsWith('UID FETCH')).every((c) => c.includes('BODY.PEEK[]')));
    assert.ok(cmds.some((c) => c.includes('newer_than:7d')));
  } finally { srv.close(); }
});

test('gmail: an unreachable server gives a plain message', async () => {
  const store = fakeStore();
  const g = createGmail({ store, host: '127.0.0.1', port: 1, secure: false, timeout: 1000 });
  await assert.rejects(g.connect('u1', 'me@gmail.com', PW), /Could not reach Gmail|closed/);
});
