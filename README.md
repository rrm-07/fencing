# UCL Fencing (Piste)

The UCL Fencing club app, at **https://uclfencing.com**. It's a mobile-first web app that installs to the home screen and runs full screen like a native app (About → Install the App). You can use it one-handed at the side of the piste, and scoring works fully offline.

Three tabs sit at the bottom: **Fence**, **Book** and **About**. They have a sliding highlight, and screens slide in from the side they sit on. On the Fence tab, a slim switch above the tab bar changes mode:

- **Fence:** Scorer · Poules · Teams. It remembers where you were in each.
- **Book:** book training, cancel, coach lessons, check in. The lock at the top right opens **Admin**: organisers unlock it with the passphrase to reach every organiser tool.
- **About:** the club page. It has a rotating photo album, links to the Students' Union page, WhatsApp, Instagram and TikTok, and an install button. Organisers edit the links and upload photos under Book → Admin → Club Page. Empty links are hidden.

Under the hood: The design follows Apple's iOS conventions: system font with rounded numerals, Apple's system colours in dark and light (or automatic) appearance, grouped lists, sheets and action sheets. Every tap target is still at least 56px.

- **Bout scorer:** red and green lamps, big scores, and a clock that you tap to start and tap anywhere to stop. It has undo (100 steps), cards, the épée double, priority, DE periods, and a "Bout over" banner with confirm and undo.
- **Poules:** 3–8 fencers, standard FIE bout order, and the classic V5/D3 sheet with live V, V/M, TS, TR, Ind and Rank. "Next bout" opens the scorer with names filled in and writes the result back to the sheet. Exports to CSV, PNG and print.
- **Elimination tableaux (DE):** after the poules, open a finished poule and tap **Elimination Tableau** (or Poules → ⋯ → New Elimination Tableau).
  - Fencers are seeded from one or more poules, all ranked together by V/M, then indicator, then touches scored. You can switch anyone off (a withdrawal or a cut), or type in a seeded list instead.
  - The bracket follows the FIE table: seeds 1 and 2 can only meet in the final, and top seeds get byes when the numbers aren't a power of two.
  - Bouts are to 15 (or 10 or 5) and run in the scorer with three periods, from **Next Bout** or Choose Bout. You can also enter or correct a result by hand. If a correction changes who went through, the later results that depended on it are cleared after a warning.
  - Final ranking follows FIE rules: losing semi-finalists are 3rd equal, and fencers out in the same round are placed by seed.
  - A tableau shares with a code exactly like a poule (no new database rules), so other pistes enter results and spectators follow live. It exports as CSV, image or print-out.
- **Team matches:** FIE relay, three against three plus a reserve. Nine legs to 45 in the official order (3–6, 1–5, 2–4, 1–6, 3–4, 2–5, 1–4, 2–6, 3–5). Each leg opens in the scorer with the score and team cards carried over. A leg ends at its target or on time; only the last leg goes to priority. You can enter or correct a leg by hand, bring on the reserve once, and see each fencer's touches scored and received.
- **Three-weapon fixtures:** choose **All Three Weapons** when creating a team match. Each club enters three fencers and a reserve for foil, épée and sabre (9 + 3). Each weapon is its own relay to 45, and the fixture page shows the overall result. You choose how it's decided: most weapons won (two of three), or total touches across all three. The fixture exports as one CSV, image or print-out.
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

Other suites cover team matches, shared poules, elimination tableaux, the training booking page (bookings, lessons, timetable editing, check-in, attendance) and moving to a new address.

The sharing, booking, About and import suites need the club database. By default they run its code ([`server/db.js`](server/db.js)) in a local Node server. To run them against the **real Cloudflare runtime**, use `npm run e2e:cloudflare`. This starts `wrangler dev` with the Worker and a fresh Durable Object, the same setup as production.

## Deploy to Cloudflare (everything on uclfencing.com)

Everything runs on Cloudflare, under one address. There's no Firebase or Google, and GitHub only stores the code (the repository can be private).

- **The app:** plain static files in `app/`.
- **The club database:** shared poules, bookings, attendance and the club page. It is [`server/worker.js`](server/worker.js), a small Cloudflare Worker with a Durable Object (Cloudflare's built-in storage, a private SQLite database), at `uclfencing.com/db`.
  - The access rules live in [`server/db.js`](server/db.js) and are checked on the server. The tests run this exact code (see Tests).
  - The free Workers plan covers a club easily.
- **[`app/_headers`](app/_headers)** adds security headers, including a Content-Security-Policy that only allows the site's own files and its own database. It also sets `no-cache`, so phones always pick up new versions.

**1. Connect the repository** (one time, in the Cloudflare dashboard):

1. Open **Workers & Pages → Create → Import a repository**, then authorise GitHub and pick this repository.
2. Fill in the project settings:
   - **Project name:** `piste` (it must match `name` in `wrangler.jsonc`).
   - **Production branch:** the branch you deploy from.
   - **Build command:** `npm test`. The unit tests run first, and a failure stops the deploy.
   - **Deploy command:** `npx wrangler deploy` (the default).
3. Click **Deploy**. Every push to that branch redeploys it.

**2. The domain.** `wrangler.jsonc` serves the app on **uclfencing.com**. The domain must be on the same Cloudflare account: the first deploy creates its DNS record and HTTPS certificate. If it fails because a DNS record already exists for `uclfencing.com` (e.g. a parking page), delete that record and deploy again.

- For `www.uclfencing.com`, add **Rules → Redirect Rules → template "Redirect from WWW to root"** in the dashboard.
- The app is at `https://uclfencing.com/`.
- Training bookings are at `https://uclfencing.com/#book`. Old `…/book/` links forward there.

**3. Bring the old data across (once).** In the Firebase console, open **Realtime Database → ⋮ (top right of the data) → Export JSON**. Then, in the app at uclfencing.com, go to **Book → Admin → Import Old Data…** and pick that file.

- It brings across bookings, the timetable, lessons, attendance, the club page, shared poules and the organiser passphrase. Afterwards, unlock with your usual passphrase.
- Import only works while the new database is empty.
- If you'd rather start fresh, skip this: set up bookings with a passphrase as before.

**4. Phones move over by themselves.** Phones keep the app's data per web address. `HOME_URL` (`https://uclfencing.com`) and `OLD_HOSTS` (`rrm-07.github.io`) in [`app/js/config.js`](app/js/config.js) make the old address send people on. It only does so once uclfencing.com is answering; until then it keeps working, on the old database.

- **Phones with data** are offered **Move My Data**. This carries their poules, team matches, roster, settings and training bookings to the new address in the link itself (in the `#` part, which never reaches a server). The booking keys matter: members need them to cancel or check in.
- **Phones with nothing to move** are forwarded straight away.
- **Old shared links and QR codes** (`#join/…`, `#checkin/…`) keep working because they are forwarded too.
- Not moved: the log of free bouts, which you can still export as a backup.

**5. Then switch the old things off:**

- Once you've opened the old address on your own phone and moved your data, make the GitHub repository **private** (GitHub → Settings → General → Danger Zone → Change visibility). The GitHub Pages copy stops with it.
- Once the import is done, delete the Firebase project.
- Cloudflare's GitHub connection keeps working with a private repository.

**From your computer instead:** run `npx wrangler login` once, then `npm run deploy`. `npm run preview` runs the whole site, database included, locally on Cloudflare's runtime.

**When you release changes:** bump `VERSION` in `app/sw.js`. Phones pick up the new version the next time the app is opened or brought back to the front, and reload into it automatically. If the clock is running, they wait until it stops and offer a "Reload" button.

## Shared poules

Share a poule or an elimination tableau with a code. Anyone with the code follows it live and can enter results from their own phone.

**Who can do what:**

- Anyone with a code can read that poule and enter, edit or clear its results.
- Nobody can list other poules or change a shared poule's name, fencers or bout order.
- Only the organiser can delete a shared poule for everyone. Sharing stores a random owner key on the organiser's phone (and in the database, where nobody can read it), and **Delete for Everyone** must present that key. Everyone else only gets **Remove from This Phone**.
- Codes use 31 characters × 6 positions (about 900 million combinations), so they can't realistically be guessed.

**How it works:**

- The organiser's phone writes the poule once, then each bout's result is stored separately, so two people entering different bouts at the same time never overwrite each other. If two people edit the _same_ bout, the last save wins.
- Phones subscribe to a live stream of the poule. Anything entered offline is queued ("1 to send") and sent on reconnection.
- When the organiser deletes a poule for everyone, it disappears from every phone that joined.
- Team matches are stored on the phone only (not shared).

For local development, `npm run mock-share` runs the club database in Node. Then, in the browser console, run `localStorage.setItem('piste:shareDbUrl', 'http://localhost:9000')` and reload.

## Training bookings

The **Book** tab: share **`https://uclfencing.com/#book`** with members. Old `…/book/` links, including check-in QR codes, forward into the app.

- **Timetable:** starts from the defaults in [`app/book/schedule.js`](app/book/schedule.js) (organisers can change it from the page):
  - Mon 7–9 pm, Central London FC (offsite, bring your own kit)
  - Wed 11:30 am–1:30 pm, Mandela Studio, TeamUCL Gym
  - Wed 7–9 pm, Central London FC
  - Thu 3–5 pm, Mandela Studio
  - Sat 10 am–1 pm, Mandela Studio

  Bookings open two weeks ahead, in UK time (clock changes included).

- **Places:** 30 per session. Anyone after that joins the waitlist, and when someone cancels, the first person waiting moves up automatically.
- **Booking:** members enter their name and membership/student number. Names are visible to everyone with the link. The number is encrypted on the member's phone with the organiser's public key, so only the organiser can read it. Members cancel their own booking from the phone they booked on (a secret key kept there proves it's theirs); nobody can cancel anyone else's.
- **Organiser:** open **Book → Admin** (or `…/#book/admin`) and enter the passphrase.
  - The first time, choose a passphrase (at least 10 characters). It can't be recovered or changed, so keep it safe.
  - Unlocking with it on any device shows membership numbers and lets you remove a booking (press and hold), cancel or reopen a session with a reason, and export a CSV register.
  - **Weekly Timetable** lists every weekly session. You can edit one (venue, day, times, places, offsite, note, coaches), add a new one or delete one. Changes apply to every week from then on.
  - **Add One-off Session** adds a single dated session, for example an open day. One-offs can be booked up to 12 weeks ahead.
  - **Change This Date…** in an open session changes that date only, for example fewer places or a different time. Members see it marked "Changed", and **Undo Changes for This Date** puts it back.
- **Attendance check-in:** from an hour before a session, the organiser opens it and taps **Show Check-in Code**.
  - Members scan the QR code with their phone camera. The phone they booked on checks them in, using the secret booking key it holds plus the code, so nobody can check in someone else from home.
  - Members can also tap **Check In** in the session and type the code.
  - Someone who scans without a booking is offered **Book & Check In**.
  - The organiser can tick people off by hand (tap the number), add **walk-ins** with an optional, encrypted membership number, and take a late register for any session in the last week (Organiser → Attendance).
  - **Attendance** shows registers taken, how many of the booked places turned up, no-shows and walk-ins over 4 weeks, 12 weeks or all time, per member (matched by membership number). It exports as CSV, and the session register CSV gains an "Attended" column.
  - Only sessions where a register was taken count, and the waitlist never counts as a no-show.
- **Coach lessons:** a session can have a sign-up list for each coach, with a number of slots. Members put their name down from the session. Anyone past the slots becomes a reserve and moves up when someone cancels. Members cancel their own lessons; organisers can remove anyone (press and hold). Coaches are set per weekly session or per date.
- **Storage:** the club database on Cloudflare (under `booking/`). The server enforces all of the above.
- **What's visible:** without accounts, anything the app shows everyone (session lists with names, who attended, the club page) can be read by anyone who has the address. Membership numbers are encrypted so that only the organiser can read them, and the secret keys and organiser proofs are never readable.

## How data is stored

Scoring data stays on the device. There is no account, and nothing leaves the phone except poules you choose to share and training bookings, which go to the club database on Cloudflare.

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
  js/sync.js            live sync of shared poules (the club database's REST API + EventSource)
  js/config.js          sharing server URL
  book/                 the Book tab (schedule.js, core.js, crypto.js, api.js, book.js); index.html forwards old links
  js/ui/shell.js        tab bar, mode rows and transitions
  js/ui/aboutView.js    the About tab and its admin editors (links, photos)
  js/club.js            About page defaults (name, tagline, links)
  js/state.js           app state and write-through saving
  js/ui/                screens: scorer, poules, settings, exports, dialogs
tests/                  unit tests (node --test)
e2e/run.js              Playwright walkthrough in a phone viewport
e2e/share.js            multi-phone sharing test against the mock server
e2e/team.js             full team relay match, three-weapon fixture
e2e/tableau.js          elimination tableau: seeding, byes, sharing, corrections
e2e/book.js             booking page with organiser, members and the waitlist
server/db.js            the club database: data, access rules, live updates (shared with the tests)
server/worker.js        Cloudflare Worker + Durable Object serving the app and /db
wrangler.jsonc          Cloudflare deployment
database.rules.json     rules for the old Firebase database (only until the move; then delete)
scripts/                dev server, mock sharing server, icon generator
```

## Rules as implemented

- **Cards:**
  - A yellow card is a warning.
  - A second yellow, or any yellow after a red, becomes a red.
  - A red card gives the opponent a touch.
  - A black card ends the bout and the opponent wins.
- **Épée:** the "Double" button scores one touch for each fencer. A double is annulled at _target − 1_ each (for example 4–4) and during the priority minute.
- **Time:** when time runs out, the leader wins. If the score is level, Piste offers a priority draw, sets the clock to 1:00 and marks the fencer with priority. The first touch in that minute wins. If the minute runs out still level, the fencer with priority wins.
- **DE:** at the end of periods 1 and 2 you get a 1:00 break or go straight to the next period. In sabre, the break comes when the first fencer reaches 8.
- **Poule ranking:** by V/M, then indicator, then touches scored. Fencers who are still tied share a rank, shown as "2=".
