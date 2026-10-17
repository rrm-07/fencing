// Training session booking page.

import {
  h,
  fill,
  button,
  iconButton,
  icon,
  holdButton,
  toast,
  confirmDialog,
  promptText,
  modal,
  sheetNav,
  group,
  row,
  tile,
  download,
  segmented,
  toggle,
} from '../js/ui/dom.js';
import { CLUB, CAPACITY, DEFAULT_WEEKLY, KNOWN_VENUES } from './schedule.js';
import {
  upcomingSessions,
  roster,
  placeOf,
  closureOf,
  validateBooking,
  alreadyBooked,
  cleanName,
  newId,
  venueOf,
  zonedDate,
  zonedTime,
  registerCsv,
  lessonsOf,
  timetable,
  validateSession,
  newSessionId,
  newLessonId,
} from './core.js';
import * as api from './api.js';
import { createOrganiserKeys, unlockOrganiser, encryptFor, decryptWith, randomKey } from './crypto.js';

const root = document.getElementById('book');
const S = {
  keys: { publicKey: null, privateKey: null },
  keysLoaded: false,
  sessions: {},
  closures: {},
  config: null, // organiser-edited timetable (booking/config)
  lessons: {}, // coach lesson sign-ups (booking/lessons)
  status: 'connecting',
  org: null, // { secret, privateKey } once unlocked
  members: new Map(), // encrypted → decrypted membership numbers (organiser only)
};
const sheets = new Set(); // redraw functions of open sheets

/* ---------- this phone's bookings and details ---------- */

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};
const MINE = 'piste:myBookings';
const ME = 'piste:me';
const mine = () => store.get(MINE, []);
const MY_LESSONS = 'piste:myLessons';
const myLessons = () => store.get(MY_LESSONS, []);
const sessionsAt = (now = Date.now()) => upcomingSessions(now, { config: S.config });
const myBooking = (s) => mine().find((m) => m.s === s.key && S.sessions[s.key]?.[m.id]);

/* ---------- formatting ---------- */

const tz = CLUB.timeZone;
const fmt = (ms, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(ms));
/** { t: '7' | '11:30', p: 'am' | 'pm' } in UK time. */
function hm(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const min = get('minute');
  return {
    t: `${Number(get('hour'))}${min === '00' ? '' : `:${min}`}`,
    p: get('dayPeriod').toLowerCase().replace(/\./g, ''),
  };
}
/** "7–9 pm", "11:30 am–1:30 pm" */
function timeRange(s) {
  const a = hm(s.startMs);
  const b = hm(s.endMs);
  return `${a.t}${a.p === b.p ? '' : ` ${a.p}`}–${b.t} ${b.p}`;
}
const dayTitle = (s) => fmt(s.startMs, { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (s) => fmt(s.startMs, { weekday: 'short', day: 'numeric', month: 'short' });
const weekTitle = (w) => (w === 0 ? 'This Week' : w === 1 ? 'Next Week' : `In ${w} Weeks`);

function stateOf(s, now = Date.now()) {
  const r = roster(S.sessions[s.key], s.capacity);
  const closed = closureOf(S.closures[s.key]);
  const m = myBooking(s);
  const place = m ? placeOf(r, m.id) : { status: null };
  return { r, closed, m, place, started: s.startMs <= now, left: Math.max(0, s.capacity - r.booked.length) };
}

function statusTag(st) {
  if (st.closed) return h('span', { class: 'tag tag-red' }, 'Cancelled');
  if (st.place.status === 'booked') return h('span', { class: 'tag tag-green' }, icon('check'), 'Booked');
  if (st.place.status === 'waitlist') return h('span', { class: 'tag tag-live' }, `Waitlist #${st.place.position}`);
  if (st.started) return h('span', { class: 'tag tag-gray' }, 'Under way');
  if (!st.left) return h('span', { class: 'tag tag-gray' }, 'Full');
  return h('span', { class: 'tag tag-next' }, `${st.left} left`);
}

/* ---------- page ---------- */

function render() {
  const pb = root.querySelector('.page-body');
  const y = pb?.scrollTop ?? 0;
  const now = Date.now();
  const sessions = sessionsAt(now);
  const myUpcoming = sessions.filter((s) => myBooking(s));
  const weeks = [...new Set(sessions.map((s) => s.week))];
  const nav = h(
    'header',
    { class: 'navbar large' },
    h('div', { class: 'nav-l' }),
    h('div', { class: 'nav-title' }, CLUB.title),
    h(
      'div',
      { class: 'nav-r' },
      iconButton('share', shareLink, 'Share booking link'),
      iconButton('people', organiserSheet, S.org ? 'Organiser (unlocked)' : 'Organiser', S.org ? 'org-on' : ''),
    ),
  );
  const body = h(
    'div',
    { class: 'page-body' },
    h('h1', { class: 'large-title' }, CLUB.title),
    h(
      'div',
      { class: 'summary' },
      h('div', { class: 'summary-line' }, h('span', { class: `dot ${S.status}` }), ` ${CLUB.subtitle}`),
    ),
    S.org &&
      group(
        { header: 'Organiser', footer: 'Membership numbers are visible to you on this device until you lock it.' },
        row({
          lead: tile('doc', 'green'),
          title: 'Export Register (CSV)',
          chevron: true,
          onClick: () => exportCsv(sessions),
        }),
        row({ lead: tile('clock', 'blue'), title: 'Weekly Timetable', chevron: true, onClick: timetableSheet }),
        row({
          lead: tile('plus', 'purple'),
          title: 'Add One-off Session',
          chevron: true,
          onClick: () => editSessionSheet({ mode: 'event' }),
        }),
        row({ lead: tile('people', 'gray'), title: 'Lock Organiser Mode', tone: 'danger', onClick: lock }),
      ),
    S.keysLoaded &&
      !S.keys.publicKey &&
      group(
        {
          footer: 'The organiser needs to set up bookings once before anyone can book: tap the people icon at the top.',
        },
        row({ lead: tile('clock', 'orange'), title: 'Bookings open soon' }),
      ),
    myUpcoming.length > 0 &&
      group(
        { header: 'My Bookings', footer: 'Saved on this phone. To cancel, open the session.' },
        ...myUpcoming.map((s) => sessionRow(s, { mine: true })),
      ),
    ...weeks.flatMap((w) => {
      const inWeek = sessions.filter((s) => s.week === w);
      const days = [...new Set(inWeek.map((s) => s.date))];
      return [
        h('h2', { class: 'week-title' }, weekTitle(w)),
        ...days.map((d) =>
          group(
            { header: dayTitle(inWeek.find((s) => s.date === d)) },
            ...inWeek.filter((s) => s.date === d).map((s) => sessionRow(s)),
          ),
        ),
      ];
    }),
    h(
      'p',
      { class: 'group-footer center-foot' },
      'Names are shown to everyone with this link. Membership numbers are encrypted on your phone; only the organiser can read them.',
    ),
  );
  body.addEventListener('scroll', () => nav.classList.toggle('scrolled', body.scrollTop > 8), { passive: true });
  fill(root, h('section', { class: 'page' }, nav, body));
  body.scrollTop = y;
  nav.classList.toggle('scrolled', y > 8);
  for (const redraw of sheets) redraw();
}

function sessionRow(s, { mine: inMine = false } = {}) {
  const v = venueOf(s);
  const st = stateOf(s);
  return row({
    lead: h(
      'span',
      { class: `time-lead tint-${v.color}` },
      h('b', {}, hm(s.startMs).t),
      h('small', {}, hm(s.startMs).p),
    ),
    title: inMine ? `${dayShort(s)} · ${v.short}` : v.short,
    subtitle: [
      `Until ${hm(s.endMs).t} ${hm(s.endMs).p}`,
      st.r.waitlist.length ? ` · ${st.r.waitlist.length} waiting` : '',
      v.badge && h('span', { class: `badge-text ${v.color}` }, ` · ${v.badge}`),
      s.changed && h('span', { class: 'badge-text changed' }, ' · Changed'),
      s.lessons.length > 0 && h('span', { class: 'badge-text lessons' }, ' · Lessons'),
    ],
    trailing: statusTag(st),
    chevron: true,
    onClick: () => sessionSheet(s),
    cls: 'session-row',
    attrs: { 'aria-label': `${dayShort(s)} ${v.name} ${timeRange(s)}` },
  });
}

/* ---------- session detail ---------- */

function sessionSheet(s) {
  let redraw = null;
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const draw = () => {
      s = sessionsAt().find((x) => x.key === s.key) ?? s; // follow timetable edits
      const v = venueOf(s);
      const st = stateOf(s);
      const isMine = (b) => mine().some((m) => m.id === b.id && m.s === s.key);
      const person = (b, i, wait) =>
        row({
          lead: h('span', { class: `num-badge${wait ? ' muted' : ''}` }, i + 1),
          title: [b.name, isMine(b) && h('span', { class: 'you' }, ' You')],
          subtitle: S.org ? `No. ${S.members.get(b.enc) ?? '…'}` : null,
          trailing:
            S.org &&
            holdButton(icon('trash'), () => organiserRemove(s, b), {
              cls: 'mini del',
              hint: 'Press and hold to remove this booking',
              attrs: { 'aria-label': `Remove ${b.name}` },
            }),
        });
      let action = null;
      if (st.m && st.place.status) {
        action = [
          h(
            'p',
            { class: 'sheet-status' },
            st.place.status === 'booked'
              ? `You’re booked (place ${st.place.position} of ${s.capacity}).`
              : `You’re #${st.place.position} on the waitlist. You’ll move up automatically if someone cancels.`,
          ),
          button('Cancel My Booking', () => cancelMine(s, st.m), 'btn-gray btn-block btn-large tone-danger-text'),
        ];
      } else if (st.closed) action = null;
      else if (st.started) action = h('p', { class: 'sheet-status' }, 'This session has started; booking is closed.');
      else if (!S.keys.publicKey) action = h('p', { class: 'sheet-status' }, 'Bookings open soon.');
      else
        action = button(
          st.left ? 'Book a Place' : 'Join the Waitlist',
          () => bookSheet(s),
          'btn-filled btn-block btn-large',
        );
      fill(
        body,
        sheetNav({ title: dayShort(s), right: { label: 'Done', bold: true, onClick: () => close() } }),
        h(
          'div',
          { class: 'session-hero' },
          h('div', { class: 'sh-venue' }, v.name),
          h('div', { class: 'sh-time' }, `${dayTitle(s)} · ${timeRange(s)}`),
          v.note && h('div', { class: 'sh-note' }, v.note),
          h(
            'div',
            { class: 'sh-cap' },
            h(
              'div',
              { class: 'progress' },
              h('span', { style: { width: `${(st.r.booked.length / s.capacity) * 100}%` } }),
            ),
            h('span', {}, `${st.r.booked.length} of ${s.capacity} places taken`),
          ),
        ),
        st.closed &&
          group(
            {},
            row({ lead: tile('xmark', 'red'), title: 'Session cancelled', subtitle: st.closed.reason || null }),
          ),
        action,
        ...s.lessons.map((l) => lessonGroup(s, l, st)),
        group(
          { header: `Booked · ${st.r.booked.length}` },
          ...(st.r.booked.length
            ? st.r.booked.map((b, i) => person(b, i, false))
            : [row({ title: h('span', { class: 'row-sub' }, 'No one yet — be the first') })]),
        ),
        st.r.waitlist.length > 0 &&
          group({ header: `Waitlist · ${st.r.waitlist.length}` }, ...st.r.waitlist.map((b, i) => person(b, i, true))),
        S.org &&
          group(
            { header: 'Organiser' },
            st.closed
              ? row({ lead: tile('check', 'green'), title: 'Reopen Session', onClick: () => organiserClose(s, false) })
              : row({
                  lead: tile('xmark', 'red'),
                  title: 'Cancel Session…',
                  tone: 'danger',
                  onClick: () => organiserClose(s, true),
                }),
            row({
              lead: tile('pencil', 'blue'),
              title: 'Change This Date…',
              subtitle: s.changed ? 'Changed from the usual timetable' : 'Time, places, note or coaches',
              chevron: true,
              onClick: () => editSessionSheet({ mode: 'override', session: s }),
            }),
            row({
              lead: tile('clock', s.kind === 'event' ? 'purple' : 'indigo'),
              title: s.kind === 'event' ? 'Edit One-off Session…' : 'Edit Weekly Session…',
              subtitle: s.kind === 'event' ? null : 'Every week from now on',
              chevron: true,
              onClick: () => editSessionSheet({ mode: s.kind === 'event' ? 'event' : 'weekly', id: s.sourceId }),
            }),
            row({
              lead: tile('doc', 'green'),
              title: 'Export This Session (CSV)',
              chevron: true,
              onClick: () => exportCsv([s]),
            }),
          ),
      );
      if (S.org) decryptVisible([s]);
    };
    redraw = draw;
    sheets.add(draw);
    draw();
    return body;
  }).finally(() => sheets.delete(redraw));
}

/* ---------- coach lessons ---------- */

const lessonRoster = (s, l) => roster(S.lessons[s.key]?.[l.id], l.slots);
const myLesson = (s, l) => myLessons().find((m) => m.s === s.key && m.c === l.id && S.lessons[s.key]?.[l.id]?.[m.id]);

/** One coach's lesson list inside a session: who's in, reserves, and sign up / cancel. */
function lessonGroup(s, l, st) {
  const r = lessonRoster(s, l);
  const m = myLesson(s, l);
  const place = m ? placeOf(r, m.id) : { status: null };
  const isMine = (x) => myLessons().some((y) => y.id === x.id && y.s === s.key && y.c === l.id);
  const person = (x, i, reserve) =>
    row({
      lead: h('span', { class: `num-badge${reserve ? ' muted' : ''}` }, i + 1),
      title: [x.name, isMine(x) && h('span', { class: 'you' }, ' You')],
      subtitle: reserve ? 'Reserve' : null,
      trailing:
        S.org &&
        holdButton(icon('trash'), () => organiserRemoveLesson(s, l, x), {
          cls: 'mini del',
          hint: 'Press and hold to remove',
          attrs: { 'aria-label': `Remove ${x.name} from ${l.coach}’s lessons` },
        }),
    });
  let action = null;
  if (m && place.status) {
    action = row({
      lead: tile('xmark', 'red'),
      title: 'Cancel My Lesson',
      subtitle: place.status === 'booked' ? `You’re slot ${place.position}` : `You’re reserve #${place.position}`,
      tone: 'danger',
      onClick: () => cancelLesson(s, l, m),
    });
  } else if (!st.closed && !st.started && S.keys.publicKey) {
    const full = r.booked.length >= l.slots;
    action = row({
      lead: tile('plus', full ? 'gray' : 'indigo'),
      title: full ? 'Join as Reserve' : 'Sign Up for a Lesson',
      chevron: true,
      onClick: () => lessonSignUp(s, l),
      attrs: { 'aria-label': `${full ? 'Join as reserve for' : 'Sign up for a lesson with'} ${l.coach}` },
    });
  }
  return group(
    {
      header: `Lessons with ${l.coach} · ${Math.min(r.booked.length, l.slots)} of ${l.slots}`,
      footer: r.waitlist.length
        ? 'Reserves move up automatically if someone cancels.'
        : 'Individual lessons during the session, first come first served.',
      cls: 'lesson-group',
    },
    ...r.booked.map((x, i) => person(x, i, false)),
    ...r.waitlist.map((x, i) => person(x, i, true)),
    !r.booked.length && row({ title: h('span', { class: 'row-sub' }, 'No one yet') }),
    action,
  );
}

async function lessonSignUp(s, l) {
  const booked = myBooking(s);
  const name = await promptText({
    title: `Lesson with ${l.coach}`,
    message: `${dayShort(s)} · ${venueOf(s).short}.${booked ? '' : ' Remember to book your place in the session too.'}`,
    value: booked?.name ?? store.get(ME, {}).name ?? '',
    placeholder: 'Full name',
    confirm: 'Sign Up',
    maxLength: 60,
    attrs: { 'aria-label': 'Name for the lesson', autocomplete: 'name' },
  });
  if (name === null) return;
  const clean = cleanName(name);
  if (clean.length < 2) return toast('Please enter your full name');
  if (alreadyBooked(lessonRoster(s, l), clean)) return toast(`${clean} is already on ${l.coach}’s list`, { ms: 3500 });
  try {
    const id = newId();
    const key = randomKey();
    await api.lessonSignUp(s.key, l.id, id, clean, key);
    store.set(MY_LESSONS, [
      ...myLessons().filter((x) => x.s >= zonedDate(Date.now())),
      { s: s.key, c: l.id, id, key, name: clean },
    ]);
    if (!store.get(ME, {}).name) store.set(ME, { ...store.get(ME, {}), name: clean });
    render();
    const full = lessonRoster(s, l).booked.length >= l.slots;
    toast(full ? `You’re a reserve for ${l.coach}` : `Lesson with ${l.coach} booked`, { ms: 3000 });
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

async function cancelLesson(s, l, m) {
  const ok = await confirmDialog({
    title: 'Cancel your lesson?',
    message: `With ${l.coach}, ${dayShort(s)}. The next reserve moves up.`,
    confirm: 'Cancel Lesson',
    cancel: 'Keep',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.lessonCancel(s.key, l.id, m.id, m.key);
    store.set(
      MY_LESSONS,
      myLessons().filter((x) => x.id !== m.id),
    );
    toast('Lesson cancelled');
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

async function organiserRemoveLesson(s, l, x) {
  try {
    await api.lessonRemove(s.key, l.id, x.id, S.org.secret);
    toast(`Removed ${x.name}`);
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

/* ---------- booking ---------- */

function bookSheet(s) {
  const v = venueOf(s);
  const me = store.get(ME, {});
  return modal((close) => {
    const name = h('input', {
      class: 'input',
      value: me.name ?? '',
      placeholder: 'Full name',
      autocomplete: 'name',
      maxlength: 60,
      'aria-label': 'Full name',
    });
    const member = h('input', {
      class: 'input',
      value: me.member ?? '',
      placeholder: 'Membership / student no.',
      autocapitalize: 'characters',
      autocomplete: 'off',
      maxlength: 20,
      'aria-label': 'Membership or student number',
    });
    const st = stateOf(s);
    const submit = button(st.left ? 'Book My Place' : 'Add Me to the Waitlist', go, 'btn-filled btn-block btn-large');
    async function go() {
      const details = { name: cleanName(name.value), member: member.value.trim().toUpperCase() };
      const err = validateBooking(details);
      if (err) return toast(err, { ms: 3500 });
      if (alreadyBooked(stateOf(s).r, details.name))
        return toast(`${details.name} is already on this session`, { ms: 3500 });
      submit.disabled = true;
      submit.textContent = 'Booking…';
      try {
        const id = newId();
        const key = randomKey();
        const enc = await encryptFor(S.keys.publicKey, details.member);
        await api.book(s.key, id, { name: details.name, enc }, key);
        store.set(MINE, [
          ...mine().filter((m) => m.s >= zonedDate(Date.now())),
          { s: s.key, id, key, name: details.name },
        ]);
        store.set(ME, details);
        close();
        toast(st.left ? `You’re booked: ${dayShort(s)}` : `You’re on the waitlist for ${dayShort(s)}`, { ms: 3500 });
        render();
      } catch (e) {
        toast(e.message, { ms: 4000 });
        submit.disabled = false;
        submit.textContent = 'Try Again';
      }
    }
    return h(
      'form',
      { class: 'sheet-body', onSubmit: (e) => (e.preventDefault(), go()) },
      sheetNav({
        title: st.left ? 'Book a Place' : 'Join Waitlist',
        left: { label: 'Cancel', onClick: () => close() },
      }),
      group({}, row({ lead: tile('clock', v.color), title: v.name, subtitle: `${dayShort(s)} · ${timeRange(s)}` })),
      group(
        {
          header: 'Your details',
          footer:
            'Your name is shown on the list. Your number is encrypted on this phone so only the organiser can read it. Both are remembered here for next time.',
        },
        row({ title: name, cls: 'row-inline' }),
        row({ title: member, cls: 'row-inline' }),
      ),
      v.note && h('p', { class: 'sheet-status warn' }, `${v.note}.`),
      submit,
    );
  });
}

async function cancelMine(s, m) {
  const ok = await confirmDialog({
    title: 'Cancel your booking?',
    message: `${dayShort(s)} · ${venueOf(s).name}. Your place goes to the next person on the waitlist.`,
    confirm: 'Cancel Booking',
    cancel: 'Keep',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.cancel(s.key, m.id, m.key);
    store.set(
      MINE,
      mine().filter((x) => x.id !== m.id),
    );
    // Your lessons in that session go too.
    for (const l of myLessons().filter((x) => x.s === s.key && S.lessons[s.key]?.[x.c]?.[x.id])) {
      await api.lessonCancel(l.s, l.c, l.id, l.key).catch(() => {});
    }
    store.set(
      MY_LESSONS,
      myLessons().filter((x) => x.s !== s.key),
    );
    toast('Booking cancelled');
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

async function shareLink() {
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ title: `${CLUB.title} bookings`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch (e) {
    if (e?.name !== 'AbortError') toast(url, { ms: 8000 });
  }
}

/* ---------- organiser ---------- */

function organiserSheet() {
  if (S.org) {
    return confirmDialog({
      title: 'Organiser mode is on',
      message: 'Membership numbers and organiser tools are visible on this device.',
      confirm: 'Lock',
      cancel: 'Keep Unlocked',
    }).then((ok) => ok && lock());
  }
  if (!S.keysLoaded) return toast('Still connecting…');
  const setup = !S.keys.publicKey;
  return modal((close) => {
    const pass = h('input', {
      class: 'input',
      type: 'password',
      placeholder: 'Passphrase',
      autocomplete: setup ? 'new-password' : 'current-password',
      'aria-label': 'Organiser passphrase',
    });
    const pass2 = h('input', {
      class: 'input',
      type: 'password',
      placeholder: 'Repeat passphrase',
      autocomplete: 'new-password',
      'aria-label': 'Repeat passphrase',
    });
    const go = button(setup ? 'Set Up Bookings' : 'Unlock', submit, 'btn-filled btn-block btn-large');
    async function submit() {
      const p = pass.value;
      if (setup) {
        if (p.length < 10) return toast('Use at least 10 characters', { ms: 3500 });
        if (p !== pass2.value) return toast('The passphrases don’t match');
      }
      go.disabled = true;
      go.textContent = setup ? 'Setting up…' : 'Unlocking…';
      try {
        if (setup) {
          const keys = await createOrganiserKeys(p);
          await api.setUp(keys);
          S.keys = await api.getKeys();
        }
        S.org = await unlockOrganiser(p, S.keys.privateKey);
        close();
        toast(setup ? 'Bookings are open' : 'Organiser mode on');
        render();
        decryptVisible(sessionsAt());
      } catch (e) {
        toast(e.message, { ms: 4000 });
        go.disabled = false;
        go.textContent = setup ? 'Set Up Bookings' : 'Unlock';
      }
    }
    return h(
      'form',
      { class: 'sheet-body', onSubmit: (e) => (e.preventDefault(), submit()) },
      sheetNav({ title: setup ? 'Set Up Bookings' : 'Organiser', left: { label: 'Cancel', onClick: () => close() } }),
      h(
        'p',
        { class: 'sheet-status' },
        setup
          ? 'Choose an organiser passphrase. It unlocks membership numbers and lets you remove bookings or cancel sessions, on any device. Keep it safe: it can’t be recovered or changed.'
          : 'Enter the organiser passphrase to see membership numbers and manage sessions.',
      ),
      group({}, row({ title: pass, cls: 'row-inline' }), setup && row({ title: pass2, cls: 'row-inline' })),
      go,
    );
  });
}

function lock() {
  S.org = null;
  S.members.clear();
  toast('Organiser mode locked');
  render();
}

async function decryptVisible(sessions) {
  if (!S.org) return;
  let changed = false;
  for (const s of sessions) {
    for (const b of Object.values(S.sessions[s.key] ?? {})) {
      if (!b?.enc || S.members.has(b.enc)) continue;
      S.members.set(b.enc, await decryptWith(S.org.privateKey, b.enc));
      changed = true;
    }
  }
  if (changed) render();
}

async function organiserRemove(s, b) {
  try {
    await api.removeBooking(s.key, b.id, S.org.secret);
    toast(`Removed ${b.name}`);
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

async function organiserClose(s, closed) {
  let reason = '';
  if (closed) {
    reason = await promptText({
      title: 'Cancel Session',
      message: `${dayShort(s)} · ${venueOf(s).name}. Everyone sees it as cancelled. Add a reason (optional).`,
      placeholder: 'e.g. Venue closed',
      confirm: 'Cancel Session',
      maxLength: 120,
    });
    if (reason === null) {
      const ok = await confirmDialog({
        title: 'Cancel without a reason?',
        confirm: 'Cancel Session',
        cancel: 'Back',
        danger: true,
      });
      if (!ok) return;
      reason = '';
    }
  }
  try {
    await api.setClosed(s.key, closed, reason, S.org.secret);
    toast(closed ? 'Session cancelled' : 'Session reopened');
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

/* ---------- organiser: timetable ---------- */

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T12:00:00Z`),
  );
const timesOf = (x) => timeRange({ startMs: zonedTime('2026-01-05', x.start), endMs: zonedTime('2026-01-05', x.end) });

/** Write timetable entries, seeding the default weekly timetable the first time weekly sessions change. */
async function saveConfig(entries) {
  const t = timetable(S.config);
  const all = { ...entries };
  if (!t.seeded && Object.keys(entries).some((k) => k.startsWith('weekly/'))) {
    for (const w of DEFAULT_WEEKLY) {
      const { id, ...rest } = w;
      all[`weekly/${id}`] ??= rest;
    }
    all['meta/main'] = { seeded: true };
  }
  await api.saveTimetable(all, S.org.secret);
}

/** Bookings already made for upcoming dates of a weekly / one-off session. */
function bookingsFor(sourceId) {
  return sessionsAt()
    .filter((x) => x.sourceId === sourceId)
    .reduce((n, x) => n + Object.keys(S.sessions[x.key] ?? {}).length, 0);
}

function timetableSheet() {
  let redraw = null;
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const draw = () => {
      const t = timetable(S.config);
      const today = zonedDate(Date.now());
      const weekly = [...t.weekly].sort(
        (a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.start.localeCompare(b.start),
      );
      const events = t.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const entry = (x, kind) => {
        const v = venueOf({ ...x, kind });
        return row({
          lead: h(
            'span',
            { class: `time-lead tint-${v.color}` },
            h('b', {}, hm(zonedTime(today, x.start)).t),
            h('small', {}, hm(zonedTime(today, x.start)).p),
          ),
          title: kind === 'weekly' ? `${DAY_NAMES[x.day]} · ${v.short}` : `${longDate(x.date)} · ${v.short}`,
          subtitle: [
            timesOf(x),
            ` · ${x.capacity ?? CAPACITY} places`,
            v.badge && h('span', { class: `badge-text ${v.color}` }, ` · ${v.badge}`),
            lessonsOf(x).length > 0 && h('span', { class: 'badge-text lessons' }, ' · Lessons'),
          ],
          chevron: true,
          onClick: () => editSessionSheet({ mode: kind, id: x.id }),
          attrs: { 'aria-label': `Edit ${kind === 'weekly' ? DAY_NAMES[x.day] : longDate(x.date)} ${v.name}` },
        });
      };
      fill(
        body,
        sheetNav({ title: 'Timetable', right: { label: 'Done', bold: true, onClick: () => close() } }),
        group(
          {
            header: 'Every Week',
            footer: 'Changes apply to every week from now on. To change one date only, open that session.',
          },
          ...weekly.map((x) => entry(x, 'weekly')),
          row({
            lead: tile('plus', 'blue'),
            title: 'Add Weekly Session',
            tone: 'accent',
            onClick: () => editSessionSheet({ mode: 'weekly' }),
          }),
        ),
        group(
          { header: 'One-off Sessions' },
          ...events.map((x) => entry(x, 'event')),
          row({
            lead: tile('plus', 'purple'),
            title: 'Add One-off Session',
            tone: 'accent',
            onClick: () => editSessionSheet({ mode: 'event' }),
          }),
        ),
      );
    };
    redraw = draw;
    sheets.add(draw);
    draw();
    return body;
  }).finally(() => sheets.delete(redraw));
}

const sameLessons = (a, b) =>
  JSON.stringify(a.map((l) => [l.id, l.coach, l.slots])) === JSON.stringify(b.map((l) => [l.id, l.coach, l.slots]));
const lessonsValue = (list) =>
  list.length ? Object.fromEntries(list.map((l) => [l.id, { coach: cleanName(l.coach), slots: l.slots }])) : false;

/**
 * Add or edit a weekly session, a one-off session, or one date of either
 * (mode 'override', with `session`).
 */
function editSessionSheet({ mode, id = null, session = null }) {
  const t = timetable(S.config);
  const today = zonedDate(Date.now());
  const blank = { title: '', start: '19:00', end: '21:00', capacity: CAPACITY, offsite: false, note: '' };
  let source;
  if (mode === 'weekly') source = id ? t.weekly.find((x) => x.id === id) : { ...blank, day: 1 };
  else if (mode === 'event') source = id ? t.events.find((x) => x.id === id) : { ...blank, date: today };
  else source = session;
  if (!source) return toast('That session no longer exists');
  // For one date: what it would be without changes, to store only the differences.
  const usual =
    mode === 'override'
      ? ((session.kind === 'event' ? t.events : t.weekly).find((x) => x.id === session.sourceId) ?? session)
      : null;
  const d = {
    ...blank,
    ...source,
    capacity: source.capacity ?? CAPACITY,
    offsite: Boolean(source.offsite),
    note: source.note ?? '',
    lessons: (Array.isArray(source.lessons) ? source.lessons : lessonsOf(source)).map((l) => ({ ...l })),
  };
  const isNew = mode !== 'override' && !id;
  const what = mode === 'weekly' ? 'Weekly Session' : mode === 'event' ? 'One-off Session' : dayShort(session);

  return modal((close) => {
    const input = (attrs) => h('input', { class: 'input', ...attrs });
    const title = input({
      value: d.title,
      placeholder: 'Venue or title',
      maxlength: 60,
      'aria-label': 'Venue or title',
    });
    title.addEventListener('input', () => (d.title = title.value));
    const offsite = toggle(d.offsite, (v) => (d.offsite = v), 'Offsite');
    const venues = h(
      'div',
      { class: 'chips' },
      ...KNOWN_VENUES.map((name) =>
        button(
          name.split(',')[0],
          () => {
            d.title = title.value = name;
            d.offsite = Boolean(DEFAULT_WEEKLY.find((w) => w.title === name)?.offsite);
            offsite.setAttribute('aria-checked', String(d.offsite));
          },
          'chip',
        ),
      ),
    );
    const timeInput = (key, label) => {
      const el = input({ type: 'time', value: d[key], step: 300, 'aria-label': label, class: 'input inline-input' });
      el.addEventListener('input', () => (d[key] = el.value));
      return el;
    };
    const places = input({
      type: 'number',
      inputmode: 'numeric',
      min: 1,
      max: 500,
      value: d.capacity,
      'aria-label': 'Places',
      class: 'input inline-input num',
    });
    places.addEventListener('input', () => (d.capacity = Number(places.value)));
    const note = input({
      value: d.note,
      placeholder: 'Note (optional), e.g. Bring a mask',
      maxlength: 80,
      'aria-label': 'Note',
    });
    note.addEventListener('input', () => (d.note = note.value));

    const dayBox = h('div', { class: 'seg-row' });
    const drawDays = () =>
      fill(
        dayBox,
        segmented(DAYS, d.day, (v) => ((d.day = v), drawDays()), 'Day'),
      );
    if (mode === 'weekly') drawDays();
    const date = input({
      type: 'date',
      value: d.date ?? today,
      min: today,
      'aria-label': 'Date',
      class: 'input inline-input',
    });
    date.addEventListener('input', () => (d.date = date.value));

    const lessonBox = h('div', { class: 'group' });
    const drawLessons = () =>
      fill(
        lessonBox,
        ...d.lessons.map((l, i) => {
          const coach = input({ value: l.coach, placeholder: 'Coach', maxlength: 40, 'aria-label': `Coach ${i + 1}` });
          coach.addEventListener('input', () => (l.coach = coach.value));
          const slots = input({
            type: 'number',
            inputmode: 'numeric',
            min: 1,
            max: 30,
            value: l.slots,
            'aria-label': `Lesson slots ${i + 1}`,
            class: 'input inline-input num',
          });
          slots.addEventListener('input', () => (l.slots = Number(slots.value)));
          const signed = Object.keys(S.lessons[session?.key]?.[l.id] ?? {}).length;
          return row({
            title: coach,
            trailing: [
              h('span', { class: 'row-sub slots-label' }, 'slots'),
              slots,
              iconButton(
                'minusCircle',
                async () => {
                  if (signed) {
                    const ok = await confirmDialog({
                      title: `Remove ${l.coach || 'this coach'}?`,
                      message: `${signed} signed up for lessons on this date. Their sign-ups are hidden.`,
                      confirm: 'Remove',
                      danger: true,
                    });
                    if (!ok) return;
                  }
                  d.lessons.splice(d.lessons.indexOf(l), 1);
                  drawLessons();
                },
                `Remove coach ${i + 1}`,
                'mini del',
              ),
            ],
            cls: 'row-inline lesson-edit',
          });
        }),
        row({
          lead: tile('plus', 'indigo'),
          title: 'Add Coach',
          tone: 'accent',
          onClick: () => {
            d.lessons.push({ id: newLessonId(), coach: '', slots: 4 });
            drawLessons();
            lessonBox
              .querySelectorAll('input[aria-label^="Coach"]')
              .item(d.lessons.length - 1)
              ?.focus();
          },
        }),
      );
    drawLessons();

    const save = async () => {
      const x = {
        ...d,
        title: cleanName(d.title),
        note: cleanName(d.note),
        capacity: Number.isFinite(d.capacity) ? Math.round(d.capacity) : NaN,
        lessons: d.lessons.map((l) => ({ ...l, coach: cleanName(l.coach) })),
      };
      const err = validateSession(x, { kind: mode, today });
      if (err) return toast(err, { ms: 3500 });
      const value = {
        title: x.title,
        start: x.start,
        end: x.end,
        capacity: x.capacity,
        offsite: x.offsite,
        note: x.note,
        lessons: lessonsValue(x.lessons),
      };
      let path;
      if (mode === 'override') {
        // Store only what differs from the usual session.
        const base = {
          ...blank,
          ...usual,
          capacity: usual.capacity ?? CAPACITY,
          offsite: Boolean(usual.offsite),
          note: usual.note ?? '',
        };
        const diff = Object.fromEntries(
          Object.entries(value).filter(([k, v]) =>
            k === 'lessons' ? !sameLessons(x.lessons, lessonsOf(base)) : v !== base[k],
          ),
        );
        path = { [`overrides/${session.key}`]: Object.keys(diff).length ? diff : { cleared: true } };
      } else if (mode === 'weekly') path = { [`weekly/${id ?? newSessionId('weekly')}`]: { ...value, day: x.day } };
      else path = { [`events/${id ?? newSessionId('event')}`]: { ...value, date: x.date } };
      try {
        await saveConfig(path);
        close();
        toast(isNew ? 'Session added' : 'Changes saved');
      } catch (e) {
        toast(e.message, { ms: 4000 });
      }
    };

    const remove = async () => {
      const n = bookingsFor(id);
      const ok = await confirmDialog({
        title: `Delete this ${mode === 'weekly' ? 'weekly' : 'one-off'} session?`,
        message:
          (mode === 'weekly'
            ? `${DAY_NAMES[source.day]} ${timesOf(source)} at ${source.title} disappears from every week.`
            : `${longDate(source.date)} at ${source.title} disappears.`) +
          (n ? ` ${n} booking${n === 1 ? '' : 's'} already made will be dropped.` : '') +
          ' To call off a single date instead, use Cancel Session.',
        confirm: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await saveConfig({ [`${mode === 'weekly' ? 'weekly' : 'events'}/${id}`]: { deleted: true } });
        close();
        toast('Session deleted');
      } catch (e) {
        toast(e.message, { ms: 4000 });
      }
    };

    const undo = async () => {
      try {
        await saveConfig({ [`overrides/${session.key}`]: { cleared: true } });
        close();
        toast('Back to the usual timetable');
      } catch (e) {
        toast(e.message, { ms: 4000 });
      }
    };

    return h(
      'form',
      { class: 'sheet-body', onSubmit: (e) => (e.preventDefault(), save()) },
      sheetNav({
        title: isNew ? `New ${what}` : mode === 'override' ? `Change ${what}` : `Edit ${what}`,
        left: { label: 'Cancel', onClick: () => close() },
        right: { label: isNew ? 'Add' : 'Save', bold: true, onClick: save },
      }),
      mode === 'override' &&
        h(
          'p',
          { class: 'sheet-status' },
          `Changes apply to ${dayTitle(session)} only. Everyone sees the session marked “Changed”.`,
        ),
      group(
        { header: 'Venue' },
        row({ title, cls: 'row-inline' }),
        row({ title: venues, cls: 'row-inline chips-row' }),
      ),
      mode === 'weekly' && group({ header: 'Every' }, row({ title: dayBox, cls: 'row-inline' })),
      group(
        { header: 'When' },
        mode === 'event' && row({ title: 'Date', trailing: date }),
        row({ title: 'Starts', trailing: timeInput('start', 'Start time') }),
        row({ title: 'Ends', trailing: timeInput('end', 'End time') }),
        row({ title: 'Places', trailing: places }),
      ),
      group(
        { footer: 'Offsite sessions show “Offsite · bring your own kit”.' },
        row({ title: 'Offsite', trailing: offsite }),
        row({ title: note, cls: 'row-inline' }),
      ),
      h(
        'section',
        { class: 'group-wrap' },
        h('div', { class: 'group-header' }, h('span', {}, 'Coach Lessons')),
        lessonBox,
        h(
          'div',
          { class: 'group-footer' },
          'Members can put their name down for an individual lesson with each coach. Names beyond the slots become reserves.',
        ),
      ),
      mode === 'override' &&
        session.changed &&
        group(
          {},
          row({ lead: tile('undo', 'gray'), title: 'Undo Changes for This Date', tone: 'accent', onClick: undo }),
        ),
      mode !== 'override' &&
        !isNew &&
        group(
          {},
          row({
            lead: tile('trash', 'red'),
            title: `Delete ${mode === 'weekly' ? 'Weekly' : 'One-off'} Session`,
            tone: 'danger',
            onClick: remove,
          }),
        ),
    );
  });
}

async function exportCsv(sessions) {
  await decryptVisible(sessions);
  const rows = [];
  for (const s of sessions) {
    const r = roster(S.sessions[s.key], s.capacity);
    const closed = closureOf(S.closures[s.key]);
    for (const [list, status] of [
      [r.booked, closed ? 'cancelled' : 'booked'],
      [r.waitlist, 'waitlist'],
    ]) {
      list.forEach((b, i) =>
        rows.push({
          session: s,
          status,
          position: i + 1,
          name: b.name,
          member: S.members.get(b.enc),
          bookedAt: b.createdAt,
        }),
      );
    }
  }
  if (!rows.length) return toast('No bookings to export yet');
  download(
    `training-register-${zonedDate(Date.now())}.csv`,
    new Blob(['﻿', registerCsv(rows)], { type: 'text/csv;charset=utf-8' }),
  );
}

/* ---------- start ---------- */

function applyTheme() {
  const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

async function start() {
  applyTheme();
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  render();
  if (!api.serverUrl()) {
    toast('Bookings aren’t connected to a server yet');
    return;
  }
  const today = zonedDate(Date.now());
  const status = (st) => {
    if (S.status !== st) {
      S.status = st;
      render();
    }
  };
  api.watch('booking/sessions', {
    startAt: today,
    onChange: (t) => {
      S.sessions = t;
      render();
      if (S.org) decryptVisible(sessionsAt());
    },
    onStatus: status,
  });
  api.watch('booking/closures', { startAt: today, onChange: (t) => ((S.closures = t), render()), onStatus: status });
  api.watch('booking/config', { onChange: (t) => ((S.config = t), render()), onStatus: status });
  api.watch('booking/lessons', { startAt: today, onChange: (t) => ((S.lessons = t), render()), onStatus: status });
  try {
    S.keys = await api.getKeys();
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
  S.keysLoaded = true;
  render();
  if (location.hash === '#organiser') organiserSheet();
  setInterval(render, 60_000); // sessions drop off as they finish
  // Expose for debugging and end-to-end tests.
  window.__book = S;
}

start();
