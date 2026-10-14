const test = require('node:test');
const assert = require('node:assert');
const { parseLoanText, dateIn, moneyIn, pctIn } = require('../loanparse');

test('loan reader: dates, money and rates in the usual formats', () => {
  assert.strictEqual(dateIn('Due 10/21/2026'), '2026-10-21'); assert.strictEqual(dateIn('Due Oct 21, 2026'), '2026-10-21'); assert.strictEqual(dateIn('21 October 2026'), '2026-10-21');
  assert.strictEqual(dateIn('Period 09/01/26 - 09/30/26', 'last'), '2026-09-30'); assert.strictEqual(dateIn('2026-10-21'), '2026-10-21'); assert.strictEqual(dateIn('no date 99/99/2026'), '');
  assert.strictEqual(moneyIn('Amount $1,234.50 due').value, 1234.5); assert.strictEqual(moneyIn('Day 15 of the month'), null); assert.strictEqual(moneyIn('$95').value, 95);
  assert.strictEqual(pctIn('Rate 6.28%'), 6.28); assert.strictEqual(pctIn('Rate: 5.5', true), 5.5); assert.strictEqual(pctIn('15', true), null);
});

test('loan reader: a car loan statement with labels on the same line', () => {
  const text = ['HONDA FINANCIAL SERVICES', 'Statement Date: 10/01/2026', '2022 Honda Civic', 'Account Number: XXXX1234', 'Payment Amount: $310.45', 'Payment Due Date: 10/21/2026', 'Past Due Amount: $0.00', 'Current Balance $9,600.12', 'Interest Rate: 7.20%', 'Original Loan Amount $18,000.00', 'Last Payment Received 09/18/2026 $310.45'].join('\n');
  const l = parseLoanText(text, 'auto').loans[0];
  assert.deepStrictEqual([l.name, l.lender, l.balance, l.apr, l.minPay, l.dueDay, l.origBalance, l.dueDate, l.asOf, l.lastPayAmt, l.lastPayDate], ['2022 Honda Civic', 'Honda Financial', 9600.12, 7.2, 310.45, 21, 18000, '2026-10-21', '2026-10-01', 310.45, '2026-09-18']);
});

test('loan reader: values on the line below the label, past due, accrued interest and principal', () => {
  const text = ['Nelnet', 'Statement Date', 'October 3, 2026', 'Total Amount Due', '$285.00', 'Past Due Amount', '$95.00', 'Due Date', '11/15/2026', 'Outstanding Principal Balance', '$7,080.26', 'Accrued Interest', '$120.24', 'Interest Rate', '6.28%'].join('\n');
  const l = parseLoanText(text, 'student').loans[0];
  assert.deepStrictEqual([l.amountDue, l.pastDue, l.dueDate, l.principal, l.accruedInterest, l.apr, l.asOf, l.lender], [285, 95, '2026-11-15', 7080.26, 120.24, 6.28, '2026-10-03', 'Nelnet']);
  assert.strictEqual(l.balance, 7200.5);                                                       // principal plus unpaid interest when no total is printed
  assert.strictEqual(l.minPay, 190);                                                           // no separate monthly payment line, so amount due less past due, with a note
  assert.ok(/amount due/.test(l.note));
});

test('loan reader: a table of several student loans becomes one loan per row', () => {
  const text = ['NELNET STATEMENT', 'Statement Date 10/01/2026', 'Amount Due $360.00', 'Due Date 10/25/2026', 'Loan Type Interest Rate Outstanding Principal Accrued Interest Total',
    'Direct Subsidized 2019 4.50% $3,000.00 $12.10 $3,012.10', 'Direct Unsubsidized 2019 5.50% $4,000.00 $20.40 $4,020.40', 'Direct PLUS Grad 7.54% $9,500.00 $64.00 $9,564.00', 'Total $16,500.00 $96.50 $16,596.50'].join('\n');
  const out = parseLoanText(text, 'student');
  assert.strictEqual(out.loans.length, 3);
  assert.deepStrictEqual(out.loans.map((l) => [l.name, l.apr, l.principal, l.accruedInterest, l.balance]), [['Direct Subsidized 2019', 4.5, 3000, 12.1, 3012.1], ['Direct Unsubsidized 2019', 5.5, 4000, 20.4, 4020.4], ['Direct PLUS Grad', 7.54, 9500, 64, 9564]]);
  assert.ok(/Totals shown on the statement are not split/.test(out.notes) && /amount due 360\.00/.test(out.notes));
  assert.deepStrictEqual(out.loans.map((l) => l.amountDue), [0, 0, 0]);                       // statement totals are never copied onto each loan
});

test('loan reader: a credit card statement, and nothing found', () => {
  const text = ['CHASE', 'Statement Closing Date 09/30/2026', 'Previous Balance $850.00', 'New Balance $912.33', 'Minimum Payment Due $35.00', 'Payment Due Date 10/25/2026', 'Purchases APR 24.99%', 'Payment Received 09/12/2026 $850.00'].join('\n');
  const c = parseLoanText(text, 'credit').loans[0];
  assert.deepStrictEqual([c.balance, c.minPay, c.amountDue, c.dueDay, c.apr, c.lastPayAmt, c.lastPayDate, c.lender], [912.33, 35, 35, 25, 24.99, 850, '2026-09-12', 'Chase']);
  const none = parseLoanText('Dear customer, thank you for banking with us.', 'auto');
  assert.deepStrictEqual(none.loans, []);
});
