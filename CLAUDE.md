# Working on Agent X

Rules the owner has set for every change to this app. Follow them without being asked.

## Keep the Help current with every update
Every user-visible change must update the in-app help in the same commit:
- `HELP` (per page, in `index.html`): what the page does and how to use it, including any new button, page or setting.
- `TOURS` (the walkthrough steps) when a new panel or button is worth pointing at.
- `WHATSNEW` (plain-words list of changes per version): add the entry for the version you are about to release. A test fails if `package.json`'s version has no entry.
- `README.md`: a short section for the feature.
- `updTasks` ("What to update") when the feature has data that goes stale.
- New pages go in `PAGES` and in exactly one tab in `HUBS`; a test checks it.

## Releasing
- Only publish when the owner says "publish it as vX.Y.Z". Never start a build or workflow to test, retry or check. Mac runners cost 10x.
- Release procedure: bump `package.json` line 3, add the `WHATSNEW` entry, `npm test`, commit, push `main`, then dispatch `build-mac.yml` with `release_tag`.
- New files the app requires at runtime must be listed in `package.json` `build.files` (a test checks this).

## Real or nothing
- Do not make up stand-ins for real-world things (sounds, photos, artwork, data). Look up a real, licensed source first, check it, or say it cannot be done here. The owner does not want tokens spent on guesses.

## Privacy
- No real personal data (names, addresses, account numbers, IDs) in the repo, tests or output. Use made-up data.

## Tests
- `npm test` runs everything that can run on Linux. Swift (`native-widget/`) cannot be compiled here: say so when it changes.
- For text, copy or help-wording changes: run `npm test` only. Do not launch a browser or Playwright.
- Use the browser only when layout, clicks or visuals change, or when the owner asks.
