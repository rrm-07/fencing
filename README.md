# Piste

A mobile-first web app for scoring fencing bouts and running poules. You can use it one-handed at the side of the piste. It installs as an app and works fully offline.

- **Bout scorer:** red and green lamps, big scores, and a clock that you tap to start and tap anywhere to stop. It has undo (100 steps), cards, the épée double, priority, DE periods, and a "Bout over" banner with confirm and undo.
- **Poules:** 3–8 fencers, standard FIE bout order, and the classic V5/D3 sheet with live V, V/M, TS, TR, Ind and Rank. "Next bout" opens the scorer with names filled in and writes the result back to the sheet. Exports to CSV, PNG and print.

## Run it locally

You need Node 18 or later. There are no runtime dependencies and no build step.

```sh
npm start            # serves ./app on http://localhost:8080
```

To try it on a phone, open the "on your network" URL that `npm start` prints, with the phone on the same Wi-Fi. Service workers, wake lock and installing the app all need HTTPS (or `localhost`), so the full PWA behaviour shows up once it is deployed.

### Tests

```sh
npm test             # unit tests (node:test, no install needed)
npm install && npm run e2e   # end-to-end walkthrough in a 375px phone viewport (Playwright)
```

The unit tests cover:
- poule ranking, including ties
- bout order for pools of 3–8: every pair fences exactly once, and nobody fences back-to-back in pools of 5–8
- red and black card rules
- priority
- DE periods
- undo
- timer accuracy across a simulated background/foreground

The end-to-end script works through the app like a referee would:
1. a full 5-touch bout with cards, a clock reset and undo
2. a level bout decided on priority
3. a full 5-person poule, from creation to CSV and image export
4. a reload in the middle of a bout, and an offline start

Screenshots are saved to `e2e/screens/`.

## Deploy to GitHub Pages

The app is plain static files under `app/`, and every path is relative, so it works from any sub-path such as `https://you.github.io/fencing/`.

1. Push the repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` runs the unit tests and then publishes `app/`.

**When you release changes:** bump `VERSION` in `app/sw.js`. Installed copies then download the new files and show "A new version of Piste is ready · Reload".

To use any other static host instead, upload the contents of `app/`.

## How data is stored

Everything stays on the device. There is no server and no account.

- **IndexedDB** (database `piste`) holds poules, the fencer roster, finished bouts and settings. If IndexedDB is unavailable, for example in some private-browsing modes, the app falls back to `localStorage`.
- **The bout in progress** is also written synchronously to `localStorage` on every tap. A sudden reload, crash or screen lock never loses the last touch.
- **The clock** stores timestamps, not a running count. It stays accurate when the phone locks or the app goes to the background, and even across a reload.
- **Backups:** use **⋯ → Settings → Export backup** to download everything as JSON. **Import backup** merges a file back in: records with the same id are replaced and nothing else is deleted. Use this to move to a new phone.
- The app asks the browser for persistent storage so data isn't evicted under storage pressure. Still export a backup now and then: clearing site data in the browser deletes it.

## Project layout

```
app/                    the deployable site
  index.html, manifest.webmanifest, sw.js, icons/, css/app.css
  js/core/              pure logic, unit-tested in Node
    timer.js            timestamp-based countdown
    bout.js             bout reducer: scoring, cards, priority, periods, undo
    poule.js            bout-order tables, results, indicators, ranking, CSV
  js/store.js           IndexedDB / localStorage persistence, backup
  js/state.js           app state and write-through saving
  js/ui/                screens: scorer, poules, settings, exports, dialogs
tests/                  unit tests (node --test)
e2e/run.js              Playwright walkthrough in a phone viewport
scripts/                dev server, icon generator
```

## Rules as implemented

- **Cards:**
  - A yellow card is a warning.
  - A second yellow, or any yellow after a red, becomes a red.
  - A red card gives the opponent a touch.
  - A black card ends the bout and the opponent wins.
- **Épée:** the "Double" button scores one touch for each fencer. A double is annulled at *target − 1* each (for example 4–4) and during the priority minute.
- **Time:** when time runs out, the leader wins. If the score is level, Piste offers a priority draw, sets the clock to 1:00 and marks the fencer with priority. The first touch in that minute wins. If the minute runs out still level, the fencer with priority wins.
- **DE:** at the end of periods 1 and 2 you get a 1:00 break or go straight to the next period. In sabre, the break comes when the first fencer reaches 8.
- **Poule ranking:** by V/M, then indicator, then touches scored. Fencers who are still tied share a rank, shown as "2=".
