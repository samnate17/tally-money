const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDocs, cleanName } = require('../docs');

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-docs-'));
  const opened = [];
  return { root, opened, docs: createDocs({ root, shell: { openPath: async (p) => { opened.push(p); return ''; } } }) };
}
test('docs: files are filed by kind and year, and the same file is not stored twice', () => {
  const { root, docs } = world();
  const a = docs.save('Pay statements', 'stub.pdf', Buffer.from('one'), 2026);
  assert.equal(fs.readFileSync(path.join(root, 'Pay statements', '2026', 'stub.pdf'), 'utf8'), 'one');
  assert.equal(a.duplicate, false);
  assert.equal(docs.save('Pay statements', 'stub.pdf', Buffer.from('one'), 2026).duplicate, true);
  const c = docs.save('Pay statements', 'stub.pdf', Buffer.from('two'), 2026);
  assert.equal(c.name, 'stub (2).pdf');
  const l = docs.list().find((x) => x.category === 'Pay statements');
  assert.equal(l.files.length, 2);
  assert.equal(docs.list().length, docs.CATEGORIES.length);
});
test('docs: unknown folders, odd types, huge or empty files and path tricks are refused', () => {
  const { root, docs } = world();
  assert.throws(() => docs.save('Nope', 'a.pdf', Buffer.from('x'), 2026), /Unknown folder/);
  assert.throws(() => docs.save('Other', 'a.exe', Buffer.from('x'), 2026), /cannot be stored/);
  assert.throws(() => docs.save('Other', 'a.pdf', Buffer.alloc(0), 2026), /empty/);
  assert.equal(cleanName('../../etc/passwd.pdf'), 'passwd.pdf');
  docs.save('Other', '../../escape.pdf', Buffer.from('x'), 2026);
  assert.ok(fs.existsSync(path.join(root, 'Other', '2026', 'escape.pdf')));
  assert.equal(fs.existsSync(path.join(root, '..', 'escape.pdf')), false);
});
test('docs: open and remove work only on stored files', async () => {
  const { root, docs, opened } = world();
  docs.save('Tax documents', 'w2.pdf', Buffer.from('x'), 2025);
  await docs.open('Tax documents');
  await docs.open('Tax documents', 2025, 'w2.pdf');
  assert.deepEqual(opened, [path.join(root, 'Tax documents'), path.join(root, 'Tax documents', '2025', 'w2.pdf')]);
  await assert.rejects(() => docs.open('Tax documents', 2025, 'missing.pdf'), /no longer there/);
  docs.remove('Tax documents', 2025, 'w2.pdf');
  assert.equal(docs.list().find((x) => x.category === 'Tax documents').files.length, 0);
});
