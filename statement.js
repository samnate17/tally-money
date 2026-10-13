// Reads bank statement PDFs. Text is extracted locally with pdf.js and transaction rows are detected
// heuristically (date at the start of a line, money amounts after it). Nothing here touches the network.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONRE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const NUM = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}';
const AMT = new RegExp('^\\(?-?\\$?\\s?' + NUM + '\\)?-?$');
const CRDR = /^(CR|DR)$/i;
const SKIP = /^(beginning|opening|previous|starting|ending|closing|new|total|subtotal|balance|statement|minimum|payment due)\b|\btotals?\b|balance forward|\bpage \d/i;
const INFLOW = /deposit|payroll|direct dep|salary|interest (paid|earned)|refund|reversal|transfer from|zelle from|cash ?out|received|rebate|cash ?back|credit/i;

let pdfjsP = null;
function loadPdfjs() { return pdfjsP || (pdfjsP = import('pdfjs-dist/legacy/build/pdf.mjs')); }

async function extractPages(data) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      // Some PDFs write a minus as U+2212 or a dash; normalise so amounts parse.
      pages.push(tc.items.filter((it) => typeof it.str === 'string' && it.str.trim() !== '').map((it) => ({ str: it.str.trim().replace(/[\u2212\u2012-\u2015]/g, '-'), x: it.transform[4], y: it.transform[5], w: it.width })));
    }
  } finally { await doc.destroy(); }
  return pages;
}

// Items -> visual lines (top to bottom), each with tokens left to right.
function buildLines(pages) {
  const lines = [];
  pages.forEach((items, pi) => {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    sorted.forEach((it) => {
      if (!cur || Math.abs(cur.y - it.y) > 3) { cur = { y: it.y, page: pi, items: [] }; lines.push(cur); }
      cur.items.push(it);
    });
  });
  return lines.map((l) => {
    const items = l.items.sort((a, b) => a.x - b.x), runs = [];
    items.forEach((it) => {
      const prev = runs[runs.length - 1];
      if (prev && it.x - prev.x2 < 1.2) { prev.str += it.str; prev.x2 = it.x + it.w; } // one word split by the PDF
      else runs.push({ str: it.str, x: it.x, x2: it.x + it.w });
    });
    // Many statements store a whole row as one text run ("09/03 WHOLE FOODS -86.42 4,813.58"), so split every run into
    // words and estimate each word's x position from its character offset.
    const tokens = [];
    runs.forEach((r) => {
      const re = /\S+/g, len = r.str.length || 1;
      let m;
      while ((m = re.exec(r.str))) tokens.push({ str: m[0], x: r.x + ((r.x2 - r.x) * m.index) / len, x2: r.x + ((r.x2 - r.x) * (m.index + m[0].length)) / len });
    });
    for (let i = 0; i < tokens.length - 1; i++) { // a lone currency sign belongs to the amount after it
      if (/^-?\$$/.test(tokens[i].str)) { tokens[i + 1].str = tokens[i].str + tokens[i + 1].str; tokens[i + 1].x = tokens[i].x; tokens.splice(i, 1); i--; }
    }
    return { page: l.page, tokens, text: tokens.map((t) => t.str).join(' ') };
  });
}

function parseAmt(s) {
  const t = s.trim();
  if (!AMT.test(t)) return null;
  const v = parseFloat(t.replace(/[^0-9.]/g, ''));
  return { v, neg: /^\(|^-|^\$-|-$/.test(t), cr: false, dr: false };
}

// ----- dates -----
function matchDate(text, order) {
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?=\s|$)/.exec(text))) return { y: +m[1], m: +m[2], d: +m[3], len: m[0].length };
  if ((m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}|\d{2}))?(?=\s|$)/.exec(text))) {
    let a = +m[1], b = +m[2]; const mo = order === 'dmy' ? b : a, dy = order === 'dmy' ? a : b;
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
    let y = m[3] ? +m[3] : null; if (y !== null && y < 100) y += 2000;
    return { y, m: mo, d: dy, len: m[0].length };
  }
  if ((m = new RegExp('^' + MONRE + '\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?(?=\\s|$)', 'i').exec(text))) return { y: m[3] ? +m[3] : null, m: MON[m[1].toLowerCase()], d: +m[2], len: m[0].length };
  if ((m = new RegExp('^(\\d{1,2})[\\s-]+' + MONRE + '(?:[\\s,-]+(\\d{4}))?(?=\\s|$)', 'i').exec(text))) return { y: m[3] ? +m[3] : null, m: MON[m[2].toLowerCase()], d: +m[1], len: m[0].length };
  if ((m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{1,2})(?=\s|$)/i.exec(text)) && +m[2] >= 1 && +m[2] <= 31) return { y: null, m: MON[m[1].toLowerCase()], d: +m[2], len: m[0].length };   // "SEP22", no space and no year
  return null;
}
function findFullDates(text, order) { // dates with a 4-digit year anywhere in a line
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1])) continue;
    const d = matchDate(text.slice(i), order);
    if (d && d.y && d.y > 1999) out.push({ ...d, at: i });
  }
  return out;
}
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const ymdNum = (o) => o.y * 372 + o.m * 31 + o.d;

function detectOrder(lines) {
  let dmy = false;
  lines.forEach((l) => { const m = /^(\d{1,2})[\/.](\d{1,2})[\/.]/.exec(l.text); if (m && +m[1] > 12 && +m[2] <= 12) dmy = true; });
  return dmy ? 'dmy' : 'mdy';
}

function pickYear(d, period, fallbackYear) {
  if (d.y) return d.y;
  if (period) {
    for (const y of [period.end.y, period.start.y]) {
      const n = ymdNum({ y, m: d.m, d: d.d });
      if (n >= ymdNum(period.start) - 10 && n <= ymdNum(period.end) + 10) return y;
    }
    return period.end.y;
  }
  return fallbackYear;
}

function parseStatement(lines, opts = {}) {
  const order = detectOrder(lines);
  const meta = { type: 'checking', period: null, mode: 'signed', skipped: 0, order };
  // header = everything before the first transaction-looking line
  const rowLike = (l) => { const d = matchDate(l.text, order); return d && l.tokens.some((t) => parseAmt(t.str)); };
  const firstRow = lines.findIndex(rowLike);
  const header = lines.slice(0, firstRow < 0 ? Math.min(lines.length, 40) : firstRow);
  const headText = header.map((l) => l.text).join('\n');
  meta.type = opts.type === 'credit' || opts.type === 'checking' ? opts.type : (/minimum payment due|credit limit|payment due date|available credit|credit card (statement|account|number)|cash advance/i.test(headText) || (/new balance/i.test(headText) && /minimum payment/i.test(headText)) ? 'credit' : 'checking');

  // statement period
  const dates = [];
  header.forEach((l) => { if (/period|statement|closing|opening|billing|through|from|date/i.test(l.text)) findFullDates(l.text, order).forEach((d) => { if (!/due/i.test(l.text.slice(Math.max(0, d.at - 22), d.at))) dates.push(d); }); });
  if (dates.length >= 2) { dates.sort((a, b) => ymdNum(a) - ymdNum(b)); meta.period = { start: dates[0], end: dates[dates.length - 1] }; }
  else if (dates.length === 1) { const e = dates[0], s = new Date(e.y, e.m - 1, e.d - 31); meta.period = { start: { y: s.getFullYear(), m: s.getMonth() + 1, d: s.getDate() }, end: e }; }
  const yrs = {}; (headText.match(/\b20\d{2}\b/g) || []).forEach((y) => { yrs[y] = (yrs[y] || 0) + 1; });
  const fallbackYear = +(Object.keys(yrs).sort((a, b) => yrs[b] - yrs[a])[0] || new Date().getFullYear());

  // withdrawal / deposit / balance columns
  let cols = null;
  for (const l of header.concat(lines.slice(firstRow < 0 ? 0 : firstRow, (firstRow < 0 ? 0 : firstRow) + 1))) {
    const found = {};
    l.tokens.forEach((t) => {
      const c = (t.x + t.x2) / 2, s = t.str.replace(/[^a-z ]/gi, '').trim();
      const isDebit = /^(withdrawals?|debits?|charges|purchases|money out)$/i.test(s);
      const isCredit = /^(deposits?|credits?|money in|additions)$/i.test(s) || (meta.type === 'credit' && /^payments?$/i.test(s));
      if (isDebit) found.debit = c;
      else if (isCredit) found.credit = c;
      else if (/^balance$/i.test(s)) found.balance = c;
    });
    if (found.debit !== undefined && found.credit !== undefined) { cols = found; break; }
  }
  if (cols) meta.mode = 'columns';

  const rows = [];
  let opening = null, sawExplicitNeg = false, lastLi = -9, contN = 0, inSummary = false;
  // A description that wraps onto the next line ("DEBIT CARD DEBIT 4012..." then "GATEWAY FOOD SHOPS WORCESTER MA 09-02-26").
  const CONT_STOP = /^(account statement|member\s*#|statement period|page\b|\d+ of \d+|call:|date\s+(transaction|description)|.*acct\s*#|direct general|in case of|telephone|attention|p\.?o\.? box|\*{3}|deposits,|withdrawals,|total\b|continued\b)/i;
  const tidy = (t) => t.replace(/\s*~\s*[0-9a-f]{8}-[0-9a-f-]{20,}\s*$/i, '').replace(/\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s*$/, '').replace(/\s+/g, ' ').trim();
  const appendCont = (row, text) => {
    const c = tidy(text);
    if (!c) return;
    row.name = /^(debit|credit|pos|atm)? ?card (debit|credit|purchase)?\s*\d*$/i.test(row.name) || /^(debit card|credit card)\s+(debit|credit)\s+\d+$/i.test(row.name) ? c : (row.name + ' ' + c).replace(/\s+/g, ' ').trim();
  };
  lines.forEach((l, li) => {
    if (li < (firstRow < 0 ? lines.length : firstRow)) return;
    // The tables at the end ("DEPOSITS, DIVIDENDS AND OTHER CREDITS", "CHECKS CLEARED") list the same transactions again, without descriptions.
    if (/^(deposits,? dividends and other credits|withdrawals,? fees and other debits|checks cleared)\b/i.test(l.text)) inSummary = true;
    else if (inSummary && (/acct\s*#/i.test(l.text) || /^account statement$/i.test(l.text))) inSummary = false;
    if (inSummary) return;
    const d1 = matchDate(l.text, order);
    if (!d1 && rows.length && lastLi === li - 1 && contN < 2 && l.text.length <= 140 && !l.tokens.some((t) => parseAmt(t.str)) && !CONT_STOP.test(l.text) && !SKIP.test(l.text)) {
      appendCont(rows[rows.length - 1], l.text); lastLi = li; contN++; return;
    }
    if (!d1) {
      if (/(beginning|opening|previous|starting)\s+balance/i.test(l.text)) { const a = l.tokens.map((t) => parseAmt(t.str)).filter(Boolean); if (a.length && opening === null) opening = a[a.length - 1].v * (a[a.length - 1].neg ? -1 : 1); }
      return;
    }
    let consumed = d1.len, rest = l.text.slice(consumed).replace(/^\s+/, ''); consumed = l.text.length - rest.length;
    const d2 = matchDate(rest, order);
    if (d2 && !/^\d/.test(rest.slice(d2.len).trim())) { rest = rest.slice(d2.len).replace(/^\s+/, ''); consumed = l.text.length - rest.length; }
    // tokens after the date(s)
    let off = 0; const toks = [];
    l.tokens.forEach((t) => { if (off >= consumed) toks.push(t); off += t.str.length + 1; });
    const amts = [], desc = [];
    toks.forEach((t, i) => {
      const a = parseAmt(t.str);
      if (a) amts.push({ ...a, x: (t.x + t.x2) / 2 });
      else if (CRDR.test(t.str) && amts.length && i > 0) { const last = amts[amts.length - 1]; if (/^cr$/i.test(t.str)) last.cr = true; else last.dr = true; }
      else desc.push(t.str);
    });
    // trailing CR/DR glued to an amount token ("300.00 CR" as one run)
    toks.forEach((t) => { const m = new RegExp('^(.*?)(\\(?-?\\$?\\s?' + NUM + '\\)?-?)\\s*(CR|DR)$', 'i').exec(t.str); if (m && !AMT.test(t.str)) { const a = parseAmt(m[2]); if (a) { a[m[3].toLowerCase()] = true; amts.push({ ...a, x: (t.x + t.x2) / 2 }); const ix = desc.indexOf(t.str); if (ix > -1) { if (m[1].trim()) desc[ix] = m[1].trim(); else desc.splice(ix, 1); } } } });
    const name = desc.join(' ').replace(/\s+/g, ' ').trim();
    if (/^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d{1,2}\s*)+$/i.test(name)) return;   // a row made only of dates is an index table, not a transaction
    if (!amts.length || !name || SKIP.test(name)) { if (amts.length && name && SKIP.test(name)) meta.skipped++; return; }

    let amt = null, balance = null, sign = 0, certain = true;
    if (cols) {
      const classify = (a) => { let best = null, bd = Infinity; Object.keys(cols).forEach((k) => { const dd = Math.abs(a.x - cols[k]); if (dd < bd) { bd = dd; best = k; } }); return best; };
      amts.forEach((a) => { const c = classify(a); if (c === 'balance') balance = a.v * (a.neg ? -1 : 1); else if (!amt) { amt = a; sign = (a.neg || a.dr) ? -1 : c === 'debit' ? -1 : 1; } });   // an explicit minus sign beats column position
      if (!amt) return;
    } else if (meta.type === 'credit') {
      amt = amts[amts.length - 1]; sign = (amt.neg || amt.cr) ? 1 : -1;
    } else {
      if (amts.length >= 2) { amt = amts[amts.length - 2]; balance = amts[amts.length - 1].v * (amts[amts.length - 1].neg ? -1 : 1); } else amt = amts[0];
      if (amt.neg || amt.dr) { sign = -1; sawExplicitNeg = true; } else if (amt.cr) sign = 1; else sign = 0;
    }
    const y = pickYear(d1, meta.period, fallbackYear);
    rows.push({ date: iso(y, d1.m, d1.d), name, amount: sign * amt.v, abs: amt.v, sign, balance, uncertain: false });
    lastLi = li; contN = 0;
  });

  // checking statements without a debit/credit column: resolve unsigned amounts
  if (meta.type === 'checking' && !cols) {
    const unknown = rows.filter((r) => r.sign === 0);
    if (unknown.length) {
      if (sawExplicitNeg) { unknown.forEach((r) => { r.sign = 1; }); meta.mode = 'signed'; }
      else {
        const withBal = rows.filter((r) => r.balance !== null);
        let dir = 0;
        if (withBal.length >= Math.max(2, rows.length * 0.6)) {
          const prev = (i) => (i === 0 ? opening : rows[i - 1].balance), next = (i) => (i === rows.length - 1 ? opening : rows[i + 1].balance);
          let fwd = 0, rev = 0;
          rows.forEach((r, i) => {
            const p = prev(i), n = next(i);
            if (r.balance !== null && p !== null && p !== undefined && Math.abs(Math.abs(r.balance - p) - r.abs) < 0.011) fwd++;
            if (r.balance !== null && n !== null && n !== undefined && Math.abs(Math.abs(r.balance - n) - r.abs) < 0.011) rev++;
          });
          if (Math.max(fwd, rev) >= rows.length * 0.5) dir = fwd >= rev ? 1 : -1;
        }
        if (dir) meta.mode = 'balance';
        rows.forEach((r, i) => {
          if (r.sign !== 0) return;
          if (dir) {
            const other = dir === 1 ? (i === 0 ? opening : rows[i - 1].balance) : (i === rows.length - 1 ? opening : rows[i + 1].balance);
            if (other !== null && other !== undefined && r.balance !== null && Math.abs(Math.abs(r.balance - other) - r.abs) < 0.011) { r.sign = r.balance - other > 0 ? 1 : -1; return; }
          }
          r.sign = INFLOW.test(r.name) ? 1 : -1; r.uncertain = true; meta.mode = meta.mode === 'balance' ? 'balance' : 'keywords';
        });
      }
      rows.forEach((r) => { r.amount = r.sign * r.abs; });
    }
  }
  const OWN = /\b(transfer|xfer)\b.*\b(to|from)\b.*\b(checking|savings|share|money market)\b/i;
  rows.forEach((r) => { delete r.sign; delete r.balance; r.name = tidy(r.name); r.amount = Math.round(r.amount * 100) / 100; delete r.abs; if (OWN.test(r.name)) r.transfer = true; });
  meta.rows = rows.length;
  return { rows, meta };
}

function maskText(text) {
  return text
    .replace(/\b(?:\d[ -]?){12,19}\b/g, (m) => '****' + m.replace(/\D/g, '').slice(-4))
    .replace(/\b\d{6,}\b/g, (m) => '****' + m.slice(-4));
}

async function parsePdf(data, opts = {}) {
  const pages = await extractPages(data);
  const count = pages.reduce((n, p) => n + p.length, 0);
  const lines = buildLines(pages);
  const text = lines.map((l) => l.text).join('\n');
  if (!count) return { rows: [], meta: { pages: pages.length, noText: true, type: opts.type || 'checking', mode: 'none', rows: 0 }, text: '', lines: [] };
  const r = parseStatement(lines, opts);
  r.meta.pages = pages.length;
  r.text = text;
  r.lines = lines.map((l) => l.text);
  return r;
}

module.exports = { extractPages, buildLines, parseStatement, parsePdf, maskText, parseAmt, matchDate };
