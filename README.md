# Tally Money

A personal money app in a single static page: spending overview, subscription tracker, budgets, transactions with CSV import, and savings goals. No build step, no dependencies, no server.

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

## Data and privacy

Everything is stored in the browser's `localStorage` (key `tally-money-v1`). Nothing is uploaded. Clearing site data erases it, and it does not sync between devices.

The app starts with made-up example data. "Start fresh" clears it, and so does your first CSV import.

## Backup and restore

Transactions tab, Backup panel. "Download backup" saves a JSON file with everything. "Restore from file" reads one back, shows what it contains, and asks before replacing your current data. Use it to move between devices or to recover after clearing site data.

## CSV import

The file needs a header row with a date column, a description column (`description`, `name`, `payee`, `merchant` or `memo`) and an amount column (or separate `debit` and `credit` columns). Spending is negative, income positive. Categories are guessed from the description unless a `category` column matches one of the built-in categories. Duplicates are skipped.

## Limits

- No bank connection. Live sync would need an aggregator such as Plaid plus a backend to hold the API keys.
- No bill negotiation or cancellation. You cancel with the provider, then mark the subscription cancelled to count the savings.
