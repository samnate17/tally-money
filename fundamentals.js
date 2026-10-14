'use strict';
// Company details for a holding: key statistics, financials, earnings, analyst opinions and a company profile.
// Source: Yahoo Finance's public (unofficial) quote-summary data, fetched from the Electron main process like the prices are. It needs a cookie and a
// "crumb" token that Yahoo hands out to anyone; both are requested here and kept in memory only. Nothing is sent about you, only the ticker symbol.
// It can break or be delayed without notice, so every section is optional and the app shows "not available" instead of failing.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SYMBOL = /^[A-Za-z0-9.\-^=]{1,15}$/;
const MODULES = ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'incomeStatementHistory', 'incomeStatementHistoryQuarterly', 'earningsHistory', 'calendarEvents', 'recommendationTrend', 'fundProfile', 'topHoldings'];
const CACHE_MS = 6 * 3600 * 1000;

const raw = (v) => (v && typeof v === 'object' ? (typeof v.raw === 'number' && isFinite(v.raw) ? v.raw : null) : (typeof v === 'number' && isFinite(v) ? v : null));
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n || 200) : '');
const day = (v) => { const r = raw(v); return r ? new Date(r * 1000).toISOString().slice(0, 10) : ''; };
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function normalizeSummary(sym, res) {
  const r = res || {};
  const price = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const type = str(price.quoteType, 20).toUpperCase();
  const isFund = type === 'ETF' || type === 'MUTUALFUND' || !!r.fundProfile;
  const out = {
    symbol: String(sym).toUpperCase(), name: str(price.longName || price.shortName, 120), type: isFund ? 'fund' : 'stock', exchange: str(price.exchangeName, 40), currency: str(price.currency, 6) || 'USD',
    stats: {
      marketCap: raw(price.marketCap) || raw(sd.marketCap), pe: raw(sd.trailingPE), forwardPe: raw(sd.forwardPE), eps: raw(ks.trailingEps), forwardEps: raw(ks.forwardEps), beta: raw(sd.beta) || raw(ks.beta),
      dividendYield: raw(sd.dividendYield) || raw(sd.trailingAnnualDividendYield), dividendRate: raw(sd.dividendRate), exDividend: day(sd.exDividendDate), payoutRatio: raw(sd.payoutRatio),
      open: raw(sd.open), previousClose: raw(sd.previousClose), dayLow: raw(sd.dayLow), dayHigh: raw(sd.dayHigh), low52: raw(sd.fiftyTwoWeekLow), high52: raw(sd.fiftyTwoWeekHigh),
      volume: raw(sd.volume), avgVolume: raw(sd.averageVolume), priceToBook: raw(ks.priceToBook), sharesOutstanding: raw(ks.sharesOutstanding), shortPercent: raw(ks.shortPercentOfFloat),
      expenseRatio: raw(sd.annualReportExpenseRatio) || raw(r.fundProfile && r.fundProfile.feesExpensesInvestment && r.fundProfile.feesExpensesInvestment.annualReportExpenseRatio), totalAssets: raw(sd.totalAssets),
      ytdReturn: raw(sd.ytdReturn),
    },
    financials: {
      revenue: raw(fd.totalRevenue), revenueGrowth: raw(fd.revenueGrowth), grossProfit: raw(fd.grossProfits), grossMargin: raw(fd.grossMargins), operatingMargin: raw(fd.operatingMargins), profitMargin: raw(fd.profitMargins) || raw(ks.profitMargins),
      ebitda: raw(fd.ebitda), freeCashflow: raw(fd.freeCashflow), cash: raw(fd.totalCash), debt: raw(fd.totalDebt), debtToEquity: raw(fd.debtToEquity), roe: raw(fd.returnOnEquity), earningsGrowth: raw(fd.earningsGrowth),
      annual: [], quarterly: [],
    },
    earnings: { next: '', nextEpsEstimate: null, history: [] },
    analysts: { count: raw(fd.numberOfAnalystOpinions) || 0, key: str(fd.recommendationKey, 20), mean: raw(fd.recommendationMean), target: { mean: raw(fd.targetMeanPrice), median: raw(fd.targetMedianPrice), high: raw(fd.targetHighPrice), low: raw(fd.targetLowPrice) }, current: null, trend: null, price: raw(fd.currentPrice) },
    about: { summary: str(ap.longBusinessSummary, 1600), sector: str(ap.sector, 60), industry: str(ap.industry, 80), employees: num(ap.fullTimeEmployees), city: str(ap.city, 60), state: str(ap.state, 40), country: str(ap.country, 60), website: /^https?:\/\//i.test(ap.website || '') ? str(ap.website, 120) : '', officers: [] },
    fund: { category: str(r.fundProfile && r.fundProfile.categoryName, 80), family: str(r.fundProfile && r.fundProfile.family, 80), holdings: [] },
  };
  const stmt = (obj, key) => (obj && Array.isArray(obj[key]) ? obj[key] : []);
  const row = (x) => ({ end: day(x.endDate), revenue: raw(x.totalRevenue), gross: raw(x.grossProfit), operating: raw(x.operatingIncome), net: raw(x.netIncome) });
  out.financials.annual = stmt(r.incomeStatementHistory, 'incomeStatementHistory').map(row).filter((x) => x.end).sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 4);
  out.financials.quarterly = stmt(r.incomeStatementHistoryQuarterly, 'incomeStatementHistory').map(row).filter((x) => x.end).sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 4);
  out.earnings.history = stmt(r.earningsHistory, 'history').map((x) => ({ quarter: day(x.quarter), actual: raw(x.epsActual), estimate: raw(x.epsEstimate), surprise: raw(x.surprisePercent) })).filter((x) => x.quarter && x.actual !== null).sort((a, b) => (a.quarter < b.quarter ? 1 : -1)).slice(0, 4);
  const ce = r.calendarEvents && r.calendarEvents.earnings;
  if (ce) { const d = Array.isArray(ce.earningsDate) && ce.earningsDate.length ? day(ce.earningsDate[0]) : ''; out.earnings.next = d; out.earnings.nextEpsEstimate = raw(ce.earningsAverage); }
  const tr = stmt(r.recommendationTrend, 'trend'), cur = tr.filter((x) => x.period === '0m')[0] || tr[0];
  if (cur) { const t = { strongBuy: +cur.strongBuy || 0, buy: +cur.buy || 0, hold: +cur.hold || 0, sell: +cur.sell || 0, strongSell: +cur.strongSell || 0 }; t.total = t.strongBuy + t.buy + t.hold + t.sell + t.strongSell; if (t.total > 0) out.analysts.trend = t; }
  out.about.officers = (Array.isArray(ap.companyOfficers) ? ap.companyOfficers : []).map((o) => ({ name: str(o.name, 60), title: str(o.title, 80) })).filter((o) => o.name).slice(0, 3);
  out.fund.holdings = stmt(r.topHoldings, 'holdings').map((h) => ({ symbol: str(h.symbol, 15), name: str(h.holdingName, 80), pct: raw(h.holdingPercent) })).filter((h) => h.name && h.pct !== null).slice(0, 10);
  const has = (o) => Object.keys(o).some((k) => o[k] !== null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length));
  out.empty = !has(out.stats) && !has(out.financials) && !out.about.summary && !out.analysts.trend && !out.earnings.history.length;
  return out;
}

function createFundamentals({ fetchImpl, now } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const clock = now || (() => Date.now());
  let session = null;                       // { cookie, crumb, at }
  const cache = new Map();                  // symbol -> { at, data }

  async function get(url, headers) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
    try { return await f(url, { headers: Object.assign({ 'user-agent': UA, accept: '*/*' }, headers || {}), signal: ctl ? ctl.signal : undefined }); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function login() {
    const r1 = await get('https://fc.yahoo.com/', {});
    let list = [];
    if (r1.headers && typeof r1.headers.getSetCookie === 'function') list = r1.headers.getSetCookie();
    else if (r1.headers && r1.headers.get && r1.headers.get('set-cookie')) list = [r1.headers.get('set-cookie')];
    const cookie = list.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
    if (!cookie) throw new Error('Yahoo did not hand out a session');
    const r2 = await get('https://query2.finance.yahoo.com/v1/test/getcrumb', { cookie });
    if (!r2.ok) throw new Error('Yahoo refused the session (' + r2.status + ')');
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 40 || /[<\s]/.test(crumb)) throw new Error('Yahoo returned no usable token');
    session = { cookie, crumb, at: clock() };
    return session;
  }
  async function summary(sym, retry) {
    if (!session || clock() - session.at > 30 * 60 * 1000) await login();
    const url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(sym) + '?modules=' + MODULES.join(',') + '&crumb=' + encodeURIComponent(session.crumb);
    const res = await get(url, { cookie: session.cookie });
    if ((res.status === 401 || res.status === 403) && !retry) { session = null; return summary(sym, true); }
    if (!res.ok) throw new Error(res.status === 404 ? 'No company details for ' + sym : 'Yahoo returned ' + res.status);
    const j = await res.json();
    const result = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if (!result) throw new Error((j && j.quoteSummary && j.quoteSummary.error && j.quoteSummary.error.description) || 'No company details for ' + sym);
    return result;
  }
  async function details(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!SYMBOL.test(sym)) throw new Error('not a valid ticker symbol');
    const hit = cache.get(sym);
    if (hit && clock() - hit.at < CACHE_MS) return hit.data;
    const data = normalizeSummary(sym, await summary(sym));
    data.fetched = clock();
    cache.set(sym, { at: clock(), data });
    return data;
  }
  return { details };
}

module.exports = { createFundamentals, normalizeSummary, MODULES };
