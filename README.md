# Agent X

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

The app is not code-signed or notarized (that needs a paid Apple Developer account), so macOS blocks the first launch. Right-click the app, choose Open, then Open again. If it says the app is damaged, run `xattr -cr "/Applications/Agent X.app"`.

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

The Settings tab (Appearance section) changes how the whole app looks, live, and remembers it on this device:

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

The Mac app also contains a real WidgetKit widget, in `native-widget/` (SwiftUI, small, medium and large sizes). To add it: right-click the desktop (or open Notification Center), Edit Widgets, search for **Agent X**. It needs macOS 14 (Sonoma) or newer for desktop widgets.

How it works: the app writes the same sanitized summary to `~/Library/Application Support/Agent X/native-widget.json` (owner-only permissions) whenever something changes. The widget is a sandboxed extension whose entitlements allow read-only access to that one folder; it has no network access and never sees transactions. macOS decides when widgets refresh, so it updates about every 15 minutes rather than instantly. The app cannot force a refresh without a signed app group.

Limits you should know about:

- **It is only ad hoc signed.** There is no Apple Developer account behind this project, so the build signs the widget (and re-seals the app) with `codesign --sign -`. Apple's tooling is built around properly signed widgets and may refuse to list or load an ad hoc one on some macOS versions. CI proves it compiles for Apple Silicon and Intel and that the signatures verify; it cannot prove macOS will show it. If it does not appear in Edit Widgets, drag Agent X into Applications, open it once, then run `pluginkit -mA | grep tally` in Terminal and log out and in. If it still does not appear, the fix is a paid Apple Developer membership: set `WIDGET_SIGN_IDENTITY` to a Developer ID identity and the same build signs with it.
- macOS may ask whether Agent X may read data from other apps the first time the widget loads. Allow it.
- The widget is not built in Linux or by `npm run dist:mac` on a machine without Xcode command line tools. In that case the app still builds, the widget step prints a warning, and the Desktop widget panel says the build has no macOS widget.

`.github/workflows/widget-check.yml` compiles the widget on every change under `native-widget/`, and the Mac build fails if the widget is not embedded.

### Native Liquid Glass (Mac app, macOS 26 and newer)

On macOS 26 (Tahoe) or newer the Mac app's window uses Apple's real Liquid Glass material (`NSGlassEffectView`) instead of the CSS imitation. The window is transparent, the glass sits behind the page, and panels are drawn as tinted glass on top, so your wallpaper and the windows behind Tally show through with Apple's own lensing. It is on by default where available; Appearance, Window material turns it off or on (the app restarts, because a window's transparency is fixed when it is created). The Aurora background is replaced by the desktop in this mode, and the app's Light/Dark choice is passed to macOS so the glass matches.

How it works: `native-glass/glass.mm` is a small N-API addon written for this project (it looks the class up at runtime, so it compiles on any SDK and reports "unsupported" on older macOS). `scripts/after-pack.js` compiles it for each architecture and puts `glass.node` in the app; `glass.js` decides whether to use it. On macOS 25 and older, on Linux and in the browser, the CSS glass look is used, unchanged. CI (`glass-check.yml`) compiles it and, on a macOS 26 runner, adds a real glass view to an Electron window and removes it again.

Limits: glass is one layer behind the whole window, not a separate lens on every panel, so panels get tint and edge highlights but not individual refraction. Panels sit on top of live desktop content, so text contrast depends on your wallpaper; raise Frost in Appearance if it is hard to read. Apple may change the API in later macOS versions. What CI cannot show is how it looks, so check it on your Mac.

## Updating the app from inside the app

Settings tab, App updates (or Help, Check for Updates in the menu bar). Because the repository is private and the app is not signed by Apple, the usual auto-update libraries do not work, so this is built by hand:

1. **One-time setup:** paste a read-only GitHub token. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new, repository access: only `tally-money`, permission Repository, Contents: Read-only, with an expiry of up to a year. It is kept in the macOS Keychain (the same encrypted store as your other keys) and is never sent to the page. When it expires, paste a new one.
2. **Check for updates** asks GitHub for the latest release. Once a day-ish (each launch) the app also checks quietly and shows a banner when a newer version exists.
3. **Update** downloads the `.dmg` for your Mac (Apple Silicon or Intel), checks its size and SHA-256 against what GitHub reports for that file, then closes the app. A small script mounts the image, swaps the new app in for the old one in the same place, removes the "downloaded from the internet" flag, and reopens it. If any step fails, the old version is put back and the app tells you why. The script's log is `~/Library/Logs/Agent X update.log`.

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

## Sub-categories

Each category can have sub-categories: for example Housing has Rent, Mortgage, Electric, Wi-Fi and internet, Propane and heating oil, Water and sewer, Trash, and Repairs and supplies. Every other built-in category has a starter list too.

- **Filing.** New, imported and synced transactions get a sub-category automatically when the merchant name is recognised (Eversource becomes Electric, Comcast becomes Wi-Fi and internet, AmeriGas becomes Propane and heating oil, and so on). For existing history, the Transactions tab offers Sort into sub-categories, which can be undone. Edit lets you pick or clear one by hand; with "Use this category for every similar transaction" ticked, the app also remembers your sub-category for that merchant.
- **Your own lists.** Budgets tab, Sub-categories: type any names, separated by commas, for each category (for example `Rent, Wi-Fi, Propane, Electric bill`). Changing a list does not change transactions that are already sorted.
- **Seeing them.** Transactions show their sub-category under the name. On the Budgets tab, pressing Forecast on a category now also shows that category by sub-category for the month, next to each one's three-month average. The Monthly report shows each category's biggest sub-categories. Anything not yet sorted is grouped as Unsorted.
- **AI.** Predict with AI also returns a sub-category when one of your listed names clearly fits; anything else is left unsorted.
- **Limits.** Budgets are still set per category, not per sub-category. Sub-categories are saved in backups. If you rename an entry in a list, old transactions keep the old name until you edit them.

## Car loan and student loans

Two tabs, **Car loan** and **Student loans**, track what you owe, the interest rate, the payment and when it will be paid off. Add each loan by hand (federal student loans usually come as several loans with different rates, so add each one). They are the same accounts as in the Accounts tab, so net worth and the debt payoff plan include them.

- **What you see:** total owed, average rate, monthly payment, next due date, payoff date and interest still to pay at today's payments; each loan with its own payoff date and progress; the payments to that lender found in your imported transactions (with a warning when your latest payment differs from the one you entered).
- **Pay it off faster:** an extra amount each month, a one-time extra, half-payments every two weeks, or a target ("be done in 3 years") that works out the exact monthly total. A chart compares your current plan with the faster one, and a table shows what +$25, +$50, +$100, +$250 and +$500 would save. With several loans the extra goes to the highest rate first.
- **What to pay:** the amount due, plus a suggestion based on your usual leftover money (half of it) and what that would save. It warns when you owe something at a higher rate elsewhere (a credit card, say), or when your cash is under one month of spending.
- **Update from a statement (Mac app, needs your Anthropic API key):** choose a PDF or text statement from Honda Financial, Nelnet or any lender, or the loan data download from studentaid.gov. The file is read on your Mac, account numbers are masked, and Claude fills in the balance, rate, payment and due day for you to check before anything is saved. Existing loans are updated, new ones added.
- **Plaid (student loans, Mac app):** a Link a loan servicer button asks Plaid for its Liabilities data, which includes each student loan's balance, rate, minimum payment and due date. Whether Nelnet is supported, and whether your Plaid account has access to that data, is something only Plaid can confirm; it could not be tried from where this was built. Loans it returns are merged with ones you entered when the rate and balance match.
- **Honda Financial and Nelnet APIs:** neither company offers a public API for personal accounts that I could find, so there is no direct link. The statement reader above is the closest thing, and works for any lender.
- **Limits:** interest is calculated monthly on the balance. Federal loans accrue interest daily, so real figures differ by a few dollars. Payoff dates assume you keep paying the amounts shown. This is general information, not financial advice.

## A plan for "Can I afford it?"

When a purchase does not fit yet, the Can I afford it? tab adds a **How to afford it** panel with a concrete plan:

- **Timelines:** for a one-time cost, a table for 1, 3, 6 and 12 months shows how much to set aside each month and where it comes from: your usual leftover money first, then trimming spending, then extra income. Pick a timeline to see its steps, or let the app suggest the soonest one that needs no extra income.
- **Where you could trim:** categories ranked by what a sensible trim would free up (roughly 25 to 35% of dining, shopping, entertainment and travel, 15% of cash and transfers, less on groceries and transport, nothing on housing or debt payments), with the biggest sub-category named, plus any subscriptions you marked To review. Untick anything you would not cut and the plan updates.
- **Or earn more:** the extra income still needed each month, converted to hours at the hourly pay you enter (assuming you keep about 80% after tax).
- **Recurring costs** are judged against keeping at least 10% of your income, and the panel says how much monthly cost would fit.
- It also says the most you could spend today while keeping a three-month cushion, or a one-month cushion if you accept it.

This is rule-of-thumb arithmetic on your last three full months of transactions, not financial advice.

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

## Bills, loans, "Can I afford it?" and electricity

- **Bills** (Overview box and tab): add recurring bills; each counts as paid when a matching payment shows up in your transactions, or when you mark it. Pick a category and sub-category for each bill (for example Housing, Electric): payments filed under that sub-category count toward the bill, so you can link it to the recurring charge in your bank without typing matching words. Shows paid vs pending for the month.
- **Car loan / Student loans**: balance, rate, payment, payoff date and ways to pay off sooner. Fill in by hand, read a statement with AI (Mac app + API key), or, for student loans, link through Plaid Liabilities. No public Honda Financial or Nelnet API exists that I could find.
- **Can I afford it?** suggests cutting categories, earning extra, or waiting.
- **Electricity**: Eversource has no public API. Download your data from eversource.com (My Account, Usage, Green Button, Download My Data; CSV or XML, about 13 months) and choose the file on the Bills tab, or type months in. The app charts use and cost and gives savings advice. The file parsers follow the standard Green Button formats but have only been tested on made-up samples, so tell me if your real file is rejected.

**Refresh button.** Every tab except Investments (which has Refresh prices) and Settings has a Refresh button beside its title. It updates the date, re-runs the Can I afford it? check on your latest numbers, pulls changes made on another device (hosted accounts), and syncs your linked banks and loans in the Mac app.

## Live dashboard

The Dashboard tab puts the important numbers on one screen: net worth, what is left this month, how much of your budgets you have used, bills still to pay, loan balances, the donut of where money went, loan payoff dates, electricity use, goals and net worth over time. It stays current by itself: the clock ticks every second, the page redraws every minute (and rolls over at midnight), and in the Mac app you can tick **Sync banks every 30 min** to pull new transactions while it is open. **Full screen** hides the sidebar for a wall display. It only shows what is already in the app; it is not a separate web page.

## Private assistant (Mac app, runs locally)

The Assistant tab is a chat that runs entirely on your Mac through [Ollama](https://ollama.com), a free app that runs open AI models. Nothing is sent to the internet: the app only talks to Ollama at `127.0.0.1:11434`, and that address cannot be changed from the page.

Setup, once: install Ollama, drag it to Applications and open it (finish its first-run steps). In the Assistant tab press Check again, then press **Download llama3.2** (about 2 GB, works on most Macs) or **Download qwen2.5:7b** (4.7 GB, better answers, needs about 8 GB of free memory). A progress bar shows the download and Stop cancels it; starting again resumes. You can also type any other Ollama model name. No Terminal needed, and `ollama pull <name>` in Terminal does the same thing.

With **Let it see my Agent X numbers** ticked, each question includes a summary of your accounts, this month, the last three months, bills, loans, subscriptions, electricity, goals and your 25 latest transactions (no account numbers are ever stored by the app). Untick it to chat without your data. The chat is kept in memory only and disappears when you close the app.

Honest limits: small local models make arithmetic and reasoning mistakes, so check numbers that matter against the other tabs. Quality and speed depend on the model and your Mac. The streaming, errors and Stop button are tested against a stand-in for Ollama; I could not run a real model in the build environment.

## Categories for personal expenses

Besides the original categories there are now built-in **Personal care** (Haircut, Skin and nails, Cosmetics, Massage and spa), **Pets** (Food and supplies, Vet, Grooming), **Education** (Tuition, Courses, Books) and **Gifts and donations** (Donations, Gifts and flowers), with keywords so a statement line such as "GREAT CLIPS" or "PETCO" files itself and gets a sub-category. Existing transactions keep the category they have; use Predict categories or Edit to move old ones. If you already made a custom category with one of these names, it is shown once and its keywords still work.

When you add or edit a bill, the Category and Sub-category lists end with **+ New category…** and **+ New sub-category…**, so you can make "Haircuts" with "Barber" right there. A new category is a normal custom category (it appears in Budgets, with no keywords until you add some) and a new sub-category is added to that category's list.

## Credit cards on the Bills tab

A credit card (or any debt) with a minimum payment and a **payment due day** shows up on the Bills tab by itself, marked "from your card", with the minimum as its amount. Set the due day when you add the account, or later with the **Due day** and **Min $** boxes on the account's row in Accounts, so you update the minimum in one place. It counts as paid when a payment appears in your transactions that names the card, for example "PAYMENT TO CHASE CARD" or "CHASE CREDIT CRD AUTOPAY"; an ordinary purchase from a shop with a similar name does not count. Otherwise use Mark paid. If you already added a bill by hand with the same name, the automatic one is not shown twice.

Backups now also keep each loan's and card's due day, lender and original balance (an older bug dropped them when restoring a backup, which would have hidden those bills).

## Loan statement details

Each loan can keep what its statement says: **amount due** and its due date, **past due**, **unpaid accrued interest**, **principal**, the **last payment received** (amount and date) and the date the figures are **as of**. They appear on the loan's card, and a past-due amount is also flagged on the Bills tab.

Three ways to fill them in: read a statement with AI (Mac or Windows app, needs your Anthropic key; every figure is shown in an editable table before anything is saved), type them into the **Statement details (optional)** section of the Add a loan form (no key needed), or link a student loan servicer with Plaid, which supplies the due date, last payment and outstanding interest when the servicer reports them. A newer statement replaces the older figures, so a past-due amount clears once you are caught up; a statement that is older than what you have is ignored; figures more than 45 days old are marked as out of date. Backups keep all of it.

## Reading statements without paying for an API key

On the loan pages, "Update from a statement" now has three ways to read the file you choose, all showing the same editable table before anything is saved:

- **Read it for free** (always available in the desktop app): finds the usual labels on the statement (Amount Due, Past Due, Interest Rate, Principal, Accrued Interest, Last Payment, Due Date, Statement Date and so on) and takes the figure beside each. It also understands a table of several federal student loans (one loan per row). Nothing is sent anywhere. It works on ordinary statements and misses unusual layouts, so a blank or zero means the label was not found: fill it in or leave it.
- **Read it with my local assistant**: uses the model you set up in the Assistant tab (Ollama). Free and private, a little slower, and as accurate as the model.
- **Read it with Claude**: the most accurate on odd layouts, needs your Anthropic key.

Honest limits: the free reader is tested on typical layouts I wrote from how these statements are usually worded, not on your real Honda or Nelnet files. If it misses something on yours, send me the statement text with the numbers hidden and I will teach it that wording.

## Loans (everything you owe) and the payoff strategy

The **Loans** tab groups all your debts: All loans, Student, Car, Credit cards and Other loans. Each group has its own page with the loans, the "pay it off faster" tools and statement reading; **All loans** is the strategy page:

- Enter the total you can pay a month (and any one-time extra) and it compares **minimums only**, **highest rate first** (avalanche, least interest) and **smallest balance first** (snowball, fewest debts soonest): debt-free date, interest, interest saved, and how many debts are left after 1, 2 and 3 years. Freed-up payments roll into the next debt automatically.
- It lists the **order to pay them**, draws the balance over time, and tells you what monthly amount you need to be **debt-free by a date**.
- **Would one new loan help?** compares a consolidation loan, refinance or 0% transfer (rate, months, fee) with your current plan at the same monthly amount.
- "My read" points out the most expensive debt, what credit cards cost you in interest each month, low-rate debts not worth rushing, and the trade-offs for student loans.
- The old Car loan and Student loans tabs are now filters inside Loans. Your mortgage has its own tab and can be included in the strategy with a tick.

## Mortgage and home

The **Mortgage** tab takes your home value, mortgage (balance, rate, principal-and-interest payment, original loan), taxes, insurance, HOA, PMI and what you paid for it. It creates a Home (property) and a Mortgage account so both appear in your net worth and debts, then works out:

- what owning costs each month and how much of it does not come back (everything except principal), your equity, and what you would keep if you sold after selling costs;
- **whether to pay extra**: payoff date, time and interest saved for several extra amounts, set against investing the same money at the return you assume, with a plain verdict;
- **keep it, rent it out or sell it**: your net worth over 5 to 30 years in four choices (keep and sell later, sell now and rent a similar home, rent it out and sell later, sell now and invest) with a chart and the break-even point for each;
- as a rental: cash flow after vacancy, management, tax, insurance and upkeep, cap rate, cash return, the 1% rule and the rent that would break even;
- **since you bought**: purchase price, closing costs, interest paid so far and estimated running costs against what a sale would bring, whether you are ahead or behind, and when you break even (also counting the rent you did not pay);
- **refinancing**: new payment, monthly saving, months to recover the closing costs and the lifetime difference (a longer term can lower the payment and still cost more overall).

Change the assumptions (growth, return on investments, selling cost, rent, upkeep, vacancy, management) and everything updates. It is a model, not a prediction, and it leaves out income-tax effects such as the mortgage-interest deduction and capital gains tax on a sale or rental; ask a tax professional about those.

## Smarter Bills and no double counting

- **Bills find themselves.** A payment that repeats about the same amount around the same day for three months (or two, if it is still going) shows up on the Bills tab with a "Found in your transactions" tag. Press **Keep** to save it as your own bill, or **Not a bill** to hide it for good. Housing, loans, insurance, education and phone plans are considered; groceries, dining and shopping never are.
- **Phone carriers** (T-Mobile, Xfinity Mobile, Verizon, AT&T, Mint, Visible, Cricket, Google Fi and others) are filed under Subscriptions > Phone plan, even from older transactions that were filed under Housing. Plain Xfinity or Verizon Fios stays internet.
- **Car loans, student loans and cards** appear as bills as soon as they have a monthly payment. If you never set a due day, the app uses the day your payments usually land.
- **Nothing is counted twice.** Paying a credit card from checking, "payment thank you" credits on a card statement, and moves between your own accounts are left out of spending, income, budgets, reports and "Can I afford it?". Card payments are only skipped when your card purchases are in the app too (otherwise the payment is the only record of that money); change this on the Transactions tab. Press **Transfer** or **Count it** on any row to override the app. Loan and mortgage payments always count, because they are real spending.
- Everything here runs on your device with plain rules. It does not need the local assistant or an API key.

- **Nelnet / Department of Education statements** that show one "Account Snapshot" column per loan group (AA, AB, AC...) are read group by group: each group becomes its own loan with its rate, balance (principal plus accrued interest), payment, amount due and past due. The groups add up to the totals on the statement. On the Bills tab those groups from one lender appear as one student-loan bill, because you pay them together.

## Statements for every category, and decisions from your history

- **Mortgage:** on the Mortgage tab press *Fill this in from my mortgage statement* (desktop app, free, no key). It reads the balance, rate, principal-and-interest, escrow, due day, original amount and term, shows what it found, and fills the form for you to check before saving. If you leave tax and insurance blank, the escrow payment is counted as both until you split them.
- **Loans and cards:** student, car, other loans and credit cards each have *Update from a statement* on the Loans page (free reader, local assistant, or Claude).
- **Bank and card statements:** the PDF/CSV import on the Transactions tab reads the transactions, and now also the closing balance, so you can bring an account's balance up to date from the same file.
- **Not covered:** investment and retirement statements are not read yet; add holdings on the Investments tab.
- **Your history drives the advice.** "Can I afford it?" and the Loans page now use up to six months of income and spending (one unusually high and one unusually low month ignored; transfers left out). The Overview shows *What your history says*: a typical month, how steady it is, whether spending is rising, and a safe monthly amount for debt, which the debt plan offers as a starting point.
- **Mortgage double check:** the Mortgage tab compares the property tax, insurance, HOA, repairs and mortgage payments found in your transactions with the figures you saved, and offers to use the real ones.

- **Investments by topic:** the Investments tab groups your shares into topics (Technology, Healthcare, Financial, Consumer, Energy, Funds and ETFs, Bonds and so on), like Cash App. It shows a donut and each topic's share, value and gain; tap a topic to see its holdings. Common tickers are recognised automatically; for anything marked Other, press Edit on the holding and pick a topic. A warning appears when half or more of your money is in one topic.

- **A page for each share.** Tap a holding on the Investments tab. The page follows Cash App's layout: price and chart (1W, 1M, 3M, 1Y), Buy and Sell, *My investment* (total invested, gain or loss, value, shares, average cost, share of your portfolio), *Activity* (each purchase and sale), *Key stats* (market cap, revenue, growth, profit, P/E, EPS, dividend yield, beta, 52-week range), *Financials* (revenue and net profit, annual or quarterly), *Earnings* (actual against expected EPS for the last four quarters and the next report date), *Analyst opinions* (Sell to Buy gauge, number of analysts, average price target) and *About* (description, CEO, industry, employees, headquarters). Funds show their top holdings and expense ratio instead.
- Buy and Sell only record what you did at your broker; the app never trades. Selling reduces your cost in proportion and shows the gain or loss on that sale.
- Company details come from Yahoo Finance's unofficial public data through the desktop app (only the ticker symbol is sent). It can be delayed, incomplete or stop working; any section that is missing says so. Your own numbers (investment, activity) never depend on it.

## Apple Card

Apple only shares Apple Card activity with apps on an iPhone (Rocket Money does it with an iPhone app, Apple's FinanceKit and Plaid), so a Mac or Windows app cannot link it live. On the Transactions tab the **Apple Card** panel does the next best thing: export a statement from Wallet once a month (CSV, OFX or the PDF statement), choose it, review and import. The panel shows the steps, remembers when you last imported and nudges you after 35 days. Payments to the card are skipped (they are transfers, not spending or income), Daily Cash credits are not counted as income, and an Apple Card account is created in Accounts. CSV and OFX carry no balance: type it under Accounts, or import the PDF statement and press *Set balance*.

## Car loan contract and the visual dashboards

- **Read your sale contract.** On the Loans page, Car, *Read it for free* now understands the retail installment sale contract you signed at the dealer. It takes the rate, amount financed, finance charge, total of payments, total sale price, number and amount of payments, first payment date, vehicle, VIN, seller, loan company, down payment, cash price, gap coverage, registration fee, late fee and prepayment terms. Nothing leaves your computer.
- **Honda Financial style car loan dashboard.** A summary card at the top shows an animated ring of how much is paid off, the payoff amount today (an estimate, growing by a per-day amount), the next payment and its date, and chips for rate, term, payments left, last payment date and interest still to pay. Below it: the balance curve with *Today* marked, every payment split into principal and interest, all contract details, what extra payments save, a refinance check, and the payments found in your transactions.
- **The payoff is an estimate.** It assumes every payment was made on its due date. The schedule is rebuilt so that it reproduces the finance charge printed on the contract; if your records show a different balance (extra, missed or late payments) the page says so and lets you choose. Your lender's payoff quote is the real figure.
- **Pictures for every loan and card.** Each kind of debt has an *At a glance* panel: a ring for how much of the original loan is paid, a credit-use gauge for cards, a donut for where this month's payment goes (principal against interest), a donut of what you owe by loan, an animated balance-to-zero curve, a payoff race for several loans, and the yearly interest cost. The Mortgage tab shows how much of the home is yours and where each month's payment goes. Motion follows the Appearance setting (reduced motion turns it off).

## Pictures and motion

- **Your car on a road.** The car loan page shows a car that drives from the day you signed to the day the loan ends, stopping at how far along you are. The body style (sedan, hatchback, SUV, pickup, coupe, minivan) is guessed from the name, and you can change it and pick a color. Or add your own photo of the car; it slowly zooms like a photo slideshow.
- **Your house fills up.** On the Mortgage tab a house fills from the bottom as the share you own grows, windows light up and the chimney puffs. Add a photo of your own home if you like.
- **Photos stay on your computer.** They are shrunk to about 100 KB, kept with your data (and in your backup file), and never uploaded. The app does not download photos of cars from the internet.
- **Waffle chart.** Overview has "If you earned $100": 100 squares, one per dollar, colored by where the money went. It is easier to read than percentages.
- **Charts move.** Rings, donuts, gauges and bars fill in, lines draw themselves, and goals have progress rings. Everything respects the reduced-motion setting in Settings.

## Studio look

Settings → Appearance has a new **Look** choice: *Studio* is near-black and cinematic, with large light numbers, flat dark panels, a spotlight glow and, on the car loan page, your car on a lit stage with a floor reflection and headlight glow. Quick-action buttons (Payoff, Charts, Extra payment, Refinance, Payments, Contract) jump to each section, and the Mortgage tab has the same for the house. *Glass* is the original light look. A one-time banner on Overview offers Studio; you can switch any time.

## Overview home screen

The Overview now opens like a car app's home screen: a greeting, your net worth in large type with a 90-day line (from your account balance history) and the change, one-tap shortcuts (Add, Import, Bills, Can I afford it?, Loans, Home), then a row of cards you scroll sideways: **Safe to spend** (what is left per day this month after bills, with a ring of how much of the month's income is used), your **car** with its payoff, your **home** and equity, **Bills** due, **Debt** and your debt-free date, **Spending**, **Investments** and your top **Goal**. Only the cards you have data for appear, and each opens its page. The month's detail (tiles, charts, budgets, the $100 chart, history) follows underneath.

## Windows

A Windows installer (`Tally.Money-Setup-<version>.exe`, 64-bit; it also runs on Windows on ARM) is built by the same GitHub Actions workflow and attached to each release, after the Mac files. Run it, and if Windows SmartScreen says it protected your PC, choose **More info**, then **Run anyway** (the installer is not signed, which would need a paid certificate). Your data lives on that computer only; to move it from the Mac use Download backup on the Mac and Restore from file on Windows, or use the hosted version.

What is the same: every tab, bank sync, statement reading, the Assistant (install Ollama for Windows), the Dashboard, the desktop widget window and the backup. Your Plaid, AI and update keys are stored with Windows' own credential protection and are not shared with the Mac, so enter them again on Windows.

What is different: no Liquid Glass or macOS widget (the CSS glass look is used), and no in-app install of updates. **Check for updates** still tells you when a newer version exists and links to the release page; download the new installer and run it over the old one, and your data stays.

Honest limits: the build is checked in CI (it must produce the installer), but I could not run the Windows app myself, so expect rough edges and report them.

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

Settings tab, Backup panel. "Download backup" saves a JSON file with everything. "Restore from file" reads one back, shows what it contains, and asks before replacing your current data. Use it to move between devices or to recover after clearing site data.

## Importing CSV and PDF statements

Transactions tab, Import statements panel. Both go through the same review screen: edit dates, descriptions and categories, flip the sign of any amount, untick rows, and nothing is added until you press Import. Rows that match transactions already in the app (same date, amount and merchant) are unchecked, so overlapping files do not double count.

**CSV.** Works with exports from most banks without setup: the delimiter (comma, semicolon, tab), a header that is not on the first line (bank summaries above the table), a Details column next to a Description column, Transaction Date versus Post Date, separate Debit and Credit columns, a Type column, day-first or month-first dates, decimal commas, parentheses or trailing minus signs for negatives, and files with no header at all. Credit card exports that list purchases as positive numbers are detected and flipped. If the app cannot tell which column is which, it shows the first rows and lets you pick Date, Description, Amount (or Money out and Money in) yourself.

## Limits

- No bank connection. Live sync would need an aggregator such as Plaid plus a backend to hold the API keys.
- No bill negotiation or cancellation. You cancel with the provider, then mark the subscription cancelled to count the savings.

## Moving to another computer, and the password

Open **Settings** in the sidebar; the Security section holds these.

- **Move to another computer (Mac ↔ Windows).** Choose a password for the file and press *Save transfer file* (a Save dialog opens; pick your flash drive). On the other computer open Agent X → Settings → *Open a transfer file*, choose the file, enter the password and press *Replace my data*. The file is the normal backup JSON sealed with AES-256-GCM, with the key derived from your password using PBKDF2-SHA-256 (600,000 rounds). *Save without a password* is available but the file is then readable by anyone. Bank connections and API keys are not copied: they stay on the computer where they were set up.
- **Password for the app.** *Turn on password* encrypts the data stored on this computer with the same scheme (`tally-vault-v1` in local storage; the plain copy is removed only after the encrypted copy has been read back and verified). The app then opens to a lock screen, locks itself after a chosen idle time (default 5 minutes), and can be locked on demand. The password can be changed or turned off from the same panel. There is no recovery: forgetting it means erasing the local data and restoring from a backup file.
- Not encrypted: the list of linked bank names and the stock-price cache. Bank/API keys are held by the operating system's secure storage as before.
- This is a password for the computer, not an online account; nothing is sent anywhere. (The hosted web build keeps its own server-side accounts.)

## Updating on Windows

In **Settings → App updates**, when a newer release exists the Windows app shows **Download and run installer**. It downloads the Setup file, checks its SHA-256 against the checksum GitHub publishes, opens it and closes the app so the installer can replace it. Click through the installer, then reopen Agent X; your data stays. Windows may show a SmartScreen warning because the installer is unsigned (More info → Run anyway). The Mac app still replaces itself in place.

## Settings tab

The former Appearance tab is now **Settings**. It holds Appearance (look, colour, type and motion), App updates, and **Backup** (Download backup / Restore from file), which moved here from Transactions. Security (the password and moving to another computer) is a section of Settings too.

## Pay now links, and your own car in the payoff race

- **Pay now.** The app never moves money or sees your lender login. For each bill, loan, card and the mortgage, press **Add pay link** and paste the address of your lender's payment page (open their site, sign in, go to where you make a payment, copy the address). From then on **Pay now** opens that page in your browser; the lender's site is shown next to the button so you can see where it goes. Only plain `https://` addresses are accepted (no `javascript:`, no logins inside the address, no IP addresses). Links are saved with your data and included in backups and transfer files. Press the pencil to change or remove one. After paying, use **Mark paid** on the Bills tab.
- **Your car in the payoff race.** When the car loan has a photo with a plain light background (a dealer or manufacturer picture), the car that drives along the payoff road is cut out of that photo, so it is your real car. Photos with busy backgrounds fall back to the drawn car.

## Your car as a graphic, and drawing it with AI

- The car on the car-loan page is now a clean drawing with no background, so it sits on the app instead of in a white box. The Civic Type R has its own detailed drawing (wing, red-trimmed skirt and calipers, spinning wheels) in any body colour. The same drawing drives in the payoff race. A photo is still available: **Show my photo instead** on the car page switches to it, and **Show the drawing** switches back.
- **Settings → Your car → Draw my car with AI** asks Claude, with your own Anthropic API key, to draw the car as SVG from a description (and, if you tick the box, your photo as a guide). It costs roughly 15 to 40 cents per drawing. The drawing is cleaned before use (only shapes and gradients are kept: no scripts, styles, images or links), saved with your data and included in backups, and shows in the hero and the payoff race with spinning wheels. **Use the built-in drawing** reverts it. This needs the desktop app and a key (Transactions → AI analysis).
- The **Desktop widget** panel moved from Transactions to **Settings → App and data**, next to Backup.

## Touch ID unlock (Mac)

With an app password on, **Settings → Security → Unlock with Touch ID** (Mac with Touch ID only; no Mac has Face ID) lets you open the app with your fingerprint. You confirm your password once; the app keeps a copy in the Mac's Keychain (through Electron's safeStorage, in `secrets.bin`) and hands it to the page only after the system Touch ID prompt succeeds (`biometric.js`). The password is still the real encryption key: Touch ID is a shortcut to it, so anyone who can already run programs as you on your unlocked Mac is a weaker barrier than the password alone would be. Changing or removing the password turns Touch ID off. The lock screen asks for Touch ID automatically and keeps the password box as a fallback.

## Apple Card payments are shown as payments, not income

On an Apple Card (or any credit card) import, money coming in is a payment you made to the card. It is now labelled **Card payment**, shown without a green "+", checked by default and imported as a transfer: it appears in Transactions (with the **Count it** button if you ever want it counted) but is never income or spending, so nothing is counted twice. The import message says so ("2 are payments you made to the card"), instead of calling them transfers between your own accounts. Because the card's own payments are now in the app, the matching payment from checking ("Apple Card GSBANKPAYMENT") is also left out of spending automatically. Ordinary transfers between your own accounts (savings to checking and so on) stay unchecked as before.

## Cash back: what each card earns against what it costs

**Loans → Credit cards** has a **Cash back** panel (and the Overview shows a Cash back card). It answers "am I gaining or losing by using this card?"

- **Finding it.** Apple Card's Daily Cash, "cash back reward", "rewards credit", "statement credit for rewards" and similar credits are recognised automatically. If one is missed (or wrongly caught), use the **Cash back / Not cash back** button on that transaction in Transactions. Cash back is a reward, so it is kept out of income and spending everywhere else in the app.
- **Per card.** Transactions now remember which card they belong to: bank sync does it automatically, and card statement imports ask **Which card is this?** (Apple Card is automatic). Importing a statement you imported before links the old transactions to the card, so you do not need to delete anything. Cash back that is not linked to a card yet is listed with a button to link it.
- **The numbers.** For each card and in total: cash back in the last 12 months and all time, the cash-back rate on what you spent, interest and fees found in your transactions (interest charges, annual fee, late fee, foreign transaction fee and so on), and the **net** (cash back minus interest and fees), with a plain verdict: gaining, losing, even, or careful. A card with a balance and no interest rows imported is judged from the balance and rate in Accounts: if the interest of carrying that balance costs more per month than the cash back you earn, the card says so.
- **Limits.** Only what is in the app is counted, so interest and fees must be in the statements you import (or synced). Cash back that is paid out as points or miles, or only appears on a portal, is not in your transactions and is not counted.

## Credit score tab (was "Credit")

- **Scores per bureau.** Enter TransUnion, Equifax and Experian scores together (one form, one scoring model, one date), or let AI read a screenshot of Credit Karma or your bank's score screen. The tab shows a gauge for each bureau coloured by the bands of that scoring model (VantageScore and FICO draw the lines differently), the change since last time, how far you are from the next band, one trend chart with all bureaus, and a note when bureaus differ a lot.
- **Cannot be pulled automatically.** Tally does not and cannot read your score from the bureaus: that takes a paid agreement with the bureaus, and logging in to Credit Karma for you would mean handing the app your password and breaking whenever the site changes. The screenshot reader is the closest thing: you take the screenshot, Claude reads the numbers with your own Anthropic key (about 5 to 15 cents), and you check them before they are saved. Crop out your name and account numbers first.
- **Smarter than a generic score page.** It grades the factors from your own accounts (payment history, utilization with the 10/30/50% marks, age of credit from the opening months you enter on each card, new credit, mix, derogatory marks), shows each card's use, and builds a **paydown plan** with the exact dollars per card to get under 30% and under 10%, with a rough range of the points moves like that have typically added (a guide, not a prediction). It tells you what closing a card would do to your average account age. "What moved your score" connects a score change to your cards' balances at the time, and "For you" lists alerts: a stale score, a big move, a card near its limit, a bureau gap, a closed card with a balance, how many points from the next band.
- Scores, opening months and the screenshot flow are included in backups. The Overview shows a Credit score card.

## Undo and redo on every tab

Every page has **Undo** (and **Redo** after an undo) next to its title, and Ctrl or Cmd + Z / Shift + Z work when you are not typing in a box. The app keeps the state before each change (changes within a moment of each other count as one step, up to 30 steps, in memory only, so closing the app clears them). It covers imports, restoring a backup, edits, deletions and Start fresh. It does not cover a **bank sync** (the bank does not send those transactions again, so undoing one would lose them): a sync clears the undo history.

## Apple Card balance

An Apple Card export has no balance, so the Apple Card account starts at $0 owed. The Accounts tab and the Apple Card panel now show a box to type the balance from Wallet (Apple Card, Card Balance). Importing over the example data now warns first that it replaces the example accounts.

## Add a credit card from a statement (no bank link needed)

When a bank (Chase, for example) will not link through Plaid, use **Add a card from a statement** on **Loans → Credit cards** (also on the Credit score and Accounts tabs). Choose the card's PDF statement (or its CSV/OFX download, one or several months at once). The app reads the statement on your computer, without AI, and fills in a review form: the card name from the bank, product and last four digits, what you owe (the statement's new balance), credit limit, purchase APR, minimum payment, due day and statement date, plus the interest and fees it charged. You fix anything wrong and press **Add this card**. It creates the credit card account (or updates the one with the same last four digits or the only card from that bank) and imports the statement's transactions linked to the card: payments to the card are kept as transfers, cash back is recognised, and transactions you already have are skipped. A CSV has no card details, so with one existing card it updates that card; otherwise type the details in. Layouts for Chase, Capital One, American Express, Citi, Discover, Bank of America and others are matched by their labels; a card statement it cannot read is reported field by field so you can type the rest.

## Cash, wallet and receipts (Transactions tab)

- **Cash in my wallet.** Type what you have on you and it becomes a "Wallet cash" account that counts toward net worth. "I took out cash" adds to it.
- **I spent cash.** Adds a spending row marked "Paid in cash" and takes it out of the wallet.
- **Scan a receipt.** Choose a photo (or several); Claude reads merchant, date, total and category with your own API key (about 3 to 8 cents a receipt). You review and edit every field before anything is added. Possible duplicates of an existing transaction are flagged, and card receipts warn that your bank import may already have them.
- **Scan with my iPhone.** Starts a short-lived local server and shows a QR code. Scan it with the iPhone camera (same Wi-Fi), take the photo, and it appears in the app for review. The link works for 15 minutes, is a random one-time address, and is plain HTTP on your home network only; stop it any time. The first run may trigger a firewall prompt.
- **ATM withdrawals.** Once you log cash spending, the app offers to mark ATM withdrawals as transfers so the same money is not counted twice.

## Assets, depreciation and maintenance (Assets tab)

- **Add a car, motorcycle, boat, RV, ATV or anything else you own.** Each one is saved as a property account, so its value counts toward net worth. If you added it on the Accounts tab before, remove that copy so it is not counted twice.
- **Value.** Type the value with a source (KBB, dealer offer, your estimate). Kelley Blue Book has no public data feed and its terms forbid scraping, so the app opens their page for cars (a search for other kinds) and you copy the number in. "Estimate with AI" asks Claude for a range from general knowledge; it has no live market data, is labelled as not KBB, and is often off by 10 to 20 percent. It uses your own API key (a few cents).
- **Depreciation.** The yearly rate comes from the values you record, else from what you paid, else the AI figure, else a rule of thumb per kind of asset (those defaults are rough guesses, not market data). Projections for 1, 3 and 5 years assume a fast early drop eases off. A linked loan shows your equity.
- **Maintenance and yearly fees.** Add common items (oil change, tire rotation, registration renewal and so on) or your own, every N months and/or every N miles or hours. Due dates use whichever comes first, and mileage is converted to a date from how fast you actually use the vehicle. Items due this month or later appear on the Bills tab as upcoming bills; Done records the service and schedules the next one.
- **New categories.** "Fees and taxes" (vehicle registration, licenses and permits, property tax, bank and card fees, late fees) and "Repairs and maintenance" (car repair and service, parts, home repair, appliance and HVAC, yard and pool, pest and cleaning, motorcycle and boat) with merchant rules, so imports sort into them automatically. Transactions already filed elsewhere can be moved with Edit.

## Imports, replacing and duplicates (Transactions tab)

- **Imports and duplicates panel.** Every statement import from this version on is recorded. "Remove" deletes only the transactions that import added (with a confirmation). "Everything linked to an account" removes all transactions linked to a card, which also covers imports made before this version. Everything can be undone with Undo until you close the app.
- **Replace instead of skip.** When a statement you add again is "already in the app", press "Replace the N already in the app": the old copies are deleted and the file's rows are imported in their place. This also fixes rows an older version misfiled (for example card payments shown as income). Category edits you made to the replaced rows are lost.
- **Duplicates.** Transactions with the same date, amount, name and account are grouped. Copies that are probably the same row imported twice can be removed in bulk (one copy is kept, preferring the one you edited or linked to your bank). Identical rows from one recorded import, or typed in as cash, are listed but only removable one at a time, because two identical coffees on a day can be real.

## Autopay (Bills tab)

Press **Autopay** on a bill (or tick "On autopay" when adding or editing one). Loan and card bills have the same button, and it is remembered on the loan or card. An autopay bill shows "Autopay · due date" instead of a countdown or Mark paid warning, still counts as money going out this month, and turns Paid when the payment shows up in your transactions. If nothing matching appears more than 3 days after the due date, it turns red as "Autopay not seen", so a failed autopay does not go unnoticed. The flag is included in backups.

## Hidden bills (Bills tab)

Press **Hide** on a bill, or add keywords in the **Hidden bills** panel (for example "therapy, clinic"). Any bill whose name contains a keyword shows as "Hidden bill" on the Bills tab, the Overview and the Dashboard, and its name is left out of what the AI assistant is sent. The amount and due date still count in your totals and pending bills. "Show hidden names" reveals them until you switch it off again, and Unhide removes the matching keywords. Keywords are saved in backups. This hides names on screen only: the bill's name is still stored in your data on this computer and in transactions that match it, so it is not encryption (the app password in Settings does that).

## Card payments, editing and filtering (Transactions tab)

- **How the app decides a credit card payment.** It looks at the description: "payment thank you", "autopay payment", "online/mobile/web/electronic payment", "ACH deposit internet transfer from account ending…", "credit card pmt" and similar, plus the Type column of a card CSV ("Payment"). Pay, refunds, rewards, interest and person-to-person money (Venmo, Zelle, PayPal) are never treated as payments. A credit already linked to one of your cards also counts when its name has a payment word. Rows it flags show "Card payment, not counted" and stay out of income and spending.
- **Teach it.** Edit any row, set **This is** to Credit card payment, Transfer, Cash back or Real spending or income, and leave "Do the same for every similar transaction" ticked: the app applies it to every row from that merchant in that direction (money in or money out separately, so a merchant's purchases are not touched) and remembers it for future imports. The Edit form can also link a transaction to a card and add a note.
- **Filters.** Search (name, note or sub-category), category, kind (spending, income, card payments, transfers, cash back, paid in cash, uncategorized), and under "More filters": dates (with This month, Last month, Last 30 days, This year), amount range, linked card and sort order. The line under the filters shows how many match and what came in and went out. With filters on, **Fix all N at once** marks every matching transaction as a card payment, transfer, real spending or cash back, or sets their category, after a confirmation. Undo works until you close the app.

## Energy tab

- **Electricity** moved here from the Bills tab (Green Button file or typed bills, as before).
- **Heating fuel: propane, heating oil, natural gas, wood.** Add a delivery or bill by hand, upload your supplier's history (a CSV works without any key; a PDF is read by Claude with your own API key), paste lines of text, or pull the costs from your transactions (you add the gallons later). Deliveries are spread over the days between fills to get use per month, so two or more fills are enough; fills closer than 10 days are treated as one top-up. Records already in the app are skipped on re-import.
- **Weather.** Enter a town or ZIP and the app loads past daily temperatures from Open-Meteo (free, no account) and turns them into heating and cooling degree days. Only the place and dates are sent. The charts show use per day with degree days, a scatter with a fitted line (base use and use per degree day), this year against last year, cost by month for every fuel together, and the price you paid per gallon. The "next fill" date and the next-12-months cost use normal weather for each month from the years you have.
- **How to save.** Advice built from your own numbers: the weather-adjusted change since last year, months that used more than the weather explains, the price you paid against your average and by season, a thermostat estimate, a cost-per-million-BTU comparison of propane, oil, gas, baseboard and a heat pump (efficiency adjustable), and a heat-pump estimate. Dollar figures are estimates and say so. "Get advice from Claude" sends only monthly numbers and weather, no names or addresses.
- **Hidden bills** moved to Settings.

## Bills that mark themselves, and connections between tabs

- **Auto-paid.** A bill turns Paid when a matching expense shows up in any account or card: by the words in its name (or the learned words), by its category and sub-category, or, failing that, by an amount within 1% on a date within 5 days before to 7 days after the due day ("Paid (by amount)", with **Remember it** to learn the merchant's name for next month). Transfers, ATM rows, refunds and fees are never taken for a bill by amount, and one payment can pay only one bill. A bill due near the end of the month counts a payment made in the first week of the next. A credit card's own bill turns Paid when the payment appears on that card (for example from its statement). Press **Not paid?** to override any match.
- **Bills ahead.** The Bills tab can now look up to three months ahead. Maintenance and yearly fees from the Assets tab, and the next propane or oil fill (an estimate from your deliveries and the weather, labelled as such), appear in the month they fall due. A recorded delivery or a matching payment replaces the estimate.
- **Fixes found while checking the tabs against each other:** the desktop widget now lists the bills from the Bills tab (with hidden names masked) as well as subscriptions; deleting a cash transaction, or changing its amount, puts the cash back in your wallet; choosing a category from a row's drop-down no longer leaves a sub-category from the old category; deleting a custom category moves its bills to Other too.

## Credit cards tab
Every credit card now lives on its own **Credit cards** tab (it used to be a chip under Loans). The top shows all cards together: what you owe, combined credit used, minimums due, estimated monthly interest, 12-month spending and cash back net, plus plain-language findings (which card to pay extra on, cards over 50% of their limit, cards with no linked transactions) and a side-by-side table and a month-by-month spending chart by card. Each card then gets its own panel with its utilization bar, balance over time, spent vs paid by month, top categories and merchants, recurring charges, interest and fees, cash back, and a list of what stands out. The card's edit, remove, statement and pay buttons, the payoff estimate, the cash back panel, the pay-it-off-faster planner, payments found and the statement import all moved here. The Dashboard's cash back card became a Credit cards card, and the Credit score tab links to it. In Transactions, "Fix all N at once" can now link the filtered transactions to a card.

## Vehicles: real cost, upkeep and service history
On the Assets tab each vehicle can be linked to its car loan. It then shows what the vehicle has really cost: the price plus all the loan interest (paid so far and still to come), what it lost in value, your equity (or that you are upside down), the upkeep you have linked to it and what owning it costs per month. Repairs and fees can be linked to a vehicle from the Edit transaction form, in bulk from the new "Repairs not linked to a vehicle" panel, or on a bill (Bills > Edit > Vehicle). The top of the tab lists upkeep coming up with a suggested monthly amount to put aside (each cost spread over the months left), the yearly upkeep estimate and a one-click savings goal; the same suggestion appears on the Bills tab and as an Overview card. Carfax and similar services have no way for an app to connect to your account, so instead you add the report as a PDF: Claude reads the services, the app sets each item's last-done date and mileage, and shows how often you really do each service, with the option to use those intervals.

## My pay, Documents
**My pay** shows your pay the way a payroll site does: the next paycheck (date and expected take-home, learned from your pay schedule), the latest pay statement split into gross, taxes, benefits, retirement, after-tax deductions and take-home with year-to-date columns, pay history, and a "What changed" list that compares each paycheck with the one before it (take-home change and why, new or removed lines, a withholding jump that may mean a new W-4, retirement or benefit changes, hours, year-to-date totals that do not add up) and warns if an expected paycheck has not shown up as income. Add a statement as a PDF or by hand. PDFs are read on your computer first by `paystub.js`, which matches labelled lines (built around ADP's layout, including its space-separated numbers such as `3 451 50`), treats `-` amounts as deductions and `+` amounts as credits, ignores employer-paid items, and checks that gross minus deductions plus credits equals take-home; nothing is sent anywhere and no API key is needed. If the numbers do not add up or the layout is unknown, Claude reads it instead when you have saved an API key; otherwise the best reading is shown with a warning, or you add it by hand. Either way you check the numbers before saving. Below the statement, **Where your paycheck goes** breaks the paycheck into taxes, benefits, retirement and after-tax deductions: a split bar, every line with its share of gross, year-to-date and yearly cost, a stacked chart over your last paychecks, your retirement pace against the IRS employee limit, your pay in other terms (per year, per month, per hour) and plain-language notes on what stands out. ADP and payroll sites do not let apps connect to a personal account, so there is no live link; the PDF route is the practical one. **Documents** is a folder on your computer (Documents/Agent X) with a subfolder per kind (pay statements, tax documents, bank and card statements, vehicle records, energy bills, receipts, other) and a year inside each; files you add to My pay, a vehicle's service history and Energy are filed there automatically, and the Documents tab opens any folder or file.

## Taxes
The **Taxes** tab estimates what to expect at tax time. Pick your state and filing status (and children under 17, other or self-employed income, mortgage interest, property tax, donations, which come from your transactions if left blank). The federal estimate uses the 2025 and 2026 brackets and standard deductions built into the app (a year without official figures falls back to the nearest one, and says so), and works from your pay statements projected for the whole year, or your W-2 once you add it, or a yearly pay you type in. It shows refund or amount owed for federal and a rough state figure (a typical average rate per state that you can override), how the number is built, the extra withholding per paycheck that would avoid a bill, what $1,000 more into a 401(k), IRA or HSA saves, quarterly estimates when you have self-employed income, and the filing dates. W-2 and 1099 PDFs are read by Claude for you to check, then filed in Documents. It is an estimate, not tax advice: it does not model every credit, phase-out or state rule.

### Looking up tax figures online
On the Taxes tab, "Look up the latest figures online" has Claude search the web (IRS and your state's revenue department first) for the federal brackets, standard deduction, Social Security wage limit and your state's typical rate. Every figure is checked (seven known rates in order, rising bracket tops, plausible ranges) and shown beside the current value with its source links; nothing is used until you press Use these, and "Go back to the built-in figures" undoes it. Only the tax year and state are sent. It uses your Anthropic key (a few cents) and needs the desktop app.

### Vehicle values from listings online
On a vehicle, "Look up listings online" has Claude search the web for comparable listings (same year, make, model, similar mileage) and show them with links, the range and the median asking price, with the yearly depreciation for that model. It needs at least three real listings or it reports nothing. These are asking prices, which run higher than what you would get selling or trading in, and they are not Kelley Blue Book. Use sets the value (source "Web listings") and the depreciation rate. It uses your Anthropic key and needs the desktop app.

### Depreciation that does not invent gains, and modifications
A vehicle's rate of value loss is now worked out from your recorded values and what you paid, blended with a typical rate for that kind of asset until there are two years of data, and it never falls below 40% of the typical rate: a value that rose since you bought it is treated as market prices and inflation, not appreciation (the page says so, and shows the loss in real terms after about 3% inflation). Mark an asset as a collectible to allow it to gain value. The typical rate also moves a little with how much you ride or drive. On each asset, Modifications records what was installed, its cost and a share of that cost it adds to the value (accessories 50%, wheels 40%, performance 30%, cosmetic 20%, editable); the value rises by that amount, the cost counts toward what you have put into the asset, and the added value is not mistaken for market gain.

### Tab layout
Drag any tab in the navigation to move it; the order is remembered on this device (like the theme). Settings > Tabs also has up and down arrows (for a phone or the keyboard), a reset, and a Side or Top switch that puts the tabs in a bar across the top instead of down the side (the mouse wheel scrolls the bar sideways and the open tab is kept in view). Phones keep the bar at the bottom, in the same order.
Tabs can also be hidden: Settings > Tabs has a Hide/Show button for each one (Settings itself is always shown) and a Show all tabs button. Hiding only removes a tab from the navigation on this device; its data stays and links to it elsewhere still open it.
Hiding and showing tabs can be protected: Settings > Tabs > "Protect hiding and showing" makes the Hide, Show and Show all buttons ask for a password first (two minutes of grace after a success). It uses your app password if you have one (and Touch ID if that is on), or a separate tab password, stored only as a salted hash, with optional Touch ID on a Mac. It is a lock on the buttons, not encryption: for real protection of your data use the app password in Settings > Security. The app has no Face ID, and Windows uses the password.

### Windows
Every release has a Windows installer (`Tally.Money-Setup-x.y.z.exe`, 64-bit, installs for your user, and the app updates itself) and a portable version (`Tally.Money-Portable-x.y.z.exe`) that runs without installing, for example from a USB stick. The portable version keeps your data in your Windows user profile (AppData), not on the stick, and the in-app updater always fetches the installer, so to update a portable copy download the new portable file from the releases page. Neither has been run on a real Windows PC by me; the Windows build is made on GitHub's Windows runner.

### Search, budget detail and keywords, goals that follow accounts
**Search** (the Search button at the top of the navigation, Ctrl or Cmd + K, or press `/`) looks across the whole app: pages and settings, budgets, transactions (by merchant, note, category, sub-category, amount or month; with a summary line of how many match and the total), bills, accounts and loans, vehicles with their maintenance and modifications, goals, subscriptions, pay statements, tax forms and files in Documents. Arrow keys move, Enter opens, Esc closes. The Transactions search box now also matches several words and the category.
**Budgets:** click a budget (or a category name in the Monthly report or on the Overview) to see that category month by month for the last 12 months with the budget line, how this month compares with the usual, how often it went over, where the money goes, regular charges, the forecast and the month's transactions. Every category, built-in ones included, has **auto-sort keywords** (on its row and in its detail page): a transaction whose description contains one is filed under that category, including imports and bank syncs; the longest keyword wins, your keywords come before the app's built-in guesses, and the matching past transactions can be moved in one click (merchants you corrected by hand are left alone).
**Goals** can follow an account's balance, so saving into that account updates the goal without a second entry.
The search box also answers questions without opening anything. Opened empty it shows an "At a glance" list (net worth, spent this month, next paycheck, bills still to pay, budgets that are over, upkeep coming). Typing a question gives a straight answer on top, such as "net worth", "spent last month", "groceries this month" (spend, budget left, and a link to its month-by-month page), "next paycheck", "bills due", "what do i owe", "tax refund", "credit card utilization", "cash back", "budgets over" or "income this year". Time words (this month, last month, this year, last 30 days, a month name like march or oct 2025) narrow a search: "shell last month" counts only last month's transactions.

### Metered and itemised heating bills
Energy records for propane and oil now keep **gallons**, the **price per gallon** (the supplier's printed PPG, or worked out from the cost), **fixed fees** such as a meter or delivery fee (kept out of the price, with an "all in" price shown next to it), the **billing period** and, for metered customers, the **meter readings**. A supplier invoice laid out as a table (Date, Gallons, Product, PPG, Total, with the fee on its own line and meter readings below) is read on your computer for free; other PDFs go to Claude, which now also returns the fee and price. A bill that states its own period is used as that period's use directly, so a metered customer does not need delivery-to-delivery guessing, and the Bills tab expects the next invoice (about the average of the last three) instead of a tank fill. The payment of the same total is linked to the record, and the transaction then shows "32.976 gal @ $4.299 + $19.99 fee". The Energy tab flags fixed fees that are a large share of what you spend, and the manual form takes gallons, price per gallon and fees and works out the total.


## W-2 reader (Taxes tab)
`taxparse.js` reads a W-2 PDF on your computer: it matches the printed box labels (amount after the label, or the IRS layout with amounts in the row below), reads box 12 codes (401(k), Roth, HSA, employer health cost) and the state code, and checks the result against rules every W-2 follows (Social Security is 6.2% of box 3, Medicare 1.45% of box 5, box 1 not above box 5). If the check fails or the layout is unknown, Claude reads it instead when an API key is saved; otherwise the best reading is shown with a warning. You always check the numbers before saving. No names, addresses, SSNs or EINs are returned. It was built from the standard IRS W-2 box layout; it has not been tested on real W-2 PDFs from a payroll site.

## Editing bills
Every bill on the Bills tab can be changed, whatever its source (a bill you added, a loan or card, one found in your transactions, or a fuel estimate). **Edit** (or **This month** on bills you added) lets you set the amount (for this month or every month), the due day, what you have **paid so far** (the bill then shows what is left and counts as paid when the rest is covered), the months you expect it in (a seasonal bill such as propane), or skip it for the month (**Not expecting it this month**, which takes it out of the totals and the overdue count). **Back to automatic** undoes your changes. Changes are stored per bill in `billAdj` and do not touch the loan, card or fuel record the bill came from.

## Help
A round **?** button sits at the bottom right of every tab. It opens a short guide to that tab: what it does and how to use it. **Settings, then Help** has **Start the walkthrough**, a step-by-step tour of the whole app (a welcome, every tab in order, and a closing step) with Back, Next, **Open this tab** and a list to jump to any step; arrow keys and Esc work. The text lives in the `HELP` block in `index.html`, and a test fails if a tab is added without a guide.

## Look
Every tab icon is a coloured, glossy chip (one colour per tab) in the sidebar, the top bar and the phone tab bar, and the same chip heads each page. Panels get a small colour bar and tiles a coloured top edge in the tab's colour. **Energy** is neon green: a glowing lightning-bolt banner with pulsing rings and a power wave (animated unless motion is off in Settings or your system), and glowing bars, dots and lines in its charts.

Every other tab (all except the Overview and the Assistant) has its own banner in its colour: a frosted icon, a one-line promise, chips and a drawn picture (stairs for pay, a pie for budgets, a house for the mortgage, a card for credit cards, and so on). The quick-action buttons on the Overview, and the help and walkthrough, use the same coloured icon chips. The text and pictures live in `THERO` and `heroDeco` in `index.html`.

## Bonus checks and dates (My pay)
A pay statement whose only earnings are a bonus (or commission, award and the like) is recognised as a **bonus check**; you can also flip any statement with **This is a bonus check** / **This is a regular paycheck**. Bonus checks are kept out of the pay schedule, the usual take-home, **What changed** and the yearly projection, but they count in the year's totals. **Bonus checks** shows when to expect the next one, worked out from the bonus checks you added (the same time of year, on the same weekday, with a one-week window; two bonuses a year are two patterns) and from the bonus year-to-date figures on your statements. With one check it is a guess and says so; more checks sharpen it.

Dates are respected everywhere: the pay schedule is read only from your regular paychecks and only from gaps that look like a pay period (a statement from last year no longer turns the schedule into "monthly"), the next paycheck and the usual take-home come from the latest regular checks, **What changed** compares a paycheck only with the one before it (and says so when that is months away), a year's projection uses only that year's regular paychecks, and a statement months old is flagged as not used for the next paycheck.

## Undo for pay statements
On My pay, a bar under the buttons shows **Undo: added the statement of Oct 2** (and **Redo**) for every change to your statements: adding one (a PDF or by hand), removing one (the x on each history row, or the button on the statement), marking one as a bonus or regular, or **Remove all statements** (asks first). It steps back one change at a time and does not touch anything else in the app; it is kept while the app is open. The Undo at the top of every page also covers these. Statement copies already filed in Documents are not deleted, and adding the same PDF again does not file a second copy.

## Guided tour
**Settings, then Help, then Start the walkthrough** runs a guided tour: it opens each tab for you, scrolls to the part that matters, dims the rest of the page and lights that part up, with a card that says what it is and how to use it. **Next** and **Back** (or the arrow keys) move through it; **Play** (or P) lets it advance by itself at a reading pace; **Skip tab** jumps to the next tab; **Exit** or Esc stops and returns you to where you were. The **?** button on any tab has **Tour this tab**, which starts from that tab. **Read the guide** is the older text-only walkthrough. Steps that point at something not on the page (a panel that only appears once you have data) are skipped, and a tab with nothing to point at shows a plain card. The tour changes nothing in your data. The steps live in `TOURS` in `index.html`; a test fails if a tab has none.

## Scenes and the dock
Every tab has its own backdrop behind the glass, in its colour, with its own pattern and motion: diagonal money stripes for My pay, a ledger for Taxes, a lattice for Assets, perforated receipt lines for Bills, a flowing matrix for Transactions, a rising wave for Investments, a staircase for Loans, roofs for the Mortgage, bubbles for the Assistant, and for **Energy** a neon-green circuit grid with flickering lightning bolts and a sweeping glow. The scene fades in when you switch tabs and drifts slightly with the pointer. It follows Settings: it is off with the Plain background, still when motion is off, and it does not use the native Liquid Glass window.

The tab list works like the macOS Dock: icons grow and slide out near the pointer, and when the list is longer than the window, hovering near its top or bottom edge (or the left and right edge of the top bar) scrolls it. This is for a mouse; touch screens keep the plain list.

## Sound
Small synthesized sound effects (no audio files, so no size cost): a soft click on buttons, a tone for each tab (a zap for Energy, a coin for My pay, a stamp for Taxes, paper for Bills and Documents, a ding for Goals), a tick as the Dock passes each tab, chimes when something is saved, a low note for a problem, a swoosh for undo, and blips for the tour. **Settings, then Sound** has an On/Off switch, a volume slider and **Play a test sound**; the choice is remembered on this computer. Browsers only allow sound after you have clicked something, so nothing plays before your first click.

## Years
Dates now carry their year wherever it matters. A date from another year always shows the year (`Oct 24, 2025`, never just `Oct 24`), in lists, the pay history, search results and previews. When you import a statement or CSV, the review shows the span of the dates with their years and warns about anything that looks like a year mistake: dates in the future, dates over a year old (they are filed in the months and years they belong to and do not change this month's numbers), or a batch that spans two years. A statement that prints no year is read against the statement period; with no period either, a date that would land in the future is taken to be last year's. An older loan or card statement no longer overwrites a newer balance (it is skipped and you are told), and a balance imported from a statement is dated by the statement, not by the day you imported it. A recurring charge that last happened long ago is not suggested as a current subscription, a bill's usual due day comes from your recent payments rather than all of history, and the pay features only compare and project from statements of the right period.

## Analyst rating on Investments

Each holding in the list now shows an **Analysts** pill next to the volatility pill (Strong Buy, Moderate Buy, Hold, Moderate Sell, Strong Sell), and the selected holding's panel has an Analysts tile. It reuses the consensus already loaded for the stock page (Yahoo Finance via the desktop app), cached for 6 hours in memory. Holdings with no analyst coverage (many funds) show no pill. It is information from banks and research firms, which are often wrong, not advice.

## Big windows and full screen

The app used to stay in a 1120px column however large the window was, leaving wide empty sides in macOS full screen. It now grows with the window (up to 1440px from 1500px wide, 1760px from 1900px, 2080px from 2300px), and the six Overview tiles lay out as 3 + 3 (6 across on wide windows) instead of 5 + 1.

## Bottom tab placement

Settings → Tabs → Placement now has Side, Top and **Bottom**. Bottom turns the tabs into a floating dock along the bottom edge with the same hover magnification, and a Search button at its start.

## Several jobs

My pay now looks for more than one job. The pay-stub reader picks up the employer's name (on ADP layouts it is the left column of the "Period Beginning" line, or a labelled Employer/Company line), and statements are grouped by employer. When statements have no employer name, two regular statements that cover the same pay period but have different deductions and clearly different amounts are treated as two jobs. This is a best guess: the **Job** column in Pay history moves any statement to another job, **Rename** names a job, and **Treat as one job** turns detection off (with Undo for each change).

With several jobs, My pay opens on **All jobs**: a comparison of take-home per month, year so far, year projection, paycheck schedule, next paycheck, trend and hourly rate for each job, plus whether it still looks active. Open a job to get the full My pay view (next paycheck, what changed, where it goes, bonus forecast) for that job alone. The next-paycheck card on Overview, the assistant and the tax estimate also add the jobs up instead of treating all statements as one schedule.

## Other income

My pay has an **Other income** section for money that is not a paycheck: gigs, payments from friends and family, gifts, things you sold, reimbursements and rental income. Add cash or a payment directly, or **tag a deposit that is already in your accounts** (so bank, Venmo or Zelle money is not counted twice). It shows this month and this year by kind, and for gig income offers to include it in your tax estimate. Gifts, reimbursements and repayments from friends are generally not taxable income, and the notes say so; this is not tax advice.

## Fixing what counts as income

In My pay → Other income, **Already in your accounts?** lists deposits that currently count as income. Each row has **Tag** (gig, gift, friend and so on), **Transfer** (money moved between your own accounts: it stops counting as income right away), **Edit** (the full transaction editor, including "same for every similar transaction" and remembering it for future imports) and **Delete** (asks first; for a deposit that is not real). Undo at the top of the page takes any of it back. **Look further back** widens the list from four months to thirteen. Deleting a deposit that came from a linked bank removes it from the app only; a full re-sync of that bank can bring it back, so prefer Transfer or Edit for those.

## Payments to friends and family

On the Transactions tab, **Friends and family** lists payments that look like they went to a person (Venmo, Zelle, Cash App, PayPal) and lets you say what each was: a split bill or paying someone back, a gift, a **loan** (money you expect back) or other, with who it went to. Any transaction can also be tagged from **Edit**. Splits, gifts and other payments count as spending as before, with a summary by kind and person. A loan is kept out of your spending until the person pays you back; tag the money coming back as **They paid me back (not income)** (in My pay → Other income, or Edit) and the panel shows who still owes you what. Untag removes the tag and it counts as usual again.

## Energy: one page per type

The Energy tab is laid out like Loans: a row at the top with **Overview, Electricity, Propane, Heating oil, Natural gas and Wood** (with how many records each has). The Overview shows the totals, a card for each type, the weather and the savings advice. Each type has its own page: Electricity has the usage import, its own tiles (12-month cost, kWh, price per kWh) and the weather comparison; each fuel has its deliveries or bills, add and import forms, cost, use and price charts, and the tips that mention it. Switching type closes any half-filled form.

## Vehicles from car loans

Every open car loan now gets a matching vehicle under **Assets**, linked to the loan, so you never enter it twice. The name, year, make and model come from the loan contract (or the loan's name); the value is estimated from what was paid (a new vehicle drops about a fifth in its first year, then about 12% a year) or, with no contract, starts at what you still owe. Those vehicles are marked "From your car loan" until you give them a real value. If you already added the vehicle by hand, it is linked to the loan instead of duplicated; if two of your vehicles could match, nothing is guessed. Delete the vehicle, or unlink it, and it is not added again for that loan. Paid-off loans do not add a vehicle. Motorcycles, boats, RVs and ATVs are recognised from the description.

## Hold and drag to rearrange

Press and hold a tab for about half a second until it lifts and the others start to wiggle, then drag it where you want it and let go, like rearranging apps on an iPhone or the Dock on a Mac. It works for the tabs in the side list, the top bar and the bottom dock, and for the rows of choices inside a tab (the Loans types, the Energy types, the jobs on My pay). A quick click still just opens the tab, and a quick drag does not move anything. The new order is remembered; Settings → Tabs → Reset order puts everything back. The arrows in Settings still work (also with the keyboard), and Esc cancels a move in progress.

## Keeping GitHub build minutes free

Builds no longer start by themselves. All four workflows (Build Mac app, Check native glass, Check native widget, Check updater) run only when started by hand from the Actions tab (Run workflow), or by the release steps in this repo's release rule (Build Mac app with a `release_tag`). Mac runners count 10 times against the free monthly allowance of private repositories, and one release uses roughly 140 allowance minutes, so a handful of releases a month fits; pushing many tags or commits that each started builds once used a whole month's allowance in minutes.

## Student loans: auto-debit rate reduction forecast

On the Student loans page, **Auto-debit rate reduction** forecasts what enrolling in auto debit would do: payoff date, interest from now and money saved, for not enrolling, for the standard cut, and for the larger limited-time cut (1.00 point by default, for loans that qualify and enrol by the deadline, then the standard 0.25 after the end date). Mark each loan as qualifies, does not qualify or not sure (not sure is counted as qualifying in the best case), pick your enrolment date, and the page shows what each month of waiting costs. The terms are the ones in the servicer's notice and can be edited (points, deadline, end date). Use each loan's rate before any auto-debit discount. The app cannot verify the servicer's rules, so confirm with them.

## What to update

Settings → Help → **What to update** checks how fresh each part of your data is and lists what to do next, most important first, with a 0–100 freshness score and a rough time for each item. It looks at: example data, account balances, the newest transaction, uncategorised spending, unfinished or out-of-date loans, the student loan auto-debit deadline, late or ended pay statements, last year's W-2 in tax season, credit score age, investment prices and costs, vehicles with estimated values, old odometer readings and overdue upkeep, old electricity bills, overdue bills, missing budgets, deposits and payments to review, and backup age.

Each item has a button that jumps to the right place, **Later** (hides it for a week) and **Not needed** (hides it for two months). If the private assistant is running, **Plan it with my private assistant** writes a short suggested order on your own computer; nothing is sent anywhere. Hidden items and the last backup date are saved with your data and included in backups.

## Touch ID to show widget amounts

On a Mac with Touch ID, Settings → Desktop widget has **Touch ID to show amounts** (on by default). With it on, un-blurring the amounts (the Blur amounts checkbox, or the eye button on the floating widget) asks for your fingerprint first; blurring never asks, and turning the lock off asks too. Macs have no Face ID, so Touch ID (or the Mac's own prompt) is what is used. The macOS desktop widget itself cannot show a prompt, so its blur is controlled from the app and is protected the same way. On Windows or a Mac without Touch ID the option is hidden and nothing changes.

## Money you borrowed from friends

Besides loans you made, you can record money a friend lent you. On a deposit in My pay → deposits to review, choose **They lent me (not income, I owe it)**, or pick it from Friends and family when editing a transaction, and add who it was from. It stays out of your income, and your **I paid them (settling what I owed)** payments count it down. Transactions → Friends and family shows **You owe** per person.

## Your stocks on the Overview

If you have holdings, the Overview shows a **Your stocks** panel: the value of your stocks, today's change in dollars and percent, the gain since you bought, one row per stock (price, today's % with a green or red bar from a shared centre line, and a 90-day sparkline, biggest gainers first), and a 1M / 3M / 1Y chart. In the desktop app it refreshes prices about every minute while the US market is open (9:30 to 4 New York time) and every 15 minutes otherwise, only while the Overview is open; a green pulsing dot means live, and a price flashes green or red when it moves. Prices come from the same free source as the Investments tab, so they can be delayed.

## Choose what the widget shows

Settings → Desktop widget → **What the widget shows** lets you tick the sections you want and set their order with the arrows: Net worth, Investments (value, today's change, biggest movers), Budgets, Due soon, Next paycheck, This month, Goal, Debts, Subscriptions and Credit score. The floating widget scrolls and can be resized by dragging its edges (the size is remembered). The macOS desktop widget shows as many of the top sections as fit its size: 2 for small, 3 for medium, 6 for large. Sections with nothing to show (no holdings, no pay statement and so on) are skipped. The widget gets only plain totals, never transaction or account names.

## Users, the setup guide and your name

Settings now has **About you** (name and nickname) and **Users**. The Overview greets you as, for example, "Good evening, Sam", and the private assistant knows what to call you.

**Add a user** lets someone else share this computer with their own accounts, transactions, settings and look. Choose **A real person** and the app creates them, switches to them and starts the **setup guide**: a walkthrough in the style of the tour that opens each tab, lights up the place to fill in or upload, ticks it off when it sees the data arrive, and lets you skip, go back or pause (Esc). It covers your name, accounts, bank link, transactions, pay statements, loans, cards, credit scores, investments, vehicles and assets, home, bills, budgets, energy, taxes, goals and an app password. Run it again any time from Settings, About you. Choose **A demo user** for a profile filled with made-up data to demonstrate or experiment in; **Reset the demo** puts it back.

With more than one user the app asks "Who is using Agent X?" each time it opens (you can turn that off), and the sidebar has a quick switcher. The first user keeps the original storage, so nothing existing is moved. Each user has their own Touch ID entry, and the desktop widget is cleared when you switch so the last user's totals do not stay on the desktop.

This is not a lock: anyone who can open your computer account can reach every user's files. Give a user an app password (Settings, Security) while signed in as them to keep their data private. The names on the "who is using" screen are not encrypted. Users are not available in the hosted web version.

## IDs and records wallet

The top of the Documents tab (desktop app) is a wallet of cards: **ID Card**, **Passport** and **Employment Records** to start, plus **+ New Category** for anything else (a visa, property or health records). Each card shows a stack of cards, a pager, how many files it holds and its expiry date. **Add / Edit** names the category, sets an expiry date and a colour, and adds photos (PNG, JPG, WEBP) or PDFs up to 15 MB. Click the stack to view the files, or tick **Show previews** to see the front file on the card (off by default, so nobody glancing at your screen sees your ID).

Every file is encrypted with the macOS Keychain (Electron's safeStorage) before it is written, lives in the app's own folder (not the Documents folder), is never uploaded, and belongs to one user of the app. If the computer cannot encrypt, nothing is saved. The wallet's list (names, dates, file names) is in your backup files, but the files themselves are not, and they cannot be decrypted on another computer, so keep the originals. A passport or ID within six months of expiring, or expired, shows up in Settings, Help, What to update.

## Widget graphics

The widget draws its numbers: a net worth graph (last six month-ends), an investments graph with the day's biggest movers as bars, a ring for how much of your budgets you have used, a donut of this month's spending by category, a countdown ring to your next paycheck, a ring for your goal, a coloured dot for how soon each bill is due and a scale for your credit score. A green dot in the title means it was updated in the last five minutes. Blurring hides the graphs and amounts too. The macOS desktop widget gets the net worth and investment graphs and the budget, paycheck and goal rings (not the spending donut).

## Move, resize and restyle windows

On most pages (Overview, Dashboard, Accounts, Assets, Investments, Budgets, Monthly report, Bills, Subscriptions, My pay, Taxes, Loans, Credit cards, Credit score, Goals, Documents) press **Customize** next to the page title. Every window then shows a bar with a **Move** handle (hold it, then drag the window where you want it), **Make half / Make full** (width), **Hide / Show**, and, for some windows, a menu to choose the kind of graphic: spending by category as a donut, bars or a list; the six months as bars or lines; your stocks as a line graph, a pie or bars; budgets as bars or rings; net worth as a line or bars. Press **Done** when finished; **Reset layout** puts the page back. Outside Customize you can still hold a window by its title for a moment and drag it. Layouts are saved per user and per page. On a narrow screen the windows stack in one column.

## Debts follow your transactions

Payments to a student loan, car loan, other loan or credit card (found by the lender's name, or by choosing **Pays toward** when you edit a transaction) lower that balance by themselves, and transactions linked to a checking or savings account move its balance. Each account remembers the balance you last gave it and its date, and shows that balance plus the transactions after it, so deleting, editing or re-importing never double counts, and entering a new balance starts again from it. Bank-linked accounts and the cash wallet are not touched, and a mortgage is off until you turn it on (its payment includes escrow). The **Debt payments** window on Debts shows what has been paid, the interest and principal parts, and how the latest payment was split between loans: minimums first, the rest to the highest rate, with interest estimated as one month of the rate. You can change a split to match your statement. Draw it as bars, a donut or a list with Customize.

## Investments tab and card

Investments is a tab of its own in the sidebar. The Investments card on the Overview shows your value, return and today's change, a 90-day graph of the value and a bar of how it is split between holdings.

Payments count from the date a balance was last entered or stated (set it per account under **Balance as of** in the Debt payments window). Withdrawals that look like loan payments but match no lender are listed there with a menu to pick the debt. A payment that is not linked to a bank account lowers the debt but not any bank balance, so the window offers to link them to the account you choose; otherwise net worth reads too high by that amount.

## Documents lock

The Documents page and every button that opens a folder, an ID or a file ask for a password or Touch ID first (your app password if you have one, otherwise a documents password you set the first time). Unlocked for 5 minutes, then it asks again; Lock now closes it. This keeps someone using your open app out of your documents. It does not encrypt the Documents folder on disk (the IDs and records wallet is encrypted separately). Document folders use the same stacked-paper cards as IDs and records.

## Back and forward, month drum, Energy tab

The ‹ › buttons at the top left of every page move back and forward through the pages you visited (Cmd+[ / Cmd+], or Alt+Left / Alt+Right). The month control is a scrolling drum with a tick sound (Settings > Sound turns it off). Energy has its own tab again; a saved tab order puts it at the end until you drag it where you want it.

## Customizing the Overview

Customize on the Overview lets you edit the shortcut buttons (name, icon, color, size, where they go, order), move and hide the cards under them, and move, resize, restyle or fold the windows. Tap a window title to fold it; tap a number or the Open button to go to the page it comes from. Shortcut and card choices are kept per user on this computer.

## The owl

The help button is an owl that flies around the app (or sits in the corner, your choice) and follows your pointer with its eyes. Tap it and type a request. It understands requests about how the app looks and is laid out: mode, accent color, text size, corners, glass, background, font, animations, sounds, tabs, windows and Overview shortcuts. It only ever performs a fixed list of actions (no code), shows what it did, and Undo that reverses it. Requests it cannot do are kept on a list you can copy and give to a developer or to Claude Code. Help for this page is inside the owl's box.

The owl first uses its built-in rules. If you have saved an Anthropic key (Settings), a request it does not understand is sent to Claude (Haiku) as the words plus the names of your tabs, windows, pages and shortcuts; nothing about accounts or transactions. The reply is checked against the same fixed action list and your real tab and window names before anything changes, and at most 40 such requests are made a day.

## Profile picture and details

Settings, You has a picture and details (email, phone, city, state, birthday, a note) for each user. The picture shows on the Overview, the sidebar and the user picker, and is stored with the profile on this computer.

## From email

On Transactions, From email reads emails you export (.eml, or one .mbox from Google Takeout) entirely on this computer. It keeps only the amount, date, merchant and a fingerprint of each message. Bank alerts about transactions already in the app are marked and skipped (matched one-to-one on amount within four days), an order email and its alert are one purchase, the same message is never added twice, and a later bank import replaces the email copy. It also suggests subscriptions from repeating charges. A direct mailbox connection needs a Google sign-in (OAuth) set up by the owner and is not built.

### Connect Gmail

From email can also read Gmail directly over IMAP (`imap.gmail.com:993`) with a Google app password (2-Step Verification on, Security, App passwords). The code is `gmail.js`: it only sends LOGIN, EXAMINE (read-only), UID SEARCH, UID FETCH with BODY.PEEK (does not mark mail read) and LOGOUT, searches recent mail about payments and leaves out promotions and social, and returns up to 300 of the newest messages to the page in memory. The password is kept in the encrypted secret store, never goes back to the page, and Disconnect deletes it. Scanned messages go through the same duplicate-safe import as exported files. Tested against a fake IMAP server only; it has not been run against real Gmail.

## Live sky and the owl's look

The whole Overview background (a fixed layer behind the page) draws the sky from the real sun position (standard low-precision solar formulas, good to a few minutes): dawn, day, a golden sunset with the sun sinking, dusk, and a night with stars and moon. It uses the place saved in Energy, else a rough guess from the computer's time zone, and updates every minute. Settings, Appearance, Live sky turns it off. The owl is a layered vector drawing with animated feathers; it is illustrated, not a photoreal render.
