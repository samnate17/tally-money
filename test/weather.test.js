'use strict';
const test = require('node:test'), assert = require('node:assert');
const { createWeather, cleanPlace, normalizePlaces, monthlyDegreeDays } = require('../weather');

test('weather: place text is cleaned and results are reduced to name and coordinates', () => {
  assert.strictEqual(cleanPlace('  Peterborough <script>, NH  '), 'Peterborough script , NH'); assert.strictEqual(cleanPlace('Troy, NY'), 'Troy, NY');
  assert.strictEqual(cleanPlace('x'), ''); assert.strictEqual(cleanPlace(null), '');
  const p = normalizePlaces({ results: [{ name: 'Peterborough', latitude: 42.8776, longitude: -71.9501, admin1: 'New Hampshire', country_code: 'US', extra: 'x' }, { name: 'Bad', latitude: 999, longitude: 0 }, { latitude: 1, longitude: 1 }] });
  assert.deepStrictEqual(p, [{ name: 'Peterborough, New Hampshire, US', lat: 42.8776, lon: -71.9501 }]);
  assert.deepStrictEqual(normalizePlaces(null), []);
});
test('weather: daily temperatures become monthly degree days', () => {
  const m = monthlyDegreeDays({ daily: { time: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-02-01', 'bad', '2026-02-02'], temperature_2m_mean: [25, 35, 70, 80, 10, null] } });
  assert.deepStrictEqual(m['2026-01'], { hdd: 40 + 30 + 0, cdd: 5, avgF: 43.3, days: 3 });
  assert.deepStrictEqual(m['2026-02'], { hdd: 0, cdd: 15, avgF: 80, days: 1 });
  assert.deepStrictEqual(monthlyDegreeDays({}), {});
});
test('weather: search and months call the service with only a place and dates', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (/geocoding/.test(url)) return { ok: true, json: async () => ({ results: [{ name: 'Troy', latitude: 42.73, longitude: -73.69, admin1: 'New York', country_code: 'US' }] }) };
    return { ok: true, json: async () => ({ daily: { time: ['2026-09-01', '2026-09-02'], temperature_2m_mean: [60, 50] } }) };
  };
  const w = createWeather({ fetchImpl, now: () => new Date('2026-10-15T12:00:00Z') });
  const places = await w.search('12180');
  assert.match(urls[0], /name=12180/); assert.strictEqual(places[0].lat, 42.73);
  const r = await w.months({ lat: 42.73, lon: -73.69, from: '2026-09-01' });
  assert.match(urls[1], /latitude=42\.73&longitude=-73\.69&start_date=2026-09-01&end_date=2026-10-12&daily=temperature_2m_mean&temperature_unit=fahrenheit/);
  assert.deepStrictEqual(r.months['2026-09'], { hdd: 5 + 15, cdd: 0, avgF: 55, days: 2 }); assert.strictEqual(r.to, '2026-10-12');
  await assert.rejects(() => w.search('!'), /Type a town/); await assert.rejects(() => w.months({ lat: 'x', lon: 1 }), /Choose a place/);
  await assert.rejects(() => createWeather({ fetchImpl: async () => ({ ok: false, status: 500 }) }).search('Troy'), /error \(500\)/);
  await assert.rejects(() => createWeather({ fetchImpl: async () => { throw new Error('net'); } }).search('Troy'), /Could not reach/);
  await assert.rejects(() => createWeather({ fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }) }).search('Nowhere'), /No place found/);
});
