// The booking page now lives in the app (Book tab). Old links still work:
// /book/ → /#book, /book/#checkin/… → /#checkin/…, /book/#organiser → /#book/admin
const h = location.hash;
const to = h.startsWith('#checkin/') ? h : h === '#organiser' ? '#book/admin' : '#book';
location.replace(new URL(`../${to}`, location.href).href);
