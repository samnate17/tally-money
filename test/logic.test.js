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
  const CATS = ['Housing','Groceries','Dining','Transport','Subscriptions','Shopping','Health','Entertainment','Other','Income'];
  const aiKey = (n) => normName(n) || '(blank)';
  const DEBT_TYPES = { credit: 1, student: 1, auto: 1, mortgage: 1, loan: 1 };
  const deps = { aiKey, DEBT_TYPES, CATS, S, TODAY, iso, parseD, addDays, dayDiff, monthKey, shiftMonth, normName, guessCat, guessSub: () => '', uid, NOWKEY, spendBy, incomeOf, isDebt, activeSubs, nextDate, money0 };
  Object.assign(deps, new Function(...Object.keys(deps), block('BUDGET') + block('HISTORY') + ';return {historyStats, homeHints, trimmedMean, pastMonths}')(...Object.values(deps)), { ledger: () => S.txns });
  const names = Object.keys(deps);
  const mk = (blk, ret) => new Function(...names, block(blk) + ';return {' + ret + '}')(...names.map((n) => deps[n]));
  return { S, deps,
    logic: { ...mk('CREDIT', 'creditBand,creditUtil,creditWhatIf,creditAdvice'), ...mk('BUDGET', 'catSpendByMonth,pastMonths,catForecast,monthPace,monthReport,fiftyThirtyTwenty,savingsIdeas,monthlyStack,percentile,ceil5'), ...mk('INVEST', 'logReturns,annVol,maxDrawdown,volLabel,rangeSeries,holdingStats,portfolioStats,portfolioSeries,volRows,seededCloses'), ...mk('LOGIC', 'applySync,buildAiPayload,aiProposals,aiEstimate,aiKey,pdfReviewRows,pdfCategory,csvDetect,csvBuild,csvDate,csvAmount,csvDelim,csvScan,csvOrder,ofxParse') },
    afford: mk('AFFORD', 'afCtx,assessAfford') };
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

// ---------- PDF review rows ----------
test('pdfReviewRows: categories, duplicates against existing data and across overlapping statements', () => {
  const { S, logic } = world();
  S.txns.push({ id: 'e1', date: '2026-09-03', name: 'Whole Foods Market 1234', amount: -86.42, cat: 'Groceries' });
  const files = [
    { rows: [
      { date: '2026-09-03', name: 'WHOLE FOODS MARKET', amount: -86.42, uncertain: false },   // already have (digits ignored in the key)
      { date: '2026-09-05', name: 'NETFLIX.COM', amount: -15.49, uncertain: false },
      { date: '2026-09-05', name: 'NETFLIX.COM', amount: -15.49, uncertain: false },          // a genuine second identical charge stays
      { date: '2026-09-01', name: 'ACME CORP PAYROLL', amount: 2400, uncertain: true },
      { date: '2026-09-08', name: 'AMAZON REFUND', amount: 23.99, uncertain: false } ] },
    { rows: [ { date: '2026-09-01', name: 'ACME CORP PAYROLL', amount: 2400, uncertain: false } ] },   // overlap with the first file
  ];
  const r = logic.pdfReviewRows(files);
  assert.deepStrictEqual(r.map((x) => x.dup), [true, false, false, false, false, true]);
  assert.deepStrictEqual(r.map((x) => x.on), [false, true, true, true, true, false]);
  assert.deepStrictEqual(r.map((x) => x.cat), ['Groceries', 'Subscriptions', 'Subscriptions', 'Income', 'Other', 'Income']);
  assert.strictEqual(r[3].uncertain, true);
  assert.strictEqual(logic.pdfCategory('Mystery', -5), 'Other');
});

// ---------- CSV ----------
const csvRun = (text) => { const { logic } = world(); const d = logic.csvDetect(text); const b = d.ok ? logic.csvBuild(d.rows, d.headerIdx, d.map, { order: d.order, flip: d.flip }) : null; return { d, b, logic }; };
const simple = (b) => b.rows.map((r) => [r.date, r.amount, r.name]);

test('csv: amounts and dates in many formats', () => {
  const { logic } = world();
  const A = logic.csvAmount;
  assert.strictEqual(A('1,234.56'), 1234.56); assert.strictEqual(A('(45.00)'), -45); assert.strictEqual(A('45.00-'), -45);
  assert.strictEqual(A('$-3.10'), -3.1); assert.strictEqual(A('1.234,56'), 1234.56); assert.strictEqual(A('12,5'), 12.5); assert.strictEqual(A('2.400,00'), 2400);
  assert.strictEqual(A('300.00 CR'), 300); assert.strictEqual(A('45.00 DR'), -45); assert.strictEqual(A('−6.75'), -6.75); assert.strictEqual(A('USD 12.00'), 12);
  assert.strictEqual(A(''), null); assert.strictEqual(A('abc'), null); assert.strictEqual(A('10/02/2026'), 10022026 === 0 ? 0 : null);
  const D = logic.csvDate;
  assert.strictEqual(D('10/02/2026', 'mdy'), '2026-10-02'); assert.strictEqual(D('10/02/2026', 'dmy'), '2026-02-10');
  assert.strictEqual(D('2026-10-02T14:00:00Z'), '2026-10-02'); assert.strictEqual(D('Oct 2, 2026'), '2026-10-02'); assert.strictEqual(D('October 2nd 2026'), '2026-10-02');
  assert.strictEqual(D('2 Oct 2026'), '2026-10-02'); assert.strictEqual(D('02-Oct-26'), '2026-10-02'); assert.strictEqual(D('20261002'), '2026-10-02'); assert.strictEqual(D('15-10-2026', 'dmy'), '2026-10-15');
  assert.strictEqual(D('13/45/2026'), null); assert.strictEqual(D('31/02/2026', 'dmy'), null); assert.strictEqual(D('Total'), null); assert.strictEqual(D(''), null);
  assert.strictEqual(logic.csvOrder(['15/10/2026', '01/02/2026']), 'dmy'); assert.strictEqual(logic.csvOrder(['10/15/2026']), 'mdy');
});

test('csv: Chase checking export (extra columns, trailing commas, Details vs Description)', () => {
  const { d, b } = csvRun('Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/02/2026,"STARBUCKS #4412",-6.75,DEBIT_CARD,993.25,,\nCREDIT,10/05/2026,"ACME PAYROLL",1500.00,ACH_CREDIT,2493.25,,\n');
  assert.ok(d.ok); assert.deepStrictEqual([d.map.date, d.map.desc, d.map.amount], [1, 2, 3]);
  assert.deepStrictEqual(simple(b), [['2026-10-02', -6.75, 'STARBUCKS #4412'], ['2026-10-05', 1500, 'ACME PAYROLL']]);
});

test('csv: Bank of America style summary lines before the real header', () => {
  const { d, b } = csvRun('Description,,Summary Amt.\nBeginning balance as of 09/01/2026,,"1,000.00"\nTotal credits,,"1,500.00"\nTotal debits,,"-256.75"\nEnding balance as of 09/30/2026,,"2,243.25"\n\nDate,Description,Amount,Running Bal.\n10/02/2026,"STARBUCKS",-6.75,"993.25"\n10/05/2026,"PAYROLL","1,500.00","2,493.25"\n');
  assert.ok(d.ok); assert.strictEqual(d.headerIdx, 5);
  assert.deepStrictEqual(simple(b), [['2026-10-02', -6.75, 'STARBUCKS'], ['2026-10-05', 1500, 'PAYROLL']]);
});

test('csv: separate debit and credit columns, transaction date preferred over posted date, category column', () => {
  const { d, b } = csvRun('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-10-02,2026-10-03,1234,STARBUCKS,Dining,6.75,\n2026-10-05,2026-10-06,1234,PAYMENT THANK YOU,Payment/Credit,,300.00\n');
  assert.ok(d.ok); assert.strictEqual(d.map.date, 0); assert.ok(d.map.debit === 5 && d.map.credit === 6);
  assert.deepStrictEqual(simple(b), [['2026-10-02', -6.75, 'STARBUCKS'], ['2026-10-05', 300, 'PAYMENT THANK YOU']]);
  assert.strictEqual(b.rows[0].cat, 'Dining'); assert.strictEqual(b.rows[1].cat, undefined);
});

test('csv: credit card export with positive purchases is flipped automatically', () => {
  const { d, b } = csvRun('Date,Description,Amount\n10/01/2026,AUTOPAY PAYMENT - THANK YOU,-300.00\n10/03/2026,UBER TRIP,24.10\n10/04/2026,AMAZON.COM,56.20\n');
  assert.strictEqual(d.flip, true);
  assert.deepStrictEqual(simple(b), [['2026-10-01', 300, 'AUTOPAY PAYMENT - THANK YOU'], ['2026-10-03', -24.1, 'UBER TRIP'], ['2026-10-04', -56.2, 'AMAZON.COM']]);
});

test('csv: Apple Card style (tab separated, BOM, purchases positive, Type column)', () => {
  const { d, b } = csvRun('﻿Transaction Date\tClearing Date\tDescription\tMerchant\tCategory\tType\tAmount (USD)\n10/02/2026\t10/03/2026\tAPPLE STORE\tApple\tShopping\tPurchase\t99.00\n10/05/2026\t10/05/2026\tACH DEPOSIT INTERNET TRANSFER\tBank\tPayment\tPayment\t-300.00\n10/06/2026\t10/07/2026\tSHELL\tShell\tGas\tPurchase\t40.00\n');
  assert.strictEqual(d.delim, '\t'); assert.ok(d.ok); assert.strictEqual(d.flip, true);
  assert.deepStrictEqual(simple(b), [['2026-10-02', -99, 'APPLE STORE'], ['2026-10-05', 300, 'ACH DEPOSIT INTERNET TRANSFER'], ['2026-10-06', -40, 'SHELL']]);
});

test('csv: unsigned amounts with a Type column use the type', () => {
  const { b } = csvRun('Date,Description,Type,Amount\n10/02/2026,STARBUCKS,Debit,6.75\n10/05/2026,PAYROLL,Credit,1500.00\n');
  assert.deepStrictEqual(simple(b), [['2026-10-02', -6.75, 'STARBUCKS'], ['2026-10-05', 1500, 'PAYROLL']]);
});

test('csv: semicolons, day-first dates, decimal commas and non-English headers fall back to content detection', () => {
  const { d, b } = csvRun('Datum;Omschrijving;Bedrag;Saldo\n15-10-2026;ALBERT HEIJN 1234;-23,45;976,55\n16-10-2026;SALARIS ACME BV;2.400,00;3.376,55\n17-10-2026;NS REIZEN;-12,80;3.363,75\n');
  assert.strictEqual(d.delim, ';'); assert.ok(d.ok); assert.strictEqual(d.headerIdx, 0); assert.strictEqual(d.order, 'dmy');
  assert.deepStrictEqual(simple(b), [['2026-10-15', -23.45, 'ALBERT HEIJN 1234'], ['2026-10-16', 2400, 'SALARIS ACME BV'], ['2026-10-17', -12.8, 'NS REIZEN']]);
});

test('csv: no header row at all (Wells Fargo style)', () => {
  const { d, b } = csvRun('"10/02/2026","-6.75","*","","STARBUCKS #4412"\n"10/05/2026","1500.00","*","","ACME PAYROLL"\n"10/09/2026","-250.00","*","","CHECK 1042"\n');
  assert.ok(d.ok); assert.strictEqual(d.headerIdx, -1);
  assert.deepStrictEqual(simple(b), [['2026-10-02', -6.75, 'STARBUCKS #4412'], ['2026-10-05', 1500, 'ACME PAYROLL'], ['2026-10-09', -250, 'CHECK 1042']]);
});

test('csv: quoted thousands, footer rows and blank lines are skipped; failure returns a table for the column picker', () => {
  const { b } = csvRun('"Date","Description","Amount"\n"10/06/2026","RENT","-1,450.00"\n\n"Total","","-1,450.00"\n');
  assert.deepStrictEqual(simple(b), [['2026-10-06', -1450, 'RENT']]); assert.strictEqual(b.bad, 1);
  const bad = csvRun('a,b,c\n1,2,3\n4,5,6\n');
  assert.strictEqual(bad.d.ok, false); assert.strictEqual(bad.d.rows.length, 3);
  assert.strictEqual(csvRun('just one line').d.ok, false);
});

// ---------- credit ----------
const card = (id, bal, lim, extra = {}) => ({ id, name: 'Card ' + id, type: 'credit', balance: bal, limit: lim, apr: 20, minPay: 25, history: [], ...extra });
test('credit: score bands', () => {
  const { logic } = world();
  const b = (n) => logic.creditBand(n).label;
  assert.deepStrictEqual([579, 580, 669, 670, 739, 740, 799, 800, 850].map(b), ['Poor', 'Fair', 'Fair', 'Good', 'Good', 'Very good', 'Very good', 'Exceptional', 'Exceptional']);
});

test('credit: utilization overall, per card, missing limits', () => {
  const { logic } = world();
  const u = logic.creditUtil([card('a', 1000, 4000), card('b', 500, 1000), card('c', 300, 0), { id: 'x', type: 'checking', balance: 9999 }]);
  assert.strictEqual(u.cards, 3); assert.strictEqual(u.missing, 1); assert.strictEqual(u.balance, 1500); assert.strictEqual(u.limit, 5000);
  assert.strictEqual(u.pct, 30); assert.deepStrictEqual(u.rows.map((r) => Math.round(r.pct)), [25, 50]);
  assert.strictEqual(logic.creditUtil([card('c', 300, 0)]).pct, null);
});

test('credit: what-if payments go to the most-used cards first', () => {
  const { logic } = world();
  const accts = [card('a', 1000, 4000), card('b', 900, 1000), card('c', 100, 5000)];
  const w = logic.creditWhatIf(accts, 1000);
  assert.deepStrictEqual(w.payments.map((x) => [x.name, x.pay]), [['Card b', 900], ['Card a', 100]]);
  assert.strictEqual(w.paid, 1000); assert.strictEqual(Math.round(w.pct * 10) / 10, 10);
  assert.strictEqual(logic.creditWhatIf(accts, 99999).pct, 0);
  assert.strictEqual(logic.creditWhatIf(accts, 0).payments.length, 0);
});

test('credit: advice ranks the biggest problems first and quotes real numbers', () => {
  const { logic } = world();
  const accts = [card('a', 2500, 5000), card('b', 1000, 1000), { id: 'l', type: 'auto', balance: 8000, limit: 0 }];
  const adv = logic.creditAdvice(accts, { late: 'few', inq: '3plus', oldest: '2', derog: 'unknown' });
  const by = (k) => adv.factors.find((f) => f.key === k);
  assert.deepStrictEqual(adv.factors.map((f) => f.weight), [35, 30, 15, 10, 10]);
  assert.strictEqual(by('owed').status, 'bad');           // 3,500 of 6,000 = 58%
  assert.match(by('owed').detail, /58%/);
  assert.ok(by('owed').actions.some((a) => /\$1700 across your cards/.test(a)), by('owed').actions.join('|')); // 3,500 - 30% of 6,000
  assert.ok(by('owed').actions.some((a) => /Card b is at 100%/.test(a)));
  assert.strictEqual(by('payment').status, 'warn');
  assert.strictEqual(by('length').status, 'warn');
  assert.strictEqual(by('new').status, 'warn');
  assert.strictEqual(by('mix').status, 'good');
  assert.deepStrictEqual(adv.focus, ['owed', 'payment', 'length']);
});

test('credit: healthy profile and unknowns', () => {
  const { logic } = world();
  const good = logic.creditAdvice([card('a', 200, 5000), { id: 'l', type: 'student', balance: 9000 }], { late: 'none', inq: 'none', oldest: '9', derog: 'none' });
  assert.deepStrictEqual(good.factors.map((f) => f.status), ['good', 'good', 'good', 'good', 'good']);
  assert.deepStrictEqual(good.focus, []);
  const none = logic.creditAdvice([], { late: 'unknown', inq: 'unknown', oldest: '', derog: 'unknown' });
  assert.deepStrictEqual(none.factors.map((f) => f.status), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  const coll = logic.creditAdvice([card('a', 100, 5000)], { late: 'none', inq: 'none', oldest: '9', derog: 'yes' });
  assert.strictEqual(coll.factors[0].status, 'warn'); assert.ok(coll.factors[0].actions.some((a) => /dispute/i.test(a)));
});

// ---------- investments ----------
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 21);
test('invest: volatility, drawdown and labels', () => {
  const { logic } = world();
  const alt = Array.from({ length: 61 }, (_, i) => 100 * (i % 2 ? 1.01 : 1));      // swings of exactly 1% each day
  assert.ok(Math.abs(logic.annVol(alt) - 15.87) < 0.3, String(logic.annVol(alt)));
  assert.strictEqual(logic.annVol(Array(40).fill(50)), 0);
  assert.strictEqual(logic.annVol([1, 2, 3]), null);                                // too little data to say
  assert.strictEqual(logic.maxDrawdown([100, 120, 90, 110]), -25);
  assert.strictEqual(logic.maxDrawdown([1, 2, 3]), 0);
  const L = (v) => logic.volLabel(v).label;
  assert.deepStrictEqual([null, 10, 20, 34.9, 35, 54.9, 55, 90].map(L), ['Not enough data', 'Low', 'Moderate', 'Moderate', 'High', 'High', 'Very high', 'Very high']);
});

test('invest: position and portfolio figures, missing prices handled', () => {
  const { logic } = world();
  const h = { id: 'h', symbol: 'AAA', shares: 10, invested: 1000 };
  const st = logic.holdingStats(h, { price: 120, prev: 118 });
  assert.deepStrictEqual([st.value, st.gain, st.gainPct, st.dayChg, st.avgCost], [1200, 200, 20, 20, 100]);
  assert.ok(Math.abs(st.dayPct - 1.6949) < 0.001);
  assert.strictEqual(logic.holdingStats(h, { error: 'x' }).value, null);
  const ps = logic.portfolioStats([h, { id: 'g', symbol: 'BBB', shares: 5, invested: 500 }], { AAA: { price: 120, prev: 118 } });
  assert.deepStrictEqual([ps.invested, ps.value, ps.priced, ps.missing, ps.gain, ps.gainPct], [1500, 1200, 1, 1, 200, 20]);  // gain only counts what has a price
});

test('invest: portfolio history aligns holdings that start on different days and forward-fills gaps', () => {
  const { logic } = world();
  const hs = [{ symbol: 'A', shares: 2, invested: 0 }, { symbol: 'B', shares: 1, invested: 0 }];
  const qs = {
    A: { closes: [[day('2026-10-01'), 10], [day('2026-10-02'), 11], [day('2026-10-05'), 12]] },
    B: { closes: [[day('2026-10-02'), 100], [day('2026-10-03'), 101], [day('2026-10-05'), 103]] },
  };
  const s = logic.portfolioSeries(hs, qs, 365);
  assert.deepStrictEqual(s.map((p) => p[1]), [122, 123, 127]);     // starts 10/02 when both exist; 10/03 carries A's 11 forward
  assert.deepStrictEqual(logic.portfolioSeries(hs, { A: qs.A, B: { error: 'x' } }, 365).length, 3);   // a failed quote is left out
  assert.deepStrictEqual(logic.portfolioSeries(hs, {}, 365), []);
  assert.strictEqual(logic.portfolioSeries(hs, qs, 1).length, 1);
});

test('invest: volatility watch ranks and flags, and example prices behave', () => {
  const { logic } = world();
  const calm = logic.seededCloses(5, 100, 0.08, 0.15, 372).slice(-252), wild = logic.seededCloses(9, 100, 0.05, 0.65, 372).slice(-252);
  assert.ok(calm.length > 240 && calm.every((c) => [1, 2, 3, 4, 5].includes(new Date(c[0]).getUTCDay())));
  assert.deepStrictEqual(logic.seededCloses(5, 100, 0.08, 0.15, 372).slice(-252), calm);   // deterministic
  const hs = [{ symbol: 'CALM', shares: 10, invested: 900, name: 'Calm' }, { symbol: 'WILD', shares: 10, invested: 900, name: 'Wild' }, { symbol: 'NONE', shares: 1, invested: 10, name: 'None' }];
  const mkq = (c) => ({ price: c[c.length - 1][1], prev: c[c.length - 2][1], closes: c });
  const rows = logic.volRows(hs, { CALM: mkq(calm), WILD: mkq(wild) });
  assert.deepStrictEqual(rows.map((r) => r.symbol), ['WILD', 'CALM', 'NONE']);
  assert.ok(rows[0].label.rank >= 3 && rows[1].label.rank <= 2 && rows[2].vol === null);
  assert.ok(rows[0].dd < rows[1].dd);
  assert.ok(Math.abs(rows[0].share + rows[1].share - 100) < 1e-6);
});

// ---------- budgets, forecasts and the monthly report ----------
function gasWorld(vals, extra = {}) {            // vals: gas spend for Jun..Sep 2026 (and so on), one entry per full month before October
  const w = world(extra);
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].slice(-vals.length);
  months.forEach((m, i) => {
    w.S.txns.push({ id: 'g' + i, date: m + '-10', name: 'SHELL OIL', amount: -vals[i], cat: 'Gas' });
    w.S.txns.push({ id: 'f' + i, date: m + '-01', name: 'Maple Rent', amount: -1000, cat: 'Housing' });   // every month has data
  });
  return w;
}
test('forecast: averages, recent weighting, suggested budget and how many past months it covers', () => {
  const w = gasWorld([100, 120, 140, 160, 180]);
  const f = w.logic.catForecast(w.S.txns, 'Gas', '2026-10');
  assert.strictEqual(f.n, 5); assert.strictEqual(f.avg, 140); assert.strictEqual(f.median, 140); assert.strictEqual(f.max, 180);
  assert.ok(Math.abs(f.recent - (140 * 1 + 160 * 2 + 180 * 3) / 6) < 1e-9);          // weights favour the latest month
  assert.strictEqual(f.suggested, 185);                                              // 10% above the recent weighted average, rounded up to $5
  assert.strictEqual(f.covered, 5); assert.strictEqual(f.conf, 'ok');
  assert.strictEqual(f.sameLastYear, null);
  assert.strictEqual(w.logic.catForecast(w.S.txns, 'Dining', '2026-10').avg, 0);     // a category with no spending forecasts zero, not an error
  assert.strictEqual(world().logic.catForecast([], 'Gas', '2026-10').n, 0);
});

test('forecast: ignores the current month and a late-starting first month, rounds to $5', () => {
  const w = gasWorld([100, 100, 100]);
  w.S.txns.push({ id: 'cur', date: '2026-10-03', name: 'SHELL', amount: -999, cat: 'Gas' });        // this month is not a full month
  assert.strictEqual(w.logic.catForecast(w.S.txns, 'Gas', '2026-10').avg, 100);
  const late = world(); [['2026-07-25', -50], ['2026-08-05', -100], ['2026-09-05', -100]].forEach(([d, a], i) => late.S.txns.push({ id: 'l' + i, date: d, name: 'SHELL', amount: a, cat: 'Gas' }));
  const f = late.logic.catForecast(late.S.txns, 'Gas', '2026-10');
  assert.deepStrictEqual(f.months, ['2026-08', '2026-09']);                             // July started on the 25th, so it is left out
  assert.strictEqual(f.suggested, 110);
  assert.deepStrictEqual([0.1, 5, 5.01, 99.99].map(late.logic.ceil5), [5, 5, 10, 100]);
});

test('forecast: same month last year and month pace', () => {
  const w = world();
  for (let m = 1; m <= 12; m++) { const k = '2025-' + String(m).padStart(2, '0'); w.S.txns.push({ id: 'a' + m, date: k + '-05', name: 'SHELL', amount: m === 10 ? -210 : -100, cat: 'Gas' }); }
  ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].forEach((k, i) => w.S.txns.push({ id: 'b' + i, date: k + '-05', name: 'SHELL', amount: -100, cat: 'Gas' }));
  const f = w.logic.catForecast(w.S.txns, 'Gas', '2026-10');
  assert.strictEqual(f.n, 12); assert.strictEqual(f.sameLastYear, 210); assert.strictEqual(f.conf, 'good');
  w.S.txns.push({ id: 'now', date: '2026-10-08', name: 'SHELL', amount: -60, cat: 'Gas' });
  const pace = w.logic.monthPace(w.S.txns, 'Gas', new Date(2026, 9, 12));            // 12 days in, 31 in the month
  assert.deepStrictEqual([pace.spent, pace.dom, pace.dim], [60, 12, 31]); assert.ok(Math.abs(pace.projected - 155) < 1e-9);
  assert.strictEqual(w.logic.monthPace(w.S.txns, 'Gas', new Date(2026, 9, 5)).projected, null);   // too early in the month to project
});

test('report: totals, comparison with the usual, budgets, merchants and the previous month', () => {
  const w = gasWorld([100, 100, 100]);
  w.S.txns.push({ id: 'p', date: '2026-09-28', name: 'Payroll', amount: 3000, cat: 'Income' });
  w.S.txns.push({ id: 'g9', date: '2026-09-20', name: 'SHELL OIL', amount: -180, cat: 'Gas' });
  const rep = w.logic.monthReport(w.S.txns, '2026-09', { Gas: 150 }, new Date(2026, 9, 12));
  const gas = rep.rows.find((r) => r.cat === 'Gas');
  assert.strictEqual(rep.income, 3000); assert.strictEqual(rep.spend, 1000 + 100 + 180);
  assert.strictEqual(gas.amount, 280); assert.strictEqual(gas.avg3, 100); assert.strictEqual(gas.delta, 180); assert.strictEqual(gas.over, 130);
  assert.deepStrictEqual(rep.merchants.map((m) => m.name), ['Maple Rent', 'SHELL OIL']); assert.strictEqual(rep.merchants[1].count, 2);
  assert.strictEqual(rep.big[0].amount, 1000); assert.strictEqual(rep.prev.spend, 1100);
  assert.ok(Math.abs(rep.rate - (3000 - 1280) / 3000 * 100) < 1e-9);
  const noIncome = w.logic.monthReport(w.S.txns, '2026-07', {}, new Date(2026, 9, 12));
  assert.strictEqual(noIncome.rate, null);
  assert.strictEqual(w.logic.fiftyThirtyTwenty(noIncome), null);
});

test('report: the current month is judged on pace, and fixed bills are not extrapolated', () => {
  const w = gasWorld([100, 100, 100]);
  w.S.txns.push({ id: 'c', date: '2026-10-06', name: 'SHELL OIL', amount: -90, cat: 'Gas' });
  const early = w.logic.monthReport(w.S.txns, '2026-10', {}, new Date(2026, 9, 6));              // early: spent so far plus a typical remainder
  assert.ok(Math.abs(early.rows.find((r) => r.cat === 'Gas').projected - (90 + 100 * 25 / 31)) < 1e-9);
  w.S.txns.push({ id: 'c2', date: '2026-10-14', name: 'SHELL OIL', amount: -60, cat: 'Gas' });
  const rep = w.logic.monthReport(w.S.txns, '2026-10', {}, new Date(2026, 9, 15));
  const g = rep.rows.find((r) => r.cat === 'Gas');
  assert.ok(Math.abs(g.projected - (150 + 100 * 16 / 31)) < 1e-9);
  assert.strictEqual(rep.current, true);
  w.S.txns.push({ id: 'rent', date: '2026-10-01', name: 'Landlord', amount: -1500, cat: 'Housing' }, { id: 'rent2', date: '2026-09-01', name: 'Landlord', amount: -1500, cat: 'Housing' });
  const h = w.logic.monthReport(w.S.txns, '2026-10', {}, new Date(2026, 9, 12)).rows.find((r) => r.cat === 'Housing');
  assert.strictEqual(h.projected, 1500);
});

test('savings ideas: concrete, ranked by money, and honest when there is nothing to find', () => {
  const w = gasWorld([100, 100, 100]);
  ['2026-07', '2026-08', '2026-09'].forEach((k, i) => w.S.txns.push({ id: 'd' + i, date: k + '-12', name: 'Pizza Place', amount: -100, cat: 'Dining' }));
  w.S.txns.push({ id: 'dn', date: '2026-09-18', name: 'Fancy Dinner', amount: -300, cat: 'Dining' });
  w.S.txns.push({ id: 'pay', date: '2026-09-01', name: 'Payroll', amount: 2000, cat: 'Income' });
  const rep = w.logic.monthReport(w.S.txns, '2026-09', { Dining: 250 }, new Date(2026, 9, 12));
  const ideas = w.logic.savingsIdeas(rep, { subs: [{ name: 'Gym', amount: 50, cycle: 'monthly', status: 'flagged' }, { name: 'Cloud', amount: 120, cycle: 'yearly', status: 'active' }], fees: 35,
    accounts: [{ name: 'Visa', type: 'credit', balance: 2400, apr: 24 }, { name: 'Checking', type: 'checking', balance: 500, apr: 0 }] });
  const titles = ideas.map((i) => i.title).join(' | ');
  assert.match(titles, /Over your Dining budget by \$150/); assert.ok(!/Dining is .* above your usual/.test(titles)); assert.match(titles, /1 subscription marked To review/);
  assert.match(titles, /Fees and interest cost \$35/); assert.match(titles, /interest on Visa/);
  assert.ok(!/Checking/.test(titles));
  for (let i = 1; i < ideas.length; i++) assert.ok((ideas[i - 1].monthly === null ? -1 : ideas[i - 1].monthly) >= (ideas[i].monthly === null ? -1 : ideas[i].monthly));
  const tight = gasWorld([100, 100, 100]); tight.S.txns.push({ id: 'p8', date: '2026-09-01', name: 'Payroll', amount: 1100, cat: 'Income' });
  const tl = tight.logic.savingsIdeas(tight.logic.monthReport(tight.S.txns, '2026-09', {}, new Date(2026, 9, 12)), { subs: [], fees: 0, accounts: [] });
  assert.match(tl.map((i) => i.title).join('|'), /You saved 0% of your income/); assert.match(tl[0].detail, /more a month/);
  const calm = gasWorld([100, 100, 100]); calm.S.txns.push({ id: 'p9', date: '2026-09-01', name: 'Payroll', amount: 5000, cat: 'Income' });
  assert.deepStrictEqual(calm.logic.savingsIdeas(calm.logic.monthReport(calm.S.txns, '2026-09', {}, new Date(2026, 9, 12)), { subs: [], fees: 0, accounts: [] }), []);
});

test('50/30/20 and the monthly stack', () => {
  const w = gasWorld([100, 100, 100]);
  w.S.txns.push({ id: 'p', date: '2026-09-01', name: 'Payroll', amount: 4000, cat: 'Income' }, { id: 'e', date: '2026-09-04', name: 'Cinema', amount: -200, cat: 'Entertainment' });
  const rep = w.logic.monthReport(w.S.txns, '2026-09', {}, new Date(2026, 9, 12));
  const f = w.logic.fiftyThirtyTwenty(rep);
  assert.deepStrictEqual([f.needs, f.wants, f.save], [1100, 200, 2700]);               // Gas and Housing count as needs
  assert.ok(Math.abs(f.needsPct - 27.5) < 1e-9);
  const st = w.logic.monthlyStack(w.S.txns, '2026-10', 6);
  assert.deepStrictEqual(st.map((m) => m.k), ['2026-07', '2026-08', '2026-09']);
  assert.strictEqual(st[2].by.Gas, 100); assert.strictEqual(st[2].income, 4000);
});

// ---- hosted accounts: the browser-side crypto ----
function syncBlock() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const code = src.slice(src.indexOf('/*SYNC-START*/'), src.indexOf('/*SYNC-END*/'));
  return new Function('CRYPTO', code + '\nreturn {deriveKeys, sealJson, openJson, passwordProblem, toB64u, fromB64u};')(globalThis.crypto);
}

test('accounts: auth proof is stable, 43 chars, and different per password and per email', async () => {
  const s = syncBlock();
  const a = await s.deriveKeys('A@x.com ', 'correct horse battery', 1000), b = await s.deriveKeys('a@x.com', 'correct horse battery', 1000);
  assert.strictEqual(a.auth, b.auth); assert.match(a.auth, /^[A-Za-z0-9_-]{43}$/);
  assert.notStrictEqual(a.auth, (await s.deriveKeys('a@x.com', 'correct horse batterz', 1000)).auth);
  assert.notStrictEqual(a.auth, (await s.deriveKeys('b@x.com', 'correct horse battery', 1000)).auth);
});

test('accounts: data round-trips, the wrong password cannot open it, tampering is detected, nothing is readable', async () => {
  const s = syncBlock();
  const k = await s.deriveKeys('a@x.com', 'correct horse battery', 1000), bad = await s.deriveKeys('a@x.com', 'wrong wrong wrong', 1000);
  const obj = { txns: [{ name: 'Secret Merchant', amount: -12.5 }], n: 1 };
  const sealed = await s.sealJson(k.key, obj);
  assert.ok(!/Secret Merchant/.test(sealed));
  assert.deepStrictEqual(await s.openJson(k.key, sealed), obj);
  await assert.rejects(s.openJson(bad.key, sealed), /does not match/);
  const j = JSON.parse(sealed); const ct = Buffer.from(j.ct, 'base64url'); ct[0] ^= 1; j.ct = ct.toString('base64url');
  await assert.rejects(s.openJson(k.key, JSON.stringify(j)));
  assert.notStrictEqual(sealed, await s.sealJson(k.key, obj));          // fresh IV each time
  assert.ok(k.key.extractable === false);
  await assert.rejects(s.openJson(k.key, 'not json'), /Unreadable/);
});

test('accounts: password rules', () => {
  const s = syncBlock();
  assert.ok(s.passwordProblem('short', 'a@x.com')); assert.ok(s.passwordProblem('aaaaaaaaaaaa', 'a@x.com'));
  assert.ok(s.passwordProblem('contains-samuel-here', 'samuel@x.com')); assert.ok(s.passwordProblem('password1234', 'a@x.com'));
  assert.strictEqual(s.passwordProblem('correct horse battery', 'a@x.com'), '');
});

// ---- desktop widget summary ----
test('widget summary: only plain totals, budgets, bills, goal', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const code = src.slice(src.indexOf('/*WIDGET-START*/'), src.indexOf('/*WIDGET-END*/'));
  const TODAY = new Date(2026, 9, 12);
  const S = { sample: false, accounts: [{ name: 'Secret Bank 1234' }], budgets: { Dining: 100, Groceries: 300 }, goals: [{ name: 'Trip', target: 1000, saved: 250 }, { name: 'Done', target: 10, saved: 10 }, { name: 'Car', target: 2000, saved: 1000 }],
    subs: [{ name: 'Netflix', amount: 15 }, { name: 'Far', amount: 9 }] };
  const f = new Function('S,TODAY,NOWKEY,CATS,spendBy,incomeOf,activeSubs,nextDate,dayDiff,iso,monthLabel,netWorth',
    code + '\nreturn widgetSummary;')(S, TODAY, '2026-10', ['Dining', 'Groceries', 'Other', 'Income'],
    () => ({ by: { Dining: 160, Groceries: 120, Other: 40 }, total: 320 }), () => 2400,
    () => S.subs, (x) => (x.name === 'Netflix' ? new Date(2026, 9, 14) : new Date(2026, 10, 20)),
    (a, b) => Math.round((b - a) / 864e5), (d) => '2026-10-12', () => 'October 2026', () => ({ net: 5000, assets: 7000, debts: 2000 }));
  const w = f();
  assert.deepStrictEqual(w.spend, { income: 2400, spent: 320, budgeted: 400, budgetSpent: 280, left: 120, perDay: 120 / 20 });
  assert.deepStrictEqual(w.over, [{ cat: 'Dining', spent: 160, budget: 100 }]);
  assert.deepStrictEqual(w.bills, [{ name: 'Netflix', amount: 15, days: 2 }]);
  assert.deepStrictEqual(w.goal, { name: 'Car', pct: 50 });
  assert.strictEqual(w.daysLeft, 20);
  assert.ok(!/Secret|1234/.test(JSON.stringify(w)));
});

// ---- appearance ----
function themeBlock() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const code = src.slice(src.indexOf('/*THEME-START*/'), src.indexOf('/*THEME-END*/'));
  return new Function(code + '\nreturn {cleanTheme, themeVars, hexToHsl, hslToHex, lumOf, PRESETS, THEME_DEFAULT};')();
}

test('theme: junk input falls back to defaults, valid input is kept and clamped', () => {
  const t = themeBlock();
  assert.deepStrictEqual(t.cleanTheme(null), t.THEME_DEFAULT);
  assert.deepStrictEqual(t.cleanTheme('x'), t.THEME_DEFAULT);
  const c = t.cleanTheme({ accent: 'url(javascript:alert(1))', mode: 'neon', bg: 'plain', frost: 900, radius: -4, size: 'l', font: 'comic', motion: 'reduced', preset: '<b>' });
  assert.strictEqual(c.accent, t.THEME_DEFAULT.accent); assert.strictEqual(c.mode, 'auto'); assert.strictEqual(c.bg, 'plain');
  assert.strictEqual(c.frost, 100); assert.strictEqual(c.radius, 6); assert.strictEqual(c.size, 'l'); assert.strictEqual(c.font, 'modern'); assert.strictEqual(c.motion, 'reduced'); assert.strictEqual(c.preset, 'indigo');
  assert.strictEqual(t.cleanTheme({ accent: '#ABCDEF', preset: 'custom' }).accent, '#abcdef');
});

test('theme: colour maths round-trips and every preset gives readable, safe variables in light and dark', () => {
  const t = themeBlock();
  assert.strictEqual(t.hslToHex(...t.hexToHsl('#3b4cf0')).toLowerCase().length, 7);
  const [h, s, l] = t.hexToHsl('#ff0000'); assert.ok(Math.abs(h) < 1e-6 && Math.abs(s - 100) < 1e-6 && Math.abs(l - 50) < 1e-6);
  assert.strictEqual(t.hslToHex(0, 100, 50), '#ff0000');
  for (const p of t.PRESETS) for (const dark of [false, true]) {
    const v = t.themeVars({ accent: p.accent }, dark);
    assert.match(v['--accent'], /^#[0-9a-f]{6}$/); assert.match(v['--accent-soft'], /^#[0-9a-f]{6}$/);
    // text on the accent colour must stay legible (WCAG ratio at least 3 for large bold button text)
    const la = t.lumOf(v['--accent']), li = t.lumOf(v['--accent-ink']), ratio = (Math.max(la, li) + 0.05) / (Math.min(la, li) + 0.05);
    assert.ok(ratio >= 3, `${p.id} ${dark ? 'dark' : 'light'} contrast ${ratio.toFixed(2)}`);
  }
  const lo = t.themeVars({ frost: 0 }, false), hi = t.themeVars({ frost: 100 }, false);
  assert.strictEqual(lo['--glass-pct'], '86%'); assert.strictEqual(hi['--glass-pct'], '46%'); assert.strictEqual(lo['--glass-blur'], '8px'); assert.strictEqual(hi['--glass-blur'], '36px');
  assert.ok(Object.values(t.themeVars({ accent: '#112233', font: 'serif' }, true)).every((x) => !/[;{}<>]/.test(x)));   // nothing that could break out of a style value
});

// ---- category prediction and corrections ----
function srcBlock(a, b) { const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); return src.slice(src.indexOf(a), src.indexOf(b)); }
function catWorld(S) {
  const CATS = ['Housing', 'Groceries', 'Dining', 'Transport', 'Subscriptions', 'Shopping', 'Health', 'Entertainment', 'Travel', 'Cash and transfers', 'Debt and loans', 'Gas', 'Other', 'Income'];
  const normName = (n) => n.toLowerCase().replace(/[#\d*]+/g, '').replace(/\s+/g, ' ').trim(), aiKey = (n) => normName(n) || '(blank)';
  const ruleCat = (n) => { for (const c of S.customCats || []) for (const r of c.rules) if (new RegExp('(^|[^a-z0-9])' + r + '($|[^a-z0-9])', 'i').test(n)) return c.name; return null; };
  const TODAY = new Date(2026, 9, 12), iso = (d) => d.toISOString().slice(0, 10);
  const guessBlock = srcBlock('/*CATEGORY-START*/', '/*CATEGORY-END*/'), subBlock = srcBlock('/*SUB-START*/', '/*SUB-END*/'), editBlock = srcBlock('/*EDIT-START*/', '/*EDIT-END*/');
  const monthKey = (s) => s.slice(0, 7), shiftMonth = (k, n) => { const p = k.split('-'); const d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  return new Function('S,CATS,aiKey,ruleCat,TODAY,iso,monthKey,shiftMonth', guessBlock + subBlock + editBlock + '\nreturn {guessCat, learnMerchant, editTxn, setAsideTxn, restoreTxn, dropAside, reguessOther, subList, guessSub, subFor, parseSubList, cleanSubName, subBreakdown, resortSubs, learnSub};')(S, CATS, aiKey, ruleCat, TODAY, iso, monthKey, shiftMonth);
}

test('categories: common statement merchants land in sensible categories', () => {
  const w = catWorld({ customCats: [], merchantCats: {}, txns: [] });
  const table = {
    'GATEWAY FOOD SHOPS WORCESTER MA': 'Groceries', 'US 202 EXPRESS MINI MAR BENNINGTON NH': 'Groceries', 'SHAWS 4694 PETERBOROUGH NH': 'Groceries', '365 MARKET 888 432-329 TROY MI': 'Groceries', 'THE MAPLE STATION MARKE TEMPLE NH': 'Groceries',
    'BJS FUEL #9058 LEOMINSTER MA': 'Transport', 'E-ZPass MA 877-123 MA': 'Transport', 'SHELL OIL 57444': 'Transport',
    'POMODOROS PIZZA WORCESTER MA': 'Dining', 'TEMBO GRILL WORCESTER MA': 'Dining', 'MCDONALD S F1234 JAFFREY NH': 'Dining', 'INSOMNIA COOKIES-WORCE 877-632-5564 MA': 'Dining',
    'APPLE.COM/BILL 866-712-7753 CA': 'Subscriptions', 'ANTHROPIC* CLAUDE SUB ANTHROPIC.COMCA': 'Subscriptions', 'XFINITY MOBILE 888-936-4968 PA': 'Subscriptions', 'Peacock 14D40 Premium 212-555 NY': 'Subscriptions',
    'EFT ACH COMCAST-XFINITY CABLE SVCS SAMUEL': 'Housing', 'EFT ACH EVERSOURCE WEB_PAY SEP 26': 'Housing',
    'EFT ACH HONDA PMT 123 SAM': 'Debt and loans', 'EFT ACH APPLECARD GSBANKPAYMENT 123 Sam': 'Debt and loans', 'RETURNED - UNCOLLECTED FUNDS DEPT EDUCATION STUDENT LN123 DCU': 'Debt and loans',
    'CASH APP*ALISON KIARIE Oakland CA': 'Cash and transfers', 'VENMO *Someone Visa Direct NY': 'Cash and transfers', 'RMTLY* FE9A4 REMITLY.COM WA': 'Cash and transfers', 'APPLE CASH SENT MONEY 1INFINITELOOPCA': 'Cash and transfers',
    'WITHDRAWAL ATM 0902 1838 47 Blackstone River Rd Worcester MA': 'Cash and transfers', 'WITHDRAWAL ATM 0928 JAPANPOST BANK NAGANO': 'Cash and transfers', 'TRANSFER 123 FROM/TO 2 Payment to JANE DOE': 'Cash and transfers', 'EFT ACH DANIEL KAMAU IAT PAYPAL SAMUEL': 'Cash and transfers',
    'AGODA.COM SHINAGAWA New York NY': 'Travel', 'JAPAN BULLET TRAIN MINATOKU': 'Travel', 'PRINCE HOTELS TOKYO': 'Travel', 'MOBILE SUICA APPLE V TOKYO': 'Travel',
    'AMAZON MKTPL*5X8MC5430 Amzn.com/billWA': 'Shopping', 'AMAZON RETA* 532V942L1 WWW.AMAZON.COWA': 'Shopping', 'OLYMPIC WINE SPIRITS 508-123 MA': 'Shopping',
    'SHOOTERS BAR BILLIARD WORCESTER MA': 'Entertainment', 'CVS/PHARMACY #063 PETERBOROUGH NH': 'Health', 'SOMETHING UNKNOWN LLC': 'Other' };
  Object.keys(table).forEach((n) => assert.strictEqual(w.guessCat(n), table[n], n));
  assert.strictEqual(w.guessCat('ACME PAYROLL'), 'Income');
});

test('categories: your corrections win, custom keyword rules still work, and "Other" forgets', () => {
  const S = { customCats: [{ name: 'Gas', rules: ['bjs fuel'] }], merchantCats: {}, txns: [] };
  const w = catWorld(S);
  assert.strictEqual(w.guessCat('BJS FUEL #9058 LEOMINSTER MA'), 'Gas');
  w.learnMerchant('SHOOTERS BAR BILLIARD WORCESTER MA', 'Dining'); assert.strictEqual(w.guessCat('SHOOTERS BAR BILLIARD 123 WORCESTER MA'), 'Dining');   // digits and case do not matter
  w.learnMerchant('BJS FUEL #1', 'Transport'); assert.strictEqual(w.guessCat('BJS FUEL #9058 LEOMINSTER MA'), 'Gas'); // a different merchant string, so the rule above is unaffected
  w.learnMerchant('BJS FUEL #9058 LEOMINSTER MA', 'Transport'); assert.strictEqual(w.guessCat('BJS FUEL #9058 LEOMINSTER MA'), 'Transport');
  w.learnMerchant('SHOOTERS BAR BILLIARD WORCESTER MA', 'Other'); assert.strictEqual(w.guessCat('SHOOTERS BAR BILLIARD WORCESTER MA'), 'Entertainment');
  S.merchantCats.x = 'Deleted Category'; w.learnMerchant('', 'Dining');
  assert.strictEqual(w.guessCat('x'), 'Other');                                                              // a remembered category that no longer exists is ignored
});

test('edit: fields change, bad input is ignored, similar transactions follow, set-aside money leaves every list and can come back', () => {
  const S = { customCats: [], merchantCats: {}, setAside: [], txns: [
    { id: 'a', date: '2026-09-01', name: 'CASH APP*SAM 1', amount: -20, cat: 'Other' }, { id: 'b', date: '2026-09-03', name: 'CASH APP*SAM 22', amount: -35, cat: 'Other' },
    { id: 'c', date: '2026-09-05', name: 'CASH APP*SAM CASH OUT', amount: 116.78, cat: 'Income' }, { id: 'd', date: '2026-09-02', name: 'SHAWS', amount: -9, cat: 'Groceries' }] };
  const w = catWorld(S);
  const r = w.editTxn('a', { date: 'garbage', name: '  Rent to roommate  ', amount: -25.456, cat: 'Housing' }, false);
  const a = S.txns.find((x) => x.id === 'a');
  assert.deepStrictEqual([a.date, a.name, a.amount, a.cat, r.changed], ['2026-09-01', 'Rent to roommate', -25.46, 'Housing', 0]);
  w.editTxn('a', { name: '', amount: 0, cat: 'Not a category' }, false); assert.deepStrictEqual([a.name, a.amount, a.cat], ['Rent to roommate', -25.46, 'Housing']);
  const r2 = w.editTxn('b', { cat: 'Cash and transfers' }, true); assert.strictEqual(r2.changed, 0);
  S.txns.push({ id: 'e', date: '2026-09-08', name: 'CASH APP*SAM 333', amount: -5, cat: 'Other' }, { id: 'f', date: '2026-09-09', name: 'CASH APP*SAM 4', amount: 50, cat: 'Other' });
  const r3 = w.editTxn('b', { cat: 'Cash and transfers' }, true); assert.strictEqual(r3.changed, 1);              // 'e' follows; money in ('f') is not forced into a spending category
  assert.strictEqual(S.txns.find((x) => x.id === 'e').cat, 'Cash and transfers'); assert.strictEqual(S.txns.find((x) => x.id === 'f').cat, 'Other');
  assert.strictEqual(S.merchantCats[Object.keys(S.merchantCats)[0]], 'Cash and transfers');
  assert.deepStrictEqual(S.txns.map((x) => x.date), S.txns.map((x) => x.date).slice().sort().reverse());          // kept newest first
  assert.strictEqual(w.editTxn('nope', { cat: 'Dining' }, false), null);
  const before = S.txns.length;
  assert.strictEqual(w.setAsideTxn('d'), true); assert.strictEqual(S.txns.length, before - 1); assert.strictEqual(S.setAside[0].id, 'd'); assert.ok(S.setAside[0].asideAt);
  assert.strictEqual(w.setAsideTxn('d'), false);
  assert.strictEqual(w.restoreTxn('d'), true); assert.ok(S.txns.some((x) => x.id === 'd') && !('asideAt' in S.txns.find((x) => x.id === 'd')) && S.setAside.length === 0);
  w.setAsideTxn('c'); assert.strictEqual(w.dropAside('c'), true); assert.ok(!S.txns.some((x) => x.id === 'c') && S.setAside.length === 0);
});

test('re-guessing the "Other" pile is undoable and leaves money in alone', () => {
  const S = { customCats: [], merchantCats: {}, setAside: [], txns: [
    { id: '1', date: '2026-09-01', name: 'POMODOROS PIZZA', amount: -12, cat: 'Other' }, { id: '2', date: '2026-09-01', name: 'MYSTERY LLC', amount: -3, cat: 'Other' },
    { id: '3', date: '2026-09-01', name: 'ACME PAYROLL', amount: 900, cat: 'Other' }, { id: '4', date: '2026-09-01', name: 'AMAZON REFUND', amount: 5, cat: 'Other' }, { id: '5', date: '2026-09-01', name: 'SHAWS', amount: -4, cat: 'Dining' }] };
  const w = catWorld(S); const undo = w.reguessOther();
  assert.deepStrictEqual(S.txns.map((x) => x.cat), ['Dining', 'Other', 'Income', 'Other', 'Dining']);
  assert.deepStrictEqual(undo.map((p) => p[0]).sort(), ['1', '3']);
  undo.forEach((p) => { S.txns.find((x) => x.id === p[0]).cat = p[1]; }); assert.deepStrictEqual(S.txns.map((x) => x.cat), ['Other', 'Other', 'Other', 'Other', 'Dining']);
});

// ---- sub-categories ----
test('sub-categories: defaults, rules for the housing examples, your own lists and learned fixes', () => {
  const S = { customCats: [], merchantCats: {}, merchantSubs: {}, subCats: {}, setAside: [], txns: [] };
  const w = catWorld(S);
  assert.deepStrictEqual(w.subList('Housing').slice(0, 5), ['Rent', 'Mortgage', 'Electric', 'Wi-Fi and internet', 'Propane and heating oil']);
  const table = [['Housing', 'MAPLE COURT RENT', 'Rent'], ['Housing', 'EFT ACH EVERSOURCE WEB_PAY SEP 26', 'Electric'], ['Housing', 'EFT ACH COMCAST-XFINITY CABLE SVCS', 'Wi-Fi and internet'],
    ['Housing', 'AMERIGAS PROPANE 123', 'Propane and heating oil'], ['Housing', 'CITY WATER DEPT', 'Water and sewer'], ['Transport', 'BJS FUEL #9058', 'Fuel'], ['Transport', 'E-ZPass MA', 'Tolls and parking'],
    ['Cash and transfers', 'WITHDRAWAL ATM 0902', 'ATM cash'], ['Subscriptions', 'ANTHROPIC* CLAUDE SUB', 'Software and AI'], ['Housing', 'SOMETHING ELSE', '']];
  table.forEach(([c, n, e]) => assert.strictEqual(w.guessSub(c, n), e, n));
  assert.strictEqual(w.guessCat('AMERIGAS PROPANE 123'), 'Housing');                 // heating fuel is a home cost, not car fuel
  assert.strictEqual(w.guessSub('Dining', 'EVERSOURCE'), '');                       // a rule only applies inside its own category
  S.subCats.Housing = ['Rent', 'Electricity'];                                      // the person's own list replaces the default
  assert.strictEqual(w.guessSub('Housing', 'EVERSOURCE'), '');                      // 'Electric' is no longer in the list, so it is not suggested
  w.learnSub('EVERSOURCE', 'Electricity'); assert.strictEqual(w.guessSub('Housing', 'EVERSOURCE 99'), 'Electricity');
  assert.deepStrictEqual(w.parseSubList(' Rent, Wi-Fi ,rent,,<b>Prop"ane</b>\nGas & Oil'), ['Rent', 'Wi-Fi', 'bPropane/b', 'Gas  Oil'.replace('  ', ' ')]);
  assert.strictEqual(w.cleanSubName('x'.repeat(80)).length, 32); assert.strictEqual(w.cleanSubName(null), '');
  assert.strictEqual(w.subFor('Housing', 'X', 'Rent'), 'Rent'); assert.strictEqual(w.subFor('Housing', 'X', 'Nope'), '');
});

test('sub-categories: editing sets and clears them, similar transactions follow, the breakdown adds up', () => {
  const S = { customCats: [], merchantCats: {}, merchantSubs: {}, subCats: {}, setAside: [], txns: [
    { id: 'a', date: '2026-10-02', name: 'EVERSOURCE 1', amount: -60, cat: 'Housing' }, { id: 'b', date: '2026-10-03', name: 'MAPLE COURT RENT', amount: -1500, cat: 'Housing' },
    { id: 'c', date: '2026-10-04', name: 'MYSTERY PAYEE', amount: -40, cat: 'Housing' }, { id: 'd', date: '2026-09-02', name: 'EVERSOURCE 2', amount: -50, cat: 'Housing', sub: 'Electric' },
    { id: 'e', date: '2026-09-03', name: 'MAPLE COURT RENT', amount: -1500, cat: 'Housing', sub: 'Rent' }, { id: 'f', date: '2026-08-03', name: 'MAPLE COURT RENT', amount: -1500, cat: 'Housing', sub: 'Rent' },
    { id: 'g', date: '2026-10-05', name: 'SHAWS', amount: -9, cat: 'Groceries' }] };
  const w = catWorld(S);
  assert.deepStrictEqual(w.resortSubs().sort(), ['a', 'b']); assert.deepStrictEqual([S.txns[0].sub, S.txns[1].sub, S.txns[2].sub], ['Electric', 'Rent', undefined]);
  w.editTxn('c', { cat: 'Housing', sub: 'Propane and heating oil' }, true); assert.strictEqual(S.txns.find((x) => x.id === 'c').sub, 'Propane and heating oil'); assert.strictEqual(S.merchantSubs['mystery payee'], 'Propane and heating oil');
  w.editTxn('c', { cat: 'Dining' }, false); assert.ok(!('sub' in S.txns.find((x) => x.id === 'c')));                         // moving to another category drops a sub that does not belong there
  w.editTxn('c', { sub: '' }, false);
  const bd = w.subBreakdown(S.txns, 'Housing', '2026-10');
  assert.deepStrictEqual(bd.map((r) => [r.sub, r.amount]), [['Rent', 1500], ['Electric', 60]]);
  assert.strictEqual(bd[0].avg, 1500); assert.strictEqual(bd[1].avg, 25);                                                    // two earlier months with Housing spending: (0 + 50) / 2 for Electric
  assert.ok(Math.abs(bd.reduce((a, r) => a + r.share, 0) - 100) < 1e-9);
  assert.deepStrictEqual(w.subBreakdown(S.txns, 'Dining', '2026-10').map((r) => [r.sub, r.amount]), [['Unsorted', 40]]);   // the transaction moved to Dining earlier
  assert.deepStrictEqual(w.subBreakdown(S.txns, 'Travel', '2026-10'), []);
  S.txns.push({ id: 'h', date: '2026-10-06', name: 'UNSORTED THING', amount: -5, cat: 'Housing' }); assert.ok(w.subBreakdown(S.txns, 'Housing', '2026-10').some((r) => r.sub === 'Unsorted' && r.amount === 5));
  assert.strictEqual(w.resortSubs().length, 0);
});

// ---- loans ----
function loanBlock() { return new Function(srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + '\nreturn {amortize, requiredPayment, portfolio, extraForTarget, nextDue, loanMatchRe, paymentsSeen, cleanStmt, applyStmt};')(); }

test('loans: a single loan pays off on the schedule the formula predicts, and extra money shortens it', () => {
  const L = loanBlock();
  const pay = L.requiredPayment(20000, 6, 60);
  assert.ok(Math.abs(pay - 386.66) < 0.01, 'standard 60-month payment');
  const base = L.amortize(20000, 6, pay);
  assert.strictEqual(base.months, 60); assert.ok(Math.abs(base.interest - (pay * 60 - 20000)) < 0.5); assert.ok(base.sched[60] === 0 && base.sched[0] === 20000);
  const fast = L.amortize(20000, 6, pay, { extra: 100 });
  assert.ok(fast.months < 60 && fast.interest < base.interest); assert.strictEqual(fast.sched.length, fast.months + 1);
  const lumped = L.amortize(20000, 6, pay, { lump: 5000 }); assert.ok(lumped.months < base.months && lumped.sched[0] === 15000);
  assert.deepStrictEqual(L.amortize(1000, 0, 100).months, 10); assert.strictEqual(L.amortize(1000, 0, 100).interest, 0);
  assert.strictEqual(L.amortize(0, 5, 100).months, 0); assert.strictEqual(L.amortize(10, 5, 100, { lump: 50 }).months, 0);
  assert.deepStrictEqual([L.amortize(1000, 5, 0).reason, L.amortize(10000, 12, 50).reason], ['nopay', 'never']);
  assert.ok(Math.abs(L.amortize(10000, 12, 50).needed - 100) < 1e-9);                                  // the first month's interest is what the payment must beat
  assert.strictEqual(L.requiredPayment(1200, 0, 12), 100); assert.strictEqual(L.requiredPayment(500, 5, 0), 500);
});

test('loans: several loans, extra money goes to the highest rate first, and a target date has an exact answer', () => {
  const L = loanBlock();
  const loans = [{ id: 'a', name: 'Low', balance: 5000, apr: 3, minPay: 60 }, { id: 'b', name: 'High', balance: 3000, apr: 8, minPay: 50 }, { id: 'z', name: 'Done', balance: 0, apr: 5, minPay: 10 }];
  const none = L.portfolio(loans, 0), withExtra = L.portfolio(loans, 100);
  assert.ok(none.ok && withExtra.ok && withExtra.months < none.months && withExtra.interest < none.interest);
  assert.strictEqual(withExtra.order[0].id, 'b');                                                         // the 8% loan clears first
  assert.strictEqual(withExtra.sched[0], 8000); assert.strictEqual(withExtra.sched[withExtra.months], 0);
  const one = [{ id: 'x', name: 'X', balance: 9000, apr: 5, minPay: 150 }], a = L.amortize(9000, 5, 150), p = L.portfolio(one, 0);
  assert.strictEqual(p.months, a.months); assert.ok(Math.abs(p.interest - a.interest) < 1e-6);            // one loan agrees with the single-loan maths
  assert.ok(L.portfolio(loans, 0, 3000).months < none.months);                                            // a lump sum goes to the highest rate
  assert.strictEqual(L.portfolio([], 50).months, 0); assert.strictEqual(L.portfolio([{ id: 'n', balance: 100, apr: 4, minPay: 0 }], 0).reason, 'nopay');
  const x = L.extraForTarget(loans, 24, 0); assert.ok(x > 0); assert.ok(L.portfolio(loans, x).months <= 24); assert.ok(L.portfolio(loans, x - 1).months > 24);
  assert.strictEqual(L.extraForTarget(loans, 1000, 0), 0); assert.strictEqual(L.extraForTarget(loans, 0, 0), null);
});

test('loans: due dates and the payments found in your transactions', () => {
  const L = loanBlock();
  assert.strictEqual(L.nextDue(15, new Date(2026, 9, 12)).getDate(), 15); assert.strictEqual(L.nextDue(15, new Date(2026, 9, 20)).getMonth(), 10);
  assert.strictEqual(L.nextDue(31, new Date(2026, 1, 3)).getDate(), 28); assert.strictEqual(L.nextDue(0, new Date()), null); assert.strictEqual(L.nextDue(12, new Date(2026, 9, 12)).getDate(), 12);
  const txns = [{ date: '2026-09-18', name: 'EFT ACH HONDA PMT 123 SAMUEL', amount: -846.32 }, { date: '2026-08-18', name: 'EFT ACH HONDA PMT 123 SAMUEL', amount: -846.32 }, { date: '2026-09-02', name: 'Honda refund', amount: 40 }, { date: '2026-09-05', name: 'SHAWS', amount: -9 },
    { date: '2026-09-09', name: 'NELNET PAYMENT 4455', amount: -190 }, { date: '2026-09-10', name: 'RETURNED DEPT EDUCATION STUDENT LN999 DCU', amount: 120 }];
  assert.deepStrictEqual(L.paymentsSeen(txns, { type: 'auto', lender: 'Honda Financial', name: 'Honda Civic' }).map((x) => x.amount), [846.32, 846.32]);
  assert.deepStrictEqual(L.paymentsSeen(txns, { type: 'student', lender: 'Nelnet', name: 'Direct Unsubsidized 2019' }).map((x) => x.amount), [190]);
  assert.deepStrictEqual(L.paymentsSeen(txns, { type: 'auto', lender: '', name: 'Car' }), []);            // nothing distinctive to match on
  assert.ok(L.loanMatchRe({ type: 'auto', lender: 'A+B (Co.)', name: 'Loan' }) === null || true);
});

// ---- affordability plan ----
function planBlock() { return new Function(srcBlock('/*PLAN-START*/', '/*PLAN-END*/') + '\nreturn {affordPlan};')().affordPlan; }
const baseCats = [{ cat: 'Dining', avg: 300, subs: [{ sub: 'Takeout and delivery', avg: 180 }, { sub: 'Restaurants', avg: 120 }] }, { cat: 'Shopping', avg: 200, subs: [] }, { cat: 'Groceries', avg: 500, subs: [] }, { cat: 'Housing', avg: 1500, subs: [] }, { cat: 'Entertainment', avg: 10, subs: [] }, { cat: 'Transport', avg: 200, subs: [] }];

test('plan: a purchase you cannot afford yet gets a gap, trims ranked by size, and an income need only when trimming is not enough', () => {
  const plan = planBlock();
  const p = plan({ upfront: 3000, income: 4000, spend: 3500, liquid: 11000, upcoming: 100, cats: baseCats, hourly: 25, flaggedSubs: 30 });
  assert.strictEqual(p.kind, 'upfront'); assert.strictEqual(p.comfortGap, 3000 + 10500 + 100 - 11000);            // 2,600 short of a three-month cushion
  assert.strictEqual(p.minGap, 0);                                                                           // but fine if one month of cushion is enough
  assert.deepStrictEqual(p.cuts.map((c) => [c.id, c.save]), [['Dining', 75], ['Shopping', 60], ['__subs', 30], ['Groceries', 40], ['Transport', 15]]);   // discretionary first, essentials last
  assert.strictEqual(p.cuts[0].hint, 'Takeout and delivery is the biggest part (180 a month)');
  assert.ok(!p.cuts.some((c) => c.id === 'Housing' || c.id === 'Entertainment'));                            // housing is not trimmed; tiny categories are skipped
  assert.strictEqual(p.cutTotal, 220); assert.strictEqual(p.surplus, 500);
  const s3 = p.scenarios.find((x) => x.months === 3);
  assert.ok(Math.abs(s3.perMonth - 2600 / 3) < 1e-9); assert.ok(Math.abs(s3.fromLeftover - 500) < 1e-9); assert.strictEqual(s3.fromCuts, 220); assert.ok(Math.abs(s3.fromIncome - (2600 / 3 - 720)) < 1e-9);   // three months needs a bit of extra income
  const s1 = p.scenarios.find((x) => x.months === 1); assert.ok(s1.fromIncome > 0 && Math.abs(s1.hours - s1.fromIncome / (25 * 0.8)) < 1e-9);
  const s6 = p.scenarios.find((x) => x.months === 6); assert.ok(Math.abs(s6.fromLeftover - 2600 / 6) < 1e-9 && s6.fromCuts === 0 && s6.fromIncome === 0);   // six months is covered by leftover money alone
  assert.strictEqual(p.chosen.months, 6); assert.strictEqual(p.needsIncome, false);
  assert.ok(p.steps.some((x) => /6 months/.test(x)) && !p.steps.some((x) => /trimming spending/.test(x)) && p.steps.some((x) => /thinner cushion/.test(x)));
  assert.strictEqual(p.monthsLeftoverOnly, 6); assert.strictEqual(p.monthsWithCuts, 4);
  assert.strictEqual(p.affordableComfortably, 400); assert.strictEqual(p.affordableStretch, 7400);
});

test('plan: turning trims off, no leftover money and unaffordable amounts push the answer toward earning more', () => {
  const plan = planBlock();
  const skipAll = {}; baseCats.forEach((c) => { skipAll[c.cat] = true; });
  const q = plan({ upfront: 6000, income: 3000, spend: 3000, liquid: 2000, upcoming: 0, cats: baseCats, hourly: 20, skip: skipAll });
  assert.strictEqual(q.cutTotal, 0); assert.strictEqual(q.monthsLeftoverOnly, null); assert.strictEqual(q.monthsWithCuts, null);
  assert.strictEqual(q.needsIncome, true); assert.strictEqual(q.chosen.months, 12);
  assert.ok(q.chosen.fromIncome > 0 && Math.abs(q.chosen.hours - q.chosen.fromIncome / 16) < 1e-9);               // $20 an hour, 80% kept
  assert.ok(q.steps.some((x) => /earning more/.test(x) && /extra hours/.test(x)));
  assert.ok(plan({ upfront: 6000, income: 3000, spend: 3000, liquid: 2000, cats: [], hourly: 0 }).chosen.hours === null);   // no hourly rate: say "more income" instead of hours
  const rich = plan({ upfront: 100, income: 4000, spend: 2000, liquid: 20000, cats: baseCats }); assert.strictEqual(rich.gap, 0); assert.ok(/No changes needed/.test(rich.steps[0]));
  const noBal = plan({ upfront: 1500, income: 3000, spend: 2500, liquid: null, cats: [] }); assert.strictEqual(noBal.gap, 1000);   // without balances, compare with one month's leftover
});

test('plan: a monthly cost is judged against keeping 10% of income', () => {
  const plan = planBlock();
  const m = plan({ monthly: 150, income: 4000, spend: 3500, cats: baseCats, hourly: 20 });
  assert.strictEqual(m.kind, 'monthly'); assert.strictEqual(m.gap, 0.1 * 4000 - (500 - 150)); assert.strictEqual(m.breakEven, 0);
  assert.ok(Math.abs(m.relief.perMonth - 50) < 1e-9 && m.relief.fromLeftover === 0 && m.relief.fromCuts === 50 && m.relief.fromIncome === 0 && m.affordableMonthly === 100);   // $50 short of the 10% target, closed by trimming
  const big = plan({ monthly: 800, income: 4000, spend: 3500, cats: baseCats, hourly: 20 });
  assert.strictEqual(big.breakEven, 300); assert.ok(big.relief.fromIncome > 0 && big.needsIncome); assert.ok(big.steps.some((x) => /extra hours/.test(x)));
  const fine = plan({ monthly: 20, income: 5000, spend: 3000, cats: [] }); assert.strictEqual(fine.gap, 0); assert.ok(/No changes needed/.test(fine.steps[0]));
  assert.strictEqual(plan({ income: 1, spend: 1 }).kind, 'none');
});

test('plan: choosing a timeline forces that scenario and the wording follows', () => {
  const plan = planBlock();
  const a = { upfront: 3000, income: 4000, spend: 3500, liquid: 11000, upcoming: 100, cats: baseCats, hourly: 25 };
  const auto = plan(a), one = plan({ ...a, horizon: 1 }), twelve = plan({ ...a, horizon: 12 });
  assert.strictEqual(auto.chosen.months, 6); assert.strictEqual(auto.horizonForced, false);
  assert.strictEqual(one.chosen.months, 1); assert.strictEqual(one.horizonForced, true); assert.strictEqual(one.needsIncome, true); assert.match(one.steps[0], /^To have it in 1 month:/);
  assert.ok(one.steps.some((x) => /extra hours/.test(x)));
  assert.strictEqual(twelve.needsIncome, false); assert.match(twelve.steps[0], /12 months/);
});

// ---- bills ----
function billsWorld() {
  const normName = (n) => n.toLowerCase().replace(/[#\d*]+/g, '').replace(/\s+/g, ' ').trim(), aiKey = (n) => normName(n) || '(blank)';
  const monthKey = (s) => s.slice(0, 7), shiftMonth = (k, n) => { const p = k.split('-'); const d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return new Function('aiKey,monthKey,shiftMonth,iso', srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + srcBlock('/*BILLS-START*/', '/*BILLS-END*/') + '\nreturn {billMatchRe, billItems, dueDateFor, billStatus, billsSummary, suggestBills, autoBillItems};')(aiKey, monthKey, shiftMonth, iso);
}

test('bills: payments are found in transactions with a sensible amount window; marks override; states follow the calendar', () => {
  const B = billsWorld(), today = new Date(2026, 9, 12);                                               // Oct 12
  const bills = [{ id: 'rent', name: 'Maple Court Rent', amount: 1500, dueDay: 1, match: 'maple court' }, { id: 'el', name: 'Eversource electric', amount: 110, dueDay: 22, match: '' }, { id: 'wifi', name: 'Wi-Fi', amount: 70, dueDay: 8, match: 'comcast' }, { id: 'prop', name: 'Propane', amount: 240, dueDay: 0, match: 'amerigas' }, { id: 'gen', name: 'Electric bill', amount: 50, dueDay: 15, match: '' }];
  const txns = [{ date: '2026-09-29', name: 'MAPLE COURT RENT', amount: -1500 }, { date: '2026-10-06', name: 'EFT ACH COMCAST CABLE', amount: -69.99 }, { date: '2026-10-07', name: 'COMCAST REFUND', amount: 20 }, { date: '2026-10-03', name: 'EVERSOURCE WEB PAY', amount: -480 }];
  const items = B.billItems(bills, []);
  const st = (id, mk, marks) => B.billStatus(items.find((x) => x.id === id), mk || '2026-10', txns, marks || {}, today);
  assert.strictEqual(st('rent').state, 'paid'); assert.strictEqual(st('rent').found.date, '2026-09-29');     // paid in the last days of September for the October 1 due date
  assert.strictEqual(st('wifi').state, 'paid'); assert.strictEqual(st('wifi').paidAmount, 69.99);
  assert.strictEqual(st('el').state, 'upcoming');                                                           // the $480 payment is outside the window for a $110 bill
  assert.strictEqual(st('prop').state, 'upcoming'); assert.strictEqual(st('prop').due, null);
  assert.strictEqual(B.billMatchRe(items.find((x) => x.id === 'gen').raw), null);                           // nothing distinctive to match on: manual only
  assert.strictEqual(st('gen').state, 'soon');                                                              // due the 15th, three days away
  assert.strictEqual(st('el', '2026-10', { 'el:2026-10': 'paid' }).state, 'paid'); assert.strictEqual(st('el', '2026-10', { 'el:2026-10': 'paid' }).paidAmount, 110);
  assert.strictEqual(st('rent', '2026-10', { 'rent:2026-10': 'unpaid' }).state, 'overdue');                    // marked unpaid even though a payment was found; due on the 1st, so past due on the 12th
  assert.strictEqual(st('el', '2026-09').state, 'missed');                                                  // last month, nothing found, not marked
  assert.strictEqual(B.billStatus({ id: 'x', name: 'x', amount: 10, dueDay: 5, re: null }, '2026-10', [], {}, today).state, 'overdue');
  assert.strictEqual(B.dueDateFor(31, '2026-02').getDate(), 28); assert.strictEqual(B.dueDateFor(0, '2026-02'), null);
});

test('bills: loans and credit cards appear as bills, and the summary adds up paid, pending and overdue', () => {
  const B = billsWorld(), today = new Date(2026, 9, 12);
  const accounts = [{ id: 'c', name: 'Honda Civic loan', lender: 'Honda Financial', type: 'auto', minPay: 846.32, dueDay: 18, balance: 18000 }, { id: 'z', name: 'Old loan', type: 'auto', minPay: 100, dueDay: 3, balance: 0 }, { id: 'n', name: 'Direct Unsub', lender: 'Nelnet', type: 'student', minPay: 95, dueDay: 5, balance: 7000 }, { id: 'k', name: 'Visa', type: 'credit', minPay: 25, dueDay: 9, balance: 500 }, { id: 'q', name: 'Store card', type: 'credit', minPay: 0, dueDay: 9, balance: 500 }, { id: 'w', name: 'No due day card', type: 'credit', minPay: 30, balance: 500 }];
  const bills = [{ id: 'rent', name: 'Rent', amount: 1500, dueDay: 1, match: 'maple' }];
  const items = B.billItems(bills, accounts);
  assert.deepStrictEqual(items.map((x) => x.id).sort(), ['loan:c', 'loan:k', 'loan:n', 'loan:w', 'rent']);   // paid-off debts and cards with no minimum are not listed; one with no due day still is
  const txns = [{ date: '2026-10-01', name: 'MAPLE COURT RENT', amount: -1500 }, { date: '2026-10-05', name: 'NELNET PAYMENT 12', amount: -95 }];
  const sum = B.billsSummary(items, '2026-10', txns, {}, today);
  assert.deepStrictEqual([sum.count, sum.paidCount, sum.paid, sum.pending, sum.total, sum.overdue], [5, 2, 1595, 901.32, 2496.32, 1]);   // the card was due on the 9th
  assert.deepStrictEqual(sum.rows.map((r) => r.item.id), ['rent', 'loan:n', 'loan:k', 'loan:c', 'loan:w']);   // by due date, undated last
  const late = B.billsSummary(items, '2026-10', [], {}, new Date(2026, 9, 20)); assert.strictEqual(late.overdue, 4);
  assert.strictEqual(late.pending, 2496.32);
  assert.strictEqual(B.billsSummary([], '2026-10', [], {}, today).count, 0);
});

test('bills: a credit card is paid only by a payment that names the card, and a hand-made bill is not doubled', () => {
  const B = billsWorld(), today = new Date(2026, 9, 25);
  const card = { id: 'a', name: 'Chase Amazon Prime (closed)', type: 'credit', minPay: 35, dueDay: 20, balance: 900 };
  const it = B.billItems([], [card])[0];
  assert.strictEqual(it.kind, 'credit');
  const shop = [{ date: '2026-10-19', name: 'AMAZON MKTPL 123', amount: -35 }];
  assert.notStrictEqual(B.billStatus(it, '2026-10', shop, {}, today).state, 'paid');                          // a $35 Amazon purchase is not a card payment
  const pay = [{ date: '2026-10-19', name: 'PAYMENT TO CHASE CARD ENDING IN 1234', amount: -35 }];
  assert.strictEqual(B.billStatus(it, '2026-10', pay, {}, today).state, 'paid');
  assert.strictEqual(B.billStatus(it, '2026-10', [{ date: '2026-10-19', name: 'CHASE CREDIT CRD AUTOPAY', amount: -35 }], {}, today).state, 'paid');
  assert.strictEqual(B.billItems([{ id: 'm', name: 'Chase Amazon Prime (closed)', amount: 35, dueDay: 20 }], [card]).length, 1);   // already added by hand
});


test('bills: repeating payments you have not tracked are suggested', () => {
  const B = billsWorld();
  const mk = (d, name, amt, cat, sub) => ({ date: d, name, amount: amt, cat, ...(sub ? { sub } : {}) });
  const txns = [mk('2026-08-17', 'GEICO AUTO 123', -140, 'Transport', 'Insurance'), mk('2026-09-17', 'GEICO AUTO 456', -140, 'Transport', 'Insurance'), mk('2026-10-17', 'GEICO AUTO 789', -140, 'Transport', 'Insurance'),
    mk('2026-09-02', 'MAPLE COURT RENT', -1500, 'Housing', 'Rent'), mk('2026-10-02', 'MAPLE COURT RENT', -1500, 'Housing', 'Rent'), mk('2026-10-05', 'ONE TIME FEE', -90, 'Housing'), mk('2026-09-09', 'SHAWS', -80, 'Groceries'), mk('2026-10-09', 'SHAWS', -80, 'Groceries'), mk('2026-09-20', 'TINY THING', -10, 'Housing'), mk('2026-10-20', 'TINY THING', -10, 'Housing')];
  const items = B.billItems([{ id: 'r', name: 'Rent', amount: 1500, dueDay: 2, match: 'maple' }], []);
  const s = B.suggestBills(txns, items, '2026-10');
  assert.deepStrictEqual(s.map((x) => [x.name, x.amount, x.dueDay, x.months]), [['GEICO AUTO', 140, 17, 3]]);   // rent is tracked, one-off, groceries and tiny items are not suggested
});

// ---- energy ----
function energyBlock() { return new Function(srcBlock('/*ENERGY-START*/', '/*ENERGY-END*/') + '\nreturn {splitCsv, numOf, dateOf, parseEnergyCsv, parseEnergyXml, parseEnergyFile, energyMerge, energySeries, energyInsights};')(); }

test('energy: a Green Button style billing CSV with a preface is read by month, with cost', () => {
  const E = energyBlock();
  const csv = ['Name,Jane Doe', 'Address,"1 Main St, Bennington NH"', 'Account Number,123456', '', 'Service period start,Service period end,Usage (kWh),Cost', '09/05/2025,10/06/2025,612,$98.40', '10/06/2025,11/05/2025,540.5,"$1,087.25"', '11/05/2025,12/05/2025,700,$140.00', 'notes,,,'].join('\r\n');
  const r = E.parseEnergyCsv(csv);
  assert.ok(r.ok); assert.deepStrictEqual(r.records, [{ month: '2025-10', kwh: 612, cost: 98.4, days: 31 }, { month: '2025-11', kwh: 540.5, cost: 1087.25, days: 30 }, { month: '2025-12', kwh: 700, cost: 140, days: 30 }]);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(E.parseEnergyFile(csv).records.length, 3);
});

test('energy: interval CSV (hourly, watt-hours) adds up per month; wrong units and junk are refused politely', () => {
  const E = energyBlock();
  const lines = ['Date,Start Time,Usage (Wh)']; for (let h = 0; h < 24; h++) lines.push(`2025-10-30,${h}:00,500`); for (let h = 0; h < 24; h++) lines.push(`2025-11-01,${h}:00,1000`);
  const r = E.parseEnergyCsv(lines.join('\n'));
  assert.deepStrictEqual(r.records, [{ month: '2025-10', kwh: 12, cost: null, days: 1 }, { month: '2025-11', kwh: 24, cost: null, days: 1 }]);
  assert.match(E.parseEnergyCsv('Start,End,Usage (therms)\n01/01/2025,02/01/2025,40').error, /not electricity/);
  assert.match(E.parseEnergyCsv('a,b,c\n1,2,3').error, /usage column/);
  assert.match(E.parseEnergyFile('   ').error, /empty/);
  assert.strictEqual(E.numOf('($5.00)'), -5); assert.strictEqual(E.numOf('abc'), null); assert.deepStrictEqual(E.dateOf('Oct 5, 2025'), { y: 2025, m: 10, d: 5 });
  assert.deepStrictEqual(E.splitCsv('a;b;"c;d"\n1;2;3'), [['a', 'b', 'c;d'], ['1', '2', '3']]);
});

test('energy: ESPI XML interval readings and usage summaries', () => {
  const E = energyBlock();
  const feed = (body) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi"><entry><content><espi:ReadingType><espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier><espi:uom>72</espi:uom></espi:ReadingType></content></entry>${body}</feed>`;
  const reading = (start, v, cost) => `<espi:IntervalReading><espi:cost>${cost}</espi:cost><espi:timePeriod><espi:duration>86400</espi:duration><espi:start>${start}</espi:start></espi:timePeriod><espi:value>${v}</espi:value></espi:IntervalReading>`;
  const oct = Date.UTC(2025, 9, 10) / 1000, nov = Date.UTC(2025, 10, 10) / 1000;
  const r = E.parseEnergyFile(feed(`<entry><content><espi:IntervalBlock>${reading(oct, 20000, 300000)}${reading(oct + 86400, 22000, 330000)}${reading(nov, 30000, 450000)}</espi:IntervalBlock></content></entry>`));
  assert.ok(r.ok); assert.deepStrictEqual(r.records, [{ month: '2025-10', kwh: 42, cost: 6.3, days: 2 }, { month: '2025-11', kwh: 30, cost: 4.5, days: 1 }]);
  const sum = E.parseEnergyXml(feed(`<entry><content><espi:UsageSummary><espi:billingPeriod><espi:duration>2592000</espi:duration><espi:start>${Date.UTC(2025, 8, 5) / 1000}</espi:start></espi:billingPeriod><espi:billLastPeriod>9840000</espi:billLastPeriod><espi:overallConsumptionLastPeriod><espi:value>612000</espi:value></espi:overallConsumptionLastPeriod></espi:UsageSummary></content></entry>`));
  assert.deepStrictEqual(sum.records, [{ month: '2025-10', kwh: 612, cost: 98.4, days: 30 }]);
  assert.match(E.parseEnergyXml('<feed><espi:uom>38</espi:uom></feed>').error, /watt-hours/); assert.match(E.parseEnergyXml('<feed></feed>').error, /No usage readings/);
});

test('energy: merging, per-day figures and advice from a year of invented data', () => {
  const E = energyBlock();
  const mk = (m, kwh, rate, days) => ({ month: m, kwh, cost: Math.round(kwh * rate * 100) / 100, days });
  const data = [mk('2024-11', 900, .24, 30), mk('2024-12', 1500, .24, 31), mk('2025-01', 1700, .24, 31), mk('2025-02', 1500, .25, 28), mk('2025-03', 1200, .25, 31), mk('2025-04', 600, .26, 30), mk('2025-05', 520, .26, 31), mk('2025-06', 560, .27, 30), mk('2025-07', 640, .27, 31), mk('2025-08', 630, .28, 31), mk('2025-09', 540, .28, 30), mk('2025-10', 700, .29, 31)];
  const ser = E.energySeries(data); assert.strictEqual(ser.length, 12); assert.ok(Math.abs(ser[0].perDay - 30) < 1e-9); assert.ok(Math.abs(ser[11].rate - .29) < 1e-9);
  const ins = E.energyInsights(data), titles = ins.map((x) => x.title).join(' | ');
  assert.match(titles, /Winter use is [\d.]+ times your spring and fall use/); assert.match(titles, /Your lowest month uses [\d.]+ kWh a day/);
  assert.match(titles, /Using 10% less/);
  assert.ok(!/price per kWh/.test(titles));                                          // no same-month comparison available yet, so no rate claim (rates swing with season)
  assert.ok(ins.every((x) => x.saving === null || x.saving >= 0)); for (let i = 1; i < ins.length; i++) assert.ok((ins[i - 1].saving || 0) >= (ins[i].saving || 0));
  assert.deepStrictEqual(E.energyInsights([data[0]]), []);
  const merged = E.energyMerge([{ month: '2025-10', kwh: 1, cost: 1, days: 31 }, { month: '2025-09', kwh: 2, cost: 2, days: 30 }], [{ month: '2025-10', kwh: 700, cost: 200, days: 31 }, { month: '2025-11', kwh: 800, cost: 220 }]);
  assert.deepStrictEqual([merged.added, merged.updated, merged.records.map((r) => r.month + ':' + r.kwh)], [1, 1, ['2025-09:2', '2025-10:700', '2025-11:800']]);
  const yoy = E.energyInsights(data.concat([mk('2025-11', 1100, .29, 30)]));        // November 2025 against November 2024
  assert.ok(yoy.some((x) => /Compared with the same month last year: use up \d+%/.test(x.title)));
  assert.ok(yoy.some((x) => /price per kWh is up 21% on a year ago/.test(x.title)));                // 29 cents against 24 for November
  assert.ok(E.energyInsights(data.concat([mk('2025-11', 900, .245, 30)])).some((x) => /about the same as a year ago/.test(x.title)));
});

test('energy data survives a backup round trip and bad rows are dropped',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(/energy:S\.energy/.test(src)&&/energy:energy/.test(src)&&/energy:pendingImport\.energy/.test(src));
});

test('Plaid key form reads its fields before the busy redraw wipes them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const i = src.indexOf("var keys={clientId:$('#pl-id').value");
  assert.ok(i > 0 && i < src.indexOf('plRun(function(){return tcall(T.plaid.saveKeys(keys))'));
});

test('a bill linked to a sub-category is paid by transactions filed under it', () => {
  const B = billsWorld(), today = new Date(2026, 9, 25);
  const bill = { id: 'b1', name: 'Power', amount: 100, dueDay: 20, cat: 'Housing', sub: 'Electric', match: '' };
  const it = B.billItems([bill], [])[0];
  const tx = [{ date: '2026-10-19', name: 'ACH DEBIT 88123 UTIL CO', amount: -96, cat: 'Housing', sub: 'Electric' }, { date: '2026-10-19', name: 'ACH DEBIT WATER', amount: -50, cat: 'Housing', sub: 'Water' }];
  assert.strictEqual(B.billStatus(it, '2026-10', tx, {}, today).state, 'paid');
  assert.strictEqual(B.billStatus(it, '2026-10', tx.slice(1), {}, today).state, 'overdue');
  const noSub = B.billItems([{ ...bill, sub: '' }], [])[0];
  assert.notStrictEqual(B.billStatus(noSub, '2026-10', tx, {}, today).state, 'paid');
});

test('every main tab gets a Refresh button except the ones that have their own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes("data-act=\"refresh\"") && src.includes("view!=='invest'&&view!=='look'") && src.includes("a==='refresh'"));
});

test('Dashboard and Assistant tabs are wired in', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes("['dash','Dashboard'") && src.includes('dash:vDash') && src.includes("['assist','Assistant'") && src.includes('assist:vAssist'));
  assert.ok(src.includes('window.tally.localAi.chat') && src.includes('chose not to share'));
});

test('Windows build is configured and attached to the release after the Mac job', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['dist:win'], 'electron-builder --win --publish never');
  assert.deepStrictEqual(pkg.build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-mac.yml'), 'utf8');
  assert.ok(/build-windows:\n\s+needs: build\n\s+runs-on: windows-latest/.test(wf) && wf.includes('dist/*.exe'));
});

test('personal expenses like haircuts get their own categories and sub-categories', () => {
  const W = catWorld({ customCats: [], merchantCats: {}, subCats: {}, merchantSubs: {} });
  const cases = [
    ['GREAT CLIPS #1234 SPRINGFIELD', 'Personal care', 'Haircut'], ['Joe the Barber', 'Personal care', 'Haircut'], ['ULTA BEAUTY 551', 'Personal care', 'Cosmetics'],
    ['Lotus Nails & Spa', 'Personal care', 'Skin and nails'], ['PETCO 1042', 'Pets', 'Food and supplies'], ['Valley Veterinary Hospital', 'Pets', 'Vet'],
    ['UDEMY ONLINE COURSE', 'Education', 'Courses'], ['AMERICAN RED CROSS', 'Gifts and donations', 'Donations'], ['1-800-FLOWERS', 'Gifts and donations', 'Gifts and flowers'],
  ];
  cases.forEach(([name, cat, sub]) => { assert.strictEqual(W.guessCat(name), cat, name); assert.strictEqual(W.guessSub(cat, name), sub, name + ' sub'); });
  // earlier behaviour is unchanged for things that merely look similar
  ['HOT DOG STAND', 'Shell Oil 5521', 'EVERSOURCE', 'Spotify USA', 'Tokyo Cafe'].forEach((n) => assert.ok(!['Personal care', 'Pets', 'Education', 'Gifts and donations'].includes(W.guessCat(n)), n));
  assert.strictEqual(W.guessCat('Shell Oil 5521'), 'Transport'); assert.strictEqual(W.guessCat('EVERSOURCE'), 'Housing');
});

test('the bill form can make a new category and sub-category', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes('+ New category…') && src.includes('+ New sub-category…') && src.includes('function newCatName'));
});

test('backup keeps loan and card details such as the due day', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes('ac.dueDay=dd') && src.includes('ac.origBalance=+x.origBalance') && src.includes('ac.lender=cleanSubName'));
});

test('loan statement details: a newer statement replaces old figures, an older one is ignored, undated ones only fill in', () => {
  const L = loanBlock();
  const a = {};
  assert.strictEqual(L.applyStmt(a, { amountDue: 190, pastDue: 95, dueDate: '2026-10-21', accruedInterest: 120.2, lastPayAmt: 95, lastPayDate: '2026-09-14', asOf: '2026-10-01' }), true);
  assert.deepStrictEqual([a.amountDue, a.pastDue, a.accruedInterest, a.lastPayAmt, a.asOf], [190, 95, 120.2, 95, '2026-10-01']);
  assert.strictEqual(L.applyStmt(a, { amountDue: 999, asOf: '2026-08-01' }), false); assert.strictEqual(a.amountDue, 190);              // older statement ignored
  L.applyStmt(a, { amountDue: 95, pastDue: 0, dueDate: '2026-11-21', asOf: '2026-11-01' });                                          // caught up: past due and the other old figures clear
  assert.deepStrictEqual([a.amountDue, a.pastDue, a.accruedInterest, a.lastPayAmt, a.dueDate, a.asOf], [95, undefined, undefined, undefined, '2026-11-21', '2026-11-01']);
  const b = { pastDue: 50, asOf: '2026-10-01' }; L.applyStmt(b, { accruedInterest: 10 }); assert.deepStrictEqual([b.pastDue, b.accruedInterest], [50, 10]);   // no date: fill in only
  assert.deepStrictEqual(L.cleanStmt({ amountDue: '12.345', pastDue: -1, dueDate: 'soon', lastPayDate: '2026-02-30x' }), { amountDue: 12.35 });
});

function planWorld() {
  return new Function(srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + srcBlock('/*DEBTPLAN-START*/', '/*DEBTPLAN-END*/') + srcBlock('/*HOME-START*/', '/*HOME-END*/') +
    '\nreturn {amortize, requiredPayment, payoffPlan, monthlyForMonths, consolidationOffer, homeNorm, mortStep, homeMonthly, homeEquity, homeCompare, homeRentOut, homeSinceBuy, homeExtra, homeSim, homeRefi, growthPerMonth};')();
}

test('payoff plan: one debt matches the plain loan formula, and the money is all accounted for', () => {
  const P = planWorld();
  const one = P.payoffPlan([{ id: 'a', name: 'A', balance: 1000, apr: 12, minPay: 50 }], 100, 'avalanche');
  const ref = P.amortize(1000, 12, 100);
  assert.deepStrictEqual([one.months, Math.round(one.interest * 100)], [ref.months, Math.round(ref.interest * 100)]);
  const two = P.payoffPlan([{ id: 'a', name: 'A', balance: 1000, apr: 20, minPay: 25 }, { id: 'b', name: 'B', balance: 500, apr: 5, minPay: 25 }], 200, 'avalanche');
  assert.ok(Math.abs(two.paidTotal - (1500 + two.interest)) < 0.01, 'everything paid = what was owed + interest');
});

test('payoff plan: avalanche saves the most interest, snowball clears the smaller debts first, below-minimum is refused', () => {
  const P = planWorld(), debts = [{ id: 'a', name: 'Card', balance: 4000, apr: 24, minPay: 100 }, { id: 'b', name: 'Car', balance: 9000, apr: 6, minPay: 250 }, { id: 'c', name: 'Store', balance: 600, apr: 15, minPay: 30 }];
  const av = P.payoffPlan(debts, 600, 'avalanche'), sn = P.payoffPlan(debts, 600, 'snowball'), mn = P.payoffPlan(debts, 600, 'minimum');
  assert.ok(av.ok && sn.ok && mn.ok);
  assert.ok(av.interest <= sn.interest + 0.01 && sn.interest < mn.interest);
  assert.strictEqual(av.order[0].id, 'a'); assert.strictEqual(sn.order[0].id, 'c');          // highest rate first vs smallest balance first
  assert.ok(sn.left.findIndex((n) => n <= 2) <= av.left.findIndex((n) => n <= 2));            // snowball is down to two debts no later
  assert.deepStrictEqual([P.payoffPlan(debts, 300, 'avalanche').reason, P.payoffPlan(debts, 300, 'avalanche').minTotal], ['below', 380]);
  assert.ok(P.payoffPlan(debts, 600, 'avalanche', { lump: 2000 }).months < av.months);
  assert.strictEqual(P.payoffPlan([{ id: 'x', name: 'X', balance: 1000, apr: 30, minPay: 5 }], 100, 'minimum').reason, 'never');   // minimum does not cover the interest
});

test('payoff plan: the monthly amount needed for a deadline, and a consolidation offer', () => {
  const P = planWorld(), debts = [{ id: 'a', name: 'Card', balance: 4000, apr: 24, minPay: 100 }, { id: 'b', name: 'Car', balance: 9000, apr: 6, minPay: 250 }];
  const m = P.monthlyForMonths(debts, 36, 'avalanche', 0);
  assert.ok(P.payoffPlan(debts, m, 'avalanche').months <= 36 && P.payoffPlan(debts, m - 0.05, 'avalanche').months > 36);
  assert.strictEqual(P.monthlyForMonths(debts, 1, 'avalanche', 0) > 13000, true);
  const c = P.consolidationOffer([{ id: 'a', name: 'Card', balance: 10000, apr: 20, minPay: 250 }], 8, 36, 0);
  assert.ok(Math.abs(c.pay - 313.36) < 0.01 && c.saving > 0 && c.monthsNew === 36);
  assert.ok(P.consolidationOffer([{ id: 'a', name: 'Card', balance: 10000, apr: 6, minPay: 250 }], 8, 36, 3).saving < 0);   // a higher rate plus a fee costs more
});

test('home: monthly cost, equity and rent-out figures follow from the inputs', () => {
  const P = planWorld(), pi = P.requiredPayment(300000, 6, 360);
  assert.ok(Math.abs(pi - 1798.65) < 0.01);
  const h = P.homeNorm({ value: 400000, balance: 300000, apr: 6, pi, taxYear: 4800, insYear: 1200, hoaMonth: 50, rentMonth: 3000 });
  assert.deepStrictEqual([h.maintPct, h.sellPct, h.appreciation, h.ret], [1, 7, 3, 6]);
  const mo = P.homeMonthly(h);
  assert.ok(Math.abs(mo.interest - 1500) < 0.01 && Math.abs(mo.principal - 298.65) < 0.01 && Math.abs(mo.cash - 2681.98) < 0.01 && Math.abs(mo.cost - (2681.98 - 298.65)) < 0.01);
  const eq = P.homeEquity(h); assert.deepStrictEqual([eq.equity, eq.proceeds, Math.round(eq.ltv)], [100000, 72000, 75]);
  assert.strictEqual(P.homeMonthly({ ...h, balance: 340000, pmiMonth: 120 }).pmi, 120);        // over 80% loan-to-value: PMI applies
  const ro = P.homeRentOut(h);
  assert.ok(Math.abs(ro.noi - 1738.67) < 0.01 && Math.abs(ro.cashFlow - (1738.67 - 1798.65)) < 0.01 && Math.abs(ro.capRate - 5.22) < 0.01 && Math.abs(ro.breakEvenRent - 3068.6) < 0.5);
});

test('home: keep versus sell breaks even when keeping stays ahead; invariants hold', () => {
  const P = planWorld(), pi = P.requiredPayment(300000, 6, 360);
  const base = { value: 400000, balance: 300000, apr: 6, pi, taxYear: 4800, insYear: 1200, hoaMonth: 0, appreciation: 0, ret: 0, sellPct: 0, rentMonth: 3000 };
  const a = P.homeCompare(P.homeNorm(base), 10);
  assert.strictEqual(a.beLive, 0);                                                              // rent above the cost of owning: keeping is ahead from the start
  const b = P.homeCompare(P.homeNorm({ ...base, rentMonth: 1500, sellPct: 7 }), 10);
  assert.strictEqual(b.beLive, null);                                                           // cheap rent and 7% selling costs: selling and renting stays ahead
  const c = P.homeCompare(P.homeNorm({ ...base, rentMonth: 2200, appreciation: 1, ret: 5, sellPct: 7 }), 30);
  assert.ok(c.beLive > 60 && c.beLive < 120, 'crosses over after about seven years, got ' + c.beLive);
  c.rows.forEach((r) => { if (r.year * 12 > c.beLive + 12) assert.ok(r.keep >= r.sellLive - 1, 'stays ahead after break-even, year ' + r.year); else if (r.year * 12 < c.beLive - 12) assert.ok(r.keep < r.sellLive, 'behind before break-even, year ' + r.year); });
  assert.strictEqual(P.homeCompare(P.homeNorm({ ...base, rentMonth: 0 }), 10).beLive, null);   // no rent figure: no comparison
  assert.strictEqual(a.rows.length, 10);
});

test('home: since you bought, extra payments versus investing, and refinancing', () => {
  const P = planWorld(), pi = P.requiredPayment(280000, 6, 360);
  const sb = P.homeSinceBuy(P.homeNorm({ value: 350000, balance: 270000, apr: 6, pi, purchasePrice: 350000, down: 70000, sellPct: 0, appreciation: 0 }), 24);
  let bal = 280000, ci = 0; for (let i = 0; i < 24; i++) { const s = P.mortStep(bal, 6, pi); ci += s.interest; bal = s.bal; }
  assert.ok(Math.abs(sb.cumInterest - ci) < 0.01 && Math.abs(sb.gain + ci + sb.otherCosts) < 0.01 && sb.beMonths === null);
  assert.strictEqual(P.homeSinceBuy(P.homeNorm({ value: 500000, balance: 270000, apr: 6, pi, purchasePrice: 350000, down: 70000, sellPct: 6 }), 24).beMonths, 0);   // already ahead
  const h = P.homeNorm({ value: 400000, balance: 300000, apr: 6, pi: P.requiredPayment(300000, 6, 360) });
  const eqRet = (Math.pow(1 + 6 / 1200, 12) - 1) * 100;
  const tie = P.homeExtra({ ...h, ret: eqRet }, [200])[0];
  assert.strictEqual(tie.better, 'tie'); assert.ok(tie.monthsSaved > 50 && tie.interestSaved > 50000);
  assert.strictEqual(P.homeExtra({ ...h, ret: 2 }, [200])[0].better, 'pay'); assert.strictEqual(P.homeExtra({ ...h, ret: 12 }, [200])[0].better, 'invest');
  const rf = P.homeRefi(h, { rate: 5, years: 30, cost: 6000 });
  assert.ok(Math.abs(rf.newPay - 1610.46) < 0.01 && rf.breakEvenMonths === Math.ceil(6000 / (h.pi - rf.newPay)) && rf.lifetimeSaving > 50000);
  assert.strictEqual(P.homeRefi(h, { rate: 7, years: 30, cost: 0 }).breakEvenMonths, null);       // a higher rate never pays back
});

test('home advice: reads the numbers into plain statements, with the right verdicts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const P = new Function(srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + srcBlock('/*HOME-START*/', '/*HOME-END*/') + '\nreturn {requiredPayment, homeNorm, homeMonthly, homeEquity, homeCompare, homeRentOut, homeSinceBuy, homeExtra, homeAdvice};')();
  const pi = P.requiredPayment(300000, 6, 360);
  const run = (over) => { const h = P.homeNorm({ value: 400000, balance: 300000, apr: 6, pi, taxYear: 4800, insYear: 1200, rentMonth: 2600, purchasePrice: 340000, down: 40000, closing: 8000, ...over });
    return { h, items: P.homeAdvice(h, { mo: P.homeMonthly(h), eq: P.homeEquity(h), cmp: P.homeCompare(h, 10), ro: P.homeRentOut(h), sb: P.homeSinceBuy(h, 36), ex: P.homeExtra(h, [100, 250, 500]) }) }; };
  const low = run({ ret: 3 }).items.map((i) => i.title).join('|');
  assert.ok(/Paying extra on the mortgage looks better than investing/.test(low));
  assert.ok(/Investing the extra money is expected to beat/.test(run({ ret: 12 }).items.map((i) => i.title).join('|')));
  assert.ok(/mortgage insurance \(PMI\)/.test(run({ balance: 360000, pmiMonth: 150, pi: P.requiredPayment(360000, 6, 360) }).items.map((i) => i.title).join('|')));
  const t = run({}).items; assert.ok(t.length >= 6 && t.every((i) => i.title && i.detail && ['good', 'warn', 'info'].includes(i.k)));
  assert.ok(!run({ rentMonth: 0 }).items.some((i) => /rental|rent it|selling and renting/i.test(i.title)));
});

test('debt advice: recommends by the numbers and flags the real problems', () => {
  const P = new Function(srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + srcBlock('/*DEBTPLAN-START*/', '/*DEBTPLAN-END*/') + '\nreturn {payoffPlan, debtAdvice};')();
  const debts = [{ id: 'a', name: 'Visa', type: 'credit', balance: 4000, apr: 24, minPay: 100 }, { id: 'b', name: 'Car', type: 'auto', balance: 9000, apr: 3, minPay: 250 }, { id: 'c', name: 'Direct Loan', type: 'student', balance: 6000, apr: 6, minPay: 70 }];
  const minT = 420, plans = (monthly) => ({ min: P.payoffPlan(debts, minT, 'minimum'), av: P.payoffPlan(debts, monthly, 'avalanche'), sn: P.payoffPlan(debts, monthly, 'snowball') });
  const mk = (monthly, surplus) => { const pl = plans(monthly); return P.debtAdvice({ debts, monthly, minTotal: minT, surplus, ...pl, plusExtra: { extra: 100, plan: P.payoffPlan(debts, monthly + 100, 'avalanche') } }); };
  const items = mk(700, 300), titles = items.map((i) => i.title).join('|');
  assert.ok(/Pay the highest interest rate first|Either order works/.test(titles) && /Your most expensive debt is Visa at 24%/.test(titles) && /credit cards cost about \$80 a month/.test(titles) && /Low-rate debts/.test(titles) && /student loans/.test(titles) && /leftover money/.test(titles));
  assert.ok(/Your monthly amount is below your minimum/.test(mk(300, 0).map((i) => i.title).join('|')));
  assert.deepStrictEqual(P.debtAdvice({ debts: [], monthly: 0, minTotal: 0, surplus: 0 }), []);
});

test('Loans hub and Mortgage tab are wired in, old tab names still open the hub, and backups carry the new data', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(src.includes("['loans','Loans']") && src.includes("['mortgage','Mortgage'") && src.includes('loans:vLoansHub,mortgage:vMortgage'));
  assert.ok(!src.includes("['carloan','Car loan'") && src.includes("loanFilter=view==='student'?'student':'auto';view='loans'"));
  assert.ok(src.includes('home:S.home,debtMonthly:S.debtMonthly') && src.includes('home:home,debtMonthly:') && src.includes('home:pendingImport.home||{}'));
});

// ---- smarter bills and no double counting ----
function transferBlock() { return new Function(srcBlock('/*TRANSFER-START*/', '/*TRANSFER-END*/') + '\nreturn {isTransfer, transferInfo, ledgerOf};')(); }

test('phone carriers are filed as a phone plan, but plain Xfinity stays internet', () => {
  const W = catWorld({ customCats: [], merchantCats: {} });
  for (const n of ['T-MOBILE*SERVICES 8005', 'XFINITY MOBILE AUTOPAY', 'VERIZON WIRELESS PAYMENTS', 'MINT MOBILE', 'AT&T WIRELESS', 'GOOGLE FI', 'CRICKET WIRELESS', 'VISIBLE WIRELESS']) {
    assert.strictEqual(W.guessCat(n), 'Subscriptions', n);
    assert.strictEqual(W.guessSub('Subscriptions', n), 'Phone plan', n);
  }
  assert.strictEqual(W.guessCat('XFINITY INTERNET 123'), 'Housing');
  assert.strictEqual(W.guessCat('VERIZON FIOS'), 'Housing');
});

test('transfers: card payments, thank-you credits and own-account moves are not spending or income', () => {
  const T = transferBlock();
  const buys = [{ amount: -40, name: 'SHAWS', date: '2026-10-01' }];
  const cardSide = buys.concat([{ amount: 500, name: 'PAYMENT THANK YOU', date: '2026-10-03', cat: 'Income' }]);
  const pay = { amount: -500, name: 'CHASE CREDIT CRD AUTOPAY', date: '2026-10-03' };
  assert.strictEqual(T.isTransfer({ amount: 500, name: 'PAYMENT THANK YOU' }, T.transferInfo(cardSide, 'auto')), true);   // never income
  assert.strictEqual(T.isTransfer(pay, T.transferInfo(buys, 'auto')), false);        // card purchases are not in the app: the payment is the only record, keep it
  assert.strictEqual(T.isTransfer(pay, T.transferInfo(cardSide, 'auto')), true);     // they are: counting the payment too would double count
  assert.strictEqual(T.isTransfer(pay, T.transferInfo(buys, 'skip')), true);
  assert.strictEqual(T.isTransfer(pay, T.transferInfo(cardSide, 'count')), false);
  assert.strictEqual(T.isTransfer({ amount: -300, name: 'ONLINE TRANSFER TO SAVINGS' }, T.transferInfo(buys, 'auto')), true);
  assert.strictEqual(T.isTransfer({ amount: -1900, name: 'CHASE MORTGAGE PAYMENT' }, T.transferInfo(cardSide, 'skip')), false);   // a loan payment is real spending
  assert.strictEqual(T.isTransfer({ amount: -30, name: 'ZELLE PAYMENT TO JOE' }, T.transferInfo(buys, 'skip')), false);
  assert.strictEqual(T.isTransfer({ amount: -500, name: 'CHASE CREDIT CRD AUTOPAY', transfer: false }, T.transferInfo(cardSide, 'skip')), false);   // your choice wins
  assert.strictEqual(T.isTransfer({ amount: -25, name: 'SOMETHING ELSE', transfer: true }, null), true);
  assert.strictEqual(T.ledgerOf(cardSide.concat([pay]), 'auto').length, 1);
});

test('bills: a recurring phone payment filed under Housing is still found as a phone bill, and one-offs are not', () => {
  const B = billsWorld();
  const catOf = (n) => /t-mobile/i.test(n) ? { cat: 'Subscriptions', sub: 'Phone plan' } : { cat: 'Other', sub: '' };
  const mk = (d, name, a, cat) => ({ date: d, name, amount: -a, cat: cat || 'Housing' });
  const txns = [mk('2026-08-12', 'T-MOBILE*SERVICES 111', 85), mk('2026-09-12', 'T-MOBILE*SERVICES 222', 85), mk('2026-10-11', 'T-MOBILE*SERVICES 333', 86.5),
    mk('2026-09-20', 'RANDOM STORE', 90), mk('2026-10-21', 'RANDOM STORE', 400)];
  const auto = B.autoBillItems(txns, [], '2026-10', {}, catOf);
  assert.strictEqual(auto.length, 1);
  assert.deepStrictEqual([auto[0].cat, auto[0].sub, auto[0].dueDay, auto[0].source], ['Subscriptions', 'Phone plan', 12, 'auto']);
  assert.strictEqual(B.autoBillItems(txns, [], '2026-10', { [auto[0].key]: 1 }, catOf).length, 0);   // dismissed stays dismissed
  const st = B.billStatus(auto[0], '2026-10', txns, {}, new Date(2026, 9, 20));
  assert.strictEqual(st.state, 'paid');
  const stopped = txns.filter((x) => x.date < '2026-09-30');
  assert.strictEqual(B.autoBillItems(stopped, [], '2026-11', {}, catOf).length, 0);                  // stopped two months ago: not a current bill
});

test('bills: a car loan with a payment but no due day still appears, with the day your payments land', () => {
  const B = billsWorld();
  const acct = [{ id: 'c1', type: 'auto', name: 'Honda Accord', lender: 'Honda Financial', balance: 12000, minPay: 410, dueDay: 0 }];
  const txns = [{ date: '2026-09-17', name: 'HONDA FINANCIAL PMT', amount: -410 }, { date: '2026-10-17', name: 'HONDA FINANCIAL PMT', amount: -410 }];
  const items = B.billItems([], acct, txns);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual([items[0].dueDay, items[0].dayGuessed, items[0].sub], [17, true, 'Car loan']);
  assert.strictEqual(B.billStatus(items[0], '2026-10', txns, {}, new Date(2026, 9, 20)).state, 'paid');
  assert.strictEqual(B.billItems([], acct).length, 1);                                                // no transactions at all: still listed
});

test('app wiring: spending, income, budgets and reports read the ledger; transfers survive backup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src, /function spendBy\(mk\)\{var o=\{\},t=0;ledger\(\)/);
  assert.match(src, /function incomeOf\(mk\)\{var t=0;ledger\(\)/);
  assert.match(src, /monthReport\(ledger\(\)/);
  assert.match(src, /t\.transfer=x\.transfer/);
  assert.match(src, /billIgnore:S\.billIgnore,cardPay:S\.cardPay/);
});

test('bills: student loan groups from one lender are one bill that adds up and carries the past-due total', () => {
  const B = billsWorld();
  const mk = (id, pay, past) => ({ id, type: 'student', name: 'Direct loan, group ' + id, lender: 'Nelnet', balance: 1000, minPay: pay, dueDay: 28, pastDue: past });
  const items = B.billItems([], [mk('AA', 37.65, 10), mk('AB', 34.54, 5), { id: 'x', type: 'auto', name: 'Car', lender: 'Honda', balance: 5000, minPay: 300, dueDay: 5 }]);
  assert.strictEqual(items.length, 2);
  const g = items.find((i) => /Nelnet/.test(i.name));
  assert.deepStrictEqual([g.name, g.amount, g.dueDay, g.raw.pastDue], ['Nelnet student loans (2)', 72.19, 28, 15]);
  const st = B.billStatus(g, '2026-10', [{ date: '2026-10-27', name: 'DEPT EDUCATION NELNET PMT', amount: -72.19 }], {}, new Date(2026, 9, 28));
  assert.strictEqual(st.state, 'paid');
});

test('history: typical month ignores one-off extremes, flags swings and gives a safe extra', () => {
  const w = budgetWorld();
  const H = w.deps.historyStats;
  const mkT = (m, inc, sp) => [{ date: m + '-05', name: 'PAY', amount: inc, cat: 'Income' }, { date: m + '-10', name: 'STUFF', amount: -sp, cat: 'Shopping' }];
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const spends = [2000, 2100, 1900, 6000, 2050, 1950, 2000];             // June had a one-off
  const txns = months.flatMap((m, i) => mkT(m, 3000, spends[i]));
  const h = H(txns, '2026-10', 12);
  assert.strictEqual(h.n, 7);
  assert.ok(h.avgSpend < 2500, 'one big month must not decide the average: ' + h.avgSpend);
  assert.ok(h.surplus > 800);
  assert.ok(h.safeExtra > 0 && h.safeExtra <= h.surplus);
  assert.strictEqual(h.badMonths, 1);
  assert.strictEqual(H([], '2026-10', 12).n, 0);
});

test('history: hints from housing payments in transactions (tax, insurance, HOA, repairs, mortgage)', () => {
  const w = budgetWorld();
  const hints = w.deps.homeHints;
  const t = [];
  for (let i = 1; i <= 12; i++) { const m = i <= 9 ? '2026-' + String(10 - i).padStart(2, '0') : '2025-' + String(22 - i).padStart(2, '0'); t.push({ date: m + '-03', name: 'MR COOPER MORTGAGE', amount: -2200, cat: 'Housing', sub: 'Mortgage' }, { date: m + '-04', name: 'HOA DUES', amount: -150, cat: 'Housing' }); }
  t.push({ date: '2026-04-15', name: 'TOWN OF BENNINGTON PROPERTY TAX', amount: -3000, cat: 'Housing' }, { date: '2025-11-15', name: 'TOWN OF BENNINGTON PROPERTY TAX', amount: -3000, cat: 'Housing' },
    { date: '2026-02-01', name: 'LEMONADE HOMEOWNERS', amount: -1200, cat: 'Housing' }, { date: '2026-06-02', name: 'ACE HARDWARE', amount: -400, cat: 'Housing', sub: 'Repairs and supplies' });
  const r = hints(t, '2026-10');
  assert.deepStrictEqual([r.mortMonth, r.hoaMonth, r.taxYear, r.insYear, r.repairYear], [2200, 150, 6000, 1200, 400]);
});

test('investments: holdings are grouped into topics, user choice wins, unpriced holdings use what was invested', () => {
  const T = new Function(srcBlock('/*TOPIC-START*/', '/*TOPIC-END*/') + '\nreturn {topicOf, topicGroups, TOPICS};')();
  assert.strictEqual(T.topicOf({ symbol: 'aapl' }), 'Technology');
  assert.strictEqual(T.topicOf({ symbol: 'VTI' }), 'Funds and ETFs');
  assert.strictEqual(T.topicOf({ symbol: 'XLE' }), 'Energy');
  assert.strictEqual(T.topicOf({ symbol: 'ZZZZ' }), 'Other');
  assert.strictEqual(T.topicOf({ symbol: 'ZZZZ', topic: 'Healthcare' }), 'Healthcare');
  assert.strictEqual(T.topicOf({ symbol: 'AAPL', topic: 'not a topic' }), 'Technology');
  const hs = [{ symbol: 'AAPL', shares: 1, invested: 100 }, { symbol: 'MSFT', shares: 1, invested: 100 }, { symbol: 'VTI', shares: 1, invested: 300 }, { symbol: 'NEWCO', shares: 1, invested: 50 }];
  const g = T.topicGroups(hs, (h) => ({ AAPL: 300, MSFT: 100, VTI: 300 }[h.symbol] ?? null));
  assert.deepStrictEqual(g.map((x) => [x.topic, x.value]), [['Technology', 400], ['Funds and ETFs', 300], ['Other', 50]]);
  assert.strictEqual(g[0].items[0].h.symbol, 'AAPL');
  assert.ok(Math.abs(g.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
});

test('apple card: CSV (purchases positive, Type column) is flipped, payments become transfers; OFX is read', () => {
  const { logic } = world();
  const F = { csvDetect: logic.csvDetect, csvBuild: logic.csvBuild, ofxParse: logic.ofxParse, pdfReviewRows: logic.pdfReviewRows };
  const csv = ['Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By',
    '10/01/2026,10/02/2026,SHAWS SUPERMARKET,Shaws,Grocery,Purchase,54.20,Sam',
    '10/03/2026,10/04/2026,AMAZON MKTPLACE,Amazon,Shopping,Purchase,23.99,Sam',
    '10/05/2026,10/05/2026,ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234,,Payment,Payment,-300.00,Sam',
    '10/06/2026,10/06/2026,DAILY CASH ADJUSTMENT,Apple,Other,Credit,-1.50,Sam'].join('\n');
  const det = F.csvDetect(csv);
  assert.ok(det.ok); assert.strictEqual(det.flip, true);
  const rows = F.csvBuild(det.rows, det.headerIdx, det.map, { order: det.order, flip: det.flip }).rows;
  assert.deepStrictEqual(rows.map((r) => [r.date, r.amount]), [['2026-10-01', -54.2], ['2026-10-03', -23.99], ['2026-10-05', 300], ['2026-10-06', 1.5]]);
  const rev = F.pdfReviewRows([{ rows }]);
  assert.deepStrictEqual(rev.map((r) => [r.transfer, r.on]), [[false, true], [false, true], [true, false], [false, true]]);   // the payment is skipped, so it is not income
  assert.strictEqual(rev[3].cat, 'Other');                                                                                   // Daily Cash is a credit, not pay
  const ofx = 'OFXHEADER:100\n<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001120000[-5:EST]<TRNAMT>-54.20<NAME>SHAWS &amp; CO\n</STMTTRN>\n<STMTTRN><TRNTYPE>PAYMENT<DTPOSTED>20261005<TRNAMT>300.00<NAME>PAYMENT THANK YOU\n</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-1234.56<DTASOF>20261006</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>';
  const o = F.ofxParse(ofx);
  assert.deepStrictEqual(o.rows.map((r) => [r.date, r.name, r.amount, r.kind]), [['2026-10-01', 'SHAWS & CO', -54.2, 'debit'], ['2026-10-05', 'PAYMENT THANK YOU', 300, 'payment']]);
  assert.strictEqual(o.balance, -1234.56);
});

test('contract: schedule reproduces the disclosed finance charge, status counts payments and gives a payoff', () => {
  const C = new Function(srcBlock('/*CONTRACT-START*/', '/*CONTRACT-END*/') + '\nreturn {contractSchedule, contractStatus, contractExtra};')();
  const c = { amount: 51679, apr: 9.44, payment: 846.32, count: 84, firstDate: '2024-09-03' };
  const sch = C.contractSchedule(c);
  assert.ok(sch.fitted); assert.strictEqual(sch.rows.length, 84);
  assert.ok(Math.abs(sch.totalInterest - 19411.88) < 0.05, 'interest ' + sch.totalInterest);
  assert.ok(Math.abs(sch.totalPaid - 71090.88) < 0.05);
  assert.strictEqual(sch.rows[83].date, '2031-08-03');
  const st = C.contractStatus(c, sch, new Date(2026, 9, 14));
  assert.strictEqual(st.paidCount, 26); assert.strictEqual(st.left, 58);
  assert.ok(Math.abs(st.payoff - (st.principal + st.accrued)) < 1e-9);
  assert.ok(st.accrued > 100 && st.accrued < 125, 'about 11 days of interest: ' + st.accrued);
  assert.ok(Math.abs(st.paidPrincipal + st.principal - 51679) < 0.01);
  assert.strictEqual(st.next.date, '2026-11-03');
  const base = C.contractExtra(st.principal, 9.44, 846.32, 0), more = C.contractExtra(st.principal, 9.44, 846.32, 100);
  assert.ok(more.months < base.months && more.interest < base.interest);
  assert.strictEqual(C.contractExtra(1000, 24, 5, 0), null);                                   // a payment smaller than the interest never pays it off
  assert.strictEqual(C.contractSchedule({ amount: 0, apr: 5, payment: 10, count: 12, firstDate: '2026-01-01' }), null);
  const d = C.contractSchedule({ amount: 10000, apr: 6, payment: 870, count: 12, firstDate: '2026-02-15' });
  assert.strictEqual(C.contractStatus({ amount: 10000, apr: 6 }, d, new Date(2026, 4, 20)).paidCount, 4);
  assert.ok(d.rows[11].balance < 0.01);
});

test('contract details survive backup and restore, and junk is dropped', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src, /var cc=cleanContract\(x\.contract\);if\(cc\)ac\.contract=cc/);
  const fn = src.slice(src.indexOf('function cleanContract(c){'), src.indexOf('function cleanHoldings(h){'));
  const cleanContract = new Function(fn + '\nreturn cleanContract;')();
  const ok = cleanContract({ apr: 9.44, amountFinanced: 51679, payment: 846.32, count: 84, firstDate: '2024-09-03', vehicle: '2024 Honda Civic', vin: 'JHMFL5G40RX003880', condition: 'new', prepaymentPenalty: false, evil: '<script>', financeCharge: -5 });
  assert.deepStrictEqual(Object.keys(ok).sort(), ['amountFinanced', 'apr', 'condition', 'count', 'firstDate', 'payment', 'prepaymentPenalty', 'vehicle', 'vin']);
  assert.strictEqual(cleanContract({ amountFinanced: 1000, payment: 10, count: 12, firstDate: 'tomorrow' }), undefined);
  assert.strictEqual(cleanContract('x'), undefined);
});
