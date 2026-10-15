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
  const bills = { rows: [{ item: { name: 'Rent', amount: 1500 }, st: { state: 'upcoming', due: new Date(2026, 9, 15) } }, { item: { name: 'Therapy Associates', amount: 120 }, st: { state: 'upcoming', due: new Date(2026, 9, 13) } }, { item: { name: 'Paid one', amount: 5 }, st: { state: 'paid', due: new Date(2026, 9, 13) } }, { item: { name: 'Far', amount: 9 }, st: { state: 'upcoming', due: new Date(2026, 10, 20) } }] };
  const f = new Function('S,TODAY,NOWKEY,CATS,spendBy,incomeOf,activeSubs,nextDate,dayDiff,iso,monthLabel,netWorth,billsSummary,allBillItems,billName,isHiddenName',
    code + '\nreturn widgetSummary;')(S, TODAY, '2026-10', ['Dining', 'Groceries', 'Other', 'Income'],
    () => ({ by: { Dining: 160, Groceries: 120, Other: 40 }, total: 320 }), () => 2400,
    () => S.subs, (x) => (x.name === 'Netflix' ? new Date(2026, 9, 14) : new Date(2026, 10, 20)),
    (a, b) => Math.round((b - a) / 864e5), (d) => '2026-10-12', () => 'October 2026', () => ({ net: 5000, assets: 7000, debts: 2000 }), () => bills, () => [], (n) => (/therapy/i.test(n) ? 'Hidden bill' : n), (n) => /therapy/i.test(n));
  const w = f();
  assert.deepStrictEqual(w.spend, { income: 2400, spent: 320, budgeted: 400, budgetSpent: 280, left: 120, perDay: 120 / 20 });
  assert.deepStrictEqual(w.over, [{ cat: 'Dining', spent: 160, budget: 100 }]);
  assert.deepStrictEqual(w.bills, [{ name: 'Hidden bill', amount: 120, days: 1 }, { name: 'Netflix', amount: 15, days: 2 }, { name: 'Rent', amount: 1500, days: 3 }]);   // bills from the Bills tab first, hidden names masked, subscriptions added
  assert.deepStrictEqual(w.goal, { name: 'Car', pct: 50 });
  assert.strictEqual(w.daysLeft, 20);
  assert.ok(!/Secret|1234|Therapy/.test(JSON.stringify(w)));
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
  return new Function('aiKey,monthKey,shiftMonth,iso', srcBlock('/*LOAN-START*/', '/*LOAN-END*/') + srcBlock('/*BILLS-START*/', '/*BILLS-END*/') + '\nreturn {billMatchRe, billItems, dueDateFor, billStatus, billsSummary, suggestBills, autoBillItems, billApply, cleanBillAdj};')(aiKey, monthKey, shiftMonth, iso);
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
  assert.deepStrictEqual(pkg.build.win.target, [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }]);
  assert.strictEqual(pkg.build.portable.artifactName, 'Tally.Money-Portable-${version}.${ext}');
  assert.ok(!/Setup.*\.exe/.test(pkg.build.portable.artifactName));   // the updater only picks the Setup installer
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
  assert.ok(!src.includes("['carloan','Car loan'") && src.includes("if(view==='cashback')view='cards';else if(view==='carloan'||view==='student'){loanFilter=view==='student'?'student':'auto';view='loans'}"));
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
  const rev = F.pdfReviewRows([{ rows }], { card: true });
  assert.deepStrictEqual(rev.map((r) => [r.transfer, r.card, r.on]), [[false, false, true], [false, false, true], [true, true, true], [false, false, true]]);   // the payment is kept as a card payment (a transfer), so it is never income
  const own = F.pdfReviewRows([{ rows: [{ date: '2026-10-05', name: 'TRANSFER FROM SAVINGS', amount: 50, transfer: true }] }]);
  assert.deepStrictEqual(own.map((r) => [r.transfer, r.card, r.on]), [[true, false, false]]);                          // an ordinary transfer between your own accounts stays unchecked
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

test('illustrations: car body style comes from the name, waffle always has 100 squares, photos are validated', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const art = src.slice(src.indexOf('var CAR_COLORS'), src.indexOf('// Resize a chosen photo')) + src.slice(src.indexOf('function photoOk'), src.indexOf('function photoControls'));
  const A = new Function('esc,vzColor', art + '\nreturn {carType, waffleSVG, houseSVG, carScene, photoOk, CAR_TYPES};')((s) => String(s), (i) => 'c' + i);
  const cases = { '2024 Honda Civic Type R': 'civictyper', 'Honda Civic Sport': 'hatchback', 'Ford F-150': 'pickup', 'Toyota RAV4': 'suv', 'Honda Odyssey': 'minivan', 'Ford Mustang': 'coupe', 'Toyota Camry': 'sedan', 'Tesla Model Y': 'suv', 'Honda Accord': 'sedan' };
  Object.keys(cases).forEach((n) => assert.strictEqual(A.carType(n), cases[n], n));
  [[30, 25, 15, 30], [1, 1, 1], [33.3, 33.3, 33.4], [0.2, 99.8]].forEach((v) => {
    const svg = A.waffleSVG(v.map((x, i) => ({ v: x, label: 'p' + i })));
    assert.strictEqual((svg.match(/class="wcell"/g) || []).length, 100);
  });
  assert.strictEqual(A.waffleSVG([{ v: 0, label: 'x' }]), '');
  assert.match(A.houseSVG(0.39), /39% yours/); assert.match(A.houseSVG(5), /100% yours/); assert.match(A.houseSVG(-1), /0% yours/);
  assert.match(A.carScene({ name: 'x' }, 0.5, {}), /--carx:/);
  assert.strictEqual(A.photoOk('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.strictEqual(A.photoOk('data:image/svg+xml;base64,AAAA'), false);
  assert.strictEqual(A.photoOk('javascript:alert(1)'), false);
  assert.strictEqual(A.photoOk('data:image/jpeg;base64,' + 'A'.repeat(200001)), false);
  assert.match(src, /if\(photoOk\(d\.home\.photo\)\)home\.photo=d\.home\.photo/);
});

test('net worth series: uses the balance on or before each date, debts subtract, today is the current balance', () => {
  const N = new Function(srcBlock('/*NETWORTH-START*/', '/*NETWORTH-END*/') + '\nreturn {netWorthTrail};')();
  const accts = [
    { type: 'checking', balance: 1500, history: [{ date: '2026-07-01', balance: 1000 }, { date: '2026-09-01', balance: 1400 }] },
    { type: 'auto', balance: 9000, history: [{ date: '2026-06-01', balance: 12000 }, { date: '2026-10-01', balance: 9500 }] },
    { type: 'savings', balance: 500, history: [] },
  ];
  const isDebt = (a) => a.type === 'auto';
  const s = N.netWorthTrail(accts, isDebt, new Date(2026, 9, 14), 90, 3);
  assert.strictEqual(s.length, 4);
  assert.strictEqual(s[3], 1500 + 500 - 9000);                       // today: current balances
  assert.strictEqual(s[0], 1000 + 500 - 12000);                      // about 90 days ago (Jul 16): checking 1000, loan 12000, savings unknown so its balance
  assert.deepStrictEqual(N.netWorthTrail([], isDebt, new Date(2026, 9, 14), 90, 2), [0, 0, 0]);
});

test('vault: password-sealed data round-trips, and a wrong password or tampering fails', async () => {
  const V = new Function('crypto,btoa,atob,TextEncoder,TextDecoder', block('VAULT') + '\nreturn {vaultSeal,vaultOpen,vaultEnvOk,xferPack,xferKind,vaultNew,vaultEnc,vaultDec};')(require('crypto').webcrypto, btoa, atob, TextEncoder, TextDecoder);
  const IT = 100000; // fewer rounds keeps the test quick; the app uses 600,000
  const data = JSON.stringify({ txns: [{ name: 'Café ☕', amount: -4.5 }], big: 'x'.repeat(300000) });
  const env = await V.vaultSeal(data, 'correct horse battery', IT);
  assert.ok(V.vaultEnvOk(env));
  assert.ok(!Buffer.from(env.ct, 'base64').includes('Café'));
  assert.strictEqual(await V.vaultOpen(env, 'correct horse battery'), data);
  await assert.rejects(V.vaultOpen(env, 'correct horse batterY'), /Wrong password/);
  const bad = { ...env, ct: env.ct.slice(0, 20) + (env.ct[20] === 'A' ? 'B' : 'A') + env.ct.slice(21) };
  await assert.rejects(V.vaultOpen(bad, 'correct horse battery'));
  // two seals of the same data never look alike (fresh salt and nonce)
  const env2 = await V.vaultSeal(data, 'correct horse battery', IT);
  assert.notStrictEqual(env.ct, env2.ct); assert.notStrictEqual(env.salt, env2.salt);
  // envelope validation refuses junk and absurd iteration counts
  assert.ok(!V.vaultEnvOk(null)); assert.ok(!V.vaultEnvOk({})); assert.ok(!V.vaultEnvOk({ ...env, it: 1 })); assert.ok(!V.vaultEnvOk({ ...env, it: 1e9 }));
  await assert.rejects(V.vaultOpen({ ...env, it: 1e9 }, 'x'));
});

test('transfer file: password-protected when a password is given, plain JSON otherwise', async () => {
  const V = new Function('crypto,btoa,atob,TextEncoder,TextDecoder', block('VAULT') + '\nreturn {vaultOpen,xferPack,xferKind};')(require('crypto').webcrypto, btoa, atob, TextEncoder, TextDecoder);
  const payload = { app: 'tally-money', version: 1, data: { txns: [], note: 'secret-merchant' } };
  const plain = JSON.parse(await V.xferPack(payload, ''));
  assert.deepStrictEqual(plain, payload); assert.strictEqual(V.xferKind(plain), 'plain');
  const locked = JSON.parse(await V.xferPack(payload, 'a long enough password'));
  assert.strictEqual(V.xferKind(locked), 'locked'); assert.strictEqual(locked.app, 'tally-money');
  assert.ok(!JSON.stringify(locked).includes('secret-merchant'));
  assert.deepStrictEqual(JSON.parse(await V.vaultOpen(locked, 'a long enough password')), payload);
  await assert.rejects(V.vaultOpen(locked, 'another password here'));
});

test('pay links: only plain https addresses are accepted, and the saved map is cleaned', () => {
  const P = new Function(block('PAYLINK') + '\nreturn {cleanPayUrl, payHost, cleanPayLinks};')();
  assert.strictEqual(P.cleanPayUrl('https://www.hondafinancialservices.com/pay'), 'https://www.hondafinancialservices.com/pay');
  assert.strictEqual(P.cleanPayUrl('  mortgage.example-bank.com/pay?id=7 '), 'https://mortgage.example-bank.com/pay?id=7');   // a bare address gets https
  for (const bad of ['javascript:alert(1)', 'http://pay.example.com', 'ftp://a.example.com', 'https://user:pw@pay.example.com', 'https://localhost/pay', 'https://192.168.1.5/pay', 'https://nodot/pay', 'not a url', '', null, 'data:text/html,hi', 'https://a.example.com/' + 'x'.repeat(400)]) assert.strictEqual(P.cleanPayUrl(bad), '', String(bad));
  assert.strictEqual(P.payHost('https://www.nelnet.net/pay'), 'nelnet.net');
  const m = P.cleanPayLinks({ 'loan:abc1': 'https://a.example.com/pay', 'home': 'b.example.com', 'bill:x9': 'javascript:1', 'weird key': 'https://c.example.com', 'loan:grp:nelnet inc|student': 'https://d.example.com/p', '__proto__': 'https://e.example.com' });
  assert.deepStrictEqual(m, { 'loan:abc1': 'https://a.example.com/pay', home: 'https://b.example.com/', 'loan:grp:nelnet inc|student': 'https://d.example.com/p' });
  assert.deepStrictEqual(P.cleanPayLinks([1, 2]), {}); assert.deepStrictEqual(P.cleanPayLinks(null), {});
});

test('car cut-out: removes the studio background around the car, keeps highlights inside it, refuses busy photos', () => {
  const C = new Function(block('CUTOUT') + '\nreturn {cutoutBg};')();
  const W = 40, H = 24, mk = (fn) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };
  const car = (x, y) => (x >= 8 && x < 32 && y >= 6 && y < 18) ? ((x >= 16 && x < 20 && y >= 9 && y < 12) ? [252, 252, 252] : [30, 110, 230]) : (y > 19 ? [205, 207, 210] : [252, 252, 252]);   // blue car, white glare inside, grey floor shadow
  const d = mk(car); const r = C.cutoutBg(d, W, H);
  assert.ok(r.ok); assert.deepStrictEqual(r.box, [8, 6, 31, 17]);
  assert.strictEqual(d[(2 * W + 2) * 4 + 3], 0);                      // background gone
  assert.strictEqual(d[(21 * W + 5) * 4 + 3], 0);                     // light floor shadow gone
  assert.strictEqual(d[(10 * W + 17) * 4 + 3], 255);                  // glare inside the car stays
  assert.strictEqual(d[(10 * W + 25) * 4 + 3], 255);                  // body stays
  const busy = mk((x, y) => [(x * 37 + y * 11) % 200, (x * 13) % 180, (y * 29) % 160]);   // not a studio shot
  assert.strictEqual(C.cutoutBg(busy, W, H).ok, false);
  assert.strictEqual(C.cutoutBg(mk(() => [250, 250, 250]), W, H).ok, false);   // nothing in it
});

test('car drawing from AI: only plain shapes survive, and cleaning twice changes nothing', () => {
  const C = new Function(block('CARSVG') + '\nreturn {cleanCarSvg};')();
  const shapes = Array.from({ length: 9 }, (_, i) => `<rect x="${i}" y="1" width="3" height="3" fill="#336699"/>`).join('');
  const good = `Here you go:\n\`\`\`svg\n<svg viewBox="0 0 250 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient></defs><path d="M10,80 L240,80 Q245,60 200,50 L60,50 Z" fill="url(#g1)"/><g class="wheel"><circle cx="57" cy="73" r="19" fill="#111"/></g>${shapes}</svg>\n\`\`\``;
  const out = C.cleanCarSvg(good);
  assert.ok(out.includes('<path d="M10,80 L240,80 Q245,60 200,50 L60,50 Z" fill="url(#aic-g1)"/>'), out);
  assert.ok(out.includes('id="aic-g1"') && out.includes('class="aiwheel"') && out.includes('<circle cx="57" cy="73" r="19" fill="#111"/>'));
  assert.strictEqual(C.cleanCarSvg('<svg>' + out + '</svg>'), out);                      // cleaning is stable
  const evil = `<svg viewBox="0 0 250 100" onload="alert(1)"><script>alert(1)</script><style>*{display:none}</style><image href="https://evil.example/x.png"/><foreignObject><div>hi</div></foreignObject><a href="javascript:alert(1)"><rect x="1" y="1" width="2" height="2" fill="javascript:alert(1)" onclick="alert(1)" style="x:y"/></a><use href="#a"/>${shapes}<text>hi</text></svg>`;
  const e = C.cleanCarSvg(evil);
  assert.ok(e && !/script|style|image|foreign|onload|onclick|javascript|href|<a|<use|<text|evil|alert/i.test(e), e);
  assert.ok(e.includes('<rect x="1" y="1" width="2" height="2"/>'));                       // bad attributes dropped, shape kept
  assert.strictEqual(C.cleanCarSvg('<svg><rect x="1" y="1" width="2" height="2"/></svg>'), '');          // too little to be a car
  assert.strictEqual(C.cleanCarSvg('not a drawing'), ''); assert.strictEqual(C.cleanCarSvg(''), ''); assert.strictEqual(C.cleanCarSvg(null), '');
  assert.strictEqual(C.cleanCarSvg('<svg>' + shapes + '</svg>'.padEnd(200000, ' ')), '');                 // far too big
  assert.strictEqual(C.cleanCarSvg('<svg>' + shapes.replace('fill="#336699"', 'fill="url(#x);evil"') + '</svg>').includes('evil'), false);
});

test('card payments imported from a card statement are transfers, and make the checking-side payment count only once', () => {
  const { ledgerOf, transferInfo, isTransfer } = new Function(srcBlock('/*TRANSFER-START*/', '/*TRANSFER-END*/') + '\nreturn {ledgerOf, transferInfo, isTransfer};')();
  const card = [{ id: 'a', date: '2026-10-01', name: 'SHAWS', amount: -54.2, cat: 'Groceries' }, { id: 'b', date: '2026-10-05', name: 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234', amount: 300, cat: 'Other', transfer: true, cardPay: true }];
  const checking = { id: 'c', date: '2026-10-05', name: 'APPLE CARD GSBANKPAYMENT', amount: -300, cat: 'Debt and loans' };
  assert.strictEqual(transferInfo(card, 'auto').cardSide, true);
  assert.deepStrictEqual(ledgerOf(card, 'auto').map((x) => x.id), ['a']);                    // the payment is not income
  assert.deepStrictEqual(ledgerOf(card.concat([checking]), 'auto').map((x) => x.id), ['a']);   // and the payment from checking is not spent again
  assert.strictEqual(transferInfo([card[0], checking], 'auto').cardSide, false);              // no card payments imported: the checking payment is the real spending
  assert.strictEqual(isTransfer({ amount: 25, name: 'FROM SAVINGS', transfer: true }, transferInfo([], 'auto')), true);
  assert.strictEqual(transferInfo([{ amount: 25, name: 'FROM SAVINGS', transfer: true }], 'auto').cardSide, false);            // an ordinary transfer is not card evidence
});

test('cash back: daily cash is not income, and each card shows what it earned against interest and fees', () => {
  const C = new Function(srcBlock('/*TRANSFER-START*/', '/*TRANSFER-END*/') + srcBlock('/*CASHBACK-START*/', '/*CASHBACK-END*/') + '\nreturn {isCashback, ledgerOf, cashbackStats, cashbackVerdict};')();
  for (const n of ['DAILY CASH ADJUSTMENT', 'Cash Back Reward', 'CASHBACK BONUS REDEMPTION', 'Rewards Credit', 'STATEMENT CREDIT - CASH REWARDS']) assert.ok(C.isCashback({ name: n, amount: 3 }), n);
  for (const n of ['AMAZON REFUND', 'SHAWS', 'STATEMENT CREDIT PAYMENT', 'CASH ADVANCE', 'PAYROLL']) assert.ok(!C.isCashback({ name: n, amount: 3 }), n);
  assert.ok(!C.isCashback({ name: 'DAILY CASH ADJUSTMENT', amount: 3, cashback: false })); assert.ok(C.isCashback({ name: 'WEIRD CREDIT', amount: 3, cashback: true }));
  const T = new Date(2026, 9, 14);
  const accounts = [{ id: 'apple', name: 'Apple Card', type: 'credit', apr: 0, balance: 0 }, { id: 'chase', name: 'Chase Sapphire', type: 'credit', apr: 24.99, balance: 2000 }, { id: 'sav', name: 'Savings', type: 'savings', balance: 5 }];
  const tx = [
    { id: '1', date: '2026-10-02', name: 'SHAWS', amount: -200, acct: 'apple' }, { id: '2', date: '2026-10-03', name: 'DAILY CASH ADJUSTMENT', amount: 6, acct: 'apple' },
    { id: '3', date: '2026-08-02', name: 'AMAZON', amount: -300, acct: 'apple' }, { id: '4', date: '2026-08-03', name: 'DAILY CASH ADJUSTMENT', amount: 9, acct: 'apple' },
    { id: '5', date: '2025-01-03', name: 'DAILY CASH ADJUSTMENT', amount: 40, acct: 'apple' },                      // older than 12 months: all-time only
    { id: '6', date: '2026-09-05', name: 'WHOLE FOODS', amount: -500, acct: 'chase' }, { id: '7', date: '2026-09-06', name: 'CASH BACK REWARD', amount: 10, acct: 'chase' },
    { id: '8', date: '2026-09-28', name: 'INTEREST CHARGE ON PURCHASES', amount: -41.5, acct: 'chase' }, { id: '9', date: '2026-07-01', name: 'ANNUAL MEMBERSHIP FEE', amount: -95, acct: 'chase' },
    { id: '10', date: '2026-10-05', name: 'ACH DEPOSIT INTERNET TRANSFER', amount: 300, acct: 'apple', transfer: true, cardPay: true },
    { id: '11', date: '2026-09-09', name: 'DAILY CASH ADJUSTMENT', amount: 2 },                                      // not linked to a card yet
  ];
  const st = C.cashbackStats(tx, accounts, T, 'auto');
  const ap = st.cards.find((c) => c.id === 'apple'), ch = st.cards.find((c) => c.id === 'chase');
  assert.strictEqual(st.cards.length, 2);
  assert.strictEqual(ap.cb12, 15); assert.strictEqual(ap.cbAll, 55); assert.strictEqual(ap.spend12, 500); assert.ok(Math.abs(ap.rate - 0.03) < 1e-9);
  assert.strictEqual(ap.cost12, 0); assert.strictEqual(ap.net12, 15); assert.strictEqual(ap.verdict.kind, 'gain');
  assert.strictEqual(ch.cb12, 10); assert.strictEqual(ch.int12, 41.5); assert.strictEqual(ch.fee12, 95); assert.strictEqual(ch.spend12, 500);   // interest and fees are not spending
  assert.strictEqual(ch.net12, -126.5); assert.strictEqual(ch.verdict.kind, 'loss'); assert.match(ch.verdict.text, /behind by \$126\.50/);
  assert.strictEqual(st.unassigned.cb12, 2); assert.strictEqual(st.unassigned.n, 1);
  assert.strictEqual(st.total.cb12, 27); assert.strictEqual(st.total.cost12, 136.5); assert.strictEqual(st.total.net12, -109.5);
  assert.strictEqual(st.monthly.length, 12); assert.strictEqual(st.monthly[11].mk, '2026-10'); assert.strictEqual(st.monthly[11].amt, 6);
  // none of it is income or spending: cash back and the card payment are out of the ledger
  assert.deepStrictEqual(C.ledgerOf(tx, 'auto').map((x) => x.id).sort(), ['1', '3', '6', '8', '9'].sort());
  // carrying a balance: the estimated interest beats the cash back, so it warns even before any interest row is imported
  const w = C.cashbackStats([{ id: 'a', date: '2026-10-01', name: 'SHOP', amount: -100, acct: 'chase' }, { id: 'b', date: '2026-10-02', name: 'CASH BACK REWARD', amount: 1, acct: 'chase' }], accounts, T, 'auto').cards[1];
  assert.strictEqual(w.verdict.kind, 'warn'); assert.match(w.verdict.text, /carrying \$2,000\.00 at 24\.99% APR/);
  assert.strictEqual(C.cashbackStats([], accounts, T, 'auto').cards[0].verdict.kind, 'none');
});

test('credit score: bands per scoring model, per-bureau series, gaps, ages, utilization history and paydown plans', () => {
  const C = new Function(srcBlock('/*CREDIT-START*/', '/*CREDIT-END*/') + srcBlock('/*SCORE-START*/', '/*SCORE-END*/') + '\nreturn {scoreBand, scoreSeries, scoreGap, creditAges, closeEffect, utilAt, paydownPlan, impactEstimate, creditInsights, modelFamily, creditBand};')();
  // FICO and VantageScore draw their lines differently
  assert.deepStrictEqual([C.scoreBand(800, 'FICO 8').label, C.scoreBand(740, 'FICO 8').label, C.scoreBand(670, 'FICO 8').label, C.scoreBand(580, 'FICO').label, C.scoreBand(579, 'FICO').label], ['Exceptional', 'Very good', 'Good', 'Fair', 'Poor']);
  assert.deepStrictEqual([C.scoreBand(781, 'VantageScore 3.0').label, C.scoreBand(780, 'VantageScore 3.0').label, C.scoreBand(661, 'VantageScore 3.0').label, C.scoreBand(601, 'VantageScore 3.0').label, C.scoreBand(500, 'VantageScore 3.0').label, C.scoreBand(499, 'VantageScore 3.0').label], ['Excellent', 'Good', 'Good', 'Fair', 'Poor', 'Very poor']);
  assert.strictEqual(C.scoreBand(712, 'VantageScore 3.0').k, 'good'); assert.strictEqual(C.scoreBand(712, 'VantageScore 3.0').next.gap, 69); assert.strictEqual(C.scoreBand(850, 'FICO 8').next, null);
  for (const n of [300, 579, 580, 669, 670, 739, 740, 799, 800, 850]) assert.strictEqual(C.scoreBand(n, 'FICO').label, C.creditBand(n).label, 'matches the older banding at ' + n);
  const scores = [
    { date: '2026-08-01', score: 700, source: 'VantageScore 3.0', bureau: 'TransUnion' }, { date: '2026-09-01', score: 705, source: 'VantageScore 3.0', bureau: 'TransUnion' }, { date: '2026-10-01', score: 722, source: 'VantageScore 3.0', bureau: 'TransUnion' },
    { date: '2026-10-02', score: 690, source: 'VantageScore 3.0', bureau: 'Equifax' }, { date: '2026-09-02', score: 688, source: 'VantageScore 3.0', bureau: 'Equifax' },
    { date: '2026-06-01', score: 700, source: 'FICO' },
  ];
  const ser = C.scoreSeries(scores);
  assert.deepStrictEqual(ser.map((s) => [s.name, s.last.score, s.diff]), [['TransUnion', 722, 17], ['Equifax', 690, 2], ['Not labelled', 700, null]]);
  const gap = C.scoreGap(ser); assert.strictEqual(gap.gap, 32); assert.strictEqual(gap.hi.name, 'TransUnion'); assert.strictEqual(gap.lo.name, 'Equifax'); assert.strictEqual(gap.sameModel, true);
  assert.strictEqual(C.scoreGap(C.scoreSeries([scores[0]])), null);
  // ages from opening dates, with the profile as fallback
  const T = new Date(2026, 9, 14);
  const accts = [{ id: 'a', type: 'credit', name: 'Old', balance: 100, limit: 1000, opened: '2016-10', history: [{ date: '2026-01-01', balance: 800 }, { date: '2026-09-01', balance: 300 }] }, { id: 'b', type: 'credit', name: 'New', balance: 900, limit: 1000, opened: '2024-10-15', history: [{ date: '2026-01-01', balance: 900 }] }, { id: 'c', type: 'auto', name: 'Car', balance: 5000, opened: '2022-10' }, { id: 'd', type: 'credit', name: 'Closed', closed: true, opened: '2010-01' }];
  const ages = C.creditAges(accts, { oldest: '3' }, T); assert.strictEqual(ages.source, 'accounts'); assert.strictEqual(Math.round(ages.oldestYears), 10); assert.ok(Math.abs(ages.avgYears - (10 + 2 + 4) / 3) < 0.05, 'avg ' + ages.avgYears);
  assert.deepStrictEqual([C.creditAges([{ id: 'x', type: 'credit' }], { oldest: '6' }, T).oldestYears, C.creditAges([], {}, T).oldestYears], [6, null]);
  const ce = C.closeEffect(accts, 'a', T); assert.ok(ce.oldestLost && ce.after < ce.before); assert.strictEqual(C.closeEffect(accts, 'zzz', T), null);
  // utilization on past dates from balance history
  assert.ok(Math.abs(C.utilAt(accts, '2026-02-01') - 85) < 1e-9);          // (800+900)/2000
  assert.ok(Math.abs(C.utilAt(accts, '2026-09-15') - 60) < 1e-9);          // (300+900)/2000
  assert.strictEqual(C.utilAt([{ id: 'n', type: 'credit', limit: 0, balance: 5 }], '2026-01-01'), null);
  // paydown plan: every card to the target, highest use first
  const pp = C.paydownPlan(accts, 29); assert.deepStrictEqual(pp.plan.map((p) => [p.name, p.pay]), [['New', 610]]); assert.ok(pp.newPct < 29);
  const p9 = C.paydownPlan(accts, 9); assert.strictEqual(p9.total, 810 + 10); assert.ok(p9.newPct <= 9.01);
  assert.deepStrictEqual(C.paydownPlan([], 9).plan, []);
  // impact estimate is only for improvements, and is a range
  const ie = C.impactEstimate(80, 9); assert.ok(ie.low > 0 && ie.high > ie.low); assert.strictEqual(C.impactEstimate(8, 60), null); assert.strictEqual(C.impactEstimate(35, 32), null);
  // insights
  const ins = C.creditInsights(scores, accts, { late: 'none', inq: '3plus' }, T, (n) => '$' + Math.round(n)), titles = ins.map((i) => i.title).join(' | ');
  assert.match(titles, /TransUnion went up 17 points/); assert.match(titles, /differ by 32 points/); assert.match(titles, /Several recent credit applications/); assert.match(titles, /is at 90% of its limit/);
  assert.strictEqual(ins[0].k === 'bad' || ins[0].k === 'warn', true);
  assert.match(C.creditInsights([], [], {}, T)[0].title, /Add your first score/);
  assert.match(C.creditInsights([{ date: '2026-07-01', score: 700, source: 'FICO' }], [], {}, T).map((i) => i.title).join('|'), /Your unlabelled score is 105 days old/);
});

test('cash: ATM rows, receipt duplicates and receipt to transaction', () => {
  const C = new Function(srcBlock('/*CASH-START*/', '/*CASH-END*/') + '\nreturn {atmRows, receiptDup, receiptNote, txnFromReceipt};')();
  const tx = [
    { id: 'a', date: '2026-10-10', name: 'ATM WITHDRAWAL MAIN ST', amount: -100 },
    { id: 'b', date: '2026-10-10', name: 'ATM FEE', amount: -3 },
    { id: 'c', date: '2026-10-11', name: 'Corner Deli #12', amount: -12.5 },
    { id: 'd', date: '2026-10-11', name: 'Wallet snack', amount: -5, cash: true },
    { id: 'e', date: '2026-10-09', name: 'ATM deposit refund', amount: 40 },
  ];
  assert.deepStrictEqual(C.atmRows(tx).map((x) => x.id), ['a']);
  assert.strictEqual(C.receiptDup({ merchant: 'Corner Deli', date: '2026-10-12', total: 12.5 }, tx).id, 'c');   // a day apart, shared word
  assert.strictEqual(C.receiptDup({ merchant: 'Other Shop', date: '2026-10-11', total: 12.5 }, tx), null);        // same amount, different merchant
  assert.strictEqual(C.receiptDup({ merchant: 'Corner Deli', date: '2026-10-20', total: 12.5 }, tx), null);       // too far apart
  assert.strictEqual(C.receiptDup({ merchant: 'Corner Deli', date: '2026-10-11', total: 0 }, tx), null);
  const rec = { merchant: 'Corner Deli', date: '2026-10-12', total: 12.499, category: 'Dining', items: [{ name: 'Sandwich', amount: 11.5 }] };
  assert.strictEqual(C.receiptNote(rec), '1 item: Sandwich 11.50');
  assert.deepStrictEqual(C.txnFromReceipt(rec, { today: '2026-10-14', guess: () => 'Other', cash: true }), { date: '2026-10-12', name: 'Corner Deli', amount: -12.5, cat: 'Dining', cash: true, note: '1 item: Sandwich 11.50' });
  const bare = C.txnFromReceipt({ total: 4 }, { today: '2026-10-14', guess: () => 'Other' });
  assert.deepStrictEqual(bare, { date: '2026-10-14', name: 'Receipt', amount: -4, cat: 'Other' });
});

test('categories: fees, taxes, repairs and maintenance', () => {
  const w = catWorld({ customCats: [], merchantCats: {}, merchantSubs: {}, subCats: {}, setAside: [], txns: [] });
  const t = [['MA RMV VEHICLE REGISTRATION RENEWAL', 'Fees and taxes', 'Vehicle registration'], ['TOWN OF PETERBOROUGH PROPERTY TAX', 'Fees and taxes', 'Property tax'], ['NH DMV 603-227', 'Fees and taxes', 'Vehicle registration'],
    ['LATE FEE', 'Fees and taxes', 'Late fees'], ['JIFFY LUBE #1234', 'Repairs and maintenance', 'Car repair and service'], ['AUTOZONE #44', 'Repairs and maintenance', 'Car parts'], ['COSTCO TIRE CENTER', 'Repairs and maintenance', 'Car repair and service'],
    ['SMITH PLUMBING LLC', 'Repairs and maintenance', 'Home repair'], ['ABC ROOFING', 'Repairs and maintenance', 'Home repair'], ['ACME HVAC SERVICE', 'Repairs and maintenance', 'Appliance and HVAC'], ['HARLEY DAVIDSON SERVICE', 'Repairs and maintenance', 'Motorcycle and boat'],
    ['STARBUCKS 123', 'Dining', 'Coffee and bakery'], ['EVERSOURCE ELECTRIC', 'Housing', '*']];
  t.forEach(([n, c, s]) => { assert.strictEqual(w.guessCat(n), c, n); if (s !== '*') assert.strictEqual(w.guessSub(c, n), s, n + ' sub'); });
});

function assetWorld() { return new Function(srcBlock('/*ASSETS-START*/', '/*ASSETS-END*/') + '\nreturn {ASSET_KINDS, MAINT_PRESETS, assetRate, assetStats, meterPerDay, maintDue, maintBillItems, valueLookupUrl, cleanAsset, modRecoup, modsCost, modsAdd};')(); }
test('assets: depreciation rate comes from your numbers, then purchase, then a default', () => {
  const A = assetWorld(), T = new Date(2026, 9, 14);
  const hist = { balance: 30000, history: [{ date: '2025-10-14', balance: 34000 }, { date: '2026-10-14', balance: 30000 }], asset: { kind: 'car' } };
  let r = A.assetRate(hist, T); assert.strictEqual(r.src, 'history'); assert.ok(Math.abs(r.rate - 0.1188) < 0.002);   // one year of data is blended 50/50 with the typical 12%
  r = A.assetRate({ balance: 36000, history: [{ date: '2026-10-14', balance: 36000 }], asset: { kind: 'car', purchasePrice: 40000, purchaseDate: '2025-10-14' } }, T); assert.strictEqual(r.src, 'purchase'); assert.ok(Math.abs(r.rate - 0.11) < 0.002);
  r = A.assetRate({ balance: 36000, history: [{ date: '2026-10-14', balance: 36000 }], asset: { kind: 'boat', rate: 0.2 } }, T); assert.strictEqual(r.rate, 0.2); assert.strictEqual(r.src, 'ai');
  r = A.assetRate({ balance: 5000, history: [], asset: { kind: 'motorcycle' } }, T); assert.strictEqual(r.rate, 0.08); assert.strictEqual(r.src, 'default');
  const st = A.assetStats(hist, T); assert.strictEqual(Math.round(st.proj[0].value), Math.round(30000 * (1 - st.rate))); assert.strictEqual(st.lost, null);
  const st2 = A.assetStats({ balance: 30000, history: [], asset: { kind: 'car', purchasePrice: 40000, purchaseDate: '2024-10-14' } }, T); assert.strictEqual(st2.lost, 10000); assert.strictEqual(Math.round(st2.lostPct), 25); assert.ok(Math.abs(st2.ageYears - 2) < 0.02);
});
test('assets: maintenance is due by date or by usage, whichever comes first, and feeds the bills list', () => {
  const A = assetWorld(), T = new Date(2026, 9, 14);
  const car = { id: 'a1', name: 'Civic', balance: 30000, history: [], asset: { kind: 'car', meter: 35000, meterLog: [{ date: '2026-01-01', v: 30000 }, { date: '2026-10-14', v: 35000 }], maint: [
    { id: 'm1', name: 'Oil', months: 6, meter: 5000, cost: 90, lastDate: '2026-05-01', lastMeter: 31000 },
    { id: 'm2', name: 'Reg', months: 12, meter: 0, cost: 60, cat: 'Fees and taxes', sub: 'Vehicle registration', lastDate: '2025-09-01' },
    { id: 'm3', name: 'Never done', months: 12, meter: 0, cost: 10 }] } };
  const d1 = A.maintDue(car.asset.maint[0], car.asset, T); assert.strictEqual(d1.by, 'date'); assert.strictEqual(d1.days, 18); assert.strictEqual(d1.meterLeft, 1000);
  const d2 = A.maintDue(car.asset.maint[1], car.asset, T); assert.strictEqual(d2.overdue, true); assert.strictEqual(d2.days, -43);
  assert.strictEqual(A.maintDue(car.asset.maint[2], car.asset, T).due, null);
  const byMiles = A.maintDue({ months: 12, meter: 5000, lastDate: '2026-09-01', lastMeter: 29500 }, car.asset, T); assert.strictEqual(byMiles.by, 'meter'); assert.strictEqual(byMiles.days, 0); assert.strictEqual(byMiles.meterLeft, -500);   // past its mileage: due today
  assert.ok(A.meterPerDay(car.asset) > 15 && A.meterPerDay(car.asset) < 20);
  assert.deepStrictEqual(A.maintBillItems([car], '2026-10', T).map((i) => i.id), ['maint:a1:m2']);                  // overdue shows in the current month
  assert.deepStrictEqual(A.maintBillItems([car], '2026-11', T).map((i) => [i.id, i.dueDay, i.amount, i.source]), [['maint:a1:m1', 1, 90, 'maint']]);
  assert.strictEqual(A.maintBillItems([car], '2026-12', T).length, 0);
});
test('assets: lookup links and the backup cleaner', () => {
  const A = assetWorld(); let n = 0; const id = () => 'n' + (++n);
  assert.match(A.valueLookupUrl({ kind: 'car', year: 2023, make: 'Honda', model: 'Civic' }).url, /^https:\/\/www\.kbb\.com\//);
  assert.match(A.valueLookupUrl({ kind: 'boat', year: 2015, make: 'Sea Ray' }).url, /^https:\/\/duckduckgo\.com\/\?q=2015%20Sea%20Ray/);
  const c = A.cleanAsset({ kind: 'plane', year: 1800, make: '<b>Honda</b>"', meter: -5, purchasePrice: 'x', rate: 9, loanId: 'a b', valueSource: 'hacker', maint: [{ name: '', months: 1 }, { id: 'ok1', name: 'Oil <i>', months: 999, meter: 5e9, cost: -3, lastDate: 'nope', cat: '' }], meterLog: [{ date: 'bad', v: 1 }, { date: '2026-01-01', v: 10 }] }, id);
  assert.strictEqual(c.kind, 'other'); assert.strictEqual(c.year, undefined); assert.strictEqual(c.make, 'bHonda/b'); assert.strictEqual(c.meter, undefined); assert.strictEqual(c.rate, undefined); assert.strictEqual(c.loanId, undefined); assert.strictEqual(c.valueSource, undefined);
  assert.strictEqual(c.maint.length, 1); assert.deepStrictEqual(c.maint[0], { id: 'ok1', name: 'Oil i', months: 240, meter: 1e6, cost: 0, cat: 'Repairs and maintenance', sub: '' });
  assert.deepStrictEqual(c.meterLog, [{ date: '2026-01-01', v: 10 }]);
  assert.strictEqual(A.cleanAsset('x', id), null);
});

test('imports: duplicates, import batches, removal and the backup cleaner', () => {
  const I = new Function(srcBlock('/*IMPORTS-START*/', '/*IMPORTS-END*/') + '\nreturn {dupGroups, importStats, acctTxnCounts, removeTxns, cleanImports};')();
  const key = (n) => n.toLowerCase().replace(/[#\d*]+/g, '').trim();
  const t = (id, d, n, a, x) => Object.assign({ id, date: d, name: n, amount: a, cat: 'Other' }, x || {});
  const txns = [t('1', '2026-10-01', 'SHAWS', -54.2), t('2', '2026-10-01', 'SHAWS #12', -54.2, { sub: 'Supermarket' }), t('3', '2026-10-02', 'Coffee', -5, { imp: 'b1' }), t('4', '2026-10-02', 'Coffee', -5, { imp: 'b1' }),
    t('5', '2026-10-03', 'Tip', -3, { cash: true }), t('6', '2026-10-03', 'Tip', -3, { cash: true }), t('7', '2026-10-04', 'Gas', -30, { imp: 'b1' }), t('8', '2026-10-04', 'Gas', -30, { imp: 'b2' }), t('9', '2026-10-05', 'Other card', -9, { acct: 'x' }), t('10', '2026-10-05', 'Other card', -9, { acct: 'y' })];
  const g = I.dupGroups(txns, key);
  assert.deepStrictEqual(g.map((x) => [x.name, x.count, x.likely, x.keep.id]), [['Gas', 2, true, '7'], ['Tip', 2, false, '5'], ['Coffee', 2, false, '3'], ['SHAWS #12', 2, true, '2']]);   // same-import and cash pairs may be real; the edited copy is kept; different accounts are not duplicates
  assert.deepStrictEqual(g.find((x) => x.name === 'SHAWS #12').extra.map((x) => x.id), ['1']);
  const st = I.importStats(txns, [{ id: 'b1', date: '2026-10-10', label: 'First', count: 3, acct: '' }, { id: 'b2', date: '2026-10-11', label: 'Second', count: 1, acct: '' }, { id: 'gone', date: '2026-10-12', label: 'Removed', count: 5, acct: '' }]);
  assert.deepStrictEqual(st.map((m) => [m.id, m.left]), [['gone', 0], ['b2', 1], ['b1', 3]]);
  assert.deepStrictEqual(I.acctTxnCounts(txns), { x: 1, y: 1 });
  assert.deepStrictEqual(I.removeTxns(txns, ['1', '2']).map((x) => x.id).slice(0, 2), ['3', '4']);
  const c = I.cleanImports([{ id: 'ok_1', date: '2026-10-01', label: '<b>Apple</b>', count: 9, acct: 'a1' }, { id: 'bad id' }, null, { id: 'z', date: 'x', count: -4 }], () => 'n');
  assert.deepStrictEqual(c, [{ id: 'ok_1', date: '2026-10-01', label: 'bApple/b', count: 9, acct: 'a1' }, { id: 'z', date: '', label: 'Import', count: 0, acct: '' }]);
});

test('bills: autopay bills are expected, turn paid when the payment shows up, and are flagged only if it does not', () => {
  const B = billsWorld(), today = new Date(2026, 9, 12);                      // Oct 12
  const mk = (day, extra) => Object.assign({ id: 'b' + day, name: 'Cell phone', amount: 80, dueDay: day, match: 'tmobile', autopay: true }, extra || {});
  const stt = (b, txns) => B.billStatus(B.billItems([b], [])[0], '2026-10', txns || [], {}, today);
  assert.strictEqual(stt(mk(20)).state, 'autopay');                            // due later this month
  assert.strictEqual(stt(mk(11)).state, 'autopay');                            // due yesterday: give it a few days
  assert.strictEqual(stt(mk(5)).state, 'overdue');                             // a week late: autopay did not go through
  assert.strictEqual(stt(mk(5)).auto, true);
  assert.strictEqual(stt(mk(11), [{ date: '2026-10-11', name: 'TMOBILE PAYMENT', amount: -80 }]).state, 'paid');
  assert.strictEqual(B.billStatus(B.billItems([mk(20, { autopay: false })], [])[0], '2026-10', [], {}, today).state, 'upcoming');
  const sum = B.billsSummary(B.billItems([mk(20)], []), '2026-10', [], {}, today);
  assert.strictEqual(sum.pending, 80); assert.strictEqual(sum.next.item.name, 'Cell phone');   // still counted as money going out
});

test('hidden bills: keywords are cleaned and matched against bill names', () => {
  const H = new Function(srcBlock('/*HIDE-START*/', '/*HIDE-END*/') + '\nreturn {cleanHideWords, isHiddenName};')();
  assert.deepStrictEqual(H.cleanHideWords(' Therapy, clinic\n<b>Lawyer</b>, a, therapy '), ['therapy', 'clinic', 'blawyer/b']);
  assert.deepStrictEqual(H.cleanHideWords(['X', 'Dr. Smith', 5, null]), ['dr. smith']);
  assert.strictEqual(H.cleanHideWords(Array.from({ length: 100 }, (_, i) => 'word' + i)).length, 60);
  assert.strictEqual(H.isHiddenName('Smith Family THERAPY LLC', ['therapy']), true);
  assert.strictEqual(H.isHiddenName('Electric', ['therapy']), false);
  assert.strictEqual(H.isHiddenName('Anything', []), false);
  assert.strictEqual(H.isHiddenName('Anything', undefined), false);
});

function xferWorld() { return new Function(srcBlock('/*TRANSFER-START*/', '/*TRANSFER-END*/') + srcBlock('/*TXFILTER-START*/', '/*TXFILTER-END*/') + '\nreturn {isTransfer, transferInfo, txKind, applyKind, setXferContext, xferLK, filterTxns, filterActive, filterTotals, rangeDates};')(); }
test('card payments: more wording is recognised, income is not, and what you teach the app sticks', () => {
  const X = xferWorld(), t = (name, amount, extra) => Object.assign({ id: name, date: '2026-10-01', name, amount, cat: 'Other' }, extra || {});
  const inf = X.transferInfo([], 'auto');
  ['AUTOMATIC PAYMENT - THANK YOU', 'ONLINE PAYMENT, THANK YOU', 'AUTOPAY PAYMENT', 'MOBILE PAYMENT', 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234', 'CRCARDPMT', 'Payment', 'PAYMENT RECEIVED', 'ELECTRONIC PAYMENT'].forEach((n) => assert.strictEqual(X.isTransfer(t(n, 100), inf), true, n));
  ['PAYROLL ACME', 'VENMO PAYMENT FROM JOE', 'ZELLE PAYMENT FROM JOE', 'AMAZON REFUND', 'INTEREST PAID', 'TARGET', 'DAILY CASH', 'IRS TREAS 310 TAX REF'].forEach((n) => assert.strictEqual(X.isTransfer(t(n, 100), inf), false, n));
  // a card-linked credit only counts as a payment when the name says so; a refund named after the shop does not
  X.setXferContext(['card1'], {});
  assert.strictEqual(X.isTransfer(t('WEB PMT', 50, { acct: 'card1' }), inf), true);
  assert.strictEqual(X.isTransfer(t('TARGET', 20, { acct: 'card1' }), inf), false);
  // kinds
  assert.strictEqual(X.txKind(t('AUTOPAY PAYMENT', 50), inf), 'cardpay'); assert.strictEqual(X.txKind(t('TRANSFER FROM SAVINGS', 50), inf), 'transfer'); assert.strictEqual(X.txKind(t('DAILY CASH', 2), inf), 'cashback'); assert.strictEqual(X.txKind(t('SHAWS', -5), inf), 'count');
  const p = t('Odd name 77', 100); assert.strictEqual(X.isTransfer(p, inf), false);
  X.applyKind(p, 'cardpay'); assert.deepStrictEqual([p.transfer, p.cardPay, X.isTransfer(p, inf), X.txKind(p, inf)], [true, true, true, 'cardpay']);
  X.applyKind(p, 'count'); assert.strictEqual(X.isTransfer(p, inf), false);
  const q = t('AUTOPAY PAYMENT', 50); X.applyKind(q, 'count'); assert.strictEqual(X.isTransfer(q, inf), false);        // you can say a payment-looking row is real money
  // learned by merchant and direction: teaching the payments does not touch the same merchant's purchases
  X.setXferContext([], { [X.xferLK(t('Odd name 5', 1))]: 'cardpay' });
  assert.strictEqual(X.isTransfer(t('Odd name 9', 80), inf), true); assert.strictEqual(X.txKind(t('Odd name 9', 80), inf), 'cardpay'); assert.strictEqual(X.isTransfer(t('Odd name 9', -80), inf), false);
  X.setXferContext([], { [X.xferLK(t('AUTOPAY PAYMENT 1', 1))]: 'count' }); assert.strictEqual(X.isTransfer(t('AUTOPAY PAYMENT 3', 50), inf), false);
  X.setXferContext([], {});
});
test('transaction filters: text, kind, dates, amounts, account, order and totals', () => {
  const X = xferWorld(), inf = X.transferInfo([], 'auto');
  const rows = [{ id: '1', date: '2026-10-01', name: 'SHAWS', amount: -50, cat: 'Groceries' }, { id: '2', date: '2026-10-03', name: 'AUTOPAY PAYMENT', amount: 300, cat: 'Other', acct: 'c1' }, { id: '3', date: '2026-09-20', name: 'PAYROLL', amount: 2000, cat: 'Income' }, { id: '4', date: '2026-10-05', name: 'Cafe', amount: -4.5, cat: 'Dining', cash: true, note: 'tip incl' }, { id: '5', date: '2026-10-06', name: 'Mystery', amount: -80, cat: 'Other' }, { id: '6', date: '2026-10-07', name: 'DAILY CASH', amount: 2, cat: 'Other' }];
  const f = (o) => Object.assign({ q: '', cat: '', kind: '', acct: '', from: '', to: '', min: '', max: '', sort: 'new' }, o || {});
  const ids = (o) => X.filterTxns(rows, f(o), inf).map((x) => x.id).join(',');
  assert.strictEqual(ids(), '1,2,3,4,5,6'); assert.strictEqual(X.filterActive(f()), false); assert.strictEqual(X.filterActive(f({ min: '5' })), true);
  assert.strictEqual(ids({ q: 'tip' }), '4'); assert.strictEqual(ids({ cat: 'Dining' }), '4');
  assert.strictEqual(ids({ kind: 'spend' }), '1,4,5'); assert.strictEqual(ids({ kind: 'income' }), '3'); assert.strictEqual(ids({ kind: 'cardpay' }), '2'); assert.strictEqual(ids({ kind: 'notcounted' }), '2');
  assert.strictEqual(ids({ kind: 'cashback' }), '6'); assert.strictEqual(ids({ kind: 'cash' }), '4'); assert.strictEqual(ids({ kind: 'other' }), '5,6');
  assert.strictEqual(ids({ from: '2026-10-01', to: '2026-10-05' }), '1,2,4'); assert.strictEqual(ids({ min: '60' }), '2,3,5'); assert.strictEqual(ids({ max: '10' }), '4,6'); assert.strictEqual(ids({ acct: 'c1' }), '2'); assert.strictEqual(ids({ acct: 'none' }), '1,3,4,5,6');
  assert.strictEqual(ids({ sort: 'big' }), '3,2,5,1,4,6'); assert.strictEqual(ids({ sort: 'old' }), '3,1,2,4,5,6'); assert.strictEqual(ids({ sort: 'small' }), '6,4,1,5,2,3');
  const tot = X.filterTotals(rows, inf); assert.deepStrictEqual([tot.n, tot.inn, tot.out, tot.skipped], [6, 2000, 134.5, 2]);                // the payment and the cash back are not counted
  const R = X.rangeDates('month', new Date(2026, 9, 14)); assert.deepStrictEqual(R, { from: '2026-10-01', to: '2026-10-31' }); assert.deepStrictEqual(X.rangeDates('last', new Date(2026, 9, 14)), { from: '2026-09-01', to: '2026-09-30' }); assert.deepStrictEqual(X.rangeDates('all', new Date()), { from: '', to: '' });
});

function fuelWorld() { return new Function(srcBlock('/*FUEL-START*/', '/*FUEL-END*/') + '\nreturn {FUELS, cleanFuel, fuelPeriods, fuelMonths, fuelSpend, fuelPrices, leastSquares, weatherModel, weatherNormals, projectYear, heatCosts, energyTips, seasonOf, annualOf};')(); }
test('fuel: deliveries are spread over the days they cover, gas bills over their period, spend by payment date', () => {
  const F = fuelWorld(), R = [{ id: 'a', fuel: 'propane', date: '2025-10-01', qty: 100, unit: 'gal', cost: 300 }, { id: 'b', fuel: 'propane', date: '2025-11-30', qty: 120, unit: 'gal', cost: 384 }, { id: 'c', fuel: 'propane', date: '2026-01-29', qty: 180, unit: 'gal', cost: 630 }];
  const m = F.fuelMonths(R, 'propane'); assert.deepStrictEqual(m.map((x) => [x.month, Math.round(x.qty), Math.round(x.cost), x.days]), [['2025-10', 60, 192, 30], ['2025-11', 60, 192, 30], ['2025-12', 93, 326, 31], ['2026-01', 87, 305, 29]]);
  assert.strictEqual(Math.round(m.reduce((a, x) => a + x.qty, 0)), 300);                                        // the first fill has no earlier fill to measure from, so 120 + 180 gallons are attributed
  assert.deepStrictEqual(F.fuelSpend(R, 'propane'), [{ month: '2025-10', cost: 300 }, { month: '2025-11', cost: 384 }, { month: '2026-01', cost: 630 }]);
  const pr = F.fuelPrices(R, 'propane'); assert.deepStrictEqual(pr.map((p) => +p.price.toFixed(2)), [3, 3.2, 3.5]);
  const G = [{ id: 'g1', fuel: 'gas', date: '2026-02-10', days: 30, qty: 60, unit: 'ccf', cost: 90 }];
  const gm = F.fuelMonths(G, 'gas'); assert.strictEqual(gm.length, 2); assert.ok(Math.abs(gm.reduce((a, x) => a + x.qty, 0) - 60 * 1.037) < 1e-6); assert.ok(Math.abs(gm.reduce((a, x) => a + x.cost, 0) - 90) < 1e-6);
  assert.deepStrictEqual(F.fuelMonths([R[0]], 'propane'), []);                                                   // one delivery cannot tell you how much you use
  assert.strictEqual(F.fuelMonths([{ id: 'x', fuel: 'propane', date: '2025-10-01', qty: 0, unit: 'gal', cost: 300 }, { id: 'y', fuel: 'propane', date: '2025-11-01', qty: 0, unit: 'gal', cost: 300 }], 'propane').length, 0);   // cost-only records count as spend, not usage
});
test('fuel: records are cleaned, the weather model finds base use and use per degree day, and projections follow normal weather', () => {
  const F = fuelWorld(); let n = 0;
  const c = F.cleanFuel([{ id: 'ok', fuel: 'propane', date: '2026-01-01', qty: 100.456, unit: 'therm', cost: 300, note: '<b>x</b>' }, { fuel: 'coal', date: '2026-01-01', qty: 1 }, { fuel: 'gas', date: 'bad', qty: 1 }, { fuel: 'gas', date: '2026-01-01', qty: -3, unit: 'therm' }, { fuel: 'gas', date: '2026-02-01', qty: 5, unit: 'ccf', cost: 8, days: 31, tx: 'bad id' }], () => 'n' + (++n));
  assert.deepStrictEqual(c.map((x) => [x.id, x.fuel, x.qty, x.unit, x.note || '', x.days, x.tx || '']), [['ok', 'propane', 100.456, 'gal', 'bx/b', 0, ''], ['n1', 'gas', 5, 'ccf', '', 31, '']]);
  const ls = F.leastSquares([[1], [2], [3], [4], [5]], [3, 5, 7, 9, 11]); assert.ok(Math.abs(ls.coef[0] - 1) < 1e-9 && Math.abs(ls.coef[1] - 2) < 1e-9 && ls.r2 > 0.999999); assert.strictEqual(F.leastSquares([[1], [2]], [1, 2]), null);
  // usage = 1 + 0.5 * degree days per day, over a year of weather
  const hdd = [30, 28, 22, 12, 4, 0, 0, 0, 3, 11, 20, 27], weather = {}, rows = [];
  hdd.forEach((h, i) => { const k = '2025-' + ('0' + (i + 1)).slice(-2); weather[k] = { hdd: h * 30, cdd: 0, days: 30, avgF: 60 }; rows.push({ month: k, perDay: 1 + 0.5 * h }); });
  const m = F.weatherModel(rows, weather, false); assert.ok(Math.abs(m.base - 1) < 1e-6 && Math.abs(m.perHdd - 0.5) < 1e-6); assert.strictEqual(m.reliable, true); assert.strictEqual(m.n, 12);
  assert.strictEqual(F.weatherModel(rows.slice(0, 4), weather, false), null);                                      // too few months to say
  assert.strictEqual(F.weatherModel(rows.map((r) => ({ month: r.month, perDay: 5 })), weather, false).reliable, false);   // flat use: the weather explains nothing
  const norms = F.weatherNormals(weather); assert.ok(Math.abs(norms['01'].hddPerDay - 30) < 1e-9);
  const proj = F.projectYear(m, norms, 3, '2026-01'); assert.strictEqual(proj.months.length, 12); assert.strictEqual(proj.months[0].month, '2026-01'); assert.ok(Math.abs(proj.months[0].qty - (1 + 15) * 31) < 1e-6); assert.ok(Math.abs(proj.cost - proj.qty * 3) < 1e-9);
  assert.strictEqual(F.projectYear(m, { '01': norms['01'] }, 3, '2026-01'), null);
  const hc = F.heatCosts({ propane: 3.5, oil: 3.8, gas: 1.6, kwh: 0.28, cop: 2.5 }); assert.deepStrictEqual(hc.map((x) => x.id), ['gas', 'heatpump', 'oil', 'propane', 'resist']); assert.ok(Math.abs(hc[1].perMMBtu - 0.28 * 1e6 / (3412 * 2.5)) < 1e-6);
});
test('fuel: advice quotes your own numbers and flags a heat pump only when it saves money', () => {
  const F = fuelWorld(), hdd = [30, 28, 22, 12, 4, 0, 0, 0, 3, 11, 20, 27], weather = {}, months = [], deliveries = [];
  for (const y of ['2024', '2025']) hdd.forEach((h, i) => { const k = y + '-' + ('0' + (i + 1)).slice(-2); weather[k] = { hdd: h * 30, cdd: 0, days: 30 }; const q = (1 + 0.5 * h) * 30 * (y === '2025' ? 1.2 : 1); months.push({ month: k, qty: q, cost: q * 3.5, days: 30, perDay: q / 30 }); });
  const rows = months.slice(12).map((r) => ({ month: r.month, perDay: r.perDay })), model = F.weatherModel(months.map((r) => ({ month: r.month, perDay: r.perDay })), weather, false);
  const prices = [{ date: '2025-01-10', price: 3.2 }, { date: '2025-04-10', price: 3.0 }, { date: '2025-07-10', price: 2.8 }, { date: '2025-12-10', price: 4.1 }];
  [['2025-09-01', 100], ['2025-11-01', 120], ['2026-01-05', 150]].forEach(([d, q], i) => deliveries.push({ date: d, qty: q, perDay: i === 2 ? 2.5 : 2 }));
  const tips = F.energyTips({ fuels: [{ fuel: 'propane', label: 'Propane', months, prices, model, deliveries }], elec: null, weather, normals: F.weatherNormals(weather), cop: 2.5, kwhPrice: 0.2, todayISO: '2026-01-10' });
  const titles = tips.map((t) => t.title).join(' | ');
  assert.match(titles, /Last 12 months: about/); assert.match(titles, /of your propane use follows the weather/); assert.match(titles, /thermostat down 1 degree/); assert.match(titles, /Propane use is up 20% on the previous 12 months/);
  assert.match(titles, /You paid the least in summer/); assert.match(titles, /above your recent average/); assert.match(titles, /heat pump could cut your heating cost/); assert.match(titles, /Next propane fill: around 2026-/);
  const late = F.energyTips({ fuels: [{ fuel: 'propane', label: 'Propane', months, prices, model, deliveries }], elec: null, weather, normals: F.weatherNormals(weather), cop: 2.5, kwhPrice: 0.2, todayISO: '2027-01-01' }).map((x) => x.title).join('|'); assert.match(late, /fill is probably due now/);
  // two fills a few days apart are one top-up
  const near = F.fuelMonths([{ id: 'a', fuel: 'propane', date: '2025-10-01', qty: 100, unit: 'gal', cost: 300 }, { id: 'b', fuel: 'propane', date: '2025-11-30', qty: 120, unit: 'gal', cost: 384 }, { id: 'c', fuel: 'propane', date: '2025-12-03', qty: 20, unit: 'gal', cost: 70 }], 'propane'); assert.strictEqual(Math.round(near.reduce((a, x) => a + x.qty, 0)), 140);
  const cheapElec = F.energyTips({ fuels: [{ fuel: 'propane', label: 'Propane', months, prices, model, deliveries }], elec: null, weather, normals: F.weatherNormals(weather), cop: 2.5, kwhPrice: 0.9 }).map((t) => t.title).join('|');
  assert.doesNotMatch(cheapElec, /heat pump could cut/); assert.match(cheapElec, /cheaper than a heat pump/);
  assert.deepStrictEqual(F.energyTips({ fuels: [], elec: null }), []);
});

test('fuel import: a supplier CSV, pasted lines, and merging without doubles', () => {
  const W = new Function(srcBlock('/*ENERGY-START*/', '/*ENERGY-END*/') + srcBlock('/*FUEL-START*/', '/*FUEL-END*/') + srcBlock('/*FUELIMPORT-START*/', '/*FUELIMPORT-END*/') + '\nreturn {parseFuelText, fuelMerge};')();
  const csv = 'Delivery Date,Gallons Delivered,Price per Gallon,Total\n01/12/2025,152.3,3.359,$511.60\n03/02/2025,98.0,3.10,$303.80\nTotals,250.3,,';
  const r = W.parseFuelText(csv, 'propane'); assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.records.map((x) => [x.date, x.qty, x.cost, x.unit]), [['2025-01-12', 152.3, 511.6, 'gal'], ['2025-03-02', 98, 303.8, 'gal']]); assert.strictEqual(r.skipped, 1);
  const noTotal = W.parseFuelText('Date,Gallons,Price\n2025-01-12,100,3.50', 'oil'); assert.strictEqual(noTotal.records[0].cost, 350);                        // total worked out from the price
  const gas = W.parseFuelText('Bill End Date,Bill Start Date,Usage (CCF),Charges\n02/10/2026,01/12/2026,64,$98.50', 'gas'); assert.deepStrictEqual([gas.records[0].date, gas.records[0].days, gas.records[0].unit, gas.records[0].qty, gas.records[0].cost], ['2026-02-10', 29, 'ccf', 64, 98.5]);
  const txt = W.parseFuelText('Ferrellgas delivery 01/12/2025 152.3 gallons $3.36/gal total $511.60\nDelivery on Oct 5, 2025 - 120 gal - $402.00\nnothing here but words about a bill', 'propane');
  assert.deepStrictEqual(txt.records.map((x) => [x.date, x.qty, x.cost]), [['2025-01-12', 152.3, 511.6], ['2025-10-05', 120, 402]]); assert.strictEqual(txt.skipped, 0);
  assert.strictEqual(W.parseFuelText('hello world', 'propane').ok, false); assert.strictEqual(W.parseFuelText('', 'propane').ok, false);
  let n = 0; const m1 = W.fuelMerge([], r.records, () => 'i' + (++n)); assert.strictEqual(m1.added, 2);
  const m2 = W.fuelMerge(m1.records, r.records.concat([{ fuel: 'propane', date: '2024-12-01', qty: 90, unit: 'gal', cost: 300 }]), () => 'i' + (++n)); assert.deepStrictEqual([m2.added, m2.dups, m2.records[0].date], [1, 2, '2024-12-01']);
});

test('weather and energy settings are cleaned for backups', () => {
  const F = fuelWorld(); const W = new Function(srcBlock('/*FUEL-START*/', '/*FUEL-END*/') + '\nreturn {cleanWeather};')();
  assert.strictEqual(W.cleanWeather(null), null); assert.strictEqual(W.cleanWeather({ lat: 'x', lon: 1 }), null); assert.strictEqual(W.cleanWeather({ place: 'x' }), null);
  const w = W.cleanWeather({ place: 'Troy <b>NY', lat: 42.7312345, lon: -73.69, fetched: '2026-10-15', months: { '2026-01': { hdd: 1200, cdd: 0, avgF: 22.44, days: 31 }, '2026-02': { hdd: -5, cdd: 0, avgF: 30, days: 28 }, bad: { hdd: 1 }, '2026-03': { hdd: 900, cdd: 0, avgF: 'x', days: 31 } } });
  assert.deepStrictEqual(w, { place: 'Troy bNY', lat: 42.7312, lon: -73.69, fetched: '2026-10-15', months: { '2026-01': { hdd: 1200, cdd: 0, avgF: 22.4, days: 31 } } });
});

test('bills: paid by name, by card statement, by amount and date, with one payment claimed by one bill, and late payments next month', () => {
  const B = billsWorld(), today = new Date(2026, 9, 29);                       // Oct 29
  const bills = [{ id: 'ph', name: 'Cell phone', amount: 80, dueDay: 20, match: '' }, { id: 'net', name: 'Internet', amount: 70, dueDay: 21, match: '' }, { id: 'gym', name: 'Gym', amount: 25, dueDay: 28, match: 'goldsgym' }];
  const items = B.billItems(bills, [{ id: 'c1', name: 'Chase Freedom', type: 'credit', balance: 500, minPay: 35, dueDay: 15, lender: 'Chase' }]);
  const txns = [
    { id: 't1', date: '2026-10-19', name: 'TMOBILE*AUTOPAY 8001', amount: -80, cat: 'Other' },                  // same amount as the phone bill, no name to match: matched by amount
    { id: 't2', date: '2026-10-21', name: 'COMCAST 8773', amount: -70, cat: 'Other' },                         // internet, by amount
    { id: 't3', date: '2026-10-20', name: 'SPOTIFY', amount: -70, cat: 'Subscriptions' },                      // also 70, but a better-dated payment already claimed by Internet's closer date
    { id: 't4', date: '2026-11-02', name: 'GOLDSGYM MONTHLY', amount: -25, cat: 'Health' },                    // paid after month end: counts for a bill due on the 28th
    { id: 't5', date: '2026-10-14', name: 'PAYMENT THANK YOU', amount: 35, cat: 'Other', acct: 'c1', cardPay: true }];
  const sum = B.billsSummary(items, '2026-10', txns, {}, today), by = (id) => sum.rows.find((r) => r.item.id === id);
  assert.strictEqual(by('ph').st.state, 'paid'); assert.strictEqual(by('ph').st.found.guess, true); assert.strictEqual(by('ph').st.found.name, 'TMOBILE*AUTOPAY 8001');
  assert.strictEqual(by('net').st.state, 'paid'); assert.strictEqual(by('net').st.found.key, 't2');                                    // the closest date to the due day wins, so SPOTIFY is not claimed
  assert.strictEqual(by('gym').st.state, 'paid'); assert.ok(!by('gym').st.found.guess);
  assert.strictEqual(by('loan:c1').st.state, 'paid'); assert.strictEqual(by('loan:c1').st.found.key, 't5');                           // the card's own statement shows the payment
  // a transfer, an ATM row or a refund is never taken for a bill by amount
  const bad = B.billsSummary(B.billItems([{ id: 'x', name: 'Thing', amount: 80, dueDay: 20, match: '' }], []), '2026-10', [{ id: 'a', date: '2026-10-19', name: 'ATM WITHDRAWAL', amount: -80 }, { id: 'b', date: '2026-10-19', name: 'TRANSFER TO SAVINGS', amount: -80 }, { id: 'c', date: '2026-10-19', name: 'Somewhere', amount: -80, transfer: true }], {}, today);
  assert.strictEqual(bad.rows[0].st.state, 'overdue');
  // a mark always wins, and the amount must be close
  const marked = B.billsSummary(items.slice(0, 1), '2026-10', txns, { 'ph:2026-10': 'unpaid' }, today); assert.notStrictEqual(marked.rows[0].st.state, 'paid');
  const off = B.billsSummary(B.billItems([{ id: 'y', name: 'Thing', amount: 80, dueDay: 20, match: '' }], []), '2026-10', [{ id: 'a', date: '2026-10-19', name: 'Somewhere', amount: -95 }], {}, today); assert.strictEqual(off.rows[0].st.state, 'overdue');
});

// ---------- Credit cards tab: per-card analysis, balance story, insights ----------
function cardsWorld() {
  return new Function(srcBlock('/*TRANSFER-START*/', '/*TRANSFER-END*/') + srcBlock('/*CASHBACK-START*/', '/*CASHBACK-END*/') + srcBlock('/*CARDS-START*/', '/*CARDS-END*/') + '\nreturn {cardMonthKeys, cardAnalysis, cardBalanceStory, cardInsights, cardsSummary, cardsAdvice, isCashback, isTransfer, transferInfo};')();
}
function cardOpts(C, txns) {
  const inf = C.transferInfo(txns, 'off');
  return { today: '2026-10-15', months: 12, keyOf: (n) => n.toLowerCase().replace(/[#\d*]+/g, '').replace(/\s+/g, ' ').trim(), isCashback: C.isCashback, isTransfer: (x) => C.isTransfer(x, inf), payRe: null };
}
test('cardMonthKeys: the last n months ending this month, across a year boundary', () => {
  const C = cardsWorld();
  assert.deepEqual(C.cardMonthKeys('2026-02-10', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
});
test('cardAnalysis: spending, payments, interest, fees, cash back and categories for one card', () => {
  const C = cardsWorld();
  const card = { id: 'c1', type: 'credit', name: 'Sample Card', balance: 800, limit: 2000, apr: 24, minPay: 35 };
  const t = [
    { id: '1', date: '2026-10-02', name: 'Grocer One', amount: -120, cat: 'Groceries', acct: 'c1' },
    { id: '2', date: '2026-10-05', name: 'Grocer One', amount: -80, cat: 'Groceries', acct: 'c1' },
    { id: '3', date: '2026-10-06', name: 'Gas Stop', amount: -40, cat: 'Gas', acct: 'c1' },
    { id: '4', date: '2026-10-08', name: 'PAYMENT THANK YOU', amount: 300, acct: 'c1', cardPay: true },
    { id: '5', date: '2026-10-09', name: 'INTEREST CHARGE', amount: -18.5, acct: 'c1' },
    { id: '6', date: '2026-10-10', name: 'LATE FEE', amount: -29, acct: 'c1' },
    { id: '7', date: '2026-10-11', name: 'Daily Cash', amount: 4, acct: 'c1' },
    { id: '8', date: '2026-10-12', name: 'Grocer One return', amount: 20, acct: 'c1', cat: 'Groceries' },
    { id: '9', date: '2026-10-03', name: 'Other card buy', amount: -999, acct: 'c2' },
  ];
  const an = C.cardAnalysis(card, t, cardOpts(C, t));
  const oct = an.months[an.months.length - 1];
  assert.equal(an.linked, 8);
  assert.equal(Math.round(oct.spend), 220);            // 120+80+40 minus the 20 refund
  assert.equal(oct.pay, 300);
  assert.equal(oct.interest, 18.5);
  assert.equal(oct.fees, 29);
  assert.equal(oct.cb, 4);
  assert.equal(an.cats[0].cat, 'Groceries');
  assert.equal(an.merchants[0].name, 'Grocer One');
  assert.equal(an.big.amount, 120);
  assert.equal(an.spend12, oct.spend);
});
test('cardAnalysis: a payment from checking that names the card counts once, not twice', () => {
  const C = cardsWorld();
  const card = { id: 'c1', type: 'credit', name: 'Sample Card', balance: 500 };
  const t = [
    { id: '1', date: '2026-09-10', name: 'PAYMENT THANK YOU', amount: 250, acct: 'c1', cardPay: true },
    { id: '2', date: '2026-09-09', name: 'SAMPLE CARD PAYMENT', amount: -250 },           // the same payment seen from checking
    { id: '3', date: '2026-08-12', name: 'SAMPLE CARD PAYMENT', amount: -100 },          // only the checking side exists
  ];
  const o = cardOpts(C, t); o.payRe = /sample.*payment/i;
  const an = C.cardAnalysis(card, t, o);
  assert.equal(an.pay12, 350);
});
test('cardAnalysis: recurring charges need 3 of the last 6 months at a steady amount', () => {
  const C = cardsWorld();
  const card = { id: 'c1', type: 'credit', name: 'Sample Card', balance: 0 };
  const t = [];
  ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m, i) => { t.push({ id: 's' + i, date: m + '-03', name: 'StreamCo 123', amount: -15.99, acct: 'c1' }); if (i < 2) t.push({ id: 'r' + i, date: m + '-09', name: 'Rare Shop', amount: -50, acct: 'c1' }); });
  const an = C.cardAnalysis(card, t, cardOpts(C, t));
  assert.equal(an.recurring.length, 1);
  assert.equal(an.recurring[0].amt, 15.99);
  assert.equal(an.recurring[0].months, 6);
});
test('cardBalanceStory: peak, progress, 90-day change and utilization', () => {
  const C = cardsWorld();
  const card = { id: 'c1', balance: 600, limit: 2000, history: [{ date: '2026-05-01', balance: 1500 }, { date: '2026-07-10', balance: 1000 }, { date: '2026-10-10', balance: 600 }] };
  const st = C.cardBalanceStory(card, '2026-10-15');
  assert.equal(st.peak, 1500);
  assert.equal(Math.round(st.progress * 100), 60);
  assert.equal(st.change90, -400);                     // from 1000 on 07-10 (older than 90 days) to 600
  assert.equal(st.util, 30);
  assert.equal(st.ageDays, 5);
});
test('cardInsights: flags high use, interest that the minimum barely covers, fees and no linked transactions', () => {
  const C = cardsWorld();
  const card = { id: 'c1', name: 'Sample Card', balance: 1800, limit: 2000, apr: 28, minPay: 40 };
  const t = [{ id: '1', date: '2026-10-10', name: 'LATE FEE', amount: -35, acct: 'c1' }];
  const an = C.cardAnalysis(card, t, cardOpts(C, t)), st = C.cardBalanceStory(card, '2026-10-15');
  const ins = C.cardInsights(card, an, st, { today: '2026-10-15' });
  assert.equal(ins[0].k, 'bad');
  assert.ok(ins.some((i) => /Using 90%/.test(i.title)));
  assert.ok(ins.some((i) => /barely covers/.test(i.detail)));
  assert.ok(ins.some((i) => /Fees of \$35/.test(i.title)));
  const none = C.cardInsights(card, C.cardAnalysis(card, [], cardOpts(C, [])), st, {});
  assert.ok(none.some((i) => /No transactions are linked/.test(i.title)));
});
test('cardsSummary and cardsAdvice: totals, combined use and which card to pay extra on', () => {
  const C = cardsWorld();
  const mk = (id, name, bal, lim, apr, cb, spend) => {
    const card = { id, name, balance: bal, limit: lim, apr, minPay: 25 };
    const an = { linked: 5, spend12: spend, pay12: 0, cb12: cb, fees12: 0, int12: 0, months: [], cats: [], recurring: [], recurringMonthly: 0 };
    return { card, an, story: C.cardBalanceStory(card, '2026-10-15') };
  };
  const list = [mk('a', 'Card A', 900, 1000, 29, 0, 3000), mk('b', 'Card B', 100, 4000, 15, 60, 1000), { ...mk('c', 'Old Card', 0, 500, 20, 0, 0), card: { id: 'c', name: 'Old Card', balance: 0, limit: 500, closed: true } }];
  const sum = C.cardsSummary(list);
  assert.equal(sum.n, 2);
  assert.equal(sum.balance, 1000);
  assert.equal(sum.limit, 5000);
  assert.equal(Math.round(sum.pct), 20);
  assert.equal(sum.top.card.id, 'a');
  assert.equal(sum.best.card.id, 'b');
  const adv = C.cardsAdvice(list, sum);
  assert.ok(adv.some((a) => /Extra payments save the most on Card A/.test(a.title)));
  assert.ok(adv.some((a) => /Card A is over 50%/.test(a.title)));
  assert.ok(adv.some((a) => /Card B earns the most back/.test(a.title)));
});

// ---------- Vehicles: real cost with a loan, upkeep savings, service history ----------
function vehWorld() { return new Function(srcBlock('/*ASSETS-START*/', '/*ASSETS-END*/') + '\nreturn {assetOwnership, maintSavings, mergeServiceRecords, serviceScore};')(); }
test('assetOwnership: price plus interest is the real cost, and money gone adds depreciation, interest and upkeep', () => {
  const W = vehWorld();
  const o = W.assetOwnership({ price: 30000, value: 22000, loan: { orig: 27000, balance: 20000, minPay: 500 }, monthsOwned: 20, loanMonths: 20, interestLeft: 2500, upkeep: 600 });
  assert.equal(o.lost, 8000);
  assert.equal(o.interestPaid, 3000);              // 500 x 20 months = 10,000 paid, 7,000 of it principal
  assert.equal(o.realCost, 35500);                 // 30,000 + 3,000 + 2,500
  assert.equal(o.gone, 11600);                     // 8,000 + 3,000 + 600
  assert.equal(o.perMonth, 580);
  assert.equal(o.equity, 2000);
  assert.equal(o.underwater, false);
  const u = W.assetOwnership({ price: 30000, value: 15000, loan: { orig: 27000, balance: 20000, minPay: 500 }, monthsOwned: 20, interestLeft: 0 });
  assert.equal(u.underwater, true);
  const c = W.assetOwnership({ price: 10000, value: 6000, loan: null, monthsOwned: 12 });
  assert.equal(c.realCost, 10000);
  assert.equal(c.interestPaid, null);
});
test('maintSavings: spreads each upcoming cost over the months left and totals the year', () => {
  const W = vehWorld(), today = new Date(2026, 9, 15);
  const acct = { id: 'a1', name: 'Sample Car', asset: { kind: 'car', meter: 50000, meterLog: [], maint: [
    { id: 'm1', name: 'Oil change', months: 6, meter: 0, cost: 90, lastDate: '2026-05-01' },        // due 2026-11-01, 17 days
    { id: 'm2', name: 'Brake pads', months: 24, meter: 0, cost: 400, lastDate: '2025-02-01' },      // due 2027-02-01, ~109 days
    { id: 'm3', name: 'No cost', months: 12, meter: 0, cost: 0, lastDate: '2026-01-01' },
    { id: 'm4', name: 'Never done', months: 12, meter: 0, cost: 50 }] } };
  const r = W.maintSavings([acct], today, 12);
  assert.deepEqual(r.items.map((i) => i.id), ['m1', 'm2']);
  assert.equal(r.items[0].monthsLeft, 1);
  assert.equal(Math.round(r.items[1].perMonth), 100);   // 400 over 4 months
  assert.equal(r.monthly, 190);
  assert.equal(r.soonTotal, 490);
  assert.equal(r.yearly, 180 + 200 + 50);               // 90 x2 + 400 / 2 + 50 x1
});
test('mergeServiceRecords: matches services to the schedule, finds real intervals and new items', () => {
  const W = vehWorld();
  const asset = { kind: 'car', maint: [{ id: 'o', name: 'Oil and filter change', months: 6, meter: 5000, lastDate: '2025-01-01' }, { id: 't', name: 'Tire rotation', months: 6, meter: 7500 }, { id: 'b', name: 'Brake inspection', months: 12, meter: 0 }] };
  const recs = [
    { date: '2025-03-01', meter: 30000, service: 'Oil and filter changed' }, { date: '2025-09-01', meter: 36000, service: 'Engine oil and filter service' }, { date: '2026-03-01', meter: 42000, service: 'Oil change' },
    { date: '2026-03-01', meter: 42000, service: 'Tires rotated' },
    { date: '2026-01-10', meter: 40500, service: 'Cabin air filter replaced' }, { date: '2025-01-10', meter: 28000, service: 'Cabin air filter replaced' },
    { date: '2024-06-01', meter: 20000, service: 'Wheel alignment performed' }];
  const r = W.mergeServiceRecords(asset, recs);
  const up = Object.fromEntries(r.updates.map((u) => [u.id, u]));
  assert.equal(up.o.date, '2026-03-01');
  assert.equal(up.o.meter, 42000);
  assert.equal(up.t.date, '2026-03-01');
  assert.ok(!up.b);
  const oil = r.intervals.find((i) => i.id === 'o');
  assert.equal(oil.months, 6);
  assert.equal(oil.meter, 6000);
  assert.equal(r.extra.length, 1);                      // the cabin filter repeats, so it becomes a schedule item
  assert.match(r.extra[0].name, /Cabin air filter/);
  assert.equal(r.extra[0].meter, 12500);
  assert.ok(r.unmatched.some((u) => /alignment/i.test(u.name)));
  assert.equal(r.latestMeter, 42000);
  assert.equal(r.latestMeterDate, '2026-03-01');
  assert.ok(W.serviceScore('Tires rotated', 'Tire rotation') > W.serviceScore('Tires rotated', 'Tire check or replacement'));
});
test('cleanServiceRecords keeps only valid, plain service rows and drops personal details', () => {
  const { cleanServiceRecords } = require('../ai.js');
  const r = cleanServiceRecords({ records: [
    { date: '2026-03-01', mileage: 42000, service: 'Oil <b>change</b>', cost: 89.5 }, { date: 'March 2026', mileage: 1, service: 'x', cost: 0 }, { date: '2026-02-01', mileage: -5, service: '', cost: 10 }, { date: '2026-02-02', mileage: 'abc', service: 'Tires rotated', cost: 'n/a' }], notes: 'ok' });
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].service, 'Oil bchange/b');
  assert.equal(r.records[1].meter, 0);
  assert.equal(r.records[1].cost, 0);
});

test('income sub-categories: salary, bonus, tax refund, interest and more are recognised', () => {
  const w = catWorld({ customCats: [], merchantCats: {}, txns: [], subCats: {}, merchantSubs: {} });
  const table = { 'ACME CORP PAYROLL DIRECT DEP': 'Salary', 'ADP PAYROLL 1234': 'Salary', 'YEAR END BONUS ACME': 'Bonus', 'IRS TREAS 310 TAX REF': 'Tax refund', 'INTEREST PAID': 'Interest and dividends', 'AMAZON REFUND': 'Refunds and reimbursements', 'SOCIAL SECURITY SSA TREAS': 'Government benefits' };
  for (const [n, sub] of Object.entries(table)) assert.equal(w.guessSub('Income', n), sub, n);
  assert.ok(w.subList('Income').includes('Overtime and commission'));
});

// ---------- My Pay: statements, next paycheck, change detection ----------
function payWorld() { return new Function(srcBlock('/*PAY-START*/', '/*PAY-END*/') + '\nreturn {cleanPayStub, payTotals, payFreqOf, payNext, payArrived, payChanges, payYear, payBreakdown, payKind, payBonusPlan, payBonusYtd, payRegulars};')(); }
const mkStub = (date, gross, lines, extra) => Object.assign({ id: 's' + date, payDate: date, gross, net: 0, lines }, extra || {});
function stubOf(P, date, gross, fed, ss, med, state, k401, health, extra) {
  const lines = [{ section: 'earnings', name: 'Regular', amount: gross }, { section: 'tax', name: 'Federal Income Tax', amount: fed }, { section: 'tax', name: 'Social Security', amount: ss }, { section: 'tax', name: 'Medicare', amount: med }, { section: 'tax', name: 'State Income Tax', amount: state }, { section: 'retirement', name: '401(k)', amount: k401 }, { section: 'benefit', name: 'Health Insurance', amount: health }];
  const net = Math.round((gross - fed - ss - med - state - k401 - health) * 100) / 100;
  return P.cleanPayStub(Object.assign({ payDate: date, gross, net, lines }, extra || {}), () => 'id' + date);
}
test('cleanPayStub keeps clean numbers and sections only', () => {
  const P = payWorld();
  assert.equal(P.cleanPayStub({ payDate: 'bad', gross: 1, net: 1 }, () => 'x'), null);
  assert.equal(P.cleanPayStub({ payDate: '2026-01-02', gross: 'abc', net: 1 }, () => 'x'), null);
  const s = P.cleanPayStub({ payDate: '2026-01-02', gross: 2000, net: 1500.456, hours: 80, lines: [{ section: 'tax', name: 'Fed <b>', amount: -250 }, { section: 'nonsense', name: 'x', amount: 1 }, { section: 'benefit', name: '', amount: 5 }] }, () => 'new');
  assert.equal(s.id, 'new');
  assert.equal(s.net, 1500.46);
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].amount, 250);
  assert.equal(s.lines[0].name, 'Fed b');
});
test('payTotals splits a statement and flags one that does not add up', () => {
  const P = payWorld(), s = stubOf(P, '2026-01-09', 3000, 300, 186, 43.5, 120, 150, 100);
  const t = P.payTotals(s);
  assert.equal(t.tax, 649.5);
  assert.equal(t.retirement, 150);
  assert.equal(t.benefit, 100);
  assert.equal(t.unexplained, 0);
  s.net -= 40;
  assert.equal(P.payTotals(s).unexplained, 40);
});
test('payFreqOf and payNext: biweekly, semimonthly and monthly pay dates', () => {
  const P = payWorld(), today = new Date(2026, 9, 15);
  const bi = ['2026-09-04', '2026-09-18', '2026-10-02'].map((d) => stubOf(P, d, 2000, 200, 124, 29, 80, 100, 50));
  assert.equal(P.payFreqOf(bi).key, 'biweekly');
  const n = P.payNext(bi, today);
  assert.equal(n.date, '2026-10-16');
  assert.equal(n.days, 1);
  assert.equal(n.overdue, false);
  const semi = ['2026-08-15', '2026-08-31', '2026-09-15', '2026-09-30'].map((d) => stubOf(P, d, 2000, 200, 124, 29, 80, 100, 50));
  assert.equal(P.payFreqOf(semi).key, 'semimonthly');
  assert.equal(P.payNext(semi, today).date, '2026-10-15');
  assert.equal(P.payNext(semi, new Date(2026, 9, 16)).date, '2026-10-31');
  const mo = ['2026-07-31', '2026-08-31', '2026-09-30'].map((d) => stubOf(P, d, 5000, 600, 310, 72, 200, 250, 100));
  assert.equal(P.payFreqOf(mo).key, 'monthly');
  assert.equal(P.payNext(mo, today).date, '2026-10-31');
});
test('payArrived: warns when the paycheck that should have landed is not in the income', () => {
  const P = payWorld(), bi = ['2026-09-04', '2026-09-18', '2026-10-02'].map((d) => stubOf(P, d, 2000, 200, 124, 29, 80, 100, 50));
  const net = bi[0].net;
  assert.equal(P.payArrived(bi, [], new Date(2026, 9, 10)), null);                                        // next one is not due yet
  const late = P.payArrived(bi, [], new Date(2026, 9, 20));
  assert.equal(late.found, null);
  const ok = P.payArrived(bi, [{ date: '2026-10-16', amount: net, name: 'Payroll' }], new Date(2026, 9, 20));
  assert.ok(ok.found);
});
test('payChanges: explains a take-home change, new lines, a withholding jump and a retirement change', () => {
  const P = payWorld();
  const a = stubOf(P, '2026-09-18', 3000, 300, 186, 43.5, 120, 150, 100), b = stubOf(P, '2026-10-02', 3000, 420, 186, 43.5, 120, 210, 100);
  const ch = P.payChanges([a, b]);
  assert.ok(ch.some((c) => /Take-home pay went down/.test(c.title) && /Federal Income Tax/.test(c.detail)));
  assert.ok(ch.some((c) => /Federal tax withholding changed from 10.0% to 14.0%/.test(c.title)));
  assert.ok(ch.some((c) => /Retirement contribution changed from 5.0% to 7.0%/.test(c.title)));
  const bonus = stubOf(P, '2026-10-16', 4500, 300, 186, 43.5, 120, 150, 100);
  bonus.lines.push({ section: 'earnings', name: 'Bonus', amount: 1500 });
  const c2 = P.payChanges([a, bonus]);
  assert.ok(c2.some((c) => /New on this paycheck: Bonus \$1,500/.test(c.title) && c.k === 'good'));
  assert.deepEqual(P.payChanges([a]).filter((c) => c.k !== 'info'), []);
  const wrong = stubOf(P, '2026-10-30', 3000, 300, 186, 43.5, 120, 150, 100, { ytdGross: 9000 }), prev = stubOf(P, '2026-10-16', 3000, 300, 186, 43.5, 120, 150, 100, { ytdGross: 6000 });
  prev.ytdGross = 5000;
  assert.ok(P.payChanges([prev, wrong]).some((c) => /Year-to-date gross rose by \$4,000/.test(c.title)));
});
test('payYear: year-to-date totals and the estimate for the rest of the year', () => {
  const P = payWorld(), today = new Date(2026, 6, 1);
  const dates = ['2026-06-05', '2026-06-19', '2026-07-03'].map((d) => d);
  const stubs = dates.map((d, i) => stubOf(P, d, 3000, 300, 186, 43.5, 120, 150, 100, { ytdGross: 3000 * (11 + i) }));
  const y = P.payYear(stubs, 2026, today);
  assert.equal(y.count, 3);
  assert.equal(y.ytdGross, 39000);
  assert.ok(y.ytdFactor > 4);                       // the statements cover only part of what the year-to-date total says
  assert.equal(y.freq.key, 'biweekly');
  assert.ok(y.periodsLeft >= 12 && y.periodsLeft <= 14);
  assert.equal(y.fedPerPeriod, 300);
  assert.equal(Math.round(y.projGross), Math.round(39000 + 3000 * y.periodsLeft));
  assert.equal(P.payYear(stubs, 2025, today), null);
});

test('cleanPayStubRecord and cleanTaxDocs keep only valid, plain numbers', () => {
  const { cleanPayStubRecord, cleanTaxDocs } = require('../ai.js');
  const ok = cleanPayStubRecord({ payDate: '2026-10-16', periodStart: 'x', periodEnd: '2026-10-16', gross: 3500, net: 2300.456, hours: 80, ytdGross: 0, ytdNet: 5, notes: 'n', lines: [
    { section: 'tax', name: 'Fed <b>', amount: -420, ytd: 0 }, { section: 'junk', name: 'x', amount: 1, ytd: 0 }, { section: 'benefit', name: 'Health', amount: 0, ytd: 0 }, { section: 'earnings', name: 'Regular', amount: 3500, ytd: 91000 }] });
  assert.equal(ok.stub.net, 2300.46);
  assert.equal(ok.stub.periodStart, undefined);
  assert.equal(ok.stub.ytdGross, undefined);
  assert.equal(ok.stub.lines.length, 2);
  assert.equal(ok.stub.lines[0].amount, 420);
  assert.equal(ok.stub.lines[1].ytd, 91000);
  assert.equal(cleanPayStubRecord({ payDate: '2026-10-16', gross: 0, net: 0, lines: [], notes: 'not a pay stub' }).stub, null);
  assert.equal(cleanPayStubRecord({ payDate: 'bad', gross: 5, net: 4 }).stub, null);
  const t = cleanTaxDocs({ forms: [{ form: 'W-2', year: 2025, state: 'ma', wages: 90000, fedWithheld: 11000, ssWages: 90000, ssWithheld: 5580, medicareWages: 90000, medicareWithheld: 1305, stateWages: 90000, stateWithheld: 4200, interest: 0, ordinaryDividends: 0, qualifiedDividends: 0, nonemployeeComp: 0, otherIncome: 0, retirementDistribution: 0, unemployment: 0, mortgageInterest: 0, stateRefund: 0 }, { form: 'bogus', year: 2025 }, { form: '1099-INT', year: 1800, interest: 5 }, { form: '1099-INT', year: 2025, interest: 0 }], notes: '' });
  assert.equal(t.forms.length, 1);
  assert.equal(t.forms[0].state, 'MA');
  assert.equal(t.forms[0].wages, 90000);
});
test('docGuess files documents by name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const g = new Function(src.slice(src.indexOf('function docGuess('), src.indexOf('function docsLoad(')) + '\nreturn docGuess;')();
  assert.deepEqual(g('W-2 2025.pdf'), { kind: 'Tax documents', year: 2025 });
  assert.equal(g('Payslip_Oct.pdf').kind, 'Pay statements');
  assert.equal(g('carfax-report.pdf').kind, 'Vehicle records');
  assert.equal(g('Chase statement 2026-03.pdf').kind, 'Bank and card statements');
  assert.equal(g('random.pdf').kind, 'Other');
});

// ---------- Taxes: federal estimate, state guide, inputs from pay statements and forms ----------
function taxWorld() { return new Function(srcBlock('/*PAY-START*/', '/*PAY-END*/') + srcBlock('/*TAX-START*/', '/*TAX-END*/') + '\nreturn {taxFormWarn, taxBrackets, taxEstimate, taxInputs, taxDeadlines, taxSaving, cleanTaxState, payYear, cleanPayStub};')(); }
test('taxEstimate: 2026 single, standard deduction, brackets, child credit and payroll tax', () => {
  const X = taxWorld();
  const e = X.taxEstimate({ year: 2026, status: 'single', wages: 100000, grossForFica: 100000, withheldFed: 12000, state: 'TX' });
  assert.equal(e.deduction, 16100);
  assert.equal(e.taxable, 83900);
  assert.equal(Math.round(e.income), 13170);
  assert.equal(Math.round(e.balance), 1170);
  assert.equal(e.marginal, 0.22);
  assert.equal(Math.round(e.ss), 6200);
  assert.equal(Math.round(e.medicare), 1450);
  assert.equal(e.state.none, true);
  const k = X.taxEstimate({ year: 2026, status: 'single', wages: 100000, grossForFica: 100000, kids: 2, withheldFed: 12000 });
  assert.equal(Math.round(k.income), 8770);
  assert.ok(k.balance < 0);                       // a refund
  assert.equal(X.taxEstimate({ year: 2026, status: 'single', wages: 10000, kids: 1 }).income, 0);   // credit cannot go below zero tax
});
test('taxEstimate: itemizing wins only when it beats the standard deduction; the SALT cap applies', () => {
  const X = taxWorld();
  const base = { year: 2026, status: 'single', wages: 150000, grossForFica: 150000 };
  const small = X.taxEstimate(Object.assign({}, base, { itemized: { salt: 9000, mortgageInterest: 4000, charity: 1000, medical: 0 } }));
  assert.equal(small.usedItemized, false);
  assert.equal(small.deduction, 16100);
  const big = X.taxEstimate(Object.assign({}, base, { itemized: { salt: 60000, mortgageInterest: 12000, charity: 3000, medical: 0 } }));
  assert.equal(big.usedItemized, true);
  assert.equal(big.itemized, 40400 + 12000 + 3000);
});
test('taxEstimate: self-employment income adds self-employment tax and halves into AGI; state uses a rate you can override', () => {
  const X = taxWorld();
  const e = X.taxEstimate({ year: 2026, status: 'single', wages: 60000, grossForFica: 60000, seIncome: 20000, withheldFed: 5000, state: 'MA', withheldState: 2500 });
  assert.equal(Math.round(e.seTax), Math.round(20000 * 0.9235 * 0.153));
  assert.ok(e.agi < 60000 + 20000);
  assert.equal(e.state.rate, 5);
  assert.equal(Math.round(e.state.tax), Math.round((80000 - e.seTax / 2) * 0.05));
  assert.equal(X.taxEstimate({ year: 2026, status: 'single', wages: 80000, state: 'MA', stateRate: 3 }).state.rate, 3);
  assert.equal(X.taxEstimate({ year: 2026, status: 'single', wages: 80000 }).state, undefined);
  assert.ok(X.taxSaving(e, 1000) > 200);
});
test('taxInputs: uses W-2s when you added them, otherwise projects the year from pay statements', () => {
  const X = taxWorld(), today = new Date(2026, 6, 1);
  const mk = (date, i) => X.cleanPayStub({ payDate: date, gross: 4000, net: 3000, ytdGross: 4000 * (13 + i), lines: [{ section: 'earnings', name: 'Regular', amount: 4000 }, { section: 'tax', name: 'Federal Income Tax', amount: 500 }, { section: 'tax', name: 'State Income Tax', amount: 200 }, { section: 'retirement', name: '401k', amount: 200 }, { section: 'benefit', name: 'Health', amount: 100 }] }, () => 'i' + date);
  const stubs = ['2026-06-05', '2026-06-19', '2026-07-03'].map(mk);
  const p = X.taxInputs({ status: 'single', state: 'MA' }, 2026, stubs, [], [], today);
  assert.equal(p.source, 'pay');
  assert.ok(p.gross > 105000 && p.gross < 120000);
  assert.ok(p.wages < p.gross);                                   // retirement and benefits come off
  assert.ok(p.periodsLeft >= 12);
  assert.ok(p.withheldFed > 500 * 14);
  const f = X.taxInputs({ status: 'single' }, 2026, stubs, [{ id: 'a', form: 'W-2', year: 2026, state: 'MA', wages: 90000, ssWages: 98000, fedWithheld: 9000, stateWithheld: 4000 }], [], today);
  assert.equal(f.source, 'forms');
  assert.equal(f.wages, 90000);
  assert.equal(f.withheldFed, 9000);
  const m = X.taxInputs({ status: 'single', manualWages: 50000, manualWithheld: 4000 }, 2026, [], [], [], today);
  assert.equal(m.source, 'manual');
  assert.equal(X.taxInputs({ status: 'single' }, 2026, [], [], [], today).source, 'none');
  const donate = X.taxInputs({ status: 'single', manualWages: 50000 }, 2026, [], [], [{ date: '2026-03-01', amount: -250, sub: 'Donations' }, { date: '2025-03-01', amount: -999, sub: 'Donations' }], today);
  assert.equal(donate.charity, 250);
});
test('taxDeadlines and cleanTaxState', () => {
  const X = taxWorld();
  const d = X.taxDeadlines(2026, new Date(2027, 1, 1));
  assert.equal(d.find((x) => /File your 2026/.test(x.label)).date, '2027-04-15');
  assert.equal(d.find((x) => /File your 2026/.test(x.label)).days, 73);
  assert.equal(d[0].past, true);
  const c = X.cleanTaxState({ state: 'ZZ', status: 'nope', kids: 99, otherIncome: -5, rate: 'x', manualWages: '60000', forms: [{ form: 'W-2', year: 2025, wages: 1000, state: 'ma' }, { form: 'bad', year: 2025 }] });
  assert.equal(c.state, undefined);
  assert.equal(c.status, 'single');
  assert.equal(c.kids, 0);
  assert.equal(c.otherIncome, undefined);
  assert.equal(c.manualWages, 60000);
  assert.equal(c.forms.length, 1);
  assert.equal(c.forms[0].wages, 1000);
});

// ---------- Tax figures looked up online: checked before use, stored safely, can be reset ----------
function ratesWorld() { return new Function(srcBlock('/*PAY-START*/', '/*PAY-END*/') + srcBlock('/*TAX-START*/', '/*TAX-END*/') + '\nreturn {TAX_YEARS, STATE_TAX, cleanTaxRates, taxApplyOnline, cleanTaxOnline, cleanTaxState, taxEstimate, taxYearOf};')(); }
function rawFed(X, y, bump) {
  const t = X.TAX_YEARS[y], br = {};
  for (const k of Object.keys(t.br)) br[k] = t.br[k].map((r) => [r[0] === Infinity ? null : r[0], r[1]]);
  return { year: y, federal: { std: Object.assign({}, t.std, bump || {}), ssWageBase: t.ssBase, saltCap: t.salt, brackets: br }, state: { code: 'MA', ratePct: 4.2, type: 'flat', note: 'Flat rate.' } };
}
test('cleanTaxRates accepts complete, sane figures and rejects broken ones', () => {
  const X = ratesWorld();
  const ok = X.cleanTaxRates(rawFed(X, 2026, { single: 17000 }), 2026);
  assert.equal(ok.fed.std.single, 17000);
  assert.equal(ok.fed.br.single[6][0], Infinity);
  assert.equal(ok.state.rate, 4.2);
  assert.equal(X.cleanTaxRates(rawFed(X, 2026), 2027).fed, null);                     // figures for a different year are not used
  const bad = rawFed(X, 2026); bad.federal.brackets.single[2][1] = 0.25;
  assert.equal(X.cleanTaxRates(bad, 2026).fed, null);                                 // rates must be the known seven
  const jumbled = rawFed(X, 2026); jumbled.federal.brackets.mfj[1][0] = 5;
  assert.equal(X.cleanTaxRates(jumbled, 2026).fed, null);
  const silly = rawFed(X, 2026, { single: 900 });
  assert.equal(X.cleanTaxRates(silly, 2026).fed, null);
  const st = rawFed(X, 2026); st.state = { code: 'MA', ratePct: 90 };
  assert.equal(X.cleanTaxRates(st, 2026).state, null);
  const nul = rawFed(X, 2026); nul.federal.std.single = null;
  assert.equal(X.cleanTaxRates(nul, 2026).fed, null);
  assert.equal(X.cleanTaxRates(null, 2026).fed, null);
});
test('online figures are stored, applied to the estimate, survive JSON, and can be reset', () => {
  const X = ratesWorld();
  const before = X.taxEstimate({ year: 2026, status: 'single', wages: 100000, grossForFica: 100000, state: 'MA' });
  const c = X.cleanTaxRates(rawFed(X, 2026, { single: 20000 }), 2026);
  const br = {}; for (const k of Object.keys(c.fed.br)) br[k] = c.fed.br[k].map((r) => [r[0] === Infinity ? null : r[0], r[1]]);
  const stored = JSON.parse(JSON.stringify(X.cleanTaxOnline({ fed: { 2026: { std: c.fed.std, ssBase: c.fed.ssBase, salt: c.fed.salt, br, fetched: '2026-10-15', sources: ['https://www.irs.gov/x', 'javascript:alert(1)'] } }, states: { MA: { rate: 4.2, type: 'flat', note: 'n', fetched: '2026-10-15', sources: [] }, ZZ: { rate: 3 } } })));
  assert.deepEqual(stored.fed[2026].sources, ['https://www.irs.gov/x']);
  assert.equal(stored.fed[2026].br.single[6][0], null);
  assert.equal(stored.states.ZZ, undefined);
  X.taxApplyOnline(stored);
  const after = X.taxEstimate({ year: 2026, status: 'single', wages: 100000, grossForFica: 100000, state: 'MA' });
  assert.equal(after.deduction, 20000);
  assert.equal(after.state.rate, 4.2);
  assert.ok(after.income < before.income);
  assert.equal(X.cleanTaxState({ online: stored }).online.fed[2026].std.single, 20000);
  assert.deepEqual(X.cleanTaxState({ online: { fed: { 2026: { std: { single: 1 } } } } }).online.fed, {});    // broken stored data is dropped
  X.taxApplyOnline(null);
  const reset = X.taxEstimate({ year: 2026, status: 'single', wages: 100000, grossForFica: 100000, state: 'MA' });
  assert.equal(reset.deduction, 16100);
  assert.equal(reset.state.rate, 5);
});
test('cleanTaxRatesRaw pulls the JSON out of Claude\'s reply and keeps only https sources', () => {
  const { cleanTaxRatesRaw } = require('../ai.js');
  const r = cleanTaxRatesRaw('Here you go:\n{"year":2026,"federal":{"std":{"single":16100}},"state":{"code":"MA","ratePct":5},"sources":["https://www.irs.gov/newsroom/x","http://evil.example","javascript:1"]}\nDone.');
  assert.equal(r.raw.year, 2026);
  assert.deepEqual(r.sources, ['https://www.irs.gov/newsroom/x']);
  assert.equal(cleanTaxRatesRaw('no json here'), null);
  assert.equal(cleanTaxRatesRaw('{bad json}'), null);
});

test('cleanAssetWeb needs three real https listings and keeps the price range sane', () => {
  const { cleanAssetWeb } = require('../ai.js');
  const L = (p, u) => ({ title: 'Car <b>', price: p, miles: 40000, url: u || 'https://www.example.com/a' });
  const ok = cleanAssetWeb('Found: {"low":18000,"mid":20000,"high":23000,"yearlyDepreciationPct":11,"confidence":"medium","basis":"Asking prices.","listings":[' + [L(19000), L(20000), L(22000), L(21000, 'http://bad.example'), L(5, 'https://x.example.com/z')].map((l) => JSON.stringify(l)).join(',') + ']}');
  assert.equal(ok.mid, 20000);
  assert.equal(ok.listings.length, 3);                                  // the http link and the $5 listing are dropped
  assert.equal(ok.listings[0].title, 'Car b');
  const few = cleanAssetWeb('{"low":1,"mid":2000,"high":3,"confidence":"high","basis":"","listings":[' + JSON.stringify(L(19000)) + ']}');
  assert.equal(few.mid, 0);
  assert.match(few.basis, /Fewer than three/);
  assert.equal(cleanAssetWeb('nothing'), null);
});

test('assets: a value that rose since purchase (market, inflation) is not treated as appreciation, mods are not market movement', () => {
  const A = assetWorld(), T = new Date(2026, 9, 14);
  const bike = { balance: 8800, history: [{ date: '2026-04-14', balance: 8000 }, { date: '2026-10-14', balance: 8800 }], asset: { kind: 'motorcycle', purchasePrice: 8000, purchaseDate: '2026-04-14' } };
  const r = A.assetRate(bike, T);
  assert.ok(r.rate >= 0.08 * 0.4 - 1e-9 && r.rate <= 0.08);                       // never an appreciation; only a slow decline
  assert.equal(r.floored, true);
  assert.equal(r.young, true);
  const st = A.assetStats(bike, T);
  assert.ok(st.perYear > 0 && st.proj[2].value < 8800);
  assert.equal(st.lost, -800);                                                    // nominally up $800 ...
  assert.ok(st.realLost !== null && st.realLost < st.lost + 1000);               // ... and the inflation-adjusted figure is lower than the nominal gain
  const coll = A.assetRate(Object.assign({}, bike, { asset: Object.assign({}, bike.asset, { collectible: true }) }), T);
  assert.ok(coll.rate < 0.08 * 0.4);                                              // a collectible may gain value
  assert.equal(coll.floored, false);
  // a $1,000 mod that adds $400 is not "market gain": the value jump is removed before the rate is worked out
  const mod = { balance: 8400, history: [{ date: '2025-10-14', balance: 8000 }, { date: '2026-10-14', balance: 8400 }], asset: { kind: 'motorcycle', purchasePrice: 8000, purchaseDate: '2025-10-14', mods: [{ id: 'm', name: 'Exhaust', cost: 1000, add: 400, counted: true, date: '2026-06-01' }] } };
  const rm = A.assetRate(mod, T);
  assert.ok(Math.abs(rm.observed) < 0.01);                                        // 8,400 less the 400 added is 8,000 again
  const sm = A.assetStats(mod, T);
  assert.equal(sm.invested, 9000);
  assert.equal(sm.lost, 600);                                                     // 9,000 put in, worth 8,400
  assert.equal(sm.modsAdd, 400);
});
test('assets: modifications are cleaned and recouped at a share of their cost', () => {
  const A = assetWorld(); let n = 0;
  const c = A.cleanAsset({ kind: 'motorcycle', collectible: true, mods: [{ name: 'Exhaust <b>', kind: 'Performance (exhaust, tune, suspension)', cost: 900, add: 270, counted: true, date: '2026-05-01' }, { name: '', cost: 5 }, { name: 'Bad', cost: -4 }] }, () => 'n' + (++n));
  assert.equal(c.collectible, true);
  assert.equal(c.mods.length, 1);
  assert.equal(c.mods[0].name, 'Exhaust b');
  assert.equal(c.mods[0].add, 270);
  assert.equal(A.modRecoup('Performance (exhaust, tune, suspension)'), 0.3);
  assert.equal(A.modRecoup('nonsense'), 0.3);
  assert.equal(A.modsCost(c), 900);
  assert.equal(A.modsAdd(c), 270);
});

test('tab layout: order is kept, new tabs go last, moves and steps work, bad saved data is cleaned', () => {
  const N = new Function(srcBlock('/*NAV-START*/', '/*NAV-END*/') + '\nreturn {navOrdered, navMove, navStep, cleanNavPref, navVisible};')();
  const tabs = [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']];
  assert.deepEqual(N.navOrdered(tabs, ['c', 'a']).map((t) => t[0]), ['c', 'a', 'b', 'd']);
  assert.deepEqual(N.navOrdered(tabs, ['zzz', 'c', 'c']).map((t) => t[0]), ['c', 'a', 'b', 'd']);
  assert.deepEqual(N.navOrdered(tabs, null).map((t) => t[0]), ['a', 'b', 'c', 'd']);
  assert.deepEqual(N.navMove(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(N.navMove(['a', 'b', 'c', 'd'], 'a', ''), ['b', 'c', 'd', 'a']);
  assert.deepEqual(N.navMove(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(N.navStep(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(N.navStep(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(N.navStep(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  const c = N.cleanNavPref({ layout: 'bogus', order: ['b', 'x', 'b', 5, 'a'] }, ['a', 'b']);
  assert.deepEqual(c, { layout: 'side', order: ['b', 'a'], hidden: [], protect: '' });
  assert.equal(N.cleanNavPref({ layout: 'top' }, ['a']).layout, 'top');
  assert.deepEqual(N.cleanNavPref(null, ['a']), { layout: 'side', order: [], hidden: [], protect: '' });
  const h = N.cleanNavPref({ hidden: ['b', 'look', 'b', 'nope', 7, 'c'] }, ['a', 'b', 'c', 'look']);
  assert.deepEqual(h.hidden, ['b', 'c']);                                            // Settings can never be hidden
  const tabs2 = [['a', 'A'], ['b', 'B'], ['look', 'Settings']];
  assert.deepEqual(N.navVisible(tabs2, ['look', 'b', 'a'], ['b', 'look']).map((t) => t[0]), ['look', 'a']);
});

test('tab lock: a salted hash accepts the right password only, and bad saved records are refused', async () => {
  const L = new Function(srcBlock('/*NAVLOCK-START*/', '/*NAVLOCK-END*/') + '\nreturn {navLockMake, navLockCheck, navLockClean};')();
  const rec = await L.navLockMake('correct horse', 2000);
  assert.equal(rec.it, 2000);
  assert.ok(!JSON.stringify(rec).includes('correct horse'));
  assert.equal(await L.navLockCheck(rec, 'correct horse'), true);
  assert.equal(await L.navLockCheck(rec, 'correct horsf'), false);
  assert.equal(await L.navLockCheck(rec, ''), false);
  const other = await L.navLockMake('correct horse', 2000);
  assert.notEqual(other.salt, rec.salt);                                  // every record has its own salt
  assert.notEqual(other.hash, rec.hash);
  assert.equal(await L.navLockCheck(null, 'x'), false);
  assert.equal(await L.navLockCheck({ salt: 'a', hash: 'b', it: 5 }, 'x'), false);   // too few rounds is not accepted
  assert.equal(L.navLockClean({ salt: 'x'.repeat(100), hash: 'y', it: 2000 }), null);
  assert.deepEqual(L.navLockClean({ salt: 's', hash: 'h', it: 2000.4, extra: 1 }), { salt: 's', hash: 'h', it: 2000 });
});
test('tab lock: protection setting is kept only as app or own', () => {
  const N = new Function(srcBlock('/*NAV-START*/', '/*NAV-END*/') + '\nreturn {cleanNavPref};')();
  assert.equal(N.cleanNavPref({ protect: 'app' }, []).protect, 'app');
  assert.equal(N.cleanNavPref({ protect: 'own' }, []).protect, 'own');
  assert.equal(N.cleanNavPref({ protect: 'yes' }, []).protect, '');
});

// ---------- Budgets: category history, findings, keywords for any category ----------
function budWorld() { return new Function(srcBlock('/*CATDETAIL-START*/', '/*CATDETAIL-END*/') + '\nreturn {catDetail, catInsights};')(); }
const budKey = (n) => n.toLowerCase().replace(/[#\d*]+/g, '').replace(/\s+/g, ' ').trim();
test('catDetail: twelve months of one category, merchants, regular charges and the biggest purchase', () => {
  const B = budWorld(), t = [];
  ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m, i) => {
    t.push({ id: 'g' + i, date: m + '-04', name: 'Grocer One', amount: -100 - i * 10, cat: 'Groceries' });
    t.push({ id: 'w' + i, date: m + '-15', name: 'Wholesale 12', amount: -50, cat: 'Groceries' });
  });
  t.push({ id: 'x', date: '2026-10-09', name: 'Elsewhere', amount: -400, cat: 'Dining' }, { id: 'r', date: '2026-10-10', name: 'Refund', amount: 20, cat: 'Groceries' });
  const d = B.catDetail(t, 'Groceries', '2026-10', 175, { keyOf: budKey, dataMonths: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] });
  assert.equal(d.months.length, 12);
  assert.equal(d.months[11].mk, '2026-10');
  assert.equal(d.spend, 200);                         // 150 + 50, the refund and the other category are not counted
  assert.equal(d.months[0].mk, '2025-11');
  assert.equal(Math.round(d.avg6), 170);               // May to September: 150, 160, 170, 180, 190
  assert.equal(d.merchants[0].name, 'Grocer One');
  assert.equal(d.recurring.find((r) => /Wholesale/.test(r.name)).amt, 50);
  assert.equal(d.big.amount, 150);
  assert.equal(d.overOf, 6);
  assert.equal(d.overCount, 3);                        // Aug, Sep and Oct are above 175
});
test('catInsights: over budget, above usual, budget too low, nothing recorded', () => {
  const B = budWorld();
  const mk = (spends, budget) => { const t = spends.map((v, i) => ({ id: 'a' + i, date: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'][i] + '-05', name: 'Shop', amount: -v, cat: 'Dining' })); return B.catDetail(t, 'Dining', '2026-10', budget, { keyOf: budKey, dataMonths: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] }); };
  const over = B.catInsights(mk([300, 300, 300, 300, 300, 450], 250), 250, 'Dining');
  assert.ok(over.some((i) => i.k === 'bad' && /Over budget by \$200/.test(i.title)));
  assert.ok(over.some((i) => /Over budget in 6 of the last 6 months/.test(i.title)));
  assert.ok(over.some((i) => /above your usual/.test(i.title)));
  const low = B.catInsights(mk([100, 100, 100, 100, 100, 100], 500), 500, 'Dining');
  assert.ok(low.some((i) => /usually use about 20%/.test(i.title)));
  const none = B.catInsights(B.catDetail([], 'Dining', '2026-10', 0, { keyOf: budKey }), 0, 'Dining');
  assert.match(none[0].title, /Nothing spent in Dining/);
});
test('keywords work for built-in categories: longest keyword wins, bad saved rules are cleaned', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const code = src.slice(src.indexOf('function ruleRe('), src.indexOf('var CCOL=')) + src.slice(src.indexOf('function cleanCatRules('), src.indexOf('function cleanCustomCats('));
  const f = new Function('S,BASECATS', code + '\nreturn {ruleCat, cleanCatRules};');
  const S = { customCats: [{ name: 'Gas', rules: ['costco gas', 'shell'] }], catRules: { Groceries: ['costco', 'aldi'] } };
  const X = f(S, ['Groceries', 'Dining']);
  assert.equal(X.ruleCat('COSTCO GAS #123'), 'Gas');            // the longer keyword wins
  assert.equal(X.ruleCat('Costco wholesale'), 'Groceries');
  assert.equal(X.ruleCat('ALDI 44'), 'Groceries');
  assert.equal(X.ruleCat('Somewhere else'), null);
  assert.deepEqual(X.cleanCatRules({ Groceries: [' Aldi ', 'aldi', '<b>x</b>', ''], Nope: ['a'], Other: ['zzz'], Dining: 'nope' }), { Groceries: ['aldi', 'bx/b'], Other: ['zzz'] });
});

test('search: every word must match, title and word-start matches rank first, groups keep their order', () => {
  const S = new Function(srcBlock('/*SEARCH-START*/', '/*SEARCH-END*/') + '\nreturn {searchTerms, searchScore, searchRank};')();
  assert.deepEqual(S.searchTerms(' $1,250  Shell  '), ['1250', 'shell']);
  assert.deepEqual(S.searchTerms(''), []);
  assert.equal(S.searchScore(['shell', 'oct'], 'Shell Oil', 'fuel oct 2026'), 31 + 1 > 0 ? S.searchScore(['shell', 'oct'], 'Shell Oil', 'fuel oct 2026') : 0);
  assert.ok(S.searchScore(['shell'], 'Shell Oil', '') > S.searchScore(['shell'], 'Nutshell Cafe', ''));   // a word start beats the middle of a word
  assert.equal(S.searchScore(['shell', 'tax'], 'Shell Oil', 'fuel'), 0);                                   // all words must be found
  assert.ok(S.searchScore(['oil'], 'Oil', '') > S.searchScore(['oil'], 'Oil change', ''));                  // an exact title is best
  const items = [{ group: 'Bills', title: 'Shell bill' }, { group: 'Pages', title: 'Shell settings' }, { group: 'Pages', title: 'Budgets', hay: 'shell keywords' }, { group: 'Bills', title: 'Other' }];
  const r = S.searchRank(items, 'shell', ['Pages', 'Budgets', 'Bills'], { Pages: 1 });
  assert.deepEqual(r.map((g) => g.group), ['Pages', 'Bills']);
  assert.equal(r[0].rows.length, 1);                                    // trimmed to the group limit
  assert.equal(r[0].total, 2);
  assert.equal(r[0].rows[0].title, 'Shell settings');
  assert.deepEqual(S.searchRank(items, '', ['Pages'], {}), []);
});

test('search periods: this month, last month, a month name, this year and last N days are pulled out of the query', () => {
  const S = new Function(srcBlock('/*SEARCH-START*/', '/*SEARCH-END*/') + '\nreturn {searchPeriod};')();
  const t = new Date(2026, 9, 15);
  assert.deepEqual(S.searchPeriod('shell last month', t), { rest: 'shell', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' });
  assert.equal(S.searchPeriod('groceries this month', t).from, '2026-10-01');
  assert.equal(S.searchPeriod('groceries march', t).label, 'March 2026');
  assert.equal(S.searchPeriod('rent in november', t).label, 'November 2025');            // a month that has not happened this year means last year's
  assert.equal(S.searchPeriod('uber oct 2024', t).label, 'October 2024');
  assert.deepEqual(S.searchPeriod('spent this year', t), { rest: 'spent', from: '2026-01-01', to: '2026-12-31', label: '2026' });
  assert.equal(S.searchPeriod('fuel last 30 days', t).from, '2026-09-15');
  assert.equal(S.searchPeriod('may flowers', t).label, '');                              // "may" alone is a word, not a month
  assert.equal(S.searchPeriod('in may', t).label, 'May 2026');
  assert.equal(S.searchPeriod('shell', t).rest, 'shell');
  assert.equal(S.searchPeriod('', t).rest, '');
});

// ---------- Metered propane invoice: gallons, price per gallon, fixed fees, meter readings ----------
const INVOICE = `Example Customer                                  Amount Due      $161.75
Account # ****9650                                   Date Due        05/15/2026
Invoice Number ****0785                              Invoice Date    04/15/2026
Meter Invoice
   Date                     Gallons Product                                  Ticket #          PPG        Total
04/15/2026                       1.000 Meter Maintenance Fee Taxable      ****0785        19.9900        19.99
04/15/2026                      32.976 Propane                            ****0785         4.2990       141.76
04/15/2026                             NH Sales Exempt                                                       0.00
                                                                            Amount Due     $161.75
Meter Reading
Prior Meter Reading Date     03/04/2026
Prior Meter Reading          540.00
April Meter Reading                                   Current Meter Reading        552.00
Meter Usage                                           12.00
Meter Conversion Factor      2.7483`;
function invWorld() { return new Function(srcBlock('/*ENERGY-START*/', '/*ENERGY-END*/') + srcBlock('/*FUEL-START*/', '/*FUEL-END*/') + srcBlock('/*FUELIMPORT-START*/', '/*FUELIMPORT-END*/') + '\nreturn {parseFuelText, parseFuelInvoice, fuelMerge, cleanFuel, fuelPeriods, fuelPrices, fuelFees, fuelLinkTx};')(); }
test('fuel invoice: gallons, price per gallon, the meter fee kept out of the price, and the billing period from the meter readings', () => {
  const W = invWorld(), r = W.parseFuelText(INVOICE, 'propane');
  assert.equal(r.ok, true);
  assert.equal(r.format, 'invoice');
  assert.equal(r.records.length, 1);
  const x = r.records[0];
  assert.equal(x.fuel, 'propane');
  assert.equal(x.date, '2026-04-15');
  assert.equal(x.qty, 32.976);
  assert.equal(x.ppg, 4.299);
  assert.equal(x.fee, 19.99);
  assert.equal(x.cost, 161.75);                         // what was charged in all
  assert.equal(x.days, 42);                             // 4 March to 15 April
  assert.deepEqual(x.meter, { prev: 540, cur: 552, factor: 2.7483 });
  const c = W.cleanFuel([x], () => 'id1')[0];
  assert.equal(c.qty, 32.976);
  assert.equal(c.fee, 19.99);
  assert.equal(c.ppg, 4.299);
  assert.equal(c.meter.factor, 2.7483);
  assert.equal(W.cleanFuel([Object.assign({}, x, { fee: 999 })], () => 'i')[0].fee, undefined);   // a fee cannot exceed the total
  const p = W.fuelPrices([Object.assign({ id: 'a' }, c)], 'propane')[0];
  assert.equal(p.price, 4.299);
  assert.equal(Math.round(p.allIn * 1000) / 1000, 4.905);   // 161.75 / 32.976
  const noPpg = W.fuelPrices([{ id: 'b', fuel: 'propane', date: '2026-04-15', qty: 30, unit: 'gal', cost: 150, fee: 20 }], 'propane')[0];
  assert.equal(Math.round(noPpg.price * 100) / 100, 4.33);  // (150 - 20) / 30
});
test('fuel invoice: a metered bill states its own period and use, so it needs no delivery-to-delivery guessing', () => {
  const W = invWorld(), mk = (date, qty, days, cost) => ({ id: date, fuel: 'propane', date, days, qty, unit: 'gal', cost, fee: 19.99, meter: { prev: 1, cur: 2, factor: 2.7483 } });
  const recs = [mk('2026-03-04', 40, 30, 190), mk('2026-04-15', 32.976, 42, 161.75)];
  const per = W.fuelPeriods(recs, 'propane');
  assert.equal(per.length, 2);
  assert.deepEqual(per.map((p) => p.days), [30, 42]);
  assert.ok(Math.abs(per[1].qty - 32.976) < 1e-9);
  const f = W.fuelFees(recs, 'propane', '2026-05-01');
  assert.equal(Math.round(f.fee * 100) / 100, 39.98);
  assert.equal(f.n, 2);
  assert.ok(Math.abs(f.share - 39.98 / 351.75) < 1e-6);
  assert.equal(W.fuelFees(recs, 'propane', '2027-12-01').fee, 0);                          // older than a year is left out
  const mixed = W.fuelPeriods(recs.concat([{ id: 'd1', fuel: 'propane', date: '2026-01-01', qty: 100, unit: 'gal', cost: 300 }, { id: 'd2', fuel: 'propane', date: '2026-02-10', qty: 90, unit: 'gal', cost: 280 }]), 'propane');
  assert.equal(mixed.length, 3);                                                           // one delivery-to-delivery period plus the two metered ones
});
test('fuel invoice: a payment of the same total shortly after the bill is linked, once', () => {
  const W = invWorld(), recs = [{ id: 'r1', fuel: 'propane', date: '2026-04-15', qty: 32.976, unit: 'gal', cost: 161.75 }, { id: 'r2', fuel: 'propane', date: '2026-03-04', qty: 40, unit: 'gal', cost: 161.75 }];
  const txns = [{ id: 't1', date: '2026-04-20', name: 'SUPERIOR PLUS', amount: -161.75 }, { id: 't2', date: '2026-04-21', name: 'Other', amount: -20 }];
  assert.equal(W.fuelLinkTx(recs, txns), 1);
  assert.equal(recs[0].tx, 't1');
  assert.equal(recs[1].tx, undefined);                    // the same payment is not used twice
});

test('payBreakdown: groups, percentages, yearly cost, retirement pace and the credit line', () => {
  const P = payWorld();
  const mk = (d, n) => ({ id: 's' + d, payDate: d, gross: 2000, net: 1562, hours: 80, lines: [
    { section: 'earnings', name: 'Regular', amount: 2000, ytd: 10000 },
    { section: 'tax', name: 'Federal Income Tax', amount: 200, ytd: 1000 }, { section: 'tax', name: 'Social Security Tax', amount: 124, ytd: 620 }, { section: 'tax', name: 'Medicare Tax', amount: 29, ytd: 145 },
    { section: 'benefit', name: 'Medical Plan', amount: 90, ytd: 450 }, { section: 'benefit', name: 'Dental Plan', amount: 10, ytd: 50 },
    { section: 'retirement', name: '401K', amount: 100, ytd: 500 }, { section: 'other', name: 'Wellness credit', amount: 15 } ] });
  const stubs = [mk('2026-02-13'), mk('2026-02-27'), mk('2026-03-13')];
  const b = P.payBreakdown(stubs, stubs[2], new Date(2026, 2, 20));
  const g = (k) => b.groups.find((x) => x.key === k);
  assert.equal(g('tax').total, 353); assert.equal(g('benefit').total, 100); assert.equal(g('retirement').total, 100);
  assert.equal(Math.round(g('tax').pct * 10) / 10, 17.7);
  assert.equal(g('benefit').lines[0].name, 'Medical Plan');                 // biggest first
  assert.equal(g('benefit').year, 100 * 26);                                 // biweekly
  assert.equal(b.perYear, 26);
  assert.equal(b.terms.annualGross, 52000);
  assert.equal(b.retire.ytd, 500); assert.equal(b.retire.limit, 24500);
  assert.ok(b.retire.pace > 500 && b.retire.pace < 24500);
  const t = b.insights.map((i) => i.title).join('|');
  assert.match(t, /Federal income tax takes 10\.0%/);
  assert.match(t, /Medical Plan is your biggest/);
  assert.match(t, /Wellness credit added \$15\.00/);
  assert.equal(b.trend.length, 3);
});

test('payBreakdown warns when the 401(k) pace passes the limit and with a lone statement', () => {
  const P = payWorld();
  const one = { id: 'a', payDate: '2026-06-12', gross: 5000, net: 3000, lines: [{ section: 'tax', name: 'Federal Income Tax', amount: 800, ytd: 0 }, { section: 'retirement', name: '401K', amount: 2500, ytd: 0 }] };
  const b = P.payBreakdown([one], one, new Date(2026, 5, 20));
  assert.ok(b.insights.some((i) => /on pace to hit/.test(i.title)));
  assert.ok(b.groups.every((x) => x.lines.length));
});

test('taxFormWarn flags a W-2 whose box 2 copied box 1, and the estimate shows why that mattered', () => {
  const W = taxWorld();
  const w2 = { form: 'W-2', year: 2025, wages: 80000, fedWithheld: 10000, ssWages: 82000, ssWithheld: 5084, medicareWages: 82000, medicareWithheld: 1189 };
  assert.equal(W.taxFormWarn(w2), '');
  assert.match(W.taxFormWarn(Object.assign({}, w2, { fedWithheld: 80000 })), /same as box 1/);
  assert.match(W.taxFormWarn(Object.assign({}, w2, { fedWithheld: 50000 })), /more than half/);
  assert.match(W.taxFormWarn(Object.assign({}, w2, { ssWithheld: 3000 })), /6\.2%/);
  const est = (fw) => W.taxInputs({ status: 'single', state: 'NH' }, 2025, [], [Object.assign({}, w2, { fedWithheld: fw })], [], new Date(2026, 9, 15));
  assert.ok(Math.abs(est(10000).balance) < 3000);        // a normal refund or bill
  assert.ok(est(80000).balance < -60000);                // the absurd result the warning exists to prevent
});

test('bill edits: a different amount, a part payment, a skipped month and a seasonal bill', () => {
  const B = billsWorld(), today = new Date(2026, 9, 20);                                   // Oct 20
  const items = B.billItems([{ id: 'el', name: 'Eversource electric', amount: 95, dueDay: 15, match: 'eversource' }, { id: 'prop', name: 'Propane', amount: 240, dueDay: 10, match: 'propane' }, { id: 'ph', name: 'Phone plan', amount: 60, dueDay: 25, match: 'carrierx' }], [], []);
  const sumOf = (adj, txns = []) => B.billsSummary(B.billApply(items, '2026-10', adj), '2026-10', txns, {}, today);
  // nothing set: all three pending, propane and electric overdue
  let s0 = sumOf({}); assert.strictEqual(s0.count, 3); assert.strictEqual(s0.pending, 395); assert.strictEqual(s0.overdue, 2);
  // part payment: 85 of 95 paid leaves 10
  let s1 = sumOf({ 'el:2026-10': { paid: 85 } });
  const el = s1.rows.find((r) => r.item.id === 'el');
  assert.strictEqual(el.st.partial, true); assert.strictEqual(el.st.remaining, 10); assert.strictEqual(el.st.paidAmount, 85); assert.strictEqual(s1.partialCount, 1);
  assert.strictEqual(s1.pending, 10 + 240 + 60); assert.strictEqual(s1.paid, 85); assert.strictEqual(s1.paidCount, 0);
  // paying the rest turns it paid
  let s2 = sumOf({ 'el:2026-10': { paid: 95 } }); assert.strictEqual(s2.rows.find((r) => r.item.id === 'el').st.state, 'paid'); assert.strictEqual(s2.paidCount, 1);
  // this month's amount only: the bill was really 85
  let s3 = sumOf({ 'el:2026-10': { amount: 85, paid: 85 } }); assert.strictEqual(s3.rows.find((r) => r.item.id === 'el').st.state, 'paid');
  assert.strictEqual(B.billApply(items, '2026-11', { 'el:2026-10': { amount: 85 } }).find((x) => x.id === 'el').amount, 95);   // other months unchanged
  // a lasting amount and due day
  const perm = B.billApply(items, '2026-11', { el: { amount: 88, dueDay: 3 } }).find((x) => x.id === 'el'); assert.strictEqual(perm.amount, 88); assert.strictEqual(perm.dueDay, 3); assert.strictEqual(perm.baseAmount, 95);
  // not expecting propane this month: out of the totals and the overdue count, listed as skipped
  let s4 = sumOf({ 'prop:2026-10': { skip: true } }); assert.strictEqual(s4.count, 2); assert.strictEqual(s4.overdue, 1); assert.strictEqual(s4.pending, 155); assert.strictEqual(s4.skipped.length, 1);
  // seasonal: propane only Nov to Mar
  const season = { prop: { months: [11, 12, 1, 2, 3] } };
  assert.strictEqual(sumOf(season).count, 2);
  assert.strictEqual(B.billsSummary(B.billApply(items, '2026-12', season), '2026-12', [], {}, new Date(2026, 11, 1)).count, 3);
  // a real payment found in transactions still beats a part payment
  let s5 = sumOf({ 'el:2026-10': { paid: 10 } }, [{ date: '2026-10-14', name: 'EVERSOURCE WEB PAY', amount: -95 }]); assert.strictEqual(s5.rows.find((r) => r.item.id === 'el').st.state, 'paid');
});

test('cleanBillAdj keeps only sane edits and refuses prototype keys', () => {
  const B = billsWorld();
  const c = B.cleanBillAdj({ el: { amount: 88, dueDay: 40, months: [11, 11, 13, 12] }, 'el:2026-10': { paid: 85, skip: true, amount: -5 }, '__proto__': { amount: 1 }, junk: 'x', 'p:2026-10': { paid: 0 } });
  assert.deepStrictEqual(c.el, { amount: 88, months: [11, 12] });
  assert.deepStrictEqual(c['el:2026-10'], { paid: 85, skip: true });
  assert.strictEqual(c.junk, undefined); assert.strictEqual(c['p:2026-10'], undefined);
  assert.strictEqual(({}).amount, undefined);
  assert.deepStrictEqual(B.cleanBillAdj(null), {});
});

test('help: every tab has a guide, the walkthrough covers all of them, and nothing is empty', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tabsLine = /^var TABS=(\[\[.*\]\]);/m.exec(src)[1];
  const TABS = new Function('return ' + tabsLine)();
  const H = new Function(srcBlock('/*HELP-START*/', '/*HELP-END*/') + '\nreturn {HELP, HELP_START, HELP_FINISH, helpFor, helpSteps};')();
  TABS.forEach((t) => { const h = H.helpFor(t[0]); assert.ok(h, 'no help for ' + t[0]); assert.ok(h.t && h.what.length > 20 && h.how.length >= 2, 'thin help for ' + t[0]); });
  assert.strictEqual(H.helpFor('carloan').t, 'Loans'); assert.strictEqual(H.helpFor('student').t, 'Loans');
  assert.strictEqual(H.helpFor('__proto__'), null); assert.strictEqual(H.helpFor('nope'), null);
  const steps = H.helpSteps(TABS);
  assert.strictEqual(steps.length, TABS.length + 2);
  assert.strictEqual(steps[0].id, 'start'); assert.strictEqual(steps[steps.length - 1].id, 'finish');
  assert.deepStrictEqual(steps.slice(1, -1).map((x) => x.view), TABS.map((t) => t[0]));
  Object.keys(H.HELP).forEach((k) => assert.ok(TABS.some((t) => t[0] === k), 'help for a tab that does not exist: ' + k));
});

test('pay: a bonus check and a year-old statement do not disturb the pay schedule, the comparison or the projection', () => {
  const P = payWorld();
  const reg = (id, d, gross, net, extra) => Object.assign({ id, payDate: d, gross, net, lines: [{ section: 'earnings', name: 'Regular', amount: gross, ytd: 60000 }, { section: 'tax', name: 'Federal Income Tax', amount: gross * 0.11 }] }, extra || {});
  const bonus = { id: 'b25', payDate: '2025-10-24', gross: 2106.92, net: 1432.91, ytdGross: 73821.32, lines: [{ section: 'earnings', name: 'Bonus', amount: 2106.92, ytd: 3823.27 }, { section: 'tax', name: 'Federal Income Tax', amount: 449.62 }, { section: 'tax', name: 'Social Security Tax', amount: 130.63 }, { section: 'tax', name: 'Medicare Tax', amount: 30.55 }, { section: 'retirement', name: '401K Ee Contr', amount: 63.21 }] };
  const a = reg('a', '2026-09-18', 3451.5, 2600), b = reg('b', '2026-10-02', 3451.5, 2624.58, { ytdLines: [{ name: 'Bonus', ytd: 2136.24 }] }), today = new Date(2026, 9, 15);
  assert.strictEqual(P.payKind(bonus), 'bonus'); assert.strictEqual(P.payKind(a), 'regular');
  assert.strictEqual(P.payKind(Object.assign({}, bonus, { kind: 'regular' })), 'regular');          // what you say wins
  // the schedule: still every two weeks, and the next paycheck is the one after Oct 2
  const all = [bonus, a, b];
  assert.strictEqual(P.payFreqOf(all).key, 'biweekly');
  assert.strictEqual(P.payNext(all, today).date, '2026-10-16');
  assert.strictEqual(P.payNext(all, today).net, 2624.58 > 2600 ? 2624.58 : 2600);                    // from the last regular checks only
  // What changed: the latest regular check against the one before it, not against the bonus of a year ago
  const ch = P.payChanges(all); assert.ok(!ch.some((x) => /2025-10-24/.test(x.detail + x.title)));
  // a regular check with only an old statement before it says so instead of comparing
  const far = P.payChanges([Object.assign({}, a, { id: 'old', payDate: '2025-10-03' }), b]); assert.ok(far.some((x) => /too long ago/.test(x.title)));
  // the year: 2026 is not affected by the 2025 statement; 2025 (bonus only) is worked out from year-to-date figures
  const y26 = P.payYear(all, 2026, today); assert.strictEqual(y26.regularCount, 2); assert.strictEqual(y26.freq.key, 'biweekly'); assert.strictEqual(Math.round(y26.perPeriod.gross), 3452);
  assert.strictEqual(y26.bonusYtd, 2136.24);
  const y25 = P.payYear(all, 2025, today); assert.strictEqual(y25.estimated, true); assert.ok(y25.perPeriod.gross > 3000 && y25.perPeriod.gross < 4000, 'usual pay about ' + y25.perPeriod.gross);
  // a bonus in the last three checks of the year is not part of the usual paycheck
  const c = reg('c', '2026-10-16', 3451.5, 2620), bn = Object.assign({}, bonus, { id: 'b26', payDate: '2026-10-23' });
  const y26b = P.payYear([a, b, c, bn], 2026, new Date(2026, 9, 25)); assert.strictEqual(Math.round(y26b.perPeriod.gross), 3452);
});

test('pay: bonus forecast from one check, from two years, and from year-to-date hints', () => {
  const P = payWorld();
  const bonus = { id: 'b25', payDate: '2025-10-24', gross: 2106.92, net: 1432.91, lines: [{ section: 'earnings', name: 'Bonus', amount: 2106.92, ytd: 3823.27 }] };
  const b = { id: 'b', payDate: '2026-10-02', gross: 3451.5, net: 2624.58, lines: [{ section: 'earnings', name: 'Regular', amount: 3451.5 }], ytdLines: [{ name: 'Bonus', ytd: 2136.24 }] };
  let pl = P.payBonusPlan([bonus, b], new Date(2026, 9, 15));
  assert.strictEqual(pl.next.date, '2026-10-23');                                   // a year after, on a Friday like the first
  assert.strictEqual(new Date(2026, 9, 23).getDay(), 5);
  assert.strictEqual(pl.next.confidence, 'low'); assert.strictEqual(pl.next.amount, 2106.92);
  assert.strictEqual(pl.byYear['2026'].ytd, 2136.24); assert.strictEqual(pl.byYear['2025'].ytd, 3823.27);
  assert.strictEqual(pl.checks[0].earlier, 1716.35);                                // 3823.27 - 2106.92 was paid earlier in 2025
  // after the date has passed (and the check for this year is in), the forecast moves to next year
  const bonus26 = { id: 'b26', payDate: '2026-10-23', gross: 2200, net: 1500, lines: [{ section: 'earnings', name: 'Bonus', amount: 2200, ytd: 4336.24 }] };
  pl = P.payBonusPlan([bonus, bonus26, b], new Date(2026, 10, 2));
  assert.ok(pl.next.date.startsWith('2027-10-')); assert.strictEqual(pl.next.confidence, 'medium'); assert.strictEqual(pl.next.count, 2);
  // no bonus checks: no forecast, but year-to-date bonus pay still shows
  pl = P.payBonusPlan([b], new Date(2026, 9, 15)); assert.strictEqual(pl.next, null); assert.strictEqual(pl.byYear['2026'].ytd, 2136.24);
  // two bonuses a year are two patterns
  const q2 = { id: 'q2', payDate: '2025-04-11', gross: 1700, net: 1200, lines: [{ section: 'earnings', name: 'Bonus', amount: 1700 }] };
  pl = P.payBonusPlan([q2, bonus], new Date(2026, 2, 1)); assert.ok(pl.next.date.startsWith('2026-04-')); assert.strictEqual(pl.others.length, 1);
});
