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

## Appearance and liquid glass

The Appearance tab changes how the whole app looks, live, and remembers it on this device:

- **Colour:** eight presets (Indigo, Ocean, Violet, Emerald, Sunset, Rose, Gold, Graphite) or any custom accent. Buttons, progress bars, highlights, the first chart colour, the background glow and the desktop widget follow it. Light and dark variants are derived automatically so text stays readable.
- **Glass and light:** Auto, Light or Dark; an Aurora background that drifts slowly behind the glass, a Still version, or Plain; a Frost slider for how blurred and opaque panels are (raise it if text is hard to read); corner roundness.
- **Type and motion:** text size, font (Modern, System, Rounded, Serif; these use fonts already on your Mac, nothing is downloaded), and Motion: Full or Calm. Full adds page transitions, count-up numbers, progress bars that fill, a light that follows your pointer across panels, and confetti when a goal is reached. Your system's "reduce motion" setting always wins.

The glass look is built with CSS (backdrop blur, saturation, specular edges and highlights). It imitates Apple's Liquid Glass; it does not use Apple's native effect, which has no equivalent in a web page or Electron. Themes are stored per device in the browser or app and are not synced to hosted accounts. A theme that makes text hard to read can always be undone with Reset to default on the Appearance tab.

## Desktop widget (Mac app)

Transactions tab, Desktop widget, Show the widget (or the Widget menu). A small frameless window you can drag anywhere shows net worth, how much of your budgets you have used and a rough per-day allowance, categories over budget, bills due in the next 7 days and your nearest goal. It updates whenever you change something in Tally and remembers its position and the last numbers it saw.

- **Blur amounts** hides the figures for when others can see your screen. **Keep on top** floats it over other windows; off, it sits like a normal window.
- The Widget menu also has **Open Tally when I log in**. When the app starts that way and the widget is on, only the widget appears; click the Dock icon or the widget's arrow to open the main window.
- Only totals, category names, bill names and one goal name are sent to the widget. No transactions or account names. It reads nothing itself.
- The floating widget is separate from the native macOS widget described next. Both use the same numbers and the Blur amounts setting.

### Native macOS widget (desktop and Notification Center)

The Mac app also contains a real WidgetKit widget, in `native-widget/` (SwiftUI, small, medium and large sizes). To add it: right-click the desktop (or open Notification Center), Edit Widgets, search for **Tally Money**. It needs macOS 14 (Sonoma) or newer for desktop widgets.

How it works: the app writes the same sanitized summary to `~/Library/Application Support/Tally Money/native-widget.json` (owner-only permissions) whenever something changes. The widget is a sandboxed extension whose entitlements allow read-only access to that one folder; it has no network access and never sees transactions. macOS decides when widgets refresh, so it updates about every 15 minutes rather than instantly. The app cannot force a refresh without a signed app group.

Limits you should know about:

- **It is only ad hoc signed.** There is no Apple Developer account behind this project, so the build signs the widget (and re-seals the app) with `codesign --sign -`. Apple's tooling is built around properly signed widgets and may refuse to list or load an ad hoc one on some macOS versions. CI proves it compiles for Apple Silicon and Intel and that the signatures verify; it cannot prove macOS will show it. If it does not appear in Edit Widgets, drag Tally Money into Applications, open it once, then run `pluginkit -mA | grep tally` in Terminal and log out and in. If it still does not appear, the fix is a paid Apple Developer membership: set `WIDGET_SIGN_IDENTITY` to a Developer ID identity and the same build signs with it.
- macOS may ask whether Tally Money may read data from other apps the first time the widget loads. Allow it.
- The widget is not built in Linux or by `npm run dist:mac` on a machine without Xcode command line tools. In that case the app still builds, the widget step prints a warning, and the Desktop widget panel says the build has no macOS widget.

`.github/workflows/widget-check.yml` compiles the widget on every change under `native-widget/`, and the Mac build fails if the widget is not embedded.

### Native Liquid Glass (Mac app, macOS 26 and newer)

On macOS 26 (Tahoe) or newer the Mac app's window uses Apple's real Liquid Glass material (`NSGlassEffectView`) instead of the CSS imitation. The window is transparent, the glass sits behind the page, and panels are drawn as tinted glass on top, so your wallpaper and the windows behind Tally show through with Apple's own lensing. It is on by default where available; Appearance, Window material turns it off or on (the app restarts, because a window's transparency is fixed when it is created). The Aurora background is replaced by the desktop in this mode, and the app's Light/Dark choice is passed to macOS so the glass matches.

How it works: `native-glass/glass.mm` is a small N-API addon written for this project (it looks the class up at runtime, so it compiles on any SDK and reports "unsupported" on older macOS). `scripts/after-pack.js` compiles it for each architecture and puts `glass.node` in the app; `glass.js` decides whether to use it. On macOS 25 and older, on Linux and in the browser, the CSS glass look is used, unchanged. CI (`glass-check.yml`) compiles it and, on a macOS 26 runner, adds a real glass view to an Electron window and removes it again.

Limits: glass is one layer behind the whole window, not a separate lens on every panel, so panels get tint and edge highlights but not individual refraction. Panels sit on top of live desktop content, so text contrast depends on your wallpaper; raise Frost in Appearance if it is hard to read. Apple may change the API in later macOS versions. What CI cannot show is how it looks, so check it on your Mac.

## Updating the app from inside the app

Appearance tab, App updates (or Help, Check for Updates in the menu bar). Because the repository is private and the app is not signed by Apple, the usual auto-update libraries do not work, so this is built by hand:

1. **One-time setup:** paste a read-only GitHub token. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new, repository access: only `tally-money`, permission Repository, Contents: Read-only, with an expiry of up to a year. It is kept in the macOS Keychain (the same encrypted store as your other keys) and is never sent to the page. When it expires, paste a new one.
2. **Check for updates** asks GitHub for the latest release. Once a day-ish (each launch) the app also checks quietly and shows a banner when a newer version exists.
3. **Update** downloads the `.dmg` for your Mac (Apple Silicon or Intel), checks its size and SHA-256 against what GitHub reports for that file, then closes the app. A small script mounts the image, swaps the new app in for the old one in the same place, removes the "downloaded from the internet" flag, and reopens it. If any step fails, the old version is put back and the app tells you why. The script's log is `~/Library/Logs/Tally Money update.log`.

Limits and honest caveats:

- Your data lives outside the app and carries over.
- It works only for a copy installed in a normal folder such as Applications and opened from there. A copy running from the disk image or from a quarantined Downloads folder is told to move to Applications first.
- The first update has to be installed by hand, because earlier versions do not contain the updater.
- Keychain items are tied to the app's signature, and ad hoc signatures change with every build, so macOS may ask once after an update to let the new version use your saved Plaid, AI and token entries. Choose Always Allow. If you choose Deny, those saved keys cannot be read and need re-entering.
- The token can read your private source code. Use a token limited to this one repository, read-only, with an expiry, and revoke it at GitHub if you lose your Mac.
- Tested: the version and download logic (mocked GitHub), and the install script on a real macOS runner (success, corrupt image, read-only folder). Not tested: a real update on your Mac against your private releases.

## Predicting categories, editing and setting money aside

- **Categories.** Besides Housing, Groceries, Dining and the rest, there are now Travel, Cash and transfers (ATM withdrawals, Cash App, Venmo, Zelle, Apple Cash, remittances, payments to named people) and Debt and loans (car, student and card payments). New and imported transactions are filed by a built-in rule list; custom categories and anything you corrected before take priority.
- **Predict categories** (Transactions tab, and on the import review screen). *Guess with built-in rules* re-sorts everything filed as Other on your device. *Predict with AI* (Mac app, needs your Anthropic API key) asks Claude about each distinct merchant. It sends only the merchant name (long digit strings masked) and the amount: no dates, account numbers or balances. Results are applied right away with an Undo button, and on the import screen predicted rows are marked AI so you can check them before importing.
- **Edit.** Every transaction has an Edit button for its date, description, amount (negative is money out) and category. Tick "Use this category for every similar transaction" and the app updates the others with the same merchant name and remembers the choice for future imports and syncs.
- **Not mine.** For money that landed on your account but was not yours, such as a friend's Cash App or a payment you only passed along, press Not mine. The transaction moves to a Set aside list under the Transactions tab and drops out of spending, income, budgets, forecasts and reports. Restore puts it back. Re-importing the same statement will not bring set-aside items back. Both the set-aside list and remembered category fixes are included in backups.
- **Limits.** Predictions are guesses, most reliable for well-known merchants; local rules know common names only; AI costs a small amount per request on your key. Transfers between your own accounts are detected on statements that say "transfer to/from checking or savings" and arrive unchecked on the import screen; paying a credit card from checking is not treated as a transfer, so it counts as spending unless you also import and set aside the other side yourself.

## Accounts for other people (hosted version)

Two ways to let other people use Tally:

1. **They install the Mac app themselves.** Each person's data stays on their own Mac and you hold nothing. This needs no accounts and no server.
2. **You host it with logins.** The same site, deployed to Cloudflare Pages with a D1 database, gains a sign-in screen. Nobody can create an account without a single-use **invite code** that you generate. The hosted version is the web app only: Plaid bank sync, AI analysis, PDF import and live prices stay in the Mac app, because they need keys that must not be shared.

### How the hosted version protects data

- The browser turns the password into two separate keys (PBKDF2, 600,000 rounds). One proves who you are and only a salted hash of it is stored. The other encrypts your data with AES-256-GCM and never leaves the browser. The server stores ciphertext only, so you, as the host, cannot read anyone's finances, and neither could someone who stole the database.
- The cost of that: **a forgotten password cannot be recovered.** The sign-up screen says so and requires a tick box. Tell people to download a backup.
- Invite codes are 80-bit, single use, expire (7 days by default), can be revoked, and are stored hashed. Sign-in is rate limited (8 failures per email and 40 per address per 15 minutes). Sessions are 30-day HttpOnly, SameSite=Strict cookies, and writes need a custom header against cross-site requests. Changing a password signs out other devices. Users can delete their own account and data.
- `_headers` adds a strict Content Security Policy and other browser protections.

### Set it up

1. Cloudflare dashboard, Storage & Databases, D1, create a database named `tally-money`. Open its Console and paste in the contents of `migrations/0001_init.sql`.
2. Pages project (see above), Settings, Bindings, add a D1 database binding named `DB` pointing at it. Add an `ADMIN_TOKEN` secret under Variables and Secrets: a random string of 24+ characters (for example the output of `openssl rand -base64 32`). Redeploy.
3. Remove the Cloudflare Access policy if you set one earlier, or add everyone's email to it. Otherwise invited people cannot reach the sign-up page. Access in front of the site is a second lock you may prefer to keep.
4. Make an invite and send it privately:

   ```
   export TALLY_URL=https://your-project.pages.dev
   export TALLY_ADMIN_TOKEN=the-secret-from-step-2
   node scripts/admin.mjs invite 7 "for Alex"
   ```

   Other commands: `invites`, `revoke <id>`, `users`, `disable <id>`, `enable <id>`, `remove <id>`. The admin list shows emails and sync times, never data.

### What you are taking on

Even with encryption you hold other people's account emails and encrypted records. You are the contact when someone loses a password or asks for deletion (`remove`). Anyone with your `ADMIN_TOKEN` or Cloudflare login can create accounts or delete data, so protect both. Encryption does not protect a user whose own browser is compromised, and the code was tested locally with a SQLite stand-in for D1, not against a live Cloudflare deployment. Try the whole flow once yourself before inviting anyone. Tally is not a bank and offers no financial advice; keep that in mind if you invite people outside your circle.

`npm test` covers the API (invites, sign-in limits, versions, password change, deletion, admin) and the browser-side encryption. `node test/devserver.mjs` runs the site and the real API locally on port 8799 with an in-memory database.

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

Transactions tab, Import statements panel. Choose one or several statement PDFs (twelve months at once works), optionally set the type (checking or savings, or credit card; the default detects it), and review the transactions that were found before importing.

- Text is extracted on your Mac with pdf.js (`statement.js`). A line counts as a transaction when it starts with a date and has a money amount. Supported dates: `09/14`, `09/14/2026`, `2026-09-14`, `Sep 14`, `14 Sep 2026`. Years missing from a date come from the statement period.
- Signs are decided in this order: Withdrawals and Deposits columns, explicit minus signs, parentheses or CR/DR, running balances (including newest-first listings), then keywords. Rows whose sign was guessed are marked with a warning, and every amount button flips money in and out. On credit card statements purchases are spending and payments and credits are money in.
- Transactions that match ones already in the app (same date, amount and merchant) are unchecked, so overlapping statements do not double count. Dates, descriptions and categories can be edited in the review list.
- If a file's layout is not recognised, "Read with AI instead" sends only that file's text, with account and card numbers masked, to Anthropic after you confirm the size and rough cost. Scanned PDFs have no text and are not read: use your bank's downloadable PDF or a CSV.
- The reader is tested on six generated statement layouts (`test/fixtures`), not on real bank statements, so expect to review rows, especially at first. If a statement of yours comes out wrong, the fix is usually a small change to the line detection in `statement.js`.

## Credit health

Credit tab. The app cannot pull a credit score from the bureaus (that needs a paid partner license), so you enter your score from your bank or card app and it tracks the history. It explains what affects the score using FICO's published weights (payment history 35%, amounts owed 30%, length of history 15%, new credit 10%, credit mix 10%) and gives advice from what it can see: card balances and limits (limits come from Plaid when linked, or you type them), the accounts you have, and a short profile you fill in for what it cannot see (late payments, applications, oldest account, collections). Utilization is shown per card and overall with the payment needed to get under 30% and 10%, plus a what-if box. The advice is general education, not a prediction of points.

## Investments

Investments tab. Add each holding as ticker, shares and total invested. In the Mac app the app loads about a year of daily prices from Yahoo Finance's public chart endpoint, with Stooq end-of-day data as a fallback (neither needs an account or key; both are unofficial or delayed and may fail, and the app says so per ticker). It shows value, gain or loss and today's move per holding and in total, a portfolio value chart (today's shares at past prices), a price chart per holding with your average cost, an allocation donut, and a volatility watch: annualized volatility from daily returns (under 20% low, 20 to 35% moderate, 35 to 55% high, above that very high), worst peak-to-trough drop, and a warning for any position that is 30% or more of the portfolio. In the browser version prices are not available (browsers block the request); holdings can still be recorded. Example data uses made-up price histories, labelled as such. Information only, not investment advice.

## Tests

`npm test` runs the logic and module tests (payoff math, affordability rules, sync application, PDF statement parsing, AI request and result handling, Plaid request handling) with no network. `xvfb-run -a npx electron --no-sandbox test/pdf-ipc.smoke.js` sends the fixture PDFs through the real app bridge. `xvfb-run -a npx electron --no-sandbox test/link-window.smoke.js` exercises the bank link window.

## Custom budgets, forecasts and the monthly report

- **Your own budget categories.** On Budgets, "Add a budget" creates a category such as Gas. Give it keywords (for example `shell, chevron, exxon`) and new or imported transactions whose description contains one are filed there automatically; "Move matching past transactions" re-files history. Naming it Gas fills in common gas-station keywords. Custom categories are saved in backups.
- **History-based suggestions.** Each category shows its average, recent trend and highest month over the last 3 to 6 months, plus a suggested limit (roughly the larger of the median and 110% of a recent-weighted forecast, rounded up to $5). "Forecast" shows a chart; "Use $X" sets it as the budget. This is arithmetic on your own past months, not a prediction of prices, so treat it as a starting point. With fewer than 3 months of data it says so.
- **Monthly report.** The Monthly report tab shows income, spending and savings rate, a 6-month stacked chart, each category against its usual, top merchants, biggest purchases, a 50/30/20 check, and ranked savings ideas. For the current month it estimates the finish as spent so far plus a typical remainder; rent, mortgage, insurance, utilities and subscriptions are not extrapolated.

## Icon

The app icon (`build/icon.png`, 1024 px; electron-builder turns it into the macOS icon), the web and Dock icons in `icons/`, the in-app logo come from the cinematic design in Figma (https://www.figma.com/design/MVx3v4oNaE6JfCgOC8x1J0). The PNG and JPEG files were rendered locally from the same layer specification rather than exported from Figma, so they can differ from the Figma file in fine detail.

The app opens straight to the main window, with no launch animation.

## Data and privacy

Everything is stored in the browser's `localStorage` (key `tally-money-v1`). Nothing is uploaded unless you use the Mac app's bank sync (data goes to and from Plaid) or AI analysis (summaries go to Anthropic). Clearing site data erases it, and it does not sync between devices.

The app starts with made-up example data. "Start fresh" clears it, and so does your first CSV import.

## Backup and restore

Transactions tab, Backup panel. "Download backup" saves a JSON file with everything. "Restore from file" reads one back, shows what it contains, and asks before replacing your current data. Use it to move between devices or to recover after clearing site data.

## Importing CSV and PDF statements

Transactions tab, Import statements panel. Both go through the same review screen: edit dates, descriptions and categories, flip the sign of any amount, untick rows, and nothing is added until you press Import. Rows that match transactions already in the app (same date, amount and merchant) are unchecked, so overlapping files do not double count.

**CSV.** Works with exports from most banks without setup: the delimiter (comma, semicolon, tab), a header that is not on the first line (bank summaries above the table), a Details column next to a Description column, Transaction Date versus Post Date, separate Debit and Credit columns, a Type column, day-first or month-first dates, decimal commas, parentheses or trailing minus signs for negatives, and files with no header at all. Credit card exports that list purchases as positive numbers are detected and flipped. If the app cannot tell which column is which, it shows the first rows and lets you pick Date, Description, Amount (or Money out and Money in) yourself.

## Limits

- No bank connection. Live sync would need an aggregator such as Plaid plus a backend to hold the API keys.
- No bill negotiation or cancellation. You cancel with the provider, then mark the subscription cancelled to count the savings.
