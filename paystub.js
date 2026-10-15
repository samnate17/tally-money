'use strict';
// Reads an earnings statement (pay stub) from its text without any AI: labelled lines, signed deductions and an arithmetic check.
// Built around ADP's layout, where the period dot and thousands comma often come out as spaces ("3 451 50" is 3,451.50).
// It never returns personal names, addresses or account numbers; only dates, labels, amounts and the employer's business name (so several jobs can be told apart). When a layout is not recognised it returns no stub
// and the caller falls back to the AI reader (if a key is saved) or to typing the numbers in.

const SECTIONS = ['earnings', 'tax', 'benefit', 'retirement', 'deduction', 'other'];

// Money in either style: "1,234.56" / "-12.34" or the space style "1 234 56" (cents are always the last two-digit group).
const MONEY_RE = /([-+]?)\s?\$?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}|\d{1,4}(?: \d{3})* \d{2}(?!\d))(?!\d)/g;

function toNum(s) {
  const t = String(s).replace(/,/g, '');
  if (/^\d+\.\d{2}$/.test(t)) return Math.round(parseFloat(t) * 100) / 100;
  const g = t.split(' ');
  const cents = g.pop();
  return Math.round(parseFloat(g.join('') + '.' + cents) * 100) / 100;
}

// All money amounts on a line, in order, with the label text that comes before the first one.
function moneyOnLine(line) {
  const out = [];
  let first = -1, m;
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(line))) {
    if (first < 0) first = m.index;
    out.push({ sign: m[1], v: toNum(m[2]) });
  }
  return { label: (first < 0 ? line : line.slice(0, first)).replace(/[$*:]+/g, ' ').replace(/\s+/g, ' ').trim(), nums: out };
}

// The right-hand column of an ADP statement (employer-paid items, accruals, hours) shares lines with the left; cut it off.
const RIGHT_COL = /\s(?:Er\s|Employer\b|Gtl\b|Max Elig|Safe Harbor|Tot Work|Totl Hrs|Vacation Accru|Sick Accru|PTO Accru|YOUR COMPANY)/i;
function leftOf(line) {
  const m = RIGHT_COL.exec(line);
  return m ? line.slice(0, m.index) : line;
}

function isoFrom(s) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
  if (!m) return '';
  const mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[3] + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function dateAfter(text, label) {
  const m = new RegExp(label + '\\s*:?\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4})', 'i').exec(text);
  return m ? isoFrom(m[1]) : '';
}

function sectionOf(name) {
  const n = String(name).toLowerCase();
  if (/\b(401|403|457)|roth|retire|pension|\bira\b|simple plan/.test(n)) return 'retirement';
  if (/federal|fed\b|social security|\bfica\b|medicare|\bstate\b|\blocal\b|\bsdi\b|\bsui\b|\bfli\b|\bpfl\b|family leave|withholding|\bwithhold|\btax\b|\bpaid leave/.test(n)) return 'tax';
  if (/medical|health|dental|vision|\bhsa\b|\bfsa\b|commuter|\blife\b|\bltd\b|\bstd\b|disability|\bhmo\b|\bppo\b|insurance|cigna|aetna|delta|kaiser|anthem|humana|supplemental/.test(n)) return 'benefit';
  return 'deduction';
}

const EARN_RE = /^(regular|reg\b|overtime|ot\b|double|bonus|holiday|retro|vacation|sick|pto|personal|commission|salary|wages|hourly|shift|differential|on.?call|stipend|severance|gift card|tips?|piece|per diem|reimb|floating|bereavement|jury|holiday|float)/i;

function cleanName(s) {
  return String(s).replace(/[<>"]/g, '').replace(/[^A-Za-z0-9&()'%\/. +-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// The employer's name: on ADP layouts it is the left column of the line that carries "Period Beginning"; else a labelled "Employer:" / "Company:" line.
function employerOf(lines) {
  let cand = '';
  const i = lines.findIndex((l) => /Period\s+Beginning/i.test(l));
  if (i >= 0) cand = lines[i].split(/Period\s+Beginning/i)[0];
  if (!cand.trim()) for (const l of lines) { const m = /^(?:Employer|Company)(?:\s+Name)?\s*:\s*(.+)$/i.exec(l); if (m) { cand = m[1]; break; } }
  cand = cleanName(cand.replace(/\d{3}[-. ]\d{3}[-. ]\d{4}/g, ' '));
  if (cand.length < 3 || /\d{4,}/.test(cand) || /earnings|statement|pay date|period|employee/i.test(cand)) return '';
  return cand.slice(0, 60);
}

function parsePayStub(text) {
  const out = { stub: null, notes: '', checked: false };
  const raw = String(text || '');
  if (!raw.trim()) { out.notes = 'There is no text to read in this file.'; return out; }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const payDate = dateAfter(raw, 'Pay Date') || dateAfter(raw, 'Check Date') || dateAfter(raw, 'Payment Date');
  const periodStart = dateAfter(raw, 'Period Beginning') || dateAfter(raw, 'Period Start');
  const periodEnd = dateAfter(raw, 'Period Ending') || dateAfter(raw, 'Period End');

  const gi = lines.findIndex((l) => /\bGross Pay\b/i.test(l));
  const ni = lines.findIndex((l, i) => i > gi && /\bNet Pay\b/i.test(l));
  if (!payDate || gi < 0 || ni < 0) { out.notes = 'This layout is not one the built-in reader knows.'; return out; }

  const gm = moneyOnLine(leftOf(lines[gi]).replace(/^.*?Gross Pay/i, 'Gross Pay'));
  const nm = moneyOnLine(leftOf(lines[ni]).replace(/^.*?Net Pay/i, 'Net Pay'));
  if (!gm.nums.length || !nm.nums.length) { out.notes = 'Could not read the gross or net pay amounts.'; return out; }
  const gross = gm.nums[0].v, net = nm.nums[0].v;
  const ytdGross = gm.nums[1] ? gm.nums[1].v : 0;
  if (!(gross > 0) || net < 0 || net > gross * 1.5) { out.notes = 'The gross and net amounts did not look right.'; return out; }

  const items = [], ytdOnly = [];
  let hours = 0;

  // Earnings: lines above Gross Pay with a pay-type label. Rate/hours/amount/year-to-date columns come in that order; a lone number is year-to-date only.
  for (let i = 0; i < gi; i++) {
    const l = leftOf(lines[i]);
    if (/taxable|excluded|exemption|filing|withholding table/i.test(l)) continue;
    const r = moneyOnLine(l);
    if (!r.nums.length || !EARN_RE.test(r.label)) continue;
    const n = r.nums;
    let amount = 0, ytd = 0;
    if (n.length >= 3) { amount = n[n.length - 2].v; ytd = n[n.length - 1].v; if (n.length >= 4 && n[1].v > 0 && n[1].v <= 400 && !hours) hours = n[1].v; }
    else if (n.length === 2) { amount = n[0].v; ytd = n[1].v; }
    else if (n.length === 1) ytdOnly.push({ name: cleanName(r.label), ytd: n[0].v });   // a lone number is the year-to-date figure (a bonus or holiday paid earlier in the year)
    if (amount > 0) items.push({ section: 'earnings', name: cleanName(r.label), amount, ytd });
  }

  // Between Gross Pay and Net Pay: signed amounts. "-" is taken out, "+" is a credit added to take-home; unsigned numbers are memo or year-to-date only.
  const singles = [];
  for (let i = gi + 1; i < ni; i++) {
    const l = leftOf(lines[i]);
    if (/^\s*(statutory|excluded|your federal|other benefits|rate|exemptions|federal:|basis of pay)/i.test(l)) continue;
    const r = moneyOnLine(l);
    if (!r.nums.length || !/[A-Za-z]/.test(r.label) || /^(er|employer)\b/i.test(r.label)) continue;
    const a = r.nums[0];
    if (a.sign !== '-' && a.sign !== '+') continue;
    const name = cleanName(r.label);
    if (!name) continue;
    if (a.sign === '+') { items.push({ section: 'other', name, amount: a.v, ytd: r.nums[1] ? r.nums[1].v : 0, credit: true }); continue; }
    if (r.nums.length >= 2) items.push({ section: sectionOf(name), name, amount: a.v, ytd: r.nums[1].v });
    else singles.push({ section: sectionOf(name), name, amount: a.v, ytd: 0 });
  }

  const taken = () => items.filter((x) => x.section !== 'earnings' && !x.credit).reduce((s, x) => s + x.amount, 0);
  const credits = () => items.filter((x) => x.credit).reduce((s, x) => s + x.amount, 0);
  const gap = () => Math.round((gross - taken() + credits() - net) * 100) / 100;
  // A lone signed number is usually a year-to-date figure; include one (or two) only when that is exactly what closes the gap.
  if (Math.abs(gap()) > 0.01 && singles.length) {
    const d = gap();
    const hit = singles.find((s) => Math.abs(s.amount - d) < 0.01);
    if (hit) items.push(hit);
    else {
      outer: for (let a = 0; a < singles.length; a++) for (let b = a + 1; b < singles.length; b++) {
        if (Math.abs(singles[a].amount + singles[b].amount - d) < 0.01) { items.push(singles[a], singles[b]); break outer; }
      }
    }
  }

  // Hours: the statement's own total if it has one, else the earnings column.
  const hm = /(?:Tot(?:al)?\s*Work\s*Hours|Totl\s*Hrs\s*Worked)\s+(\d+(?: \d{2}|\.\d{2}))/i.exec(raw);
  if (hm) hours = toNum(hm[1]);

  const stub = { payDate, gross, net, lines: [] };
  // A check whose only earnings are a bonus (or similar) is not part of the regular pay cycle.
  const earn = items.filter((x) => x.section === 'earnings');
  const REG = /regular|salary|hourly|wage|base pay|straight|overtime|holiday|vacation|pto|sick|personal|float|bereavement|jury/i, BON = /bonus|commission|incentive|award|payout|spot|retention|signing|severance/i;
  stub.kind = earn.length && !earn.some((x) => REG.test(x.name)) && earn.some((x) => BON.test(x.name)) ? 'bonus' : 'regular';
  const emp = employerOf(lines);
  if (emp) stub.employer = emp;
  if (ytdOnly.length) stub.ytdLines = ytdOnly.slice(0, 20);
  if (periodStart) stub.periodStart = periodStart;
  if (periodEnd) stub.periodEnd = periodEnd;
  if (hours > 0 && hours <= 400) stub.hours = hours;
  if (ytdGross > 0) stub.ytdGross = ytdGross;
  for (const it of items) {
    const line = { section: SECTIONS.includes(it.section) ? it.section : 'other', name: it.name, amount: it.amount };
    if (it.ytd > 0) line.ytd = it.ytd;
    stub.lines.push(line);
  }
  out.stub = stub;
  out.checked = Math.abs(gap()) <= 0.01;
  out.notes = out.checked ? '' : 'The amounts did not add up exactly, so check each line against your statement.';
  return out;
}

module.exports = { parsePayStub, moneyOnLine, toNum, sectionOf, employerOf };
