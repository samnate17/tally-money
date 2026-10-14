'use strict';
// Reads a loan or credit card statement without any AI: it looks for the usual labels ("Amount Due", "Interest Rate", "Past Due"...) in the text of the
// statement and takes the number or date next to each. It works on ordinary statements and misses unusual layouts, so the app always shows what it found for you
// to check and correct before anything is saved. Nothing leaves this computer.

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONRE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n) => String(n).padStart(2, '0');

function moneyIn(s) {
  const m = /\(?-?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\)?/g;
  let x;
  while ((x = m.exec(s))) {
    const raw = x[0], hasDollar = /\$/.test(raw), hasCents = !!x[2];
    if (!hasDollar && !hasCents) continue;                       // a bare whole number is more likely a day or a count than money
    const v = parseFloat(x[1].replace(/,/g, '') + (x[2] || ''));
    if (Number.isFinite(v)) return { value: v, index: x.index, end: x.index + raw.length };
  }
  return null;
}
function allMoney(s) {
  const out = [], re = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b|\$\s*(\d{1,3}(?:,\d{3})+|\d+)\b/g;
  let x;
  while ((x = re.exec(s))) out.push({ value: parseFloat((x[1] || x[2]).replace(/,/g, '') + (x[1] ? x[0].slice(x[0].lastIndexOf('.')) : '')), index: x.index });
  return out;
}
function pctIn(s, allowBare) {
  let m = /(\d{1,2}(?:\.\d{1,4})?)\s*%/.exec(s);
  if (m) return parseFloat(m[1]);
  if (allowBare) { m = /(?:^|[^\d.])(\d{1,2}\.\d{1,4})(?![\d%])/.exec(s); if (m && +m[1] > 0 && +m[1] < 40) return parseFloat(m[1]); }
  return null;
}
function dateIn(s, which) {
  const found = [];
  const push = (y, mo, d, idx) => { if (y < 100) y += 2000; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100) found.push({ iso: y + '-' + pad(mo) + '-' + pad(d), idx }); };
  let m, re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = re.exec(s))) push(+m[1], +m[2], +m[3], m.index);
  re = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b/g;
  while ((m = re.exec(s))) push(+m[3], +m[1], +m[2], m.index);
  re = new RegExp('\\b' + MONRE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'gi');
  while ((m = re.exec(s))) push(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2], m.index);
  re = new RegExp('\\b(\\d{1,2})\\s+' + MONRE + '\\.?,?\\s+(\\d{4})\\b', 'gi');
  while ((m = re.exec(s))) push(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1], m.index);
  found.sort((a, b) => a.idx - b.idx);
  if (!found.length) return '';
  return (which === 'last' ? found[found.length - 1] : found[0]).iso;
}

// Value after a label: on the same line, else at the start of the next non-empty line.
function after(lines, i, re, pick) {
  const m = re.exec(lines[i]);
  if (!m) return null;
  const tail = lines[i].slice(m.index + m[0].length);
  let v = pick(tail);
  if (v !== null && v !== '' && v !== undefined) return v;
  for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
    if (!lines[j].trim()) continue;
    if (/^[A-Za-z]{4,}/.test(lines[j].trim()) && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lines[j].trim())) break;   // the next line is another label
    v = pick(lines[j]);
    if (v !== null && v !== '' && v !== undefined) return v;
    break;
  }
  return null;
}
function findField(lines, labels, pick) {
  for (const re of labels) for (let i = 0; i < lines.length; i++) { const v = after(lines, i, re, pick); if (v !== null && v !== '' && v !== undefined) return v; }
  return null;
}
const mval = (s) => { const m = moneyIn(s); return m ? m.value : null; };

const LENDERS = ['Nelnet', 'Navient', 'MOHELA', 'Aidvantage', 'Great Lakes', 'FedLoan', 'EdFinancial', 'Edfinancial', 'Sallie Mae', 'SoFi', 'Earnest', 'CommonBond', 'Honda Financial', 'American Honda Finance', 'Toyota Financial', 'Ford Credit', 'GM Financial', 'Nissan Motor Acceptance', 'Hyundai Capital', 'Ally', 'Santander', 'Capital One', 'Chase', 'Discover', 'Citi', 'Bank of America', 'Wells Fargo', 'American Express', 'Synchrony', 'Barclays', 'U.S. Bank', 'PNC', 'Credit Union', 'Rocket Mortgage', 'Mr. Cooper'];
function lenderIn(text) {
  let best = null;
  for (const name of LENDERS) { const i = text.toLowerCase().indexOf(name.toLowerCase()); if (i >= 0 && (best === null || i < best.i)) best = { i, name }; }
  return best ? best.name : '';
}

const LABELS = {
  amountDue: [/(?:total\s+)?(?:amount|payment)\s+due(?!\s*(?:date|on|by))/i, /minimum\s+(?:payment\s+)?due(?!\s*date)/i, /new\s+payment\s+amount/i],
  monthlyPayment: [/(?:regular|monthly|scheduled|recurring)\s+(?:loan\s+)?payment(?:\s+amount)?/i, /minimum\s+payment(?:\s+amount)?(?!\s*due\s*date)/i, /payment\s+amount/i],
  pastDue: [/amount\s+past\s+due/i, /past\s+due(?:\s+(?:amount|balance))?/i, /delinquent\s+amount/i],
  balance: [/(?:current|total|outstanding|remaining|unpaid|new)\s+(?:loan\s+)?balance/i, /balance\s+(?:owed|remaining)/i, /(?:total\s+)?amount\s+owed/i, /statement\s+balance/i, /principal\s+and\s+interest\s+balance/i],
  principal: [/(?:outstanding|unpaid|current|remaining)\s+principal(?:\s+balance)?/i, /principal\s+balance/i],
  accruedInterest: [/(?:accrued|unpaid|outstanding|accumulated)\s+interest(?:\s+balance)?/i, /interest\s+(?:accrued|outstanding)/i],
  original: [/(?:original|initial)\s+(?:loan\s+)?(?:amount|balance|principal)/i, /amount\s+(?:borrowed|financed)/i, /disbursed\s+(?:amount|principal)/i],
};

function parseFields(lines) {
  const f = {};
  f.amountDue = findField(lines, LABELS.amountDue, mval);
  f.monthlyPayment = findField(lines, LABELS.monthlyPayment, mval);
  f.pastDue = findField(lines, LABELS.pastDue, mval);
  f.balance = findField(lines, LABELS.balance, mval);
  f.principal = findField(lines, LABELS.principal, mval);
  f.accruedInterest = findField(lines, LABELS.accruedInterest, mval);
  f.original = findField(lines, LABELS.original, mval);
  f.dueDate = findField(lines, [/(?:payment\s+)?due\s+date/i, /next\s+payment\s+(?:due|date)/i, /payment\s+due(?:\s+on|\s+by)?/i, /due\s+(?:on|by)/i, /pay\s+by/i], (s) => dateIn(s, 'first'));
  f.asOf = findField(lines, [/(?:statement|billing|closing)\s+date/i, /as\s+of/i, /statement\s+period[^\d]*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*(?:-|to|through|thru)/i, /statement\s+period/i], (s) => dateIn(s, 'last'));
  f.apr = findField(lines, [/(?:purchases?\s+)?(?:annual\s+percentage\s+rate|apr)(?:\s*\(apr\))?/i, /(?:current\s+)?interest\s+rate(?:\s+of)?/i, /rate\s+of\s+interest/i], (s) => pctIn(s, true));
  // last payment: amount, and the date on the same line
  for (const re of [/(?:last|most\s+recent|previous|latest)\s+payment(?:\s+(?:received|amount|made))?/i, /payment\s+received/i, /payments?\s+(?:and\s+credits\s+)?received/i]) {
    for (let i = 0; i < lines.length && f.lastPaymentAmount === undefined; i++) {
      const m = re.exec(lines[i]); if (!m) continue;
      const tail = lines[i].slice(m.index + m[0].length) + ' ' + (lines[i + 1] || '').slice(0, 60), amt = mval(tail);
      if (amt !== null && amt > 0) { f.lastPaymentAmount = amt; f.lastPaymentDate = dateIn(lines[i], 'first') || dateIn(tail, 'first'); }
    }
  }
  return f;
}

// A table with a header such as "Loan  Interest Rate  Outstanding Principal  Accrued Interest  Total".
function parseTable(lines) {
  const out = [];
  for (let h = 0; h < lines.length; h++) {
    const head = lines[h].toLowerCase();
    if (!/rate/.test(head) || !(/principal|balance|total/.test(head))) continue;
    const stripped = head.replace(/interest\s+rate/g, 'RATE');
    const cols = [];
    const add = (key, re) => { const i = stripped.search(re); if (i >= 0) cols.push({ key, i }); };
    add('rate', /\brate\b/); add('principal', /principal/); add('interest', /(?:accrued|unpaid)?\s*interest/); add('balance', /total|balance/); add('payment', /payment|amount\s+due/);
    cols.sort((a, b) => a.i - b.i);
    const moneyCols = cols.filter((c) => c.key !== 'rate').map((c) => c.key);
    if (cols.length < 2) continue;
    let misses = 0;
    for (let r = h + 1; r < lines.length && misses < 2; r++) {
      const line = lines[r];
      const pct = pctIn(line, false), nums = allMoney(line.replace(/\d{1,2}(?:\.\d{1,4})?\s*%/g, ' '));
      if (pct === null || !nums.length) { misses++; continue; }
      misses = 0;
      const name = line.slice(0, Math.min(...[line.search(/\$|\d+\.\d|%/)].filter((x) => x >= 0))).replace(/[\s:|\-]+$/, '').replace(/^\W+/, '').trim();
      const row = { name: name || 'Loan', apr: pct };
      moneyCols.forEach((k, idx) => { if (nums[idx]) row[k] = nums[idx].value; });
      if (!row.balance && row.principal) row.balance = row.principal + (row.interest || 0);
      if (!row.balance && !row.principal && nums.length) row.balance = nums[0].value;
      out.push(row);
    }
    if (out.length) break;
  }
  return out;
}

function parseLoanStatement(text, kind, clean) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''));
  const f = parseFields(lines), lender = lenderIn(text), notes = [];
  const label = kind === 'credit' ? 'Credit card' : kind === 'student' ? 'Student loan' : kind === 'auto' ? 'Car loan' : 'Loan';
  const veh = /\b((?:19|20)\d{2})\s+(Honda|Toyota|Ford|Chevrolet|Nissan|Hyundai|Kia|Subaru|Mazda|Volkswagen|BMW|Mercedes|Jeep|Dodge|Ram|GMC|Lexus|Acura|Tesla)\s+([A-Za-z0-9-]+)/i.exec(text);
  const dayOf = (iso) => (iso ? +iso.slice(8) : 0);
  const rows = kind === 'student' || /interest\s+rate/i.test(lines.join('\n')) ? parseTable(lines) : [];
  let loans;
  if (rows.length > 1 || (rows.length === 1 && kind === 'student')) {
    loans = rows.map((r) => ({
      name: r.name, lender, balance: r.balance || 0, apr: r.apr, monthlyPayment: r.payment || 0, dueDay: 0, originalAmount: 0, note: '',
      amountDue: 0, pastDue: 0, dueDate: '', accruedInterest: r.interest || 0, principal: r.principal || 0, lastPaymentAmount: 0, lastPaymentDate: '', asOfDate: f.asOf || '',
    }));
    const tot = [];
    if (f.amountDue) tot.push('amount due ' + f.amountDue.toFixed(2));
    if (f.pastDue) tot.push('past due ' + f.pastDue.toFixed(2));
    if (f.dueDate) tot.push('due ' + f.dueDate);
    if (f.lastPaymentAmount) tot.push('last payment ' + f.lastPaymentAmount.toFixed(2) + (f.lastPaymentDate ? ' on ' + f.lastPaymentDate : ''));
    notes.push('Found ' + rows.length + ' loans in a table. Totals shown on the statement are not split between them: ' + (tot.length ? tot.join(', ') + '.' : 'none found.'));
  } else {
    const balance = f.balance !== null ? f.balance : (f.principal !== null ? f.principal + (f.accruedInterest || 0) : 0);
    let pay = f.monthlyPayment, note = '';
    if (pay === null && f.amountDue !== null) { pay = Math.max(0, f.amountDue - (f.pastDue || 0)); note = 'monthly payment taken from the amount due'; }
    if (f.apr === null) note = (note ? note + '; ' : '') + 'rate not found';
    if (balance === 0) note = (note ? note + '; ' : '') + 'balance not found';
    loans = [{
      name: veh ? veh[1] + ' ' + veh[2] + ' ' + veh[3] : (lender ? lender + ' ' + label.toLowerCase() : label), lender, balance, apr: f.apr || 0, monthlyPayment: pay || 0, dueDay: dayOf(f.dueDate), originalAmount: f.original || 0, note,
      amountDue: f.amountDue || 0, pastDue: f.pastDue || 0, dueDate: f.dueDate || '', accruedInterest: f.accruedInterest || 0, principal: f.principal || 0,
      lastPaymentAmount: f.lastPaymentAmount || 0, lastPaymentDate: f.lastPaymentDate || '', asOfDate: f.asOf || '',
    }];
  }
  notes.unshift('Read without AI by matching the labels on the statement. Check every figure: a blank or zero means the label was not found.');
  return clean({ loans, notes: notes.join(' ') });
}

const parseLoanText = (text, kind) => parseLoanStatement(text, kind, require('./ai').cleanLoans);
module.exports = { parseLoanText, parseLoanStatement, dateIn, moneyIn, pctIn };
