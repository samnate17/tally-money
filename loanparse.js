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
  for (const name of LENDERS) { const m = new RegExp('(?:^|[^a-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i').exec(text); if (m && (best === null || m.index < best.i)) best = { i: m.index, name }; }
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

// Servicers such as Nelnet print one "Account Snapshot" column per loan group (AA, AB, ...), each with its own rate, balance, payment and amount due.
// Every field repeats once per group in the same order, so the nth match of a label belongs to the nth group.
function parseGroups(text, f) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const names = [...flat.matchAll(/Account Snapshot for:? Group ([A-Z]{1,3})\b/g)].map((m) => m[1]);
  if (!names.length) return null;
  const at = flat.search(/Account Snapshot/i), body = flat.slice(at);
  const money = '\\$\\s?(-?[\\d,]+\\.\\d{2})';
  const all = (re, conv) => [...body.matchAll(re)].map((m) => conv(m));
  const num = (m) => parseFloat(m[1].replace(/,/g, ''));
  const col = (label, extra) => all(new RegExp('(?:' + label + '[^$\\d]{0,40}?)+' + (extra || '') + money, 'gi'), num);
  const n = names.length;
  const lists = {
    orig: col('Original Principal Amount'),
    rate: all(/Interest Rate(?: is)?\s*([\d.]+)\s*%/gi, (m) => parseFloat(m[1])),
    accrued: all(/Accrued Interest on [\d/]+[^$\d]{0,6}\$\s?([\d,]+\.\d{2})/gi, num),
    pay: all(/Regular Monthly Payment Amount\s*\$\s?([\d,]+\.\d{2})/gi, num),
    principal: all(/Outstanding Principal Balance\*? on [\d/]+[^$\d]{0,6}\$\s?([\d,]+\.\d{2})/gi, num),
    past: all(/Past Due Amount\s*\$\s?([\d,]+\.\d{2})/gi, num),
    due: all(/(?<!Current )Amount Due\s*\$\s?([\d,]+\.\d{2})/gi, num),
    type: all(/((?:DIRECT|FFEL|FEDERAL|PERKINS)[A-Z ]{0,24}?(?:UNSUBSIDIZED|SUBSIDIZED|UNSUB|SUB|PLUS|CONSOLIDATION|STAFFORD))\b/g, (m) => m[1]),
  };
  if (!(lists.rate.length === n && lists.principal.length === n)) return null;   // the columns did not line up: let the other readers try
  const ok = (k) => lists[k].length === n;
  const kindName = (t) => { const u = String(t || ''); const nice = /UNSUB/.test(u) ? 'Unsubsidized' : /SUB/.test(u) ? 'Subsidized' : /PLUS/.test(u) ? 'PLUS' : /CONSOL/.test(u) ? 'Consolidation' : ''; return nice; };
  const dueDate = f.dueDate || '';
  return names.map((g, i) => {
    const acc = ok('accrued') ? lists.accrued[i] : 0, pr = lists.principal[i];
    const kn = ok('type') ? kindName(lists.type[i]) : '';
    return {
      name: 'Direct ' + (kn ? kn.toLowerCase() + ' ' : '') + 'loan, group ' + g,
      balance: Math.round((pr + acc) * 100) / 100, apr: lists.rate[i], monthlyPayment: ok('pay') ? lists.pay[i] : 0, dueDay: dueDate ? +dueDate.slice(8) : 0,
      originalAmount: ok('orig') ? lists.orig[i] : 0, amountDue: ok('due') ? lists.due[i] : 0, pastDue: ok('past') ? lists.past[i] : 0, dueDate,
      accruedInterest: acc, principal: pr, lastPaymentAmount: 0, lastPaymentDate: '', asOfDate: f.asOf || '', note: 'group ' + g,
    };
  });
}

function parseLoanStatement(text, kind, clean) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''));
  const f = parseFields(lines), lender = lenderIn(text), notes = [];
  const label = kind === 'credit' ? 'Credit card' : kind === 'student' ? 'Student loan' : kind === 'auto' ? 'Car loan' : 'Loan';
  const veh = /\b((?:19|20)\d{2})\s+(Honda|Toyota|Ford|Chevrolet|Nissan|Hyundai|Kia|Subaru|Mazda|Volkswagen|BMW|Mercedes|Jeep|Dodge|Ram|GMC|Lexus|Acura|Tesla)\s+([A-Za-z0-9-]+)/i.exec(text);
  const dayOf = (iso) => (iso ? +iso.slice(8) : 0);
  const rows = kind === 'student' || /interest\s+rate/i.test(lines.join('\n')) ? parseTable(lines) : [];
  let loans;
  const grp = kind === 'student' || kind === 'loan' ? parseGroups(text, f) : null;
  if (grp && grp.length) {
    loans = grp.map((g) => ({ ...g, lender }));
    const tot = [];
    if (f.balance) tot.push('statement balance ' + f.balance.toFixed(2));
    if (f.lastPaymentAmount) tot.push('last payment ' + f.lastPaymentAmount.toFixed(2) + (f.lastPaymentDate ? ' on ' + f.lastPaymentDate : '') + ' (not split between groups)');
    notes.push('Found ' + grp.length + ' loan groups, each with its own rate, balance and payment' + (tot.length ? ' (' + tot.join(', ') + ')' : '') + '. Balance = principal plus interest accrued so far.');
  } else if (rows.length > 1 || (rows.length === 1 && kind === 'student')) {
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
  const contract = kind === 'auto' || kind === 'loan' ? parseContract(text) : null;
  if (contract) {
    const day = contract.firstDate ? +contract.firstDate.slice(8) : 0;
    loans = [{ name: contract.vehicle || loans[0].name, lender: contract.lender || '', balance: contract.amountFinanced, apr: contract.apr, monthlyPayment: contract.payment || 0, dueDay: day, originalAmount: contract.amountFinanced, note: 'from the contract; the balance is the original amount until you enter today\u2019s', amountDue: 0, pastDue: 0, dueDate: '', accruedInterest: 0, principal: 0, lastPaymentAmount: 0, lastPaymentDate: '', asOfDate: '' }];
    notes.length = 0; notes.push('This is a sale contract, not a statement: it gives the rate, term, payment and total cost, not today\u2019s balance. The app works out the balance and payoff from the schedule.' + (contract.scheduleMismatch ? ' The payment count times amount does not match the total of payments, so check the schedule.' : ''));
    const r = clean({ loans, notes: notes.join(' ') }); r.contract = contract; return r;
  }
  return clean({ loans, notes: notes.join(' ') });
}

// A mortgage statement: balance, rate, the principal-and-interest part of the payment, escrow, due date and a few details about the loan.
const MORT_LENDERS = ['Mr. Cooper', 'Mr Cooper', 'Chase', 'Wells Fargo', 'Bank of America', 'Rocket Mortgage', 'Quicken Loans', 'loanDepot', 'PennyMac', 'Freedom Mortgage', 'U.S. Bank', 'US Bank', 'Truist', 'Citizens', 'PNC', 'Fifth Third', 'Newrez', 'Shellpoint', 'Lakeview', 'Carrington', 'Guild', 'Navy Federal', 'USAA', 'Regions', 'TD Bank', 'Cenlar', 'Flagstar', 'Ocwen', 'Mortgage Service Center', 'Santander', 'Huntington', 'Citi', 'CrossCountry', 'Fairway', 'AmeriHome', 'Planet Home Lending'];
function parseMortgageText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const notes = [];
  const money = (labels) => findField(lines, labels, mval);
  const balance = money([/(?:unpaid|outstanding|current|remaining)\s+principal\s+balance/i, /principal\s+balance/i, /(?:loan|mortgage)\s+balance/i, /(?:unpaid|outstanding)\s+balance/i]);
  let apr = findField(lines, [/(?:current\s+)?interest\s+rate/i, /note\s+rate/i, /rate\s+of\s+interest/i], (s) => pctIn(s, true));
  let pi = money([/principal\s*(?:and|&|\/|\+)\s*interest(?:\s+payment)?/i, /\bP\s*&\s*I\b/i]);
  const princ = money([/^(?:\W*)principal(?!\s*(?:balance|and|&|paid))(?:\s+payment)?\b/i]);
  const intr = money([/^(?:\W*)interest(?!\s*(?:rate|paid|accrued|due\s+date))(?:\s+payment)?\b/i]);
  if (pi === null && princ !== null && intr !== null) pi = Math.round((princ + intr) * 100) / 100;
  const escrow = money([/escrow\s*(?:\(.*?\))?\s*(?:payment|amount|deposit)?(?!\s*(?:balance|shortage|advance))/i, /taxes\s+and\s+insurance/i]);
  const total = money([/total\s+(?:monthly\s+)?(?:payment|amount)(?:\s+(?:due|amount))?/i, /regular\s+monthly\s+payment/i, /monthly\s+payment/i, /(?:total\s+)?(?:amount|payment)\s+due(?!\s*(?:date|on|by))/i]);
  const past = money([/past\s+due(?:\s+(?:amount|payment))?/i, /overdue\s+amount/i]);
  const lateFees = money([/(?:unpaid\s+)?late\s+(?:charges?|fees?)/i]);
  const orig = money([/(?:original|initial)\s+(?:principal|loan)\s*(?:amount|balance)?/i, /original\s+(?:mortgage\s+)?amount/i, /loan\s+amount/i]);
  const dueDate = findField(lines, [/(?:payment\s+)?due\s+date/i, /next\s+payment\s+(?:due|date)/i, /payment\s+due(?:\s+on|\s+by)?/i, /due\s+on/i], (x) => dateIn(x, 'first'));
  const asOf = findField(lines, [/statement\s+date/i, /as\s+of/i, /statement\s+period/i], (x) => dateIn(x, 'last'));
  const maturity = findField(lines, [/maturity\s+date/i, /final\s+payment\s+date/i], (x) => dateIn(x, 'first'));
  const escrowBal = money([/escrow\s+balance/i]);
  let termYears = findField(lines, [/(?:original\s+)?(?:loan\s+)?term/i], (x) => { const m = /(\d{1,3})\s*(years?|yrs?|months?|mos?)/i.exec(x); return m ? (/^m/i.test(m[2]) ? Math.round(+m[1] / 12) : +m[1]) : null; });
  let lender = ''; { const low = text.toLowerCase(); let best = null; for (const n of MORT_LENDERS) { const i = low.indexOf(n.toLowerCase()); if (i >= 0 && (best === null || i < best.i)) best = { i, n }; } if (best) lender = best.n; }
  if (apr !== null && (apr <= 0 || apr > 25)) apr = null;
  if (pi === null && total !== null && escrow !== null && total > escrow) { pi = Math.round((total - escrow) * 100) / 100; notes.push('Principal and interest worked out as the total payment minus escrow.'); }
  if (!termYears && orig && maturity && asOf) { const y = Math.round((new Date(maturity) - new Date(asOf)) / 31557600000); if (y > 0 && y <= 40) notes.push('Time left on the loan is about ' + y + ' years (to ' + maturity + ').'); }
  const miss = [];
  if (balance === null) miss.push('balance'); if (apr === null) miss.push('interest rate'); if (pi === null) miss.push('principal-and-interest payment');
  if (miss.length) notes.push('Not found: ' + miss.join(', ') + '. Type them in below.');
  return {
    ok: balance !== null || apr !== null || pi !== null,
    mortgage: { lender, balance: balance || 0, apr: apr || 0, pi: pi || 0, escrow: escrow || 0, total: total || 0, pastDue: past || 0, lateFees: lateFees || 0, origLoan: orig || 0, dueDate: dueDate || '', dueDay: dueDate ? +dueDate.slice(8) : 0, asOf: asOf || '', maturity: maturity || '', termYears: termYears || 0, escrowBalance: escrowBal || 0 },
    notes: ['Read without AI by matching the labels on the statement. Check every figure.'].concat(notes).join(' '),
  };
}

// A retail installment sale contract (the paper signed at the dealer): the federal Truth-in-Lending box has the rate, finance charge, amount financed, total of payments and
// total sale price in a row, then the payment schedule. Returns null when the text is not such a contract.
function parseContract(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  if (!/amount financed/i.test(flat) || !/finance charge/i.test(flat) || !/(total of payments|installment (sale )?contract)/i.test(flat)) return null;
  const num = (x) => parseFloat(String(x).replace(/,/g, ''));
  const M = '\\$?\\s?([\\d,]+\\.\\d{2})';
  const row = new RegExp('(\\d{1,2}\\.\\d{1,4})\\s*%\\s*' + M + '\\s+' + M + '\\s+' + M + '\\s+' + M).exec(flat);
  if (!row) return null;
  const c = { apr: num(row[1]), financeCharge: num(row[2]), amountFinanced: num(row[3]), totalOfPayments: num(row[4]), totalSalePrice: num(row[5]) };
  if (Math.abs(c.amountFinanced + c.financeCharge - c.totalOfPayments) > 0.05) return null;    // not the row we think it is
  const pay = /(\d{1,3})\s+\$\s?([\d,]+\.\d{2})\s+(?:beginning|monthly)/i.exec(flat) || /(\d{1,3})\s+\$\s?([\d,]+\.\d{2})\s+[^$]{0,60}?\d{2}\/\d{2}\/\d{4}/.exec(flat);
  if (pay) { c.count = +pay[1]; c.payment = num(pay[2]); }
  const first = /beginning[\s\S]{0,80}?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat) || /monthly\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat);
  if (first) c.firstDate = dateIn(first[1], 'first');
  c.frequency = /\bmonthly\b/i.test(flat.slice(flat.search(/payment schedule/i))) ? 'monthly' : '';
  if (c.count && c.payment && Math.abs(c.count * c.payment - c.totalOfPayments) > c.count * 0.02 + 1) { c.scheduleMismatch = true; }
  const down = Math.round((c.totalSalePrice - c.totalOfPayments) * 100) / 100;
  if (down >= 0) c.downPayment = down;
  const cash = new RegExp('1 Cash Price[\\s\\S]{0,60}?' + M + '\\s*\\(1\\)', 'i').exec(flat); if (cash) c.cashPrice = num(cash[1]);
  const gap = new RegExp('Optional Gap Contract\\s*' + M, 'i').exec(flat); if (gap) c.gap = num(gap[1]);
  const reg = new RegExp('Registration Fee\\s*' + M, 'i').exec(flat); if (reg) c.registration = num(reg[1]);
  const veh = /\b(NEW|USED)\s+((?:19|20)\d{2})\s+([A-Za-z]+)\s+([A-Za-z0-9 \-]{1,30}?)\s+([A-HJ-NPR-Z0-9]{17})\b/.exec(flat);
  if (veh) { c.condition = veh[1].toLowerCase(); c.vehicle = veh[2] + ' ' + veh[3] + ' ' + veh[4].trim(); c.vin = veh[5]; c.year = +veh[2]; }
  const late = /late charge[\s\S]{0,140}?(\d+(?:\.\d+)?)\s*%/i.exec(flat), lateDays = /within\s+(\d+)\s+days\s+after\s+it\s+is\s+due/i.exec(flat);
  if (late) c.lateFeePct = parseFloat(late[1]); if (lateDays) c.lateDays = +lateDays[1];
  if (/you will not have to pay a penalty/i.test(flat)) c.prepaymentPenalty = false; else if (/you will have to pay a penalty/i.test(flat)) c.prepaymentPenalty = true;
  c.simpleInterest = /simple finance charge|figure your finance charge on a daily basis/i.test(flat);
  const seller = /\b([A-Z][A-Z&.' ]{2,34}(?:HONDA|TOYOTA|FORD|CHEVROLET|NISSAN|SUBARU|HYUNDAI|KIA|MAZDA|VOLKSWAGEN|BMW|MERCEDES|JEEP|DODGE|GMC|LEXUS|ACURA|MOTORS|AUTO(?: GROUP)?))\b/.exec(String(text || '').replace(/[ \t]+/g, ' '));
  if (seller) c.seller = seller[1].replace(/^\W+/, '').trim().split(' ').slice(-2).join(' ');
  const asg = /assigns its interest in this contract to\s+([A-Z][A-Za-z&.,' ]{2,50}?)\s*\(Assignee\)/.exec(flat);
  c.lender = asg ? asg[1].trim() : lenderIn(String(text || ''));
  return c;
}

const parseLoanText = (text, kind) => parseLoanStatement(text, kind, require('./ai').cleanLoans);
module.exports = { parseContract, parseMortgageText, parseLoanText, parseLoanStatement, dateIn, moneyIn, pctIn };
