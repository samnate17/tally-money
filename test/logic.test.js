const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = (name) => html.split('/*' + name + '-START*/')[1].split('/*' + name + '-END*/')[0];

// A small deterministic world to run the page's pure logic against.
function world(overrides = {}) {
  const TODAY = new Date(2026, 9, 12); // Oct 12 2026
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseD = (s) => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);
  const monthKey = (s) => s.slice(0, 7);
  const shiftMonth = (k, n) => { const p = k.split('-'); const d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const normName = (n) => n.toLowerCase().replace(/[#\d*]+/g, '').replace(/\s+/g, ' ').trim();
  const guessCat = (n) => (/netflix|spotify/i.test(n) ? 'Subscriptions' : /payroll/i.test(n) ? 'Income' : /whole foods/i.test(n) ? 'Groceries' : 'Other');
  let id = 0;
  const uid = () => 'id' + ++id;
  const S = Object.assign({ txns: [], subs: [], budgets: {}, goals: [], accounts: [], extraPay: 0, plaidIgnored: [], sample: false }, overrides);
  const NOWKEY = monthKey(iso(TODAY));
  const spendBy = (mk) => { const o = {}; let t = 0; S.txns.forEach((x) => { if (monthKey(x.date) === mk && x.cat !== 'Income' && x.amount < 0) { o[x.cat] = (o[x.cat] || 0) - x.amount; t -= x.amount; } }); return { by: o, total: t }; };
  const incomeOf = (mk) => { let t = 0; S.txns.forEach((x) => { if (monthKey(x.date) === mk && x.amount > 0) t += x.amount; }); return t; };
  const isDebt = (a) => ['credit', 'student', 'auto', 'mortgage', 'loan'].includes(a.type);
  const activeSubs = () => S.subs.filter((s) => s.status !== 'cancelled');
  const nextDate = (s) => { let d = parseD(s.next); while (d < TODAY) d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()); return d; };
  const money0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const deps = { S, TODAY, iso, parseD, addDays, dayDiff, monthKey, shiftMonth, normName, guessCat, uid, NOWKEY, spendBy, incomeOf, isDebt, activeSubs, nextDate, money0 };
  const names = Object.keys(deps);
  const mk = (blk, ret) => new Function(...names, block(blk) + ';return {' + ret + '}')(...names.map((n) => deps[n]));
  return { S, deps, logic: mk('LOGIC', 'applySync,buildAiPayload,aiProposals,aiEstimate,aiKey'), afford: mk('AFFORD', 'afCtx,assessAfford') };
}

// ---------- bank sync ----------
test('applySync: creates accounts and transactions, dedupes, categorizes', () => {
  const { S, logic } = world();
  const res = { accounts: [{ accountId: 'a1', name: 'Checking', mask: '0000', type: 'checking', balance: 1000 }, { accountId: 'a2', name: 'Visa', mask: '', type: 'credit', balance: 250 }],
    added: [{ plaidId: 'p1', accountId: 'a1', date: '2026-10-01', name: 'Whole Foods', amount: -50, catHint: 'Groceries' }, { plaidId: 'p2', accountId: 'a1', date: '2026-10-02', name: 'Acme Payroll', amount: 2000, catHint: 'Income' },
      { plaidId: 'p3', accountId: 'a2', date: '2026-10-03', name: 'Netflix', amount: -15.49, catHint: 'Entertainment' }, { plaidId: 'p4', accountId: 'a2', date: '2026-10-04', name: 'Refund Target', amount: 20, catHint: '' }],
    modified: [], removed: [], cursor: 'c1' };
  const r = logic.applySync(res, 'item1');
  assert.deepStrictEqual([r.newTx, r.newAcct], [4, 2]);
  const cat = (pid) => S.txns.find((t) => t.plaidId === pid).cat;
  assert.strictEqual(cat('p1'), 'Groceries');
  assert.strictEqual(cat('p2'), 'Income');
  assert.strictEqual(cat('p3'), 'Subscriptions'); // name beats hint
  assert.strictEqual(cat('p4'), 'Other');         // refund, not income
  assert.strictEqual(S.accounts[0].name, 'Checking ••0000');
  assert.deepStrictEqual(S.accounts[0].plaid, { itemId: 'item1', accountId: 'a1' });
  // second run: same data adds nothing; changed balance updates; modified keeps user category
  S.txns.find((t) => t.plaidId === 'p1').cat = 'Dining';
  const res2 = { accounts: [{ accountId: 'a1', name: 'Checking', mask: '0000', type: 'checking', balance: 900 }], added: res.added.slice(0, 1), modified: [{ plaidId: 'p1', accountId: 'a1', date: '2026-10-01', name: 'Whole Foods', amount: -55, catHint: 'Groceries' }], removed: ['p2'], cursor: 'c2' };
  const r2 = logic.applySync(res2, 'item1');
  assert.strictEqual(r2.newTx, 0);
  assert.strictEqual(r2.delTx, 1);
  assert.strictEqual(S.txns.length, 3);
  const p1 = S.txns.find((t) => t.plaidId === 'p1');
  assert.strictEqual(p1.amount, -55);
  assert.strictEqual(p1.cat, 'Dining');
  assert.strictEqual(S.accounts[0].balance, 900);
  assert.strictEqual(S.accounts[0].history.length, 1); // same day replaced, not appended
  assert.strictEqual(S.accounts.length, 2);
});

test('applySync: ignored accounts stay deleted; null balance keeps old one; modified-unknown is added', () => {
  const { S, logic } = world({ plaidIgnored: ['a9'] });
  logic.applySync({ accounts: [{ accountId: 'a9', name: 'Old', mask: '', type: 'checking', balance: 5 }, { accountId: 'a1', name: 'Loan', mask: '', type: 'student', balance: 1000 }], added: [], modified: [{ plaidId: 'zz', accountId: 'a1', date: '2026-10-05', name: 'New thing', amount: -9, catHint: 'Shopping' }], removed: [], cursor: 'x' }, 'i');
  assert.strictEqual(S.accounts.length, 1);
  assert.strictEqual(S.txns.length, 1);
  logic.applySync({ accounts: [{ accountId: 'a1', name: 'Loan', mask: '', type: 'student', balance: null }], added: [], modified: [], removed: [], cursor: 'y' }, 'i');
  assert.strictEqual(S.accounts[0].balance, 1000);
});

// ---------- AI payload and proposals ----------
function txnsFor(S, name, cat, amount, dates) { dates.forEach((d, i) => S.txns.push({ id: name + i, date: d, name, amount, cat })); }
test('buildAiPayload groups merchants, masks digits, limits to 12 months', () => {
  const { S, logic } = world();
  txnsFor(S, 'Netflix 123456789', 'Other', -15.49, ['2026-08-03', '2026-09-03', '2026-10-03']);
  txnsFor(S, 'NETFLIX #99', 'Other', -15.49, ['2026-07-03']);
  txnsFor(S, 'Old thing', 'Other', -5, ['2025-01-01']); // outside the window
  txnsFor(S, 'Acme Payroll', 'Income', 2000, ['2026-10-01']);
  const { payload, stats } = logic.buildAiPayload();
  const keys = payload.merchants.map((m) => m.key);
  assert.deepStrictEqual(keys.sort(), ['acme payroll', 'netflix']);
  const nf = payload.merchants.find((m) => m.key === 'netflix');
  assert.strictEqual(nf.count, 4);
  assert.ok(payload.merchants.every((m) => !/\d{4,}/.test(m.name)));
  assert.strictEqual(stats.txns, 5);
  assert.strictEqual(payload.months.length, 12);
  assert.ok(!JSON.stringify(payload).includes('Old thing'));
});

test('buildAiPayload caps merchants at 400 and reports dropped', () => {
  const { S, logic } = world();
  for (let i = 0; i < 450; i++) S.txns.push({ id: 'x' + i, date: '2026-09-01', name: 'Shop ' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + String.fromCharCode(97 + Math.floor(i / 676)), amount: -(i + 1), cat: 'Other' });
  const { payload, stats } = logic.buildAiPayload();
  assert.strictEqual(payload.merchants.length, 400);
  assert.strictEqual(stats.dropped, 50);
  assert.strictEqual(payload.merchants[0].total, -450); // largest first
});

test('aiProposals: category rules, subscription candidates, cancelled detection', () => {
  const { S, logic } = world({ subs: [{ id: 's', name: 'Spotify', amount: 11.99, cycle: 'monthly', next: '2026-10-20', status: 'active' }] });
  txnsFor(S, 'Netflix', 'Other', -15.49, ['2026-08-03', '2026-09-03', '2026-10-03']);
  txnsFor(S, 'Spotify', 'Other', -11.99, ['2026-09-20']);
  txnsFor(S, 'Old Gym', 'Other', -30, ['2026-03-01', '2026-04-01', '2026-05-01']);
  txnsFor(S, 'Adobe', 'Other', -240, ['2025-10-20']);
  txnsFor(S, 'Mixed Shop', 'Other', -10, ['2026-10-01']);
  txnsFor(S, 'Mixed Shop', 'Other', 10, ['2026-10-02']);
  txnsFor(S, 'Netflix Refund', 'Other', 5, ['2026-10-02']);
  const res = { merchants: [
    { key: 'netflix', category: 'Subscriptions', subscription: 'monthly', confidence: 'high', reason: 'r' },
    { key: 'spotify', category: 'Subscriptions', subscription: 'monthly', confidence: 'high', reason: 'r' },
    { key: 'old gym', category: 'Health', subscription: 'monthly', confidence: 'medium', reason: 'r' },
    { key: 'adobe', category: 'Subscriptions', subscription: 'yearly', confidence: 'medium', reason: 'r' },
    { key: 'mixed shop', category: 'Shopping', subscription: 'none', confidence: 'low', reason: '' },
  ], insights: ['i'] };
  const p = logic.aiProposals(res);
  assert.deepStrictEqual(p.subs.map((s) => s.name), ['Netflix', 'Adobe']);  // Spotify already tracked; Adobe renews in 8 days
  assert.strictEqual(p.subs[0].next, '2026-11-03');
  assert.strictEqual(p.subs[0].amount, 15.49);
  assert.strictEqual(p.subs[1].next, '2026-10-20');
  assert.deepStrictEqual(p.ended.map((s) => s.name), ['Old Gym']); // monthly charges that stopped look cancelled
  const to = (id) => (p.changes.find((c) => c.id === id) || {}).to;
  assert.strictEqual(to('Netflix0'), 'Subscriptions');
  assert.strictEqual(to('Mixed Shop0'), 'Shopping');   // outflow takes the category
  assert.strictEqual(to('Mixed Shop1'), undefined);    // inflow is not forced into Shopping
  assert.strictEqual(p.changes.some((c) => c.to === 'Income'), false);
  assert.ok(p.merchantsChanged >= 3);
});

test('aiEstimate scales with payload size', () => {
  const { logic } = world();
  const small = logic.aiEstimate({ merchants: [{ key: 'a' }] }, { priceIn: 4, priceOut: 20 });
  const big = logic.aiEstimate({ merchants: Array.from({ length: 300 }, (_, i) => ({ key: 'merchant ' + i, dates: ['2026-01-01'], amounts: [-5] })) }, { priceIn: 4, priceOut: 20 });
  assert.ok(big.cost > small.cost && big.cost < 1);
});

// ---------- affordability ----------
function budgetWorld({ liquid = 5000, income = 4000, spend = 3000, extra = {} } = {}) {
  const w = world(extra);
  ['2026-07', '2026-08', '2026-09'].forEach((m) => {
    w.S.txns.push({ id: 'i' + m, date: m + '-01', name: 'Payroll', amount: income, cat: 'Income' });
    w.S.txns.push({ id: 's' + m, date: m + '-10', name: 'Spend', amount: -spend, cat: 'Other' });
  });
  if (liquid !== null) w.S.accounts.push({ id: 'chk', name: 'Chk', type: 'checking', balance: liquid, history: [], apr: 0, minPay: 0 });
  return w;
}
const assess = (w, inp) => w.afford.assessAfford(inp, w.afford.afCtx(inp.cat));

test('afford: context uses the last full months', () => {
  const w = budgetWorld();
  const c = w.afford.afCtx('Shopping');
  assert.strictEqual(c.months, 3);
  assert.strictEqual(c.avgIncome, 4000);
  assert.strictEqual(c.avgSpend, 3000);
  assert.strictEqual(c.liquid, 5000);
  assert.strictEqual(c.highDebt, null);
});

test('afford: one-time purchase tiers', () => {
  const w = budgetWorld({ liquid: 20000 });
  assert.strictEqual(assess(w, { type: 'once', cat: 'Shopping', amount: 500 }).level, 'good');
  const w2 = budgetWorld({ liquid: 5000 });
  assert.strictEqual(assess(w2, { type: 'once', cat: 'Shopping', amount: 500 }).level, 'warn');   // 4,500 left = 1.5 months
  const r3 = assess(w2, { type: 'once', cat: 'Shopping', amount: 2500 });
  assert.strictEqual(r3.level, 'bad');                                                             // 2,500 left < 1 month
  const r4 = assess(w2, { type: 'once', cat: 'Shopping', amount: 6000 });
  assert.strictEqual(r4.level, 'bad');
  assert.match(r4.reasons[0].t, /\$1,000 short/);
  assert.match(r3.wait, /month/);
});

test('afford: upcoming bills reduce available cash', () => {
  const w = budgetWorld({ liquid: 3500, extra: { subs: [{ id: 's', name: 'Rentish', amount: 500, cycle: 'monthly', next: '2026-10-20', status: 'active' }] } });
  const r = assess(w, { type: 'once', cat: 'Other', amount: 3100 });
  assert.strictEqual(r.level, 'bad');                // 3,500 - 500 due - 3,100 < 0
  assert.match(r.reasons[0].t, /\$500 of subscriptions/);
});

test('afford: recurring costs compare with leftover income', () => {
  const w = budgetWorld({ income: 4000, spend: 3000 });
  assert.strictEqual(assess(w, { type: 'monthly', cat: 'Entertainment', amount: 20 }).level, 'good');
  assert.strictEqual(assess(w, { type: 'monthly', cat: 'Entertainment', amount: 700 }).level, 'warn'); // keeps 300 < 10% of income
  assert.strictEqual(assess(w, { type: 'monthly', cat: 'Entertainment', amount: 1200 }).level, 'bad');
  const rich = budgetWorld({ liquid: 20000 });
  const y = assess(rich, { type: 'yearly', cat: 'Entertainment', amount: 1200 });                       // 100/mo and 1,200 upfront
  assert.strictEqual(y.level, 'good');
  assert.ok(y.stats.newSurplus === 900 && y.stats.after === 18800);
  assert.strictEqual(assess(w, { type: 'yearly', cat: 'Entertainment', amount: 1200 }).level, 'warn'); // only 1.3 months of cushion left
});

test('afford: budget, high-interest debt and missing data', () => {
  const w = budgetWorld({ liquid: 20000, extra: { budgets: { Dining: 300 }, accounts: [{ id: 'cc', name: 'Visa', type: 'credit', balance: 4000, apr: 24, minPay: 100, history: [] }] } });
  w.S.txns.push({ id: 'd', date: '2026-10-05', name: 'Dinner', amount: -250, cat: 'Dining' });
  const r = assess(w, { type: 'once', cat: 'Dining', amount: 200 });
  assert.strictEqual(r.level, 'warn');
  assert.ok(r.reasons.some((x) => /Dining budget/.test(x.t)));
  assert.ok(r.reasons.some((x) => /24%/.test(x.t)));
  const empty = world();
  const none = empty.afford.assessAfford({ type: 'once', cat: 'Other', amount: 100 }, empty.afford.afCtx('Other'));
  assert.strictEqual(none.level, 'warn');
  const noAcct = budgetWorld({ liquid: null });
  const na = assess(noAcct, { type: 'once', cat: 'Other', amount: 500 });
  assert.ok(na.reasons.some((x) => /Add your checking and savings/.test(x.t)));
  assert.strictEqual(na.level, 'good'); // 500 <= 1,000 monthly surplus
});
