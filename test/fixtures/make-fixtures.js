// Generates the sample statement PDFs used by test/statement.test.js (run once; the PDFs are committed).
// node test/fixtures/make-fixtures.js   (needs playwright and a Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = __dirname;
const money = (n) => n;
const page = (title, header, tableHead, rows, extra = '', aligns = []) => `<html><head><style>
body{font-family:Helvetica,Arial,sans-serif;font-size:11px;margin:40px;color:#111}h1{font-size:18px;margin:0 0 4px}.addr{color:#555;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin-top:10px}th{text-align:left;border-bottom:1px solid #000;padding:4px}td{padding:4px}
.r{text-align:right}.sum td{border-top:1px solid #999;font-weight:bold}.foot{margin-top:30px;color:#666;font-size:9px}
</style></head><body><h1>${title}</h1><div class="addr">ACME BANK, N.A. &middot; 123 Main St Springfield 12345 &middot; Member FDIC</div>${header}
<table><thead><tr>${tableHead.map((h, i) => `<th class="${aligns[i] || ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${aligns[i] || ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${extra}<div class="foot">Earn 2.50% APY on Premier Savings. Page 1 of 1</div></body></html>`;

const files = {
  'checking-balance.pdf': page('Everyday Checking Statement',
    '<div>Account number ending 4821<br>Statement Period: 09/01/2026 - 09/30/2026</div>',
    ['Date', 'Description', 'Amount', 'Balance'],
    [['', 'Beginning Balance', '', '2,500.00'],
      ['09/01/2026', 'ACME CORP PAYROLL', '2,400.00', '4,900.00'], ['09/03/2026', 'WHOLE FOODS MARKET', '-86.42', '4,813.58'],
      ['09/05/2026', 'NETFLIX.COM', '-15.49', '4,798.09'], ['09/09/2026', 'SHELL OIL 57444', '-48.00', '4,750.09'],
      ['09/12/2026', 'ZELLE FROM JORDAN', '120.00', '4,870.09'], ['09/15/2026', 'ACME CORP PAYROLL', '2,400.00', '7,270.09'],
      ['09/16/2026', 'MAPLE COURT RENT', '-1,450.00', '5,820.09'], ['09/28/2026', 'INTEREST PAID', '0.52', '5,820.61'],
      ['', 'Ending Balance', '', '5,820.61']], '<p>Total deposits 4,920.52 &middot; Total withdrawals 1,599.91</p>', ['', '', 'r', 'r']),
  'checking-columns.pdf': page('Premier Checking',
    '<div>Statement period September 1, 2026 through September 30, 2026</div>',
    ['Date', 'Description', 'Withdrawals', 'Deposits', 'Balance'],
    [['Sep 02', 'CHIPOTLE 1234', '12.85', '', '987.15'], ['Sep 04', 'ACME CORP PAYROLL', '', '2,400.00', '3,387.15'],
      ['Sep 07', 'COMCAST INTERNET', '69.99', '', '3,317.16'], ['Sep 11', 'AMAZON REFUND', '', '23.99', '3,341.15'], ['Sep 20', 'UBER TRIP', '18.40', '', '3,322.75']],
    '', ['', '', 'r', 'r', 'r']),
  'credit-card.pdf': page('Visa Rewards Card Statement',
    '<div>Opening/Closing Date 09/13/2026 - 10/12/2026<br>New Balance $1,234.56 &middot; Minimum Payment Due $35.00 &middot; Payment Due Date 11/08/2026</div>',
    ['Trans Date', 'Post Date', 'Description', 'Amount'],
    [['09/14', '09/15', 'SPOTIFY USA', '11.99'], ['09/20', '09/21', 'AMAZON MKTPLACE', '64.30'], ['09/28', '09/28', 'PAYMENT THANK YOU', '-500.00'],
      ['10/02', '10/03', 'RETURN BEST BUY', '-23.99'], ['10/05', '10/06', 'WHOLEFDS MKT', '41.17']], '', ['', '', '', 'r']),
  'checking-newest-first.pdf': page('Checking Account',
    '<div>Statement for 10/01/2026 to 10/31/2026 &middot; Ending balance 2,254.65</div>',
    ['Date', 'Transaction', 'Amount', 'Balance'],
    [['10/14/2026', 'VENMO CASHOUT', '75.00', '2,254.65'], ['10/09/2026', 'ATM WITHDRAWAL', '200.00', '2,179.65'],
      ['10/03/2026', 'COSTCO WHSE', '120.35', '2,379.65'], ['10/01/2026', 'ACME CORP PAYROLL', '1,500.00', '2,500.00']], '', ['', '', 'r', 'r']),
  'checking-rollover.pdf': page('Basic Checking',
    '<div>Statement period: 12/15/2026 - 01/14/2027</div>',
    ['Date', 'Description', 'Amount'],
    [['12/20', 'GIFT SHOP', '(45.00)'], ['12/31', 'ACME CORP PAYROLL', '2,400.00'], ['01/03', 'NETFLIX.COM', '(15.49)'], ['01/10', 'GROCERY OUTLET', '(88.20)']], '', ['', '', 'r']),
  'credit-cr.pdf': page('Platinum Card',
    '<div>Credit Card Statement &middot; Statement Date 30 Sep 2026 &middot; Credit Limit $5,000 &middot; Minimum Payment Due $25.00</div>',
    ['Date', 'Details', 'Amount'],
    [['05 Sep 2026', 'APPLE.COM/BILL', '42.10'], ['12 Sep 2026', 'PAYMENT RECEIVED', '300.00 CR'], ['20 Sep 2026', 'MERCHANT REFUND', '15.00 CR'], ['22 Sep 2026', 'DOORDASH ORDER', '31.55']], '', ['', '', 'r']),
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  for (const [name, html] of Object.entries(files)) { await p.setContent(html); await p.pdf({ path: path.join(out, name), format: 'Letter' }); }
  // scanned: text only exists as pixels
  const png = fs.readFileSync(path.join(out, 'scan.png')).toString('base64');
  await p.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png}" style="width:100%"></body></html>`);
  await p.pdf({ path: path.join(out, 'scanned.pdf'), format: 'Letter' });
  await b.close();
  console.log('ok');
})();
