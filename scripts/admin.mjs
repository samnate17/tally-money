#!/usr/bin/env node
// Manage invites and accounts on your hosted Tally Money.
//   TALLY_URL=https://your-site.pages.dev TALLY_ADMIN_TOKEN=... node scripts/admin.mjs <command>
// Commands:
//   invite [days] [note]     make a single-use invite code (default 7 days)
//   invites                  list invites and who used them
//   revoke <invite-id>       cancel an unused invite
//   users                    list accounts (no data is shown; it is encrypted)
//   disable <user-id>        block an account and sign it out
//   enable <user-id>
//   remove <user-id>         permanently delete an account and its data
const base = (process.env.TALLY_URL || '').replace(/\/+$/, '');
const token = process.env.TALLY_ADMIN_TOKEN || '';
if (!base || !token) { console.error('Set TALLY_URL and TALLY_ADMIN_TOKEN first.'); process.exit(1); }
const [cmd, a, ...rest] = process.argv.slice(2);
const when = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');
async function call(method, path, body) {
  const r = await fetch(base + '/api/admin' + path, {
    method, headers: { authorization: 'Bearer ' + token, 'x-tally': '1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.error('Failed:', j.error || r.status); process.exit(1); }
  return j;
}
(async () => {
  if (cmd === 'invite') {
    const j = await call('POST', '/invite', { days: +a || 7, note: rest.join(' ') });
    console.log('Invite code (shown once, works once):\n\n  ' + j.code + '\n\nExpires in ' + j.expiresInDays + ' days. Send it privately, not in a public chat.');
  } else if (cmd === 'invites') {
    (await call('GET', '/invites')).invites.forEach((i) => console.log(i.id, i.revoked ? 'revoked' : i.used_by ? 'used by ' + i.used_by : i.expires_at < Date.now() ? 'expired' : 'open until ' + when(i.expires_at), i.note ? '(' + i.note + ')' : ''));
  } else if (cmd === 'revoke' && a) { await call('DELETE', '/invite/' + a); console.log('Revoked.');
  } else if (cmd === 'users') {
    (await call('GET', '/users')).users.forEach((u) => console.log(u.id, u.email, u.disabled ? 'DISABLED' : '', 'joined ' + when(u.created_at), 'last sync ' + when(u.last_sync), (u.bytes || 0) + ' bytes'));
  } else if ((cmd === 'disable' || cmd === 'enable') && a) { await call('POST', '/user/' + a + '/' + cmd, {}); console.log('Done.');
  } else if (cmd === 'remove' && a) { await call('DELETE', '/user/' + a); console.log('Account and data deleted.');
  } else { console.error(fs_usage()); process.exit(1); }
})();
function fs_usage() { return 'Usage: node scripts/admin.mjs invite [days] [note] | invites | revoke <id> | users | disable <id> | enable <id> | remove <id>'; }
