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

// ---- credit-union layout: glued dates ("SEP02"), wrapped descriptions, two accounts, summary tables (all data invented) ----
const { buildLines, parseStatement } = require('../statement');
function pageOf(rows) {            // rows: arrays of [text, x]; one line per row, top to bottom
  return rows.map((cells, i) => cells.map(([str, x]) => ({ str, x, y: 800 - i * 12, w: str.length * 5 }))).flat();
}
const R = (...c) => c;
// a transaction row as a real PDF stores it: text, then each amount as its own item under its column
const T = (text, amt, bal) => R([text, 20], [amt, amt.startsWith('-') ? 340 : 420], [bal, 490]);
function creditUnion() {
  const hdr = R(['DATE', 20], ['TRANSACTION', 60], ['DESCRIPTION', 130], ['WITHDRAWALS', 330], ['DEPOSITS', 410], ['BALANCE', 480]);
  return [pageOf([
    R(['Account Statement', 20]), R(['MEMBER # STATEMENT PERIOD PAGE', 20]), R(['1234567 09-01-26 to 09-30-26 1 of 2', 20]),
    R(['Example Federal Credit Union', 20]), R(['PRIMARY SAVINGS ACCT# 1', 20]), hdr,
    R(['PREVIOUS BALANCE', 20], ['500.00', 490]),
    T('SEP01 TRANSFER FROM/TO 2', '-230.00', '270.00'), R(['One time transfer to Free Checking ~ b1234567-89ab-4cde-8f01-23456789abcd', 20]),
    T('SEP30 DIVIDEND', '0.02', '270.02'), R(['*** ANNUAL PERCENTAGE YIELD EARNED FROM 09-01-26 THRU 09-30-26 WAS 0.11% ***', 20]), R(['SEP30 NEW BALANCE', 20], ['270.02', 490]),
    R(['FREE CHECKING ACCT# 2', 20]), hdr,
    R(['PREVIOUS BALANCE', 20], ['100.00', 490]),
    T('AUG31 DEBIT CARD DEBIT 400000000001', '-18.84', '81.16'), R(['CORNER FOOD SHOP WORCESTER MA 08-30-26', 20]),
    T('SEP01 TRANSFER FROM/TO 1', '230.00', '311.16'), R(['One time transfer to Free Checking ~ b1234567-89ab-4cde-8f01-23456789abcd', 20]),
    T('SEP02 EFT ACH ACME PAYROLL 99 DOE,JANE', '2,600.00', '2,911.16'),
    T('SEP06 WITHDRAWAL', '-400.00', '2,511.16'), R(['ATM 0906 1247 000808 225 MAIN ST WORCESTER MA', 20]),
    T('SEP08 TRANSFER 7654321 FROM/TO 2', '-70.00', '2,441.16'), R(['Payment to ALEX EXAMPLE ~ 1234abcd-1234-1234-1234-1234abcd1234', 20]),
    T('SEP08 CHECK 100027', '-1,350.00', '1,091.16'),
    T('SEP09 DEBIT CARD DEBIT 400000000001', '-9.69', '1,081.47'), R(['AMAZON MKTPL*AB12 Amzn.com/billWA 09-09-26', 20]),
    R(['Direct general inquiries regarding this statement to the phone number or address below.', 20]),
  ]), pageOf([
    R(['Account Statement', 20]), R(['FREE CHECKING Continued ACCT# 2', 20]), hdr,
    R(['SEP30 NEW BALANCE', 20], ['1,081.47', 490]),
    R(['CHECKS CLEARED', 20]), R(['CHK# DATE AMOUNT CHK# DATE AMOUNT', 20]), R(['100027 SEP08 1,350.00', 20]),
    R(['DEPOSITS, DIVIDENDS AND OTHER CREDITS', 20]), R(['DATE AMOUNT DATE AMOUNT', 20]), R(['SEP01 230.00 SEP02 2,600.00', 20]),
    R(['WITHDRAWALS, FEES AND OTHER DEBITS', 20]), R(['DATE AMOUNT DATE AMOUNT DATE AMOUNT', 20]), R(['AUG31 -18.84 SEP06 -400.00 SEP08 -70.00', 20]), R(['SEP09 -9.69', 20]),
    R(['TOTAL WITHDRAWALS 4 -498.53', 20]),
  ])];
}

test('credit union statement: glued dates, wrapped merchant names, two accounts, own-account transfers, no index-table rows', () => {
  const r = parseStatement(buildLines(creditUnion()), {});
  assert.strictEqual(r.meta.type, 'checking');                                     // "Credit Union" and "PREVIOUS BALANCE" do not make it a card
  assert.deepStrictEqual(r.rows.map((x) => [x.date, x.amount, x.name]), [
    ['2026-09-01', -230, 'TRANSFER FROM/TO 2 One time transfer to Free Checking'],
    ['2026-09-30', 0.02, 'DIVIDEND'],
    ['2026-08-31', -18.84, 'CORNER FOOD SHOP WORCESTER MA'],
    ['2026-09-01', 230, 'TRANSFER FROM/TO 1 One time transfer to Free Checking'],
    ['2026-09-02', 2600, 'EFT ACH ACME PAYROLL 99 DOE,JANE'],
    ['2026-09-06', -400, 'WITHDRAWAL ATM 0906 1247 000808 225 MAIN ST WORCESTER MA'],
    ['2026-09-08', -70, 'TRANSFER 7654321 FROM/TO 2 Payment to ALEX EXAMPLE'],
    ['2026-09-08', -1350, 'CHECK 100027'],
    ['2026-09-09', -9.69, 'AMAZON MKTPL*AB12 Amzn.com/billWA']]);
  assert.deepStrictEqual(r.rows.filter((x) => x.transfer).map((x) => x.amount), [-230, 230]);          // paying a person is not an own-account transfer
  assert.ok(r.rows.every((x) => !x.uncertain));
  assert.ok(!r.rows.some((x) => /^(SEP|AUG)\d/.test(x.name)));
});

test('glued month-and-day dates', () => {
  assert.deepStrictEqual(matchDate('SEP22 DEBIT CARD', 'mdy'), { y: null, m: 9, d: 22, len: 5 });
  assert.strictEqual(matchDate('Aug3 X', 'mdy').d, 3);
  assert.strictEqual(matchDate('SEP45 X', 'mdy'), null);
  assert.strictEqual(matchDate('SEPTEMBER STATEMENT', 'mdy'), null);
  assert.strictEqual(matchDate('MAYBE 12.00', 'mdy'), null);
});

test('a statement with no year printed: dates that would land in the future belong to the year before', () => {
  const page = [[['Account Activity', 20]], [['Date', 20], ['Description', 80], ['Amount', 400]],
    [['12/05', 20], ['CORNER STORE', 80], ['-10.00', 400]], [['12/28', 20], ['GAS STATION', 80], ['-25.00', 400]], [['01/03', 20], ['PAYROLL ACME', 80], ['500.00', 400]]];
  const pg = page.map((cells, i) => cells.map(([str, x]) => ({ str, x, y: 800 - i * 12, w: str.length * 5 }))).flat();
  const r = parseStatement(buildLines([pg]), { today: new Date(2026, 9, 15) });
  const dates = r.rows.map((x) => x.date).sort();
  assert.deepStrictEqual(dates, ['2025-12-05', '2025-12-28', '2026-01-03']);   // December is last December, not a December that has not happened
  const later = parseStatement(buildLines([pg]), { today: new Date(2027, 0, 20) });
  assert.deepStrictEqual(later.rows.map((x) => x.date).sort(), ['2026-12-05', '2026-12-28', '2027-01-03']);
});
