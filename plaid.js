// Plaid bank sync. Runs in the main process: the client ID, secret and bank access tokens
// are kept in the encrypted store and never sent to the page.
const BASES = { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' };

function mapAccountType(a) {
  const t = a.type, s = a.subtype || '';
  if (t === 'depository') return s === 'checking' ? 'checking' : /savings|money market|cd|hsa/.test(s) ? 'savings' : 'cash';
  if (t === 'credit') return 'credit';
  if (t === 'loan') return s === 'student' ? 'student' : s === 'mortgage' ? 'mortgage' : s === 'auto' ? 'auto' : 'loan';
  if (t === 'investment') return 'investment';
  return 'cash';
}

function mapCategory(primary, detailed) {
  switch (primary) {
    case 'FOOD_AND_DRINK': return /GROCERIES/.test(detailed) ? 'Groceries' : 'Dining';
    case 'TRANSPORTATION': return 'Transport';
    case 'RENT_AND_UTILITIES': return 'Housing';
    case 'HOME_IMPROVEMENT': return 'Housing';
    case 'GENERAL_MERCHANDISE': return 'Shopping';
    case 'MEDICAL': return 'Health';
    case 'PERSONAL_CARE': return 'Health';
    case 'ENTERTAINMENT': return 'Entertainment';
    case 'INCOME': return 'Income';
    case 'TRAVEL': return 'Other';
    case 'LOAN_PAYMENTS': return /MORTGAGE/.test(detailed) ? 'Housing' : /CAR/.test(detailed) ? 'Transport' : 'Other';
    default: return '';
  }
}

// Returns null for transactions that should not count as spending or income.
function normalizeTxn(t, accountType) {
  if (t.pending) return null;
  const pfc = t.personal_finance_category || {};
  const primary = pfc.primary || '', detailed = pfc.detailed || '';
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return null;
  if (/CREDIT_CARD_PAYMENT$/.test(detailed)) return null;
  const amount = Math.round(-t.amount * 100) / 100; // Plaid: positive means money out
  if ((accountType === 'credit' || accountType === 'loan') && amount > 0 && primary === 'LOAN_PAYMENTS') return null;
  return {
    plaidId: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    name: String(t.merchant_name || t.name || 'Transaction').slice(0, 120),
    amount,
    catHint: mapCategory(primary, detailed),
  };
}

function normalizeAccount(a) {
  const cur = a.balances && a.balances.current;
  return {
    accountId: a.account_id,
    name: String(a.name || a.official_name || 'Account').slice(0, 100),
    mask: a.mask || '',
    type: mapAccountType(a),
    balance: typeof cur === 'number' && isFinite(cur) ? Math.max(0, Math.round(cur * 100) / 100) : null,
  };
}

function createPlaid({ store, fetchImpl }) {
  const f = fetchImpl || ((...a) => fetch(...a));

  function cfg() {
    const c = store.get('plaid');
    return c && c.clientId && c.secret ? c : null;
  }
  function itemToken(itemId) {
    const c = cfg();
    const it = c && c.items && c.items[itemId];
    if (!it) throw new Error('This bank is not linked on this Mac. Link it again.');
    return it.accessToken;
  }
  async function call(path, body) {
    const c = cfg();
    if (!c) throw new Error('Add your Plaid keys first.');
    let res;
    try {
      res = await f(BASES[c.env] + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PLAID-CLIENT-ID': c.clientId, 'PLAID-SECRET': c.secret, 'Plaid-Version': '2020-09-14' },
        body: JSON.stringify(body || {}),
      });
    } catch (e) {
      throw new Error('Could not reach Plaid. Check your internet connection.');
    }
    let j = null;
    try { j = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
      const err = new Error((j && (j.display_message || j.error_message)) || 'Plaid returned HTTP ' + res.status);
      err.code = j && j.error_code;
      throw err;
    }
    return j;
  }

  function status() {
    const c = cfg();
    return { configured: !!c, env: c ? c.env : 'sandbox', country: c ? c.country : 'US', secureStorage: store.isAvailable() };
  }
  function saveKeys(k) {
    const clientId = String((k && k.clientId) || '').trim();
    const secret = String((k && k.secret) || '').trim();
    const env = k && k.env;
    const country = k && k.country;
    if (!clientId || !secret) throw new Error('Enter both the client ID and the secret.');
    if (!BASES[env]) throw new Error('Choose Sandbox or Production.');
    if (country !== 'US' && country !== 'CA') throw new Error('Choose US or Canada.');
    const old = store.get('plaid');
    // Keep linked banks only if the same keys and environment are being re-saved.
    const keep = old && old.clientId === clientId && old.env === env ? old.items : {};
    store.set('plaid', { clientId, secret, env, country, items: keep || {} });
  }
  function clearKeys() { store.del('plaid'); }

  async function createLinkToken(itemId) {
    const c = cfg();
    if (!c) throw new Error('Add your Plaid keys first.');
    const body = { client_name: 'Tally Money', language: 'en', country_codes: [c.country], user: { client_user_id: 'tally-money-local' } };
    if (itemId) body.access_token = itemToken(itemId);
    else { body.products = ['transactions']; body.transactions = { days_requested: 365 }; }
    const r = await call('/link/token/create', body);
    return r.link_token;
  }
  async function exchange(publicToken) {
    const r = await call('/item/public_token/exchange', { public_token: publicToken });
    const c = cfg();
    c.items = c.items || {};
    c.items[r.item_id] = { accessToken: r.access_token };
    store.set('plaid', c);
    return r.item_id;
  }
  async function removeItem(itemId) {
    const c = cfg();
    let remoteOk = true;
    if (c && c.items && c.items[itemId]) {
      try { await call('/item/remove', { access_token: c.items[itemId].accessToken }); } catch (e) { remoteOk = false; }
      delete c.items[itemId];
      store.set('plaid', c);
    }
    return { remoteOk };
  }

  async function syncOnce(token, start) {
    let cur = start || '', more = true, guard = 0, accounts = null;
    const added = [], modified = [], removed = [];
    while (more && guard++ < 50) {
      const body = { access_token: token, count: 500 };
      if (cur) body.cursor = cur;
      const r = await call('/transactions/sync', body);
      added.push(...(r.added || []));
      modified.push(...(r.modified || []));
      removed.push(...(r.removed || []).map((x) => x.transaction_id));
      if (r.accounts) accounts = r.accounts;
      cur = r.next_cursor;
      more = !!r.has_more;
    }
    const accs = (accounts || []).map(normalizeAccount);
    const typeById = {};
    (accounts || []).forEach((a) => { typeById[a.account_id] = mapAccountType(a); });
    const out = { accounts: accs, added: [], modified: [], removed: removed.slice(), cursor: cur };
    added.forEach((t) => { const n = normalizeTxn(t, typeById[t.account_id]); if (n) out.added.push(n); });
    modified.forEach((t) => { const n = normalizeTxn(t, typeById[t.account_id]); if (n) out.modified.push(n); else out.removed.push(t.transaction_id); });
    return out;
  }
  async function sync(itemId, cursor) {
    const token = itemToken(itemId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await syncOnce(token, cursor);
      } catch (e) {
        if (e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
        if (e.code === 'PRODUCT_NOT_READY') {
          const err = new Error('Plaid is still preparing this bank’s data. Try again in a minute.');
          err.code = e.code;
          throw err;
        }
        throw e;
      }
    }
  }

  return { status, saveKeys, clearKeys, createLinkToken, exchange, removeItem, sync };
}

module.exports = { createPlaid, normalizeTxn, normalizeAccount, mapCategory, mapAccountType };
