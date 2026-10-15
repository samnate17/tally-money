'use strict';
// Past weather for the Energy tab, from Open-Meteo (free, no account, no key). Only a place name or postal code and a range of dates are sent; nothing about you,
// your accounts or your energy use. Daily average temperatures become heating and cooling degree days (how far each day was below or above 65 degrees F),
// added up per month, which is what energy use follows.
const BASE_F = 65;
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const iso = (d) => d.toISOString().slice(0, 10);

function cleanPlace(q) {
  const s = String(q == null ? '' : q).replace(/[^\p{L}\p{N} .,'\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : '';
}
// One query in, a short list of places out, so the page can show "Peterborough, New Hampshire" and let you choose.
function normalizePlaces(json) {
  const out = [];
  for (const r of (json && Array.isArray(json.results) ? json.results : []).slice(0, 6)) {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) continue;
    const region = [r.admin1, r.country_code].filter(Boolean).map((x) => String(x).slice(0, 40)).join(', ');
    out.push({ name: region ? name + ', ' + region : name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 });
  }
  return out;
}
// Daily mean temperatures (F) to per-month degree days. days = how many days of that month had a reading, so a part-finished month is not mistaken for a mild one.
function monthlyDegreeDays(json) {
  const d = json && json.daily;
  const times = d && Array.isArray(d.time) ? d.time : [], temps = d && Array.isArray(d.temperature_2m_mean) ? d.temperature_2m_mean : [];
  const months = {};
  for (let i = 0; i < times.length; i++) {
    const t = temps[i] == null || temps[i] === '' ? NaN : Number(temps[i]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(times[i] || '') || !Number.isFinite(t) || t < -90 || t > 140) continue;
    const k = times[i].slice(0, 7), m = months[k] || (months[k] = { hdd: 0, cdd: 0, sum: 0, days: 0 });
    m.hdd += Math.max(0, BASE_F - t); m.cdd += Math.max(0, t - BASE_F); m.sum += t; m.days++;
  }
  const out = {};
  for (const k of Object.keys(months).sort()) {
    const m = months[k];
    out[k] = { hdd: Math.round(m.hdd), cdd: Math.round(m.cdd), avgF: Math.round(m.sum / m.days * 10) / 10, days: m.days };
  }
  return out;
}
function createWeather({ fetchImpl, now } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const clock = now || (() => new Date());
  async function getJson(url) {
    let r;
    try { r = await f(url, { headers: { accept: 'application/json' } }); }
    catch (e) { throw new Error('Could not reach the weather service. Check your internet connection.'); }
    if (!r.ok) throw new Error('The weather service answered with an error (' + r.status + '). Try again later.');
    try { return await r.json(); } catch (e) { throw new Error('The weather service sent something unreadable.'); }
  }
  async function search(query) {
    const q = cleanPlace(query);
    if (!q) throw new Error('Type a town or a ZIP code.');
    const places = normalizePlaces(await getJson(GEO + '?name=' + encodeURIComponent(q) + '&count=6&language=en&format=json'));
    if (!places.length) throw new Error('No place found for "' + q + '". Try the town name with the state.');
    return places;
  }
  async function months(req) {
    const lat = Number(req && req.lat), lon = Number(req && req.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Choose a place first.');
    const today = clock(), last = new Date(today.getTime() - 3 * 864e5);       // the archive runs a couple of days behind
    let from = /^\d{4}-\d{2}-\d{2}$/.test(String(req && req.from)) ? String(req.from) : iso(new Date(today.getTime() - 3 * 365 * 864e5));
    const floor = iso(new Date(today.getTime() - 12 * 365 * 864e5));
    if (from < floor) from = floor;
    if (from > iso(last)) throw new Error('That date range has no past days yet.');
    const url = ARCHIVE + '?latitude=' + lat + '&longitude=' + lon + '&start_date=' + from + '&end_date=' + iso(last) + '&daily=temperature_2m_mean&temperature_unit=fahrenheit&timezone=auto';
    const data = monthlyDegreeDays(await getJson(url));
    if (!Object.keys(data).length) throw new Error('The weather service had no temperatures for that place and dates.');
    return { months: data, from, to: iso(last), base: BASE_F, fetched: iso(today) };
  }
  return { search, months };
}
module.exports = { createWeather, cleanPlace, normalizePlaces, monthlyDegreeDays, BASE_F };
