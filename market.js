// Stock and fund prices for the Investments tab. Runs in the Electron main process (no browser CORS limits).
// Sources are free and need no account: Yahoo Finance's public chart endpoint, with Stooq end-of-day data as a fallback.
// Both are unofficial or delayed feeds, so treat the numbers as informational.
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SYMBOL = /^[A-Za-z0-9.\-^=]{1,15}$/;

const dayKey = (ms, offsetSec) => new Date(ms + (offsetSec || 0) * 1000).toISOString().slice(0, 10);
const r4 = (n) => Math.round(n * 10000) / 10000;

function normalizeYahoo(sym, res) {
  const meta = res.meta || {};
  const ts = res.timestamp || [];
  const cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const closes = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] && typeof cl[i] === 'number' && isFinite(cl[i]) && cl[i] > 0) closes.push([ts[i] * 1000, r4(cl[i])]);
  const rm = typeof meta.regularMarketPrice === 'number' && isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0 ? meta.regularMarketPrice : null;
  if (!closes.length && rm === null) throw new Error('no price data');
  const price = rm !== null ? rm : closes[closes.length - 1][1];
  const rmMs = (meta.regularMarketTime || ts[ts.length - 1] || 0) * 1000;
  const off = meta.gmtoffset || 0;
  let prev = closes.length ? closes[closes.length - 1][1] : price;
  if (closes.length >= 2 && dayKey(closes[closes.length - 1][0], off) === dayKey(rmMs, off)) prev = closes[closes.length - 2][1]; // last bar is today's
  if (rmMs && (!closes.length || dayKey(closes[closes.length - 1][0], off) < dayKey(rmMs, off))) closes.push([rmMs, r4(price)]);
  return { symbol: String(meta.symbol || sym).toUpperCase(), name: meta.longName || meta.shortName || sym, currency: meta.currency || 'USD', price: r4(price), prev: r4(prev), asOf: rmMs || (closes.length ? closes[closes.length - 1][0] : 0), closes, source: 'Yahoo Finance' };
}

function normalizeStooq(sym, text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 3 || !/^date,/i.test(lines[0])) throw new Error('no data');
  const closes = [];
  lines.slice(1).forEach((l) => {
    const c = l.split(',');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c[0]);
    const v = parseFloat(c[4]);
    if (m && isFinite(v) && v > 0) closes.push([Date.UTC(+m[1], +m[2] - 1, +m[3], 21), r4(v)]);
  });
  if (closes.length < 2) throw new Error('no data');
  const tail = closes.slice(-252);
  return { symbol: sym.toUpperCase(), name: sym.toUpperCase(), currency: 'USD', price: tail[tail.length - 1][1], prev: tail[tail.length - 2][1], asOf: tail[tail.length - 1][0], closes: tail, source: 'Stooq (end of day)' };
}

function createMarket({ fetchImpl } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  async function get(url, accept) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
    try {
      const res = await f(url, { headers: { 'user-agent': UA, accept }, signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function yahoo(sym) {
    const res = await get(YAHOO + encodeURIComponent(sym) + '?range=1y&interval=1d&includePrePost=false', 'application/json');
    const j = await res.json();
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (!r) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'symbol not found');
    return normalizeYahoo(sym, r);
  }
  async function stooq(sym) {
    const res = await get('https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym.toLowerCase()) + '.us&i=d', 'text/csv');
    return normalizeStooq(sym, await res.text());
  }
  async function quote(sym) {
    if (!SYMBOL.test(sym)) throw new Error('not a valid ticker symbol');
    let e1;
    try { return await yahoo(sym); } catch (e) { e1 = e; }
    try { return await stooq(sym); } catch (e2) { throw new Error('Could not get a price for ' + sym.toUpperCase() + ' (Yahoo: ' + (e1.message || e1) + '; Stooq: ' + (e2.message || e2) + ')'); }
  }
  async function quotes(symbols) {
    const out = {};
    const list = Array.from(new Set((symbols || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))).slice(0, 40);
    for (const s of list) {
      try { out[s] = await quote(s); } catch (e) { out[s] = { error: e.message }; }
    }
    return out;
  }
  return { quote, quotes };
}

module.exports = { createMarket, normalizeYahoo, normalizeStooq, SYMBOL };
