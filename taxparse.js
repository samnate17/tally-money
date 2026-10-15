'use strict';
// Reads a W-2 from its text without any AI. W-2s come out of payroll sites in two shapes: the amount right after its box label
// ("1 Wages, tips, other compensation 70558.52") or on the line under the labels (the IRS layout, labels in one row and amounts in the next).
// The result is checked against rules every real W-2 follows (Social Security is 6.2% of box 3, Medicare is 1.45% of box 5), and
// the caller falls back to the AI reader when the check fails. Only dates, state code and dollar amounts are returned; never names, addresses, SSNs or EINs.

const MONEY = /(?:\$\s?)?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}|\d{1,3}(?:,\d{3})+|\d{1,7})(?![\d.])/g;
const MONEY_STRICT = /(?:\$\s?)?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}|\d{1,3}(?: \d{3})* \d{2}(?!\d))/g; // with cents only (space style for ADP-like text)

function num(s) {
  const t = String(s).replace(/[$,]/g, '').trim();
  if (/^\d+\.\d{2}$/.test(t)) return Math.round(parseFloat(t) * 100) / 100;
  const g = t.split(' ');
  if (g.length > 1 && /^\d{2}$/.test(g[g.length - 1])) { const c = g.pop(); return Math.round(parseFloat(g.join('') + '.' + c) * 100) / 100; }
  return Math.round(parseFloat(t.replace(/ /g, '')) * 100) / 100;
}

// Printed labels for each box (case-insensitive, tolerant of punctuation and line breaks).
const LABELS = [
  ['wages', /\b1\s+wages,?\s*tips,?\s*(?:and\s*)?other\s*comp(?:ensation)?/i],
  ['fedWithheld', /\b2\s+federal\s*income\s*tax\s*withheld/i],
  ['ssWages', /\b3\s+social\s*security\s*wages/i],
  ['ssWithheld', /\b4\s+social\s*security\s*tax\s*withheld/i],
  ['medicareWages', /\b5\s+medicare\s*wages(?:\s*and\s*tips)?/i],
  ['medicareWithheld', /\b6\s+medicare\s*tax\s*withheld/i],
  ['ssTips', /\b7\s+social\s*security\s*tips/i],
  ['allocTips', /\b8\s+allocated\s*tips/i],
  ['dependentCare', /\b10\s+dependent\s*care\s*benefits/i],
  ['nonqualified', /\b11\s+nonqualified\s*plans/i],
  ['stateWages', /\b16\s+state\s*wages,?\s*tips,?\s*etc\.?/i],
  ['stateWithheld', /\b17\s+state\s*income\s*tax/i],
  ['localWages', /\b18\s+local\s*wages,?\s*tips,?\s*etc\.?/i],
  ['localWithheld', /\b19\s+local\s*income\s*tax/i],
];
const MONEY_KEYS = LABELS.map((l) => l[0]);

// Box 12 codes that matter to a household budget.
const RETIRE_PRETAX = ['D', 'E', 'F', 'G', 'H', 'S']; // 401(k), 403(b), SEPP, 457(b), 501(c)(18)(D), SIMPLE
const RETIRE_ROTH = ['AA', 'BB'];
const BOX12_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', 'Z', 'AA', 'BB', 'DD', 'EE', 'FF', 'GG', 'HH'];

function moneyIn(s, strict) {
  const re = new RegExp((strict ? MONEY_STRICT : MONEY).source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(s))) out.push({ v: num(m[1]), i: m.index, end: m.index + m[0].length });
  return out;
}

function findYear(text) {
  const pats = [/\b(20\d{2})\s*(?:form\s*)?w-?2\b/i, /wage\s*and\s*tax\s*statement[^0-9]{0,20}(20\d{2})/i, /\b(?:tax\s*year|for\s*calendar\s*year|calendar\s*year)\s*:?\s*(20\d{2})/i, /\bform\s*w-?2\b[^0-9]{0,30}(20\d{2})/i];
  for (const p of pats) { const m = p.exec(text); if (m) { const y = +m[1]; if (y >= 1990 && y <= 2100) return y; } }
  return 0;
}

function parseW2(text) {
  const out = { forms: [], notes: '', checked: false };
  const raw = String(text || '');
  if (!/w-?2|wage\s*and\s*tax\s*statement/i.test(raw)) { out.notes = 'This does not look like a W-2.'; return out; }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const vals = {};
  // For every line, the labels it contains, in order of position.
  const hits = lines.map((l) => {
    const h = [];
    for (const [k, re] of LABELS) { const m = re.exec(l); if (m) h.push({ k, i: m.index, end: m.index + m[0].length }); }
    return h.sort((a, b) => a.i - b.i);
  });
  // Money that follows a label on its own line, before the next label, or on the next lines when the labels are a header row.
  const MAXV = 5e7;
  for (let li = 0; li < lines.length; li++) {
    const h = hits[li];
    if (!h.length) continue;
    const labelEndsAll = h.map((x) => x.end);
    // 1) same line, directly after each label
    const pending = [];
    h.forEach((x, n) => {
      const stop = n + 1 < h.length ? h[n + 1].i : lines[li].length;
      const seg = lines[li].slice(x.end, stop);
      // a box number is not an amount; drop leading "2" style box digits that belong to the next label (they sit after the stop)
      const mv = moneyIn(seg, true);
      if (mv.length) { if (vals[x.k] === undefined) vals[x.k] = mv[0].v; } else pending.push(x);
    });
    if (!pending.length) continue;
    // 2) header row: amounts on the next lines, left to right in label order. Use the first following line with amounts.
    for (let nj = li + 1; nj <= Math.min(li + 3, lines.length - 1); nj++) {
      if (hits[nj].length) break;
      const mv = moneyIn(lines[nj], true).filter((x) => x.v <= MAXV);
      if (!mv.length) continue;
      if (mv.length === h.length) { h.forEach((x, n) => { if (vals[x.k] === undefined) vals[x.k] = mv[n].v; }); }
      else if (mv.length === 1 && h.length >= 1 && pending.length === 1) { if (vals[pending[0].k] === undefined) vals[pending[0].k] = mv[0].v; }
      break;
    }
    void labelEndsAll;
  }

  // Box 12: pairs of "code amount" after the "12a ... See instructions for box 12" cell.
  const box12 = {}, seen12 = new Set();
  for (let li = 0; li < lines.length; li++) {
    if (!/box\s*12|\b12[a-d]\b/i.test(lines[li])) continue;
    for (let nj = li; nj <= Math.min(li + 4, lines.length - 1); nj++) {
      if (seen12.has(nj)) continue;
      seen12.add(nj);
      if (nj > li && /\b13\s+statutory|\b14\s+other|\b15\s+state|\b16\s+state/i.test(lines[nj])) break;
      const seg = lines[nj].replace(/^.*?(?:see\s*instructions?\s*for\s*box\s*12|\b12[a-d]\b)/i, '');
      const re = /\b(AA|BB|DD|EE|FF|GG|HH|[A-HJ-NP-TV-Z])\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}|\d{1,3}(?: \d{3})* \d{2})(?!\d)/g;
      let m;
      while ((m = re.exec(seg))) { if (BOX12_CODES.includes(m[1])) box12[m[1]] = (box12[m[1]] || 0) + num(m[2]); }
    }
  }

  // State code from box 15 ("State Employer's state ID number": two letters then the ID).
  let state = '';
  for (let li = 0; li < lines.length && !state; li++) {
    if (!/\b15\s+state\b/i.test(lines[li])) continue;
    for (let nj = li; nj <= Math.min(li + 2, lines.length - 1) && !state; nj++) {
      const m = /(?:^|\s)([A-Z]{2})\s+[A-Z0-9-]{4,}/.exec(lines[nj].replace(/^.*?employer'?s?\s*state\s*id\s*number/i, ''));
      if (m && /^(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/.test(m[1])) state = m[1];
    }
  }

  const g = (k) => (Number.isFinite(vals[k]) && vals[k] > 0 && vals[k] <= MAXV ? vals[k] : 0);
  if (!g('wages') && !g('medicareWages') && !g('fedWithheld')) { out.notes = 'Could not find the amounts on this W-2 with the built-in reader.'; return out; }

  const f = { form: 'W-2', year: findYear(raw), state };
  for (const k of ['wages', 'fedWithheld', 'ssWages', 'ssWithheld', 'medicareWages', 'medicareWithheld', 'stateWages', 'stateWithheld']) f[k] = g(k);
  const sum = (codes) => Math.round(codes.reduce((n, c) => n + (box12[c] || 0), 0) * 100) / 100;
  f.retire401k = sum(RETIRE_PRETAX);
  f.rothContrib = sum(RETIRE_ROTH);
  f.hsa = sum(['W']);
  f.healthCoverage = sum(['DD']);
  f.dependentCare = g('dependentCare');
  if (!f.year) { out.notes = 'Could not find the tax year on this W-2.'; return out; }

  // Rules every W-2 follows. Wrong boxes (a swapped column, a misread digit) break these.
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(1, b * tol);
  let ok = true;
  const why = [];
  if (f.ssWages && f.ssWithheld && !near(f.ssWithheld, f.ssWages * 0.062, 0.01)) { ok = false; why.push('Social Security tax is not 6.2% of box 3'); }
  if (f.medicareWages && f.medicareWithheld) {
    const base = f.medicareWages * 0.0145, extra = Math.max(0, f.medicareWages - 200000) * 0.009;
    if (!near(f.medicareWithheld, base, 0.01) && !near(f.medicareWithheld, base + extra, 0.01)) { ok = false; why.push('Medicare tax is not 1.45% of box 5'); }
  }
  if (f.wages && f.medicareWages && f.wages > f.medicareWages + 1) { ok = false; why.push('box 1 is larger than box 5'); }
  if (f.fedWithheld && f.wages && f.fedWithheld > f.wages) { ok = false; why.push('federal tax is larger than box 1'); }
  // Box 1 equals Medicare wages minus pre-tax retirement and section 125 benefits; when we know the retirement part, the gap should be at least that.
  if (f.wages && f.medicareWages && f.retire401k && f.medicareWages - f.wages + 1 < f.retire401k) { ok = false; why.push('box 1 is not lower than box 5 by the 401(k) amount'); }
  out.forms.push(f);
  out.checked = ok;
  out.notes = ok ? '' : 'Some amounts looked inconsistent (' + why.join('; ') + '), so check each box against your W-2.';
  return out;
}

module.exports = { parseW2, num, moneyIn, LABELS };
