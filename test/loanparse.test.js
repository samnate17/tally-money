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

test('servicer statement with one Account Snapshot column per loan group: each group becomes its own loan and the totals add up', () => {
  const text = [
    'Account A1 Statement Date 10/6/2026',
    'Current Balance $1,500.00', 'Regular Monthly Payment Amount $60.00', 'Past Due Amount (if applicable) + $20.00', 'Current Amount Due $80.00', 'Current Statement Due Date 10/28/2026',
    'Nelnet Contact Us:',
    'Account Snapshot: Account Snapshot for: Group AA Account Snapshot for: Group AB',
    'Loan Type Loan TypeDIRECT SUB Loan TypeDIRECT UNSUB',
    'Original Principal Amount Original Principal Amount$1,000.00 Original Principal Amount$900.00',
    'Interest Rate Interest Rate is5.050% Interest Rate is2.750%',
    'Accrued Interest on 10/6/2026 $10.00 Accrued Interest on 10/6/2026 . $5.00',
    'Regular Monthly Payment Amount $40.00 Regular Monthly Payment Amount $20.00',
    'Outstanding Principal Balance* on 10/28/2026 $900.00 Outstanding Principal Balance* on 10/28/2026 . $585.00',
    'Past Due Amount $12.00 Past Due Amount $8.00',
    'Amount Due $52.00 Amount Due $28.00',
  ].join('\n');
  const { loans } = parseLoanText(text, 'student');
  assert.strictEqual(loans.length, 2);
  assert.deepStrictEqual(loans.map((l) => [l.name, l.apr, l.balance, l.minPay, l.origBalance, l.amountDue, l.pastDue, l.dueDay, l.accruedInterest]),
    [['Direct subsidized loan, group AA', 5.05, 910, 40, 1000, 52, 12, 28, 10], ['Direct unsubsidized loan, group AB', 2.75, 590, 20, 900, 28, 8, 28, 5]]);
  assert.strictEqual(loans[0].lender, 'Nelnet');
  assert.strictEqual(loans.reduce((a, l) => a + l.balance, 0), 1500);
});

test('mortgage statement: balance, rate, principal and interest, escrow, due date and loan details', () => {
  const { parseMortgageText } = require('../loanparse');
  const text = ['Mr. Cooper', 'Statement Date: 10/05/2026', 'Payment Due Date: 11/01/2026', 'Unpaid Principal Balance $245,102.33', 'Interest Rate 6.250%', 'Original Loan Amount $260,000.00', 'Loan Term 30 years', 'Maturity Date 05/01/2053',
    'Explanation of Amount Due', 'Principal $350.12', 'Interest $1,276.60', 'Escrow (Taxes and Insurance) $612.40', 'Total Payment Amount $2,239.12', 'Past Due Amount $0.00', 'Escrow Balance $1,840.00'].join('\n');
  const r = parseMortgageText(text);
  assert.ok(r.ok);
  assert.deepStrictEqual([r.mortgage.lender, r.mortgage.balance, r.mortgage.apr, r.mortgage.pi, r.mortgage.escrow, r.mortgage.total, r.mortgage.dueDate, r.mortgage.dueDay, r.mortgage.origLoan, r.mortgage.termYears, r.mortgage.escrowBalance],
    ['Mr. Cooper', 245102.33, 6.25, 1626.72, 612.4, 2239.12, '2026-11-01', 1, 260000, 30, 1840]);
  const alt = parseMortgageText('Principal and Interest $1,500.00\nEscrow $400.00\nTotal Payment $1,900.00\nPrincipal Balance $200,000.00\nInterest Rate 5.5%');
  assert.deepStrictEqual([alt.mortgage.pi, alt.mortgage.escrow, alt.mortgage.apr], [1500, 400, 5.5]);
  assert.strictEqual(parseMortgageText('nothing useful here').ok, false);
});

test('car loan contract: the Truth-in-Lending row, payment schedule, vehicle and fees are read', () => {
  const { parseContract, parseLoanText } = require('../loanparse');
  const text = ['RETAIL INSTALLMENT SALE CONTRACT - SIMPLE FINANCE CHARGE', 'Buyer Name JANE EXAMPLE   Seller-Creditor SUNRISE TOYOTA',
    'NEW 2025 Toyota Camry XSE 4T1DAC2U0SU000001 personal', 'FEDERAL TRUTH-IN-LENDING DISCLOSURES', 'ANNUAL FINANCE Amount Total of Total Sale', 'PERCENTAGE CHARGE Financed Payments Price', '2,000.00 $is',
    '7.25 % $4,500.00 $30,000.00 $34,500.00 $36,500.00', 'Your Payment Schedule Will Be:', 'Number of Amount of When Payments', '60 $575.00 beginning', 'Monthly 03/10/2026',
    'Late Charge. If payment is not received in full within 10 days after it is due, you will pay a late charge not in excess of 5 % of the part of the payment that is late.', 'Prepayment. If you pay early, you will not have to pay a penalty.',
    'ITEMIZATION OF AMOUNT FINANCED', '1 Cash Price (including $sales tax) $31,000.00 (1)', 'Finance Charge', 'D Optional Gap Contract 995.00', 'Registration Fee 40.00', 'Seller assigns its interest in this contract to Toyota Motor Credit Corp (Assignee) under the terms'].join('\n');
  const c = parseContract(text);
  assert.deepStrictEqual([c.apr, c.financeCharge, c.amountFinanced, c.totalOfPayments, c.totalSalePrice, c.count, c.payment, c.firstDate, c.downPayment, c.cashPrice, c.gap, c.registration],
    [7.25, 4500, 30000, 34500, 36500, 60, 575, '2026-03-10', 2000, 31000, 995, 40]);
  assert.deepStrictEqual([c.vehicle, c.condition, c.vin, c.lateFeePct, c.lateDays, c.prepaymentPenalty, c.simpleInterest, c.lender], ['2025 Toyota Camry XSE', 'new', '4T1DAC2U0SU000001', 5, 10, false, true, 'Toyota Motor Credit Corp']);
  const r = parseLoanText(text, 'auto');
  assert.ok(r.contract); assert.deepStrictEqual([r.loans[0].name, r.loans[0].apr, r.loans[0].minPay, r.loans[0].dueDay, r.loans[0].origBalance], ['2025 Toyota Camry XSE', 7.25, 575, 10, 30000]);
  assert.strictEqual(parseContract('Amount Financed $100.00 Finance Charge nothing else'), null);
  assert.strictEqual(parseLoanText('Statement Date 10/01/2026 Amount Due $300.00 Interest rate 5%', 'auto').contract, undefined);
  assert.strictEqual(parseLoanText('Amount Due $300.00 Interest Rate 5% Balance $9,000.00 your purchase of the vehicle', 'auto').loans[0].lender, '');   // "purchase" is not Chase
});

// ---- credit card statements (made-up text in the layouts the big issuers use; no real accounts) ----
const { parseCardStatement } = require('../loanparse');
const CHASE = `JPMorgan Chase Bank, N.A.
FREEDOM UNLIMITED
October 2026 Statement
Account Number: XXXX XXXX XXXX 4821
Payment Due Date: 11/08/26
New Balance: $1,234.56
Minimum Payment Due: $35.00
Late Payment Warning: If we do not receive your minimum payment by the date listed above, you may have to pay a late fee of up to $40.
ACCOUNT SUMMARY
Previous Balance $1,100.00
Payment, Credits -$1,100.00
Purchases +$1,234.56
Cash Advances $0.00
Balance Transfers $0.00
Fees Charged $0.00
Interest Charged $12.34
New Balance $1,234.56
Opening/Closing Date 09/12/26 - 10/11/26
Credit Access Line $10,000
Available Credit $8,765
Cash Access Line $1,500
Available for Cash $1,500
INTEREST CHARGES
Your Annual Percentage Rate (APR) is the annual interest rate on your account.
Type of Balance APR Balance Subject to Interest Rate Interest Charge
Purchases 21.49%(v)(d) $0.00 $0.00
Cash Advances 29.99%(v)(d) $0.00 $0.00`;
test('card statement: a Chase-style statement gives the card, balance, limit, APR, minimum and due date', () => {
  const c = parseCardStatement(CHASE);
  assert.strictEqual(c.issuer, 'Chase'); assert.strictEqual(c.product, 'Freedom Unlimited'); assert.strictEqual(c.last4, '4821'); assert.strictEqual(c.name, 'Chase Freedom Unlimited ••4821');
  assert.strictEqual(c.balance, 1234.56); assert.strictEqual(c.minPay, 35); assert.strictEqual(c.dueDate, '2026-11-08'); assert.strictEqual(c.dueDay, 8); assert.strictEqual(c.closingDate, '2026-10-11');
  assert.strictEqual(c.limit, 10000); assert.strictEqual(c.available, 8765); assert.strictEqual(c.apr, 21.49); assert.strictEqual(c.prevBalance, 1100); assert.strictEqual(c.interestCharged, 12.34); assert.strictEqual(c.feesCharged, 0);
  assert.deepStrictEqual(c.notes, []);
});
test('card statement: Capital One, Amex and Citi layouts, and masked numbers', () => {
  const cap = parseCardStatement(`Capital One
Quicksilver Cash Rewards Credit Card
Statement Period: Sep 20, 2026 - Oct 19, 2026
Account ending in 7730
Statement Balance $842.10
Minimum Payment Due $25.00
Payment Due Date Nov 13, 2026
Credit Limit $5,000
Available Credit $4,157.90
Interest Charge Calculation
Purchases 28.49% (v) $0.00 $0.00`);
  assert.deepStrictEqual([cap.issuer, cap.last4, cap.balance, cap.minPay, cap.dueDate, cap.closingDate, cap.limit, cap.available, cap.apr], ['Capital One', '7730', 842.1, 25, '2026-11-13', '2026-10-19', 5000, 4157.9, 28.49]);
  const amex = parseCardStatement(`AMERICAN EXPRESS
Blue Cash Preferred Card
Closing Date 10/14/26
Account Ending 3-01007
New Balance $2,450.00
Minimum Payment Due $40.00
Payment Due Date 11/08/2026
Interest Charge Calculation
Purchases 24.99% (v) $2,100.00 $43.75
Credit Limit $15,000.00`);
  assert.deepStrictEqual([amex.issuer, amex.product, amex.balance, amex.minPay, amex.limit, amex.apr, amex.closingDate], ['American Express', 'Blue Cash Preferred', 2450, 40, 15000, 24.99, '2026-10-14']);
  const citi = parseCardStatement(`Citibank
Citi Double Cash Card
Card ending in ****0099
Statement Closing Date: 10/03/2026
New balance: $310.00
Minimum payment due: $25.00
Payment due date: 10/28/2026
Credit limit: $4,000
Available credit: $3,690
Purchases ...... 22.74% (V)`);
  assert.deepStrictEqual([citi.issuer, citi.product, citi.last4, citi.balance, citi.limit, citi.apr, citi.dueDay], ['Citi', 'Double Cash', '0099', 310, 4000, 22.74, 28]);
  // masked by the app before parsing: "****4821"
  assert.strictEqual(parseCardStatement('Chase\nAccount Number: ****4821\nNew Balance $10.00').last4, '4821');
});
test('card statement: missing fields are reported, limit is worked out from available credit, nothing invented', () => {
  const c = parseCardStatement('Discover\nNew Balance $500.00\nAvailable Credit $1,500.00\n');
  assert.strictEqual(c.balance, 500); assert.strictEqual(c.limit, 2000); assert.match(c.notes.join(' '), /worked out/); assert.strictEqual(c.apr, null); assert.match(c.notes.join(' '), /purchase APR/);
  const e = parseCardStatement('nothing useful here');
  assert.strictEqual(e.balance, null); assert.strictEqual(e.name, 'Credit card'); assert.ok(e.notes.length >= 2);
});
