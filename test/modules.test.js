const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSecretStore } = require('../secrets');
const { createPlaid, normalizeTxn, normalizeAccount, mapCategory } = require('../plaid');
const { createAI, cleanResult, friendlyError, MODEL } = require('../ai');

// Fake safeStorage: reversible, but not plaintext.
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s).toString('base64').split('').reverse().join('')),
  decryptString: (b) => Buffer.from(b.toString().split('').reverse().join(''), 'base64').toString(),
});
const tmpStore = (available = true) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const file = path.join(dir, 'secrets.bin');
  return { file, store: createSecretStore({ file, safeStorage: fakeSafe(available) }) };
};
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('secret store encrypts at rest and refuses when unavailable', () => {
  const { file, store } = tmpStore();
  store.set('anthropicKey', 'sk-ant-SECRETVALUE1234567890');
  assert.ok(!fs.readFileSync(file).toString().includes('SECRETVALUE'));
  assert.strictEqual(store.get('anthropicKey'), 'sk-ant-SECRETVALUE1234567890');
  store.del('anthropicKey');
  assert.strictEqual(store.get('anthropicKey'), undefined);
  const bad = tmpStore(false);
  assert.throws(() => bad.store.set('x', 1), /Secure storage/);
});

test('plaid: keys validated, saved, status hides secrets', () => {
  const { store } = tmpStore();
  const p = createPlaid({ store, fetchImpl: async () => { throw new Error('no network'); } });
  assert.strictEqual(p.status().configured, false);
  assert.throws(() => p.saveKeys({ clientId: '', secret: 'x', env: 'sandbox', country: 'US' }), /both/);
  assert.throws(() => p.saveKeys({ clientId: 'a', secret: 'b', env: 'dev', country: 'US' }), /Sandbox or Production/);
  assert.throws(() => p.saveKeys({ clientId: 'a', secret: 'b', env: 'sandbox', country: 'GB' }), /US or Canada/);
  p.saveKeys({ clientId: 'cid', secret: 'sec', env: 'sandbox', country: 'US' });
  const st = p.status();
  assert.deepStrictEqual(Object.keys(st).sort(), ['configured', 'country', 'env', 'secureStorage']);
  assert.ok(!JSON.stringify(st).includes('sec"'));
});

test('plaid: link token request shape, new and update mode', async () => {
  const { store } = tmpStore();
  const calls = [];
  const p = createPlaid({ store, fetchImpl: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (url.endsWith('/link/token/create')) return jsonRes(200, { link_token: 'link-sandbox-abc' });
    if (url.endsWith('/item/public_token/exchange')) return jsonRes(200, { access_token: 'access-sandbox-1', item_id: 'item1' });
    return jsonRes(404, {});
  } });
  p.saveKeys({ clientId: 'cid', secret: 'sec', env: 'sandbox', country: 'CA' });
  assert.strictEqual(await p.createLinkToken(), 'link-sandbox-abc');
  assert.strictEqual(calls[0].url, 'https://sandbox.plaid.com/link/token/create');
  assert.strictEqual(calls[0].init.headers['PLAID-CLIENT-ID'], 'cid');
  assert.strictEqual(calls[0].init.headers['PLAID-SECRET'], 'sec');
  assert.deepStrictEqual(calls[0].body.products, ['transactions']);
  assert.deepStrictEqual(calls[0].body.country_codes, ['CA']);
  assert.ok(!('access_token' in calls[0].body));
  assert.strictEqual(await p.exchange('public-sandbox-x'), 'item1');
  await p.createLinkToken('item1');
  const upd = calls[calls.length - 1].body;
  assert.strictEqual(upd.access_token, 'access-sandbox-1');
  assert.ok(!('products' in upd));
  await assert.rejects(() => p.createLinkToken('nope'), /not linked/);
});

test('plaid: sync paginates, normalizes, skips pending/transfers, retries on mutation', async () => {
  const { store } = tmpStore();
  let page = 0, mutated = false;
  const accounts = [
    { account_id: 'a1', name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 110.5 } },
    { account_id: 'a2', name: 'Plaid Credit Card', mask: '3333', type: 'credit', subtype: 'credit card', balances: { current: 410 } },
    { account_id: 'a3', name: 'Student', mask: '', type: 'loan', subtype: 'student', balances: { current: null } },
  ];
  const tx = (id, acct, amount, name, primary, detailed, extra = {}) => ({ transaction_id: id, account_id: acct, amount, name, merchant_name: null, date: '2026-09-10', pending: false, personal_finance_category: { primary, detailed }, ...extra });
  const p = createPlaid({ store, fetchImpl: async (url, init) => {
    const b = JSON.parse(init.body);
    if (url.endsWith('/item/public_token/exchange')) return jsonRes(200, { access_token: 'tok', item_id: 'it' });
    if (url.endsWith('/transactions/sync')) {
      if (!mutated && !b.cursor) { mutated = true; page++; return jsonRes(400, { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', error_message: 'x' }); }
      if (!b.cursor) return jsonRes(200, { accounts, added: [
        tx('t1', 'a1', 12.34, 'Whole Foods', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'),
        tx('t2', 'a1', 40, 'Pending thing', 'GENERAL_MERCHANDISE', 'X', { pending: true }),
        tx('t3', 'a1', 500, 'To savings', 'TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS'),
        tx('t4', 'a1', 150, 'Card payment', 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'),
      ], modified: [], removed: [], next_cursor: 'c1', has_more: true });
      return jsonRes(200, { accounts, added: [
        tx('t5', 'a1', -2400, 'Payroll', 'INCOME', 'INCOME_WAGES'),
        tx('t6', 'a2', -150, 'Payment thank you', 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_OTHER_PAYMENT'),
        tx('t7', 'a2', -9.99, 'Refund Store', 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_OTHER'),
      ], modified: [tx('t1', 'a1', 13, 'Whole Foods', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'), tx('t8', 'a1', 3, 'Became pending', 'X', 'Y', { pending: true })],
      removed: [{ transaction_id: 'gone' }], next_cursor: 'c2', has_more: false });
    }
    return jsonRes(404, {});
  } });
  p.saveKeys({ clientId: 'c', secret: 's', env: 'sandbox', country: 'US' });
  const item = await p.exchange('pt');
  const r = await p.sync(item, '');
  assert.ok(page === 1, 'retried after mutation error');
  assert.strictEqual(r.cursor, 'c2');
  assert.deepStrictEqual(r.added.map((t) => t.plaidId), ['t1', 't5', 't7']);
  assert.strictEqual(r.added[0].amount, -12.34);
  assert.strictEqual(r.added[0].catHint, 'Groceries');
  assert.strictEqual(r.added[1].amount, 2400);
  assert.strictEqual(r.added[2].amount, 9.99); // a refund on a credit card stays
  assert.deepStrictEqual(r.modified.map((t) => t.plaidId), ['t1']);
  assert.deepStrictEqual(r.removed.sort(), ['gone', 't8']);
  assert.strictEqual(r.accounts[0].type, 'checking');
  assert.strictEqual(r.accounts[1].type, 'credit');
  assert.strictEqual(r.accounts[2].type, 'student');
  assert.strictEqual(r.accounts[2].balance, null);
  assert.strictEqual(r.accounts[0].balance, 110.5);
});

test('plaid: errors are readable and carry codes', async () => {
  const { store } = tmpStore();
  const mk = (fetchImpl) => { const p = createPlaid({ store, fetchImpl }); p.saveKeys({ clientId: 'c', secret: 's', env: 'production', country: 'US' }); return p; };
  let p = mk(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => p.createLinkToken(), /Could not reach Plaid/);
  p = mk(async () => jsonRes(400, { error_code: 'INVALID_API_KEYS', display_message: null, error_message: 'invalid client_id or secret provided' }));
  await assert.rejects(() => p.createLinkToken(), (e) => e.code === 'INVALID_API_KEYS' && /invalid client_id/.test(e.message));
  const ok = createPlaid({ store, fetchImpl: async (u, i) => (u.endsWith('/item/public_token/exchange') ? jsonRes(200, { access_token: 't', item_id: 'i' }) : jsonRes(400, { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' })) });
  ok.saveKeys({ clientId: 'c', secret: 's', env: 'production', country: 'US' });
  await ok.exchange('p');
  await assert.rejects(() => ok.sync('i', ''), (e) => e.code === 'ITEM_LOGIN_REQUIRED');
  const nr = createPlaid({ store, fetchImpl: async (u) => (u.endsWith('/item/public_token/exchange') ? jsonRes(200, { access_token: 't', item_id: 'i' }) : jsonRes(400, { error_code: 'PRODUCT_NOT_READY', error_message: 'n' })) });
  nr.saveKeys({ clientId: 'c', secret: 's', env: 'production', country: 'US' });
  await nr.exchange('p');
  await assert.rejects(() => nr.sync('i', ''), /still preparing/);
});

test('plaid: removeItem deletes the token even if Plaid is unreachable', async () => {
  const { store } = tmpStore();
  let fail = false;
  const p = createPlaid({ store, fetchImpl: async (u) => { if (fail) throw new Error('down'); return u.endsWith('/item/public_token/exchange') ? jsonRes(200, { access_token: 't', item_id: 'i' }) : jsonRes(200, {}); } });
  p.saveKeys({ clientId: 'c', secret: 's', env: 'sandbox', country: 'US' });
  await p.exchange('p');
  fail = true;
  const r = await p.removeItem('i');
  assert.strictEqual(r.remoteOk, false);
  await assert.rejects(() => p.sync('i', ''), /not linked/);
});

test('plaid: category and account mapping', () => {
  assert.strictEqual(mapCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'), 'Dining');
  assert.strictEqual(mapCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT'), 'Housing');
  assert.strictEqual(mapCategory('SOMETHING_NEW', ''), '');
  assert.strictEqual(normalizeAccount({ account_id: 'x', type: 'depository', subtype: 'money market', balances: { current: -5 } }).balance, 0);
  assert.strictEqual(normalizeTxn({ transaction_id: 'a', account_id: 'b', amount: 5, name: 'N', date: '2026-01-01', pending: false }, 'checking').amount, -5);
});

// ----- AI -----
const goodPayload = () => ({ merchants: [{ key: 'netflix', count: 12, total: -185.88 }, { key: 'whole foods', count: 20, total: -900 }], months: [] });
const aiWith = (streamImpl, key = 'sk-ant-api03-abcdefghijklmnopqrstuv') => {
  const { store } = tmpStore();
  const ai = createAI({ store, clientFactory: (k) => ({ messages: { stream: (req) => streamImpl(req, k) } }) });
  if (key) ai.saveKey(key);
  return ai;
};
const final = (msg) => ({ finalMessage: async () => msg });

test('ai: key validation and status', () => {
  const { store } = tmpStore();
  const ai = createAI({ store, clientFactory: () => ({}) });
  assert.strictEqual(ai.status().hasKey, false);
  assert.throws(() => ai.saveKey('hunter2'), /sk-ant-/);
  ai.saveKey('sk-ant-api03-abcdefghijklmnopqrstuv');
  assert.strictEqual(ai.status().hasKey, true);
  assert.strictEqual(ai.status().model, MODEL);
  assert.ok(!JSON.stringify(ai.status()).includes('abcdefgh'));
  ai.clearKey();
  assert.strictEqual(ai.status().hasKey, false);
});

test('ai: request shape and result cleaning', async () => {
  let seen;
  const ai = aiWith((req, k) => {
    seen = { req, k };
    return final({ stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: 'text', text: JSON.stringify({
      merchants: [
        { key: 'netflix', category: 'Subscriptions', subscription: 'monthly', confidence: 'high', reason: '12 charges of $15.49' },
        { key: 'whole foods', category: 'Nonsense', subscription: 'weekly', confidence: 'sure', reason: 'x'.repeat(500) },
        { key: 'invented merchant', category: 'Dining', subscription: 'none', confidence: 'low', reason: '' },
        { key: 'netflix', category: 'Other', subscription: 'none', confidence: 'low', reason: 'dup' },
      ],
      insights: ['Dining is up 20%.', '', 5, 'b', 'c', 'd', 'e', 'f', 'g'],
    }) }] });
  });
  const out = await ai.analyze(goodPayload());
  assert.strictEqual(seen.req.model, 'claude-opus-5-5');
  assert.strictEqual(seen.req.output_config.format.type, 'json_schema');
  assert.ok(seen.req.max_tokens >= 16000);
  assert.ok(!('temperature' in seen.req) && !('thinking' in seen.req) && !('tool_choice' in seen.req));
  assert.ok(/untrusted/.test(seen.req.system));
  assert.strictEqual(seen.req.messages[0].role, 'user');
  assert.deepStrictEqual(JSON.parse(seen.req.messages[0].content).merchants.length, 2);
  assert.deepStrictEqual(out.merchants.map((m) => m.key), ['netflix', 'whole foods']);
  assert.strictEqual(out.merchants[1].category, 'Other');
  assert.strictEqual(out.merchants[1].subscription, 'none');
  assert.strictEqual(out.merchants[1].confidence, 'low');
  assert.strictEqual(out.merchants[1].reason.length, 200);
  assert.strictEqual(out.insights.length, 6);
  assert.strictEqual(out.usage.input, 900);
});

test('ai: refusals, truncation, bad JSON, and API errors are readable', async () => {
  await assert.rejects(() => aiWith(() => final({ stop_reason: 'refusal', content: [] })).analyze(goodPayload()), /declined/);
  await assert.rejects(() => aiWith(() => final({ stop_reason: 'max_tokens', content: [] })).analyze(goodPayload()), /cut off/);
  await assert.rejects(() => aiWith(() => final({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })).analyze(goodPayload()), /could not read/);
  const boom = (status, message = 'm') => () => ({ finalMessage: async () => { const e = new Error(message); e.status = status; throw e; } });
  await assert.rejects(() => aiWith(boom(401)).analyze(goodPayload()), /rejected the API key/);
  await assert.rejects(() => aiWith(boom(429)).analyze(goodPayload()), /rate limiting/);
  await assert.rejects(() => aiWith(boom(529)).analyze(goodPayload()), /busy/);
  await assert.rejects(() => aiWith(boom(402)).analyze(goodPayload()), /credit/);
  await assert.rejects(() => aiWith(() => final({}), null).analyze(goodPayload()), /Add your Anthropic API key/);
  await assert.rejects(() => aiWith(() => final({})).analyze({ merchants: [] }), /no transactions/);
  const many = { merchants: Array.from({ length: 401 }, (_, i) => ({ key: 'm' + i })) };
  await assert.rejects(() => aiWith(() => final({})).analyze(many), /Too many/);
  assert.ok(/Could not reach/.test(friendlyError(new Error('fetch failed'))));
});

test('ai: statement parsing request, cleaning and errors', async () => {
  let seen;
  const ai = aiWith((req) => {
    seen = req;
    return final({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ transactions: [
      { date: '2026-09-03', description: '  WHOLE   FOODS ', amount: -86.419 },
      { date: '09/04/2026', description: 'bad date', amount: -1 },
      { date: '2026-09-05', description: '', amount: -1 },
      { date: '2026-09-06', description: 'zero', amount: 0 },
      { date: '2026-09-07', description: 'huge', amount: 1e9 },
      { date: '2026-09-08', description: 'Payroll', amount: 2400 },
    ], notes: 'signs inferred' }) }] });
  });
  const r = await ai.statement('Statement text 09/03 WHOLE FOODS 86.42', 'checking');
  assert.deepStrictEqual(r.rows.map((x) => [x.date, x.name, x.amount]), [['2026-09-03', 'WHOLE FOODS', -86.42], ['2026-09-08', 'Payroll', 2400]]);
  assert.ok(r.rows.every((x) => x.uncertain === true));
  assert.strictEqual(r.notes, 'signs inferred');
  assert.strictEqual(seen.model, 'claude-opus-5-5');
  assert.strictEqual(seen.output_config.format.type, 'json_schema');
  assert.ok(/untrusted/.test(seen.system));
  assert.deepStrictEqual(JSON.parse(seen.messages[0].content), { statementType: 'checking', text: 'Statement text 09/03 WHOLE FOODS 86.42' });
  await assert.rejects(() => ai.statement('', 'checking'), /no text/);
  await assert.rejects(() => ai.statement('x'.repeat(120001), 'checking'), /too long/);
  await assert.rejects(() => aiWith(() => final({ stop_reason: 'refusal', content: [] })).statement('abc', 'credit'), /declined/);
  await assert.rejects(() => aiWith(() => final({ stop_reason: 'max_tokens', content: [] })).statement('abc', 'credit'), /too many/);
  await assert.rejects(() => aiWith(() => final({}), null).statement('abc', 'credit'), /Add your Anthropic API key/);
});
