# Piste

A mobile-first web app for scoring fencing bouts and running poules. You can use it one-handed at the side of the piste. It installs as an app and works fully offline. The design follows Apple's iOS conventions: system font with rounded numerals, Apple's system colours in dark and light (or automatic) appearance, grouped lists, sheets and action sheets. Every tap target is still at least 56px.

- **Bout scorer:** red and green lamps, big scores, and a clock that you tap to start and tap anywhere to stop. It has undo (100 steps), cards, the épée double, priority, DE periods, and a "Bout over" banner with confirm and undo.
- **Poules:** 3–8 fencers, standard FIE bout order, and the classic V5/D3 sheet with live V, V/M, TS, TR, Ind and Rank. "Next bout" opens the scorer with names filled in and writes the result back to the sheet. Exports to CSV, PNG and print.
- **Team matches:** FIE relay, three against three plus a reserve. Nine legs to 45 in the official order (3–6, 1–5, 2–4, 1–6, 3–4, 2–5, 1–4, 2–6, 3–5). Each leg opens in the scorer with the score and team cards carried over. A leg ends at its target or on time; only the last leg goes to priority. You can enter or correct a leg by hand, bring on the reserve once, and see each fencer's touches scored and received.
- **Choose Bout:** from the Bout tab, tap the format button, then **Choose Bout**. Pick any unfenced poule bout ("Bout 7 · Alice vs Bea") or the next leg of a team match, and the result goes straight back to the right sheet.
- **Exports:** poules and team matches export as CSV (opens cleanly in Excel or Sheets), as a shareable PNG and as a printable A4 page, all in one consistent layout.
- **Shared poules:** the organiser shares a poule with a 6-character code (e.g. `K7Q-M4X`), a link or a QR code. Anyone who joins with it can enter and edit results from their own phone, and the sheet updates live on every phone, including results entered offline once that phone reconnects.

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

**Simplest:**
1. In **Settings → Pages**, set **Source** to **Deploy from a branch**.
2. Pick your branch and **/ (root)**, then click **Save**.

`index.html` at the repo root forwards to `app/`, and `.nojekyll` turns off Jekyll processing. The site goes live at `https://<user>.github.io/<repo>/` within a minute or two, and every push to that branch redeploys it.

**Alternative (tests must pass before each deploy):**
1. Set **Source** to **GitHub Actions**.
2. Push to `main`. `.github/workflows/pages.yml` runs the unit tests and then publishes `app/` directly.

**When you release changes:** bump `VERSION` in `app/sw.js`. Phones pick up the new version the next time Piste is opened or brought back to the front, and reload into it automatically. If the clock is running, they wait until it stops and offer a "Reload" button.

To use any other static host instead, upload the contents of `app/`.

## Shared poules (one-time setup)

Sharing needs a small online database. Piste uses **Firebase Realtime Database**, which is free for club-sized use and needs no server code. Until it is set up, the app works exactly as before and "Share"/"Join" explain that sharing isn't configured.

1. Go to <https://console.firebase.google.com>, click **Create a project** (any name, e.g. `piste`). You can turn Google Analytics off.
2. In the left menu open **Build → Realtime Database → Create Database**. Pick a location near you (e.g. Belgium `europe-west1`), choose **Start in locked mode**, then **Enable**.
3. Open the **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
4. On the **Data** tab, copy the database URL at the top (it looks like `https://piste-1234-default-rtdb.europe-west1.firebasedatabase.app`).
5. Paste it into `app/js/config.js` as `SHARE_DB_URL`, bump `VERSION` in `app/sw.js`, and push.

**Who can do what:** anyone with a code can read that poule and enter, edit or clear its results. Nobody can list other poules or change a shared poule's name, fencers or bout order. Only the organiser can delete a shared poule for everyone: sharing stores a random owner key on the organiser's phone (and under `owners/` on the server, where nobody can read it), and **Delete for Everyone** must present that key. Everyone else only gets **Remove from This Phone**. Codes use 31 characters × 6 positions (about 900 million combinations), so they can't realistically be guessed. Fencer names and clubs of shared poules are stored in your Firebase database.

**How it works:** the organiser's phone writes the poule once (`poules/{CODE}/meta`), then each bout's result is stored separately (`poules/{CODE}/results/{boutId}`), so two people entering different bouts at the same time never overwrite each other. If two people edit the *same* bout, the last save wins. Phones subscribe to a live stream of the poule, and anything entered offline is queued ("1 to send") and sent on reconnection. When the organiser deletes a poule for everyone, it disappears from every phone that joined. Team matches are stored on the phone only (not shared).

**Updating the rules:** if you set up sharing before version 1.3, paste the new [`database.rules.json`](database.rules.json) into Firebase → Realtime Database → Rules and click **Publish**. Poules shared before 1.3 have no owner key, so they can only be removed phone by phone.

For local development there is a stand-in server: run `npm run mock-share`, then in the browser console `localStorage.setItem('piste:shareDbUrl', 'http://localhost:9000')` and reload.

## How data is stored

Everything stays on the device. There is no account, and nothing leaves the phone except poules you choose to share (see above).

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
    share.js            share codes, merging results from other phones
  js/store.js           IndexedDB / localStorage persistence, backup
  js/sync.js            live sync of shared poules (Firebase REST + EventSource)
  js/config.js          sharing server URL
  js/state.js           app state and write-through saving
  js/ui/                screens: scorer, poules, settings, exports, dialogs
tests/                  unit tests (node --test)
e2e/run.js              Playwright walkthrough in a phone viewport
e2e/share.js            two-phone sharing test against the mock server
database.rules.json     Firebase security rules for shared poules
scripts/                dev server, mock sharing server, icon generator
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
