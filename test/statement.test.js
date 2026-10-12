const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parsePdf, maskText, parseAmt, matchDate } = require('../statement');
const load = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));
const rows = async (n, o) => (await parsePdf(load(n), o));
const flat = (r) => r.rows.map((x) => [x.date, x.amount, x.name]);

test('amount and date tokens', () => {
  assert.deepStrictEqual(parseAmt('1,234.56'), { v: 1234.56, neg: false, cr: false, dr: false });
  assert.strictEqual(parseAmt('(45.00)').neg, true);
  assert.strictEqual(parseAmt('45.00-').neg, true);
  assert.strictEqual(parseAmt('-$3.10').neg, true);
  assert.strictEqual(parseAmt('12.5'), null);
  assert.strictEqual(parseAmt('2026'), null);
  assert.deepStrictEqual(matchDate('09/14 SPOTIFY', 'mdy'), { y: null, m: 9, d: 14, len: 5 });
  assert.strictEqual(matchDate('14/09/2026 X', 'dmy').m, 9);
  assert.strictEqual(matchDate('Sep 02 CHIPOTLE', 'mdy').d, 2);
  assert.strictEqual(matchDate('05 Sep 2026 APPLE', 'mdy').y, 2026);
  assert.strictEqual(matchDate('2026-09-01 X', 'mdy').d, 1);
  assert.deepStrictEqual(matchDate('02-Oct-2026 X', 'mdy'), { y: 2026, m: 10, d: 2, len: 11 });
  assert.strictEqual(matchDate('2-Oct X', 'mdy').y, null);
  assert.strictEqual(matchDate('13/45 X', 'mdy'), null);
});

test('checking with explicit minus signs and a balance column', async () => {
  const r = await rows('checking-balance.pdf');
  assert.strictEqual(r.meta.type, 'checking');
  assert.deepStrictEqual(flat(r), [
    ['2026-09-01', 2400, 'ACME CORP PAYROLL'], ['2026-09-03', -86.42, 'WHOLE FOODS MARKET'], ['2026-09-05', -15.49, 'NETFLIX.COM'], ['2026-09-09', -48, 'SHELL OIL 57444'],
    ['2026-09-12', 120, 'ZELLE FROM JORDAN'], ['2026-09-15', 2400, 'ACME CORP PAYROLL'], ['2026-09-16', -1450, 'MAPLE COURT RENT'], ['2026-09-28', 0.52, 'INTEREST PAID']]);
  assert.ok(r.rows.every((x) => !x.uncertain));
});

test('withdrawal and deposit columns decide the sign', async () => {
  const r = await rows('checking-columns.pdf');
  assert.strictEqual(r.meta.mode, 'columns');
  assert.deepStrictEqual(flat(r), [['2026-09-02', -12.85, 'CHIPOTLE 1234'], ['2026-09-04', 2400, 'ACME CORP PAYROLL'], ['2026-09-07', -69.99, 'COMCAST INTERNET'], ['2026-09-11', 23.99, 'AMAZON REFUND'], ['2026-09-20', -18.4, 'UBER TRIP']]);
});

test('credit card: purchases are spending, payments and returns are inflows, years come from the period', async () => {
  const r = await rows('credit-card.pdf');
  assert.strictEqual(r.meta.type, 'credit');
  assert.deepStrictEqual(flat(r), [['2026-09-14', -11.99, 'SPOTIFY USA'], ['2026-09-20', -64.3, 'AMAZON MKTPLACE'], ['2026-09-28', 500, 'PAYMENT THANK YOU'], ['2026-10-02', 23.99, 'RETURN BEST BUY'], ['2026-10-05', -41.17, 'WHOLEFDS MKT']]);
  assert.ok(!r.rows.some((x) => /new balance|minimum/i.test(x.name)));
});

test('credit card with CR markers and day-month-year dates', async () => {
  const r = await rows('credit-cr.pdf');
  assert.deepStrictEqual(flat(r), [['2026-09-05', -42.1, 'APPLE.COM/BILL'], ['2026-09-12', 300, 'PAYMENT RECEIVED'], ['2026-09-20', 15, 'MERCHANT REFUND'], ['2026-09-22', -31.55, 'DOORDASH ORDER']]);
});

test('unsigned amounts are resolved from running balances, newest-first order included', async () => {
  const r = await rows('checking-newest-first.pdf');
  assert.strictEqual(r.meta.mode, 'balance');
  assert.deepStrictEqual(flat(r), [['2026-10-14', 75, 'VENMO CASHOUT'], ['2026-10-09', -200, 'ATM WITHDRAWAL'], ['2026-10-03', -120.35, 'COSTCO WHSE'], ['2026-10-01', 1500, 'ACME CORP PAYROLL']]);
  assert.deepStrictEqual(r.rows.map((x) => x.uncertain), [false, false, false, true]); // oldest row has no opening balance to check against
});

test('December to January statements get the right years; parentheses mean money out', async () => {
  const r = await rows('checking-rollover.pdf');
  assert.deepStrictEqual(flat(r), [['2026-12-20', -45, 'GIFT SHOP'], ['2026-12-31', 2400, 'ACME CORP PAYROLL'], ['2027-01-03', -15.49, 'NETFLIX.COM'], ['2027-01-10', -88.2, 'GROCERY OUTLET']]);
});

test('statement type can be forced', async () => {
  const r = await rows('credit-card.pdf', { type: 'checking' });
  assert.strictEqual(r.meta.type, 'checking');
});

test('scanned PDFs report that there is no text instead of guessing', async () => {
  const r = await rows('scanned.pdf');
  assert.strictEqual(r.meta.noText, true);
  assert.strictEqual(r.rows.length, 0);
});

test('garbage input rejects cleanly', async () => {
  await assert.rejects(() => parsePdf(Buffer.from('this is not a pdf')));
});

test('maskText hides account and card numbers but keeps the last four', () => {
  const t = maskText('Account 123456789012 card 4111 1111 1111 1234 ref 9876543 on 09/03 amount 1,234.56 store 57444');
  assert.ok(!/123456789012|4111 1111|9876543/.test(t));
  assert.ok(/\*\*\*\*9012/.test(t) && /\*\*\*\*1234/.test(t) && /\*\*\*\*6543/.test(t));
  assert.ok(/1,234\.56/.test(t) && /57444/.test(t) && /09\/03/.test(t));
});

test('rows stored as one text run per line, with a Unicode minus sign', async () => {
  const r = await rows('singlerun-checking.pdf');
  assert.strictEqual(r.meta.type, 'checking');
  assert.deepStrictEqual(flat(r), [['2026-10-02', -6.75, 'DEBIT CARD PURCHASE STARBUCKS #4412'], ['2026-10-05', 1500, 'PAYROLL DIRECT DEP ACME CORP'], ['2026-10-09', -250, 'CHECK 1042']]);
  assert.ok(!r.rows.some((x) => /balance|page/i.test(x.name)));
});

test('single-run credit card statement with two-digit years and a trailing summary line', async () => {
  const r = await rows('singlerun-credit.pdf');
  assert.strictEqual(r.meta.type, 'credit');
  assert.deepStrictEqual(flat(r), [['2026-09-10', -52.18, 'TARGET 00012345'], ['2026-09-20', 300, 'AUTOPAY PAYMENT THANK YOU'], ['2026-09-29', -15.49, 'NETFLIX.COM']]);
});

test('parsePdf returns the extracted lines so a failed read can be inspected', async () => {
  const r = await rows('singlerun-checking.pdf');
  assert.ok(r.lines.length > 5 && r.lines.some((l) => /STARBUCKS/.test(l)));
});
