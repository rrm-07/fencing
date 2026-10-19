// Sharing server for shared poules: a Firebase Realtime Database URL, e.g.
//   'https://piste-1234-default-rtdb.europe-west1.firebasedatabase.app'
// Leave empty to turn sharing off. See README → "Shared poules" for setup.
export const SHARE_DB_URL = 'https://piste-9f874-default-rtdb.europe-west1.firebasedatabase.app';

// Where the app lives, and the old addresses that should send people there
// (bringing their poules, matches and bookings along). The old address only
// forwards once the new one answers with app/piste.json, so it's safe to set
// these before the domain is live. See README → "Deploy to Cloudflare".
export const HOME_URL = 'https://uclfencing.com';
export const OLD_HOSTS = ['rrm-07.github.io'];
