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
  const deps = { aiKey, DEBT_TYPES, CATS, S, TODAY, iso, parseD, addDays, dayDiff, monthKey, shiftMonth, normName, guessCat, uid, NOWKEY, spendBy, incomeOf, isDebt, activeSubs, nextDate, money0 };
  const names = Object.keys(deps);
  const mk = (blk, ret) => new Function(...names, block(blk) + ';return {' + ret + '}')(...names.map((n) => deps[n]));
  return { S, deps,
    logic: { ...mk('CREDIT', 'creditBand,creditUtil,creditWhatIf,creditAdvice'), ...mk('BUDGET', 'catSpendByMonth,pastMonths,catForecast,monthPace,monthReport,fiftyThirtyTwenty,savingsIdeas,monthlyStack,percentile,ceil5'), ...mk('INVEST', 'logReturns,annVol,maxDrawdown,volLabel,rangeSeries,holdingStats,portfolioStats,portfolioSeries,volRows,seededCloses'), ...mk('LOGIC', 'applySync,buildAiPayload,aiProposals,aiEstimate,aiKey,pdfReviewRows,pdfCategory,csvDetect,csvBuild,csvDate,csvAmount,csvDelim,csvScan,csvOrder') },
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
  const guessBlock = srcBlock('/*CATEGORY-START*/', '/*CATEGORY-END*/'), editBlock = srcBlock('/*EDIT-START*/', '/*EDIT-END*/');
  return new Function('S,CATS,aiKey,ruleCat,TODAY,iso', guessBlock + editBlock + '\nreturn {guessCat, learnMerchant, editTxn, setAsideTxn, restoreTxn, dropAside, reguessOther};')(S, CATS, aiKey, ruleCat, TODAY, iso);
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
