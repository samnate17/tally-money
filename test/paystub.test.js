'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePayStub, toNum } = require('../paystub');

// Synthetic ADP-style text (invented company and numbers): decimals and thousands separators come out as spaces.
const ADP = [
  'Earnings Statement',
  'EXAMPLE WIDGETS INC. Period Beginning: 03/01/2026',
  'Period Ending: 03/14/2026',
  'Pay Date: 03/13/2026',
  'rate salary/hours this period year to date',
  'Regular 2000 00 80 00 2 000 00 10 000 00',
  'Bonus 500 00',
  'Excluded from federal taxable wages',
  'Gross Pay $2 000 00 10 500 00 Er Medical 120 00',
  'Statutory',
  'Federal Income Tax -200 00 1 000 00',
  'Social Security Tax -124 00 620 00',
  'Medicare Tax -29 00 145 00',
  'Dental Plan -10 00* 50 00 Tot Work Hours 80 00',
  '401K Ee Contr -100 00* 500 00',
  'Safe Harbor 40 00 200 00',
  'Parking Credit +25 00',
  'Parking Credit -300 00',
  'Net Pay $1 562 00',
  'Net Check $0 00',
].join('\n');

test('toNum reads both styles', () => {
  assert.equal(toNum('3 451 50'), 3451.5);
  assert.equal(toNum('1,234.56'), 1234.56);
  assert.equal(toNum('80 00'), 80);
});

test('ADP layout: dates, totals, signed lines, credit, check', () => {
  const r = parsePayStub(ADP);
  assert.ok(r.stub);
  assert.equal(r.stub.payDate, '2026-03-13');
  assert.equal(r.stub.periodStart, '2026-03-01');
  assert.equal(r.stub.periodEnd, '2026-03-14');
  assert.equal(r.stub.gross, 2000);
  assert.equal(r.stub.net, 1562);
  assert.equal(r.stub.hours, 80);
  assert.equal(r.stub.ytdGross, 10500);
  assert.equal(r.checked, true);
  const by = (n) => r.stub.lines.find((l) => l.name === n);
  assert.equal(by('Federal Income Tax').section, 'tax');
  assert.equal(by('Dental Plan').section, 'benefit');
  assert.equal(by('401K Ee Contr').section, 'retirement');
  assert.equal(by('Parking Credit').section, 'other');
  assert.equal(by('Parking Credit').amount, 25);
  assert.equal(r.stub.lines.filter((l) => /Safe Harbor|Medical/.test(l.name)).length, 0); // employer-paid items are not deductions
});

test('standard 1,234.56 style also works and a bad total is flagged', () => {
  const t = ['Pay Date: 01/10/2026', 'Regular 1,000.00 1,000.00 5,000.00', 'Gross Pay $1,000.00 5,000.00', 'Federal Income Tax -100.00 500.00', 'Net Pay $850.00'].join('\n');
  const r = parsePayStub(t);
  assert.equal(r.stub.gross, 1000);
  assert.equal(r.checked, false); // 1000 - 100 != 850
  assert.match(r.notes, /add up/);
});

test('unknown layouts give no stub instead of guessing', () => {
  assert.equal(parsePayStub('hello world').stub, null);
  assert.equal(parsePayStub('').stub, null);
  assert.equal(parsePayStub('Pay Date: 01/01/2026 nothing else').stub, null);
});

test('no names or addresses in the output', () => {
  const r = parsePayStub('JANE EXAMPLE 1 MAIN ST\n' + ADP);
  assert.ok(!/JANE|MAIN ST/i.test(JSON.stringify(r)));
});
