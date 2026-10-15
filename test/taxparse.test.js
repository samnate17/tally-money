'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseW2 } = require('../taxparse');

// Synthetic W-2 text (invented numbers). Shape A: amount right after its label. Shape B: labels in a row, amounts in the row below (IRS layout).
const SHAPE_A = [
  'Form W-2 Wage and Tax Statement 2025',
  '1 Wages, tips, other compensation 50000.00 2 Federal income tax withheld 5000.00',
  '3 Social security wages 52000.00 4 Social security tax withheld 3224.00',
  '5 Medicare wages and tips 52000.00 6 Medicare tax withheld 754.00',
  '7 Social security tips 8 Allocated tips',
  '12a See instructions for box 12 D 2000.00',
  '12b DD 6500.00',
  '12c W 500.00',
  '13 Statutory employee Retirement plan Third-party sick pay',
  '15 State Employer\'s state ID number VT 123-456',
  '16 State wages, tips, etc. 50000.00 17 State income tax 1800.00',
].join('\n');

const SHAPE_B = [
  'Wage and Tax Statement 2025 Copy B',
  '1 Wages, tips, other compensation 2 Federal income tax withheld',
  '50,000.00 5,000.00',
  '3 Social security wages 4 Social security tax withheld',
  '52,000.00 3,224.00',
  '5 Medicare wages and tips 6 Medicare tax withheld',
  '52,000.00 754.00',
  '12a See instructions for box 12',
  'D 2,000.00',
  '13 Statutory employee',
].join('\n');

test('shape A: boxes, box 12 codes, state', () => {
  const r = parseW2(SHAPE_A);
  assert.equal(r.forms.length, 1);
  const f = r.forms[0];
  assert.equal(f.year, 2025);
  assert.equal(f.wages, 50000); assert.equal(f.fedWithheld, 5000);
  assert.equal(f.ssWages, 52000); assert.equal(f.ssWithheld, 3224);
  assert.equal(f.medicareWages, 52000); assert.equal(f.medicareWithheld, 754);
  assert.equal(f.retire401k, 2000); assert.equal(f.healthCoverage, 6500); assert.equal(f.hsa, 500);
  assert.equal(f.state, 'VT'); assert.equal(f.stateWages, 50000); assert.equal(f.stateWithheld, 1800);
  assert.equal(r.checked, true);
});

test('shape B: labels in one row, amounts below', () => {
  const r = parseW2(SHAPE_B);
  const f = r.forms[0];
  assert.equal(f.wages, 50000); assert.equal(f.fedWithheld, 5000);
  assert.equal(f.ssWages, 52000); assert.equal(f.ssWithheld, 3224);
  assert.equal(f.medicareWages, 52000); assert.equal(f.medicareWithheld, 754);
  assert.equal(f.retire401k, 2000);
  assert.equal(r.checked, true);
});

test('a W-2 with no state boxes (no state income tax) still reads', () => {
  const r = parseW2(SHAPE_A.split('\n').filter((l) => !/^1[567] /.test(l)).join('\n'));
  assert.equal(r.forms[0].stateWithheld, 0);
  assert.equal(r.forms[0].wages, 50000);
});

test('inconsistent amounts are flagged, not trusted', () => {
  const r = parseW2(SHAPE_A.replace('3224.00', '3000.00'));
  assert.equal(r.checked, false);
  assert.match(r.notes, /6\.2%/);
});

test('not a W-2 or unreadable gives no form', () => {
  assert.equal(parseW2('hello').forms.length, 0);
  assert.equal(parseW2('Form W-2 something 2025 without boxes').forms.length, 0);
});

test('no personal details in the result', () => {
  const r = parseW2('JANE EXAMPLE 123-45-6789\n' + SHAPE_A);
  assert.ok(!/JANE|123-45/.test(JSON.stringify(r)));
});
