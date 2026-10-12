# Tally Money

A personal money app in a single static page: spending overview, subscription tracker, budgets, transactions with CSV import, and savings goals. No build step, no dependencies, no server.

## Run it

Open `index.html` in a browser, or serve the folder:

```
npx serve .
```

It also deploys as-is to GitHub Pages, Netlify or Cloudflare Pages.

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
