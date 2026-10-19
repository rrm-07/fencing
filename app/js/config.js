// Where the app lives, and the old addresses that should send people there
// (bringing their poules, matches and bookings along). The old address only
// forwards once the new one answers with app/piste.json, so it's safe to set
// these before the domain is live. See README → "Deploy to Cloudflare".
export const HOME_URL = 'https://uclfencing.com';
export const OLD_HOSTS = ['rrm-07.github.io'];

// The club database (shared poules, bookings, the club page). It runs on
// Cloudflare next to the app, at /db. The old GitHub Pages copy keeps using
// the old Firebase database until everyone has moved.
const OLD_DB = 'https://piste-9f874-default-rtdb.europe-west1.firebasedatabase.app';
const onOldHost = typeof location !== 'undefined' && OLD_HOSTS.includes(location.host);
export const SHARE_DB_URL = onOldHost ? OLD_DB : '/db';
