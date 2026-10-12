# Tally Money

A personal money app in a single static page: spending overview, accounts and debts with net worth and a payoff planner, subscription tracker, budgets, transactions with CSV import, and savings goals. No build step, no dependencies, no server.

## Run it

Open `index.html` in a browser, or serve the folder:

```
npx serve .
```

It also deploys as-is to GitHub Pages, Netlify or Cloudflare Pages.

## Mac app

The same page wrapped in Electron. The built app is a `.dmg` for Apple Silicon and Intel.

Build it on GitHub (no Mac needed): Actions tab, "Build Mac app", Run workflow, then download `tally-money-mac` from the finished run. Pushing a tag like `v1.0.0` also attaches the files to a GitHub Release.

Build it on a Mac: `npm ci && npm run dist:mac`, output in `dist/`. Run without packaging: `npm start`.

The app is not code-signed or notarized (that needs a paid Apple Developer account), so macOS blocks the first launch. Right-click the app, choose Open, then Open again. If it says the app is damaged, run `xattr -cr "/Applications/Tally Money.app"`.

The app keeps its own data, separate from the web version. Use Backup and Restore to move data between them.

## Accounts and debts

The Accounts tab holds checking, savings, cash, investment and property accounts plus credit cards, student, auto, mortgage and other loans. Debts take an APR and a minimum payment. Balances are entered by hand; each update is saved so the net worth chart can show a trend, and accounts not updated in 45 days are flagged.

The payoff planner compares paying the highest interest rate first against the smallest balance first, with an optional extra monthly amount. It assumes fixed rates, no new charges, and that freed-up minimums roll into the next debt. Accounts are included in Backup and Restore; backups made before v1.1.0 still load.

## Safari Dock app

When the page is hosted over https (GitHub Pages, Netlify, Cloudflare Pages), Safari on macOS Sonoma or newer can install it: open the site, then File, Add to Dock. You get a Dock icon and a window without browser chrome. This uses `manifest.webmanifest` and the files in `icons/`.

GitHub Pages is free only for public repos. A web app installed this way keeps its own data, separate from Safari tabs and the Mac app, so use Backup and Restore to move data.

## Deploy to Cloudflare Pages

Dashboard, Workers & Pages, Create, Pages, Connect to Git, pick this repo (private is fine). Settings:

- Framework preset: None
- Build command: `npm run build:web`
- Build output directory: `dist-web`
- Environment variable: `ELECTRON_SKIP_BINARY_DOWNLOAD` = `1` (stops the install step downloading Electron, which the website doesn't need)

Every push to `main` redeploys. `npm run build:web` copies only the site files (`index.html`, `manifest.webmanifest`, `icons/`) so the Electron and build files are not published.

### Locking it with Cloudflare Access

Pages project, Settings, General, Access policy, Enable. Then in Zero Trust, edit the policy created for the project: action Allow, include rule Emails with your address, login method One-time PIN. Cloudflare Access is free for up to 50 users. The manifest link uses `crossorigin="use-credentials"` so the login cookie is sent when Safari fetches it.

## Can I afford it?

Enter what it is, whether it is a one-time, monthly or yearly cost, its category and the price. The tab checks it against your real numbers: cash in checking, savings and cash accounts, subscriptions due in the next 30 days, your average income and spending over the last three full months, the category budget, and any debt above 10% APR. It answers Yes, Tight or Not right now, explains each reason with the amounts, and says how long saving would take if you should wait. It is rule-based, runs locally and works in the web version too. The rules: one-time costs should leave at least three months of spending in cash (under one month is a No), and monthly costs should leave at least 10% of income. These are rules of thumb, not financial advice.

## Bank sync (Mac app, Plaid)

Accounts tab, Bank sync panel. Create a Plaid account, copy the client ID and secret, paste them in (stored encrypted in the macOS Keychain through Electron safeStorage and never shown to the page), then Link a bank and Sync. Start in Sandbox: pick any test bank and sign in with `user_good` / `pass_good`.

- Syncs transactions (365 days of history) and balances using Plaid's `/transactions/sync`. Cursors are stored in the page's storage, so a failed sync never loses data. Pending transactions are skipped until they post.
- Transfers between your own accounts and credit card payments are skipped so they do not count as spending or income.
- Linked accounts update their own balance. Interest rates and minimum payments for debts are still entered by hand.
- Banks that use OAuth need a registered HTTPS redirect URI, which a desktop app does not have, so they may not appear in the bank list. Check your bank in Sandbox first, then in Production.
- Plaid's free trial allows 10 linked banks in total, and unlinking does not free a slot.
- The Plaid code has been tested against mocked responses and the link window against a fake Plaid page, not against a live Plaid account.

## AI analysis (Mac app, Anthropic API)

Transactions tab, AI analysis panel. Needs an Anthropic API key from console.anthropic.com (separate from a Claude.ai subscription and billed by usage), stored in the Keychain. "Analyze my last 12 months" first shows exactly what will be sent (merchant summaries with long digit runs masked, amounts, dates, monthly totals; no account numbers or balances) and an estimated cost, then waits for you. The model returns categories, subscription calls and a few observations as structured JSON. Nothing changes until you press Apply or Track: recategorizing overwrites categories you set by hand for those merchants, and subscriptions that stopped charging are listed as probably cancelled instead of offered for tracking. The model is `claude-opus-5-5` (set in `ai.js`).

## PDF statements (Mac app)

Transactions tab, PDF statements panel. Choose one or several statement PDFs (twelve months at once works), optionally set the type (checking or savings, or credit card; the default detects it), and review the transactions that were found before importing.

- Text is extracted on your Mac with pdf.js (`statement.js`). A line counts as a transaction when it starts with a date and has a money amount. Supported dates: `09/14`, `09/14/2026`, `2026-09-14`, `Sep 14`, `14 Sep 2026`. Years missing from a date come from the statement period.
- Signs are decided in this order: Withdrawals and Deposits columns, explicit minus signs, parentheses or CR/DR, running balances (including newest-first listings), then keywords. Rows whose sign was guessed are marked with a warning, and every amount button flips money in and out. On credit card statements purchases are spending and payments and credits are money in.
- Transactions that match ones already in the app (same date, amount and merchant) are unchecked, so overlapping statements do not double count. Dates, descriptions and categories can be edited in the review list.
- If a file's layout is not recognised, "Read with AI instead" sends only that file's text, with account and card numbers masked, to Anthropic after you confirm the size and rough cost. Scanned PDFs have no text and are not read: use your bank's downloadable PDF or a CSV.
- The reader is tested on six generated statement layouts (`test/fixtures`), not on real bank statements, so expect to review rows, especially at first. If a statement of yours comes out wrong, the fix is usually a small change to the line detection in `statement.js`.

## Tests

`npm test` runs the logic and module tests (payoff math, affordability rules, sync application, PDF statement parsing, AI request and result handling, Plaid request handling) with no network. `xvfb-run -a npx electron --no-sandbox test/pdf-ipc.smoke.js` sends the fixture PDFs through the real app bridge. `xvfb-run -a npx electron --no-sandbox test/link-window.smoke.js` exercises the bank link window.

## Icon and splash

The app icon (`build/icon.png`, 1024 px; electron-builder turns it into the macOS icon), the web and Dock icons in `icons/`, the in-app logo and the splash artwork (`assets/splash.jpg`) come from the cinematic design in Figma (https://www.figma.com/design/MVx3v4oNaE6JfCgOC8x1J0). The PNG and JPEG files were rendered locally from the same layer specification rather than exported from Figma, so they can differ from the Figma file in fine detail.

On launch the Mac app shows `splash.html` in a frameless window for at least 1.8 seconds (at most 8) with an animated loading line, then reveals the main window and fades the splash out. Set `TALLY_NO_SPLASH=1` to skip it. `xvfb-run -a npx electron --no-sandbox test/splash.smoke.js` checks the sequence.

## Data and privacy

Everything is stored in the browser's `localStorage` (key `tally-money-v1`). Nothing is uploaded unless you use the Mac app's bank sync (data goes to and from Plaid) or AI analysis (summaries go to Anthropic). Clearing site data erases it, and it does not sync between devices.

The app starts with made-up example data. "Start fresh" clears it, and so does your first CSV import.

## Backup and restore

Transactions tab, Backup panel. "Download backup" saves a JSON file with everything. "Restore from file" reads one back, shows what it contains, and asks before replacing your current data. Use it to move between devices or to recover after clearing site data.

## CSV import

The file needs a header row with a date column, a description column (`description`, `name`, `payee`, `merchant` or `memo`) and an amount column (or separate `debit` and `credit` columns). Spending is negative, income positive. Categories are guessed from the description unless a `category` column matches one of the built-in categories. Duplicates are skipped.

## Limits

- No bank connection. Live sync would need an aggregator such as Plaid plus a backend to hold the API keys.
- No bill negotiation or cancellation. You cancel with the provider, then mark the subscription cancelled to count the savings.
