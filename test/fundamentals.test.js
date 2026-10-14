const test = require('node:test');
const assert = require('node:assert');
const { createFundamentals, normalizeSummary } = require('../fundamentals');

const R = (v) => ({ raw: v });
const ts = (d) => Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000);
const FIXTURE = {
  price: { longName: 'RUM Group', quoteType: 'EQUITY', exchangeName: 'NasdaqCM', currency: 'USD', marketCap: R(2.68e9) },
  summaryDetail: { trailingPE: R(30.5), dividendYield: R(0.012), fiftyTwoWeekLow: R(5), fiftyTwoWeekHigh: R(14), averageVolume: R(1200000), beta: R(1.4), exDividendDate: R(ts('2026-08-01')) },
  defaultKeyStatistics: { trailingEps: R(-0.4), profitMargins: R(-1.2) },
  financialData: { totalRevenue: R(117.66e6), revenueGrowth: R(0.1304), grossProfits: R(-18.69e6), targetMeanPrice: R(11), targetHighPrice: R(14), targetLowPrice: R(8), recommendationKey: 'buy', recommendationMean: R(2.0), numberOfAnalystOpinions: R(4), currentPrice: R(6.71) },
  assetProfile: { longBusinessSummary: 'A video   platform.', sector: 'Communication Services', industry: 'Internet Content', fullTimeEmployees: 135, city: 'Longboat Key', state: 'FL', website: 'https://example.com', companyOfficers: [{ name: 'Chris P', title: 'CEO' }] },
  incomeStatementHistory: { incomeStatementHistory: [{ endDate: R(ts('2024-12-31')), totalRevenue: R(95.49e6), netIncome: R(-338.4e6) }, { endDate: R(ts('2023-12-31')), totalRevenue: R(80.96e6), netIncome: R(-116.4e6) }] },
  incomeStatementHistoryQuarterly: { incomeStatementHistory: [{ endDate: R(ts('2026-03-31')), totalRevenue: R(30e6), netIncome: R(-20e6) }] },
  earningsHistory: { history: [{ quarter: R(ts('2025-12-31')), epsActual: R(-0.13), epsEstimate: R(-0.13), surprisePercent: R(0) }, { quarter: R(ts('2026-03-31')), epsActual: R(-0.12), epsEstimate: R(-0.09), surprisePercent: R(-0.33) }, { quarter: R(ts('2026-06-30')), epsActual: {}, epsEstimate: R(-0.1) }] },
  calendarEvents: { earnings: { earningsDate: [R(ts('2026-11-09'))], earningsAverage: R(-0.12) } },
  recommendationTrend: { trend: [{ period: '-1m', strongBuy: 0, buy: 1, hold: 3, sell: 0, strongSell: 0 }, { period: '0m', strongBuy: 1, buy: 2, hold: 1, sell: 0, strongSell: 0 }] },
};

test('fundamentals: a Yahoo quote summary is normalised into the sections the app shows', () => {
  const d = normalizeSummary('rum', FIXTURE);
  assert.strictEqual(d.symbol, 'RUM'); assert.strictEqual(d.type, 'stock'); assert.strictEqual(d.name, 'RUM Group');
  assert.strictEqual(d.stats.marketCap, 2.68e9); assert.strictEqual(d.stats.pe, 30.5); assert.strictEqual(d.stats.exDividend, '2026-08-01');
  assert.strictEqual(d.financials.revenue, 117.66e6); assert.strictEqual(d.financials.annual[0].end, '2024-12-31'); assert.strictEqual(d.financials.annual[1].net, -116.4e6);
  assert.deepStrictEqual(d.earnings.history.map((x) => [x.quarter, x.actual, x.estimate]), [['2026-03-31', -0.12, -0.09], ['2025-12-31', -0.13, -0.13]]);   // an unreported quarter is not an earnings result
  assert.deepStrictEqual([d.earnings.next, d.earnings.nextEpsEstimate], ['2026-11-09', -0.12]);
  assert.deepStrictEqual([d.analysts.count, d.analysts.mean, d.analysts.target.mean, d.analysts.trend.total, d.analysts.trend.buy], [4, 2, 11, 4, 2]);
  assert.strictEqual(d.about.summary, 'A video platform.'); assert.strictEqual(d.about.officers[0].title, 'CEO'); assert.strictEqual(d.about.employees, 135);
  assert.strictEqual(d.empty, false);
});

test('fundamentals: hostile or empty data does not break the page', () => {
  assert.strictEqual(normalizeSummary('x', {}).empty, true);
  const d = normalizeSummary('x', { assetProfile: { website: 'javascript:alert(1)', longBusinessSummary: 5 }, price: { quoteType: 'ETF' } });
  assert.strictEqual(d.about.website, ''); assert.strictEqual(d.about.summary, ''); assert.strictEqual(d.type, 'fund');
});

test('fundamentals: session is created, the summary is cached, and a rejected crumb is retried once', async () => {
  const calls = [];
  let crumbs = 0;
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (/fc\.yahoo\.com/.test(url)) return { ok: true, status: 404, headers: { getSetCookie: () => ['A3=abc; Path=/; Domain=.yahoo.com'] } };
    if (/getcrumb/.test(url)) { crumbs++; const c = 'crumb' + crumbs; return { ok: true, status: 200, text: async () => c }; }
    if (/quoteSummary/.test(url)) {
      if (/crumb=crumb1\b/.test(url)) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ quoteSummary: { result: [FIXTURE] } }) };
    }
    throw new Error('unexpected ' + url);
  };
  const F = createFundamentals({ fetchImpl });
  const d = await F.details('rum');
  assert.strictEqual(d.name, 'RUM Group');
  assert.strictEqual(crumbs, 2);                                   // the first crumb was rejected, a new one was fetched
  const n = calls.length;
  await F.details('RUM');
  assert.strictEqual(calls.length, n);                             // second request comes from the cache
  await assert.rejects(() => F.details('bad symbol!'), /valid ticker/);
});
