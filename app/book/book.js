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
  recentSessions,
  checkinOpen,
  CHECKIN_EARLY_MS,
  newCheckinCode,
  formatCheckinCode,
  normalizeCheckinCode,
  parseCheckinHash,
  attendanceOf,
  attendanceReport,
} from './core.js';
import { qrSvg } from '../js/ui/qr.js';
import { editAboutSheet, photosSheet } from '../js/ui/aboutView.js';
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
  attendance: {}, // registers (booking/attendance)
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
  const reg = attendanceOf(S.attendance[s.key]);
  return {
    r,
    closed,
    m,
    place,
    reg,
    here: Boolean(m && reg.present.has(m.id)),
    registerOpen: now >= s.startMs - CHECKIN_EARLY_MS, // organiser can take the register
    started: s.startMs <= now,
    left: Math.max(0, s.capacity - r.booked.length),
  };
}

function statusTag(st) {
  if (st.closed) return h('span', { class: 'tag tag-red' }, 'Cancelled');
  if (st.here) return h('span', { class: 'tag tag-green' }, icon('check'), 'Checked in');
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
      iconButton('lock', () => (location.hash = '#book/admin'), 'Admin', S.org ? 'org-on' : ''),
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
        {},
        row({
          lead: tile('lock', 'green'),
          title: 'Organiser mode is on',
          subtitle: 'Membership numbers and tools are visible on this phone',
          chevron: true,
          onClick: () => (location.hash = '#book/admin'),
        }),
      ),
    S.keysLoaded &&
      !S.keys.publicKey &&
      group(
        {
          footer: 'An organiser needs to set up bookings once (Book → Admin) before anyone can book.',
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
  if (adminRoot) renderAdmin();
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
      const taking = S.org && st.registerOpen && !st.closed;
      const person = (b, i, wait) => {
        const here = st.reg.present.has(b.id);
        const self = here && S.attendance[s.key]?.[b.id]?.how === 'self';
        return row({
          lead: taking
            ? button(
                here ? icon('check') : String(i + 1),
                () => markPresent(s, b, !here),
                `att-btn${here ? ' on' : ''}${wait ? ' muted' : ''}`,
                { 'aria-label': `${here ? 'Unmark' : 'Mark'} ${b.name} as here`, 'aria-pressed': String(here) },
              )
            : h('span', { class: `num-badge${wait ? ' muted' : ''}` }, i + 1),
          title: [b.name, isMine(b) && h('span', { class: 'you' }, ' You')],
          subtitle: S.org
            ? `No. ${S.members.get(b.enc) ?? '…'}${self ? ` · checked in ${hmText(S.attendance[s.key][b.id].at)}` : ''}`
            : null,
          cls: here && taking ? 'is-here' : '',
          trailing:
            S.org &&
            holdButton(icon('trash'), () => organiserRemove(s, b), {
              cls: 'mini del',
              hint: 'Press and hold to remove this booking',
              attrs: { 'aria-label': `Remove ${b.name}` },
            }),
        });
      };
      let action = null;
      if (st.m && st.place.status) {
        action = [
          !st.closed &&
            checkinOpen(s) &&
            (st.here
              ? h('div', { class: 'checked-in' }, icon('checkCircle'), 'You’re checked in')
              : button(
                  [icon('check'), 'Check In'],
                  () => askCheckin(s, st.m),
                  'btn-filled btn-block btn-large btn-green',
                )),
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
        taking &&
          group(
            {
              header: `Check-in · ${st.reg.present.size + st.reg.walkIns.length} here`,
              footer: 'Tap a number below to tick someone off by hand.',
            },
            checkinOpen(s) &&
              row({
                lead: tile('grid', 'teal'),
                title: 'Show Check-in Code',
                subtitle: 'Members scan it with their camera',
                chevron: true,
                onClick: () => checkinCodeSheet(s),
              }),
            row({ lead: tile('plus', 'indigo'), title: 'Add Walk-in…', chevron: true, onClick: () => walkInSheet(s) }),
          ),
        ...s.lessons.map((l) => lessonGroup(s, l, st)),
        group(
          {
            header: `Booked · ${st.r.booked.length}${taking ? ` · ${st.r.booked.filter((b) => st.reg.present.has(b.id)).length} here` : ''}`,
          },
          ...(st.r.booked.length
            ? st.r.booked.map((b, i) => person(b, i, false))
            : [row({ title: h('span', { class: 'row-sub' }, 'No one yet — be the first') })]),
        ),
        st.r.waitlist.length > 0 &&
          group({ header: `Waitlist · ${st.r.waitlist.length}` }, ...st.r.waitlist.map((b, i) => person(b, i, true))),
        S.org &&
          st.reg.walkIns.length > 0 &&
          group(
            { header: `Walk-ins · ${st.reg.walkIns.length}` },
            ...st.reg.walkIns.map((w) =>
              row({
                lead: h('span', { class: 'att-btn on' }, icon('check')),
                title: w.name,
                subtitle: w.enc ? `No. ${S.members.get(w.enc) ?? '…'}` : 'No number given',
                trailing: holdButton(icon('trash'), () => removeWalkIn(s, w), {
                  cls: 'mini del',
                  hint: 'Press and hold to remove this walk-in',
                  attrs: { 'aria-label': `Remove walk-in ${w.name}` },
                }),
              }),
            ),
          ),
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
      placeholder: 'First and last name',
      autocomplete: 'name',
      maxlength: 60,
      required: true,
      'aria-label': 'Name',
    });
    const member = h('input', {
      class: 'input',
      value: me.member ?? '',
      placeholder: 'Your membership number',
      autocapitalize: 'characters',
      autocomplete: 'off',
      maxlength: 20,
      required: true,
      'aria-label': 'Membership number',
    });
    const st = stateOf(s);
    const submit = button(st.left ? 'Book My Place' : 'Add Me to the Waitlist', go, 'btn-filled btn-block btn-large');
    // Both are needed: the button wakes up once there's a name and a number.
    const ready = () => (submit.disabled = !(cleanName(name.value) && member.value.trim()));
    name.addEventListener('input', ready);
    member.addEventListener('input', ready);
    ready();
    name.id = 'book-name';
    member.id = 'book-member';
    const field = (label, input) =>
      row({ lead: h('label', { class: 'field-label', for: input.id }, label), title: input, cls: 'row-inline' });
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
        const entry = { s: s.key, id, key, name: details.name };
        store.set(MINE, [...mine().filter((m) => m.s >= zonedDate(Date.now())), entry]);
        store.set(ME, details);
        close(entry);
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
            'Both are required. Your name is shown on the list; your membership number is encrypted on this phone so only the organiser can read it. Both are remembered here for next time.',
        },
        field('Name', name),
        field('Membership No.', member),
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
  const url = new URL('#book', location.href.split('#')[0]).href;
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

/* ---------- admin (Book → Admin) ---------- */

let adminRoot = null;

/** The organiser's screen: unlock with the passphrase, then every organiser tool in one place. */
function renderAdmin() {
  const pb = adminRoot.querySelector('.page-body');
  const y = pb?.scrollTop ?? 0;
  const now = Date.now();
  const nav = h(
    'header',
    { class: 'navbar large' },
    h(
      'div',
      { class: 'nav-l' },
      button([icon('chevronLeft'), 'Sessions'], () => (location.hash = '#book'), 'nav-back', {
        'aria-label': 'Back to sessions',
      }),
    ),
    h('div', { class: 'nav-title' }, 'Admin'),
    h('div', { class: 'nav-r' }),
  );
  let content;
  if (!api.serverUrl()) content = [h('p', { class: 'sheet-status' }, 'Bookings aren’t connected to a server yet.')];
  else if (!S.keysLoaded) content = [h('p', { class: 'sheet-status' }, 'Connecting…')];
  else if (!S.org) content = [unlockForm(), !S.keys.publicKey && importGroup()];
  else {
    const doorNow = sessionsAt(now).filter((s) => checkinOpen(s, now) && !closureOf(S.closures[s.key]));
    content = [
      group(
        { footer: 'Membership numbers and organiser tools are visible on this phone until you lock it.' },
        row({ lead: tile('lock', 'green'), title: 'Organiser mode is on', detail: 'This phone' }),
      ),
      doorNow.length > 0 &&
        group(
          { header: 'At the Door', footer: 'Show the code at the entrance; members scan it to check in.' },
          ...doorNow.map((s) =>
            row({
              lead: tile('grid', 'teal'),
              title: `Check-in Code · ${venueOf(s).short}`,
              subtitle: `${timeRange(s)} · ${attendanceOf(S.attendance[s.key]).present.size} checked in`,
              chevron: true,
              onClick: () => checkinCodeSheet(s),
            }),
          ),
        ),
      group(
        { header: 'Sessions' },
        row({
          lead: tile('check', 'teal'),
          title: 'Attendance',
          subtitle: 'Registers, no-shows and walk-ins',
          chevron: true,
          onClick: attendanceSheet,
        }),
        row({ lead: tile('clock', 'blue'), title: 'Weekly Timetable', chevron: true, onClick: timetableSheet }),
        row({
          lead: tile('plus', 'purple'),
          title: 'Add One-off Session',
          chevron: true,
          onClick: () => editSessionSheet({ mode: 'event' }),
        }),
        row({
          lead: tile('doc', 'green'),
          title: 'Export Register (CSV)',
          subtitle: 'Upcoming sessions',
          chevron: true,
          onClick: () => exportCsv(sessionsAt()),
        }),
      ),
      group(
        { header: 'Club Page', footer: 'What everyone sees under About.' },
        row({
          lead: tile('link', 'indigo'),
          title: 'Links',
          subtitle: 'Students’ Union, WhatsApp, Instagram, TikTok',
          chevron: true,
          onClick: () => editAboutSheet(S.org.secret),
        }),
        row({
          lead: tile('photo', 'orange'),
          title: 'Photos',
          chevron: true,
          onClick: () => photosSheet(S.org.secret),
        }),
      ),
      group({}, row({ lead: tile('lock', 'gray'), title: 'Lock Organiser Mode', tone: 'danger', onClick: lock })),
    ];
  }
  const body = h('div', { class: 'page-body' }, h('h1', { class: 'large-title' }, 'Admin'), ...content);
  body.addEventListener('scroll', () => nav.classList.toggle('scrolled', body.scrollTop > 8), { passive: true });
  // Don't rebuild the form under someone typing their passphrase.
  if (
    !S.org &&
    adminRoot.querySelector('input[aria-label="Organiser passphrase"]') &&
    S.keysLoaded &&
    adminRoot.dataset.state === 'form'
  )
    return;
  adminRoot.dataset.state = S.org ? 'tools' : S.keysLoaded ? 'form' : 'wait';
  fill(adminRoot, h('section', { class: 'page' }, nav, body));
  body.scrollTop = y;
}

/** Moving from the old (Firebase) database: bring in its exported JSON. */
function importGroup() {
  const picker = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    'aria-label': 'Choose export file',
  });
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    picker.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('That file isn’t a database export (JSON)', { ms: 4000 });
    }
    const ok = await confirmDialog({
      title: 'Import the Old Data?',
      message:
        'Bookings, the timetable, shared poules and your organiser passphrase come across. Afterwards, unlock with your usual passphrase.',
      confirm: 'Import',
    });
    if (!ok) return;
    try {
      await api.importAll(data);
      S.keys = await api.getKeys();
      adminRoot.dataset.state = '';
      render();
      toast('Old data imported: unlock with your passphrase', { ms: 4000 });
    } catch (e) {
      toast(e.message, { ms: 4000 });
    }
  });
  return group(
    {
      header: 'Moving From the Old Database?',
      footer:
        'In the Firebase console: Realtime Database → ⋮ → Export JSON. Then pick that file here. Only works once, before anything else is set up.',
    },
    picker,
    row({ lead: tile('download', 'indigo'), title: 'Import Old Data…', chevron: true, onClick: () => picker.click() }),
  );
}

function unlockForm() {
  const setup = !S.keys.publicKey;
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
  const label = setup ? 'Set Up Bookings' : 'Unlock';
  const go = button([icon('lock'), label], null, 'btn-filled btn-block btn-large', { type: 'submit' });
  async function submit() {
    const p = pass.value;
    if (setup) {
      if (p.length < 10) return toast('Use at least 10 characters', { ms: 3500 });
      if (p !== pass2.value) return toast('The passphrases don’t match');
    }
    go.disabled = true;
    go.lastChild.textContent = setup ? 'Setting up…' : 'Unlocking…';
    try {
      if (setup) {
        const keys = await createOrganiserKeys(p);
        await api.setUp(keys);
        S.keys = await api.getKeys();
      }
      S.org = await unlockOrganiser(p, S.keys.privateKey);
      toast(setup ? 'Bookings are open' : 'Organiser mode on');
      adminRoot.dataset.state = '';
      render();
      decryptVisible(sessionsAt());
    } catch (e) {
      toast(e.message, { ms: 4000 });
      go.disabled = false;
      go.lastChild.textContent = label;
    }
  }
  return h(
    'form',
    { class: 'admin-unlock', onSubmit: (e) => (e.preventDefault(), submit()) },
    h('div', { class: 'admin-badge' }, icon('lock')),
    h(
      'p',
      { class: 'sheet-status' },
      setup
        ? 'Choose an organiser passphrase. It unlocks membership numbers and the organiser tools on any phone. Keep it safe: it can’t be recovered or changed.'
        : 'Club organisers: enter the passphrase to manage sessions, take registers and edit the club page.',
    ),
    group({}, row({ title: pass, cls: 'row-inline' }), setup && row({ title: pass2, cls: 'row-inline' })),
    go,
  );
}

function lock() {
  S.org = null;
  S.members.clear();
  toast('Organiser mode locked');
  if (adminRoot) adminRoot.dataset.state = '';
  render();
}

async function decryptVisible(sessions) {
  if (!S.org) return;
  let changed = false;
  for (const s of sessions) {
    for (const b of [...Object.values(S.sessions[s.key] ?? {}), ...Object.values(S.attendance[s.key] ?? {})]) {
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
    const reg = attendanceOf(S.attendance[s.key]);
    const attended = (b) => (reg.present.has(b.id) ? 'yes' : reg.taken ? 'no' : '');
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
          attended: attended(b),
        }),
      );
    }
    reg.walkIns.forEach((w, i) =>
      rows.push({
        session: s,
        status: 'walk-in',
        position: i + 1,
        name: w.name,
        member: w.enc ? S.members.get(w.enc) : '',
        bookedAt: null,
        attended: 'yes',
      }),
    );
  }
  if (!rows.length) return toast('No bookings to export yet');
  download(
    `training-register-${zonedDate(Date.now())}.csv`,
    new Blob(['﻿', registerCsv(rows)], { type: 'text/csv;charset=utf-8' }),
  );
}

/* ---------- attendance ---------- */

const hmText = (ms) => {
  const x = hm(ms);
  return `${x.t} ${x.p}`;
};
const CODES = 'piste:checkinCodes'; // organiser: { sessionKey: code } opened on this phone

async function markPresent(s, b, present) {
  try {
    await api.setAttendance(s.key, b.id, present, S.org.secret);
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

async function removeWalkIn(s, w) {
  try {
    await api.setAttendance(s.key, w.id, false, S.org.secret, { walkIn: true, name: w.name });
    toast(`Removed ${w.name}`);
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

/** Organiser: the QR code (and typed code) for members to check themselves in. */
async function checkinCodeSheet(s) {
  const codes = store.get(CODES, {});
  let code = codes[s.key];
  if (!code) {
    code = newCheckinCode();
    try {
      await api.openCheckin(s.key, code, S.org.secret);
    } catch (e) {
      return toast(e.message, { ms: 4000 });
    }
    const today = zonedDate(Date.now());
    store.set(CODES, {
      ...Object.fromEntries(Object.entries(codes).filter(([k]) => k.slice(0, 10) >= today)),
      [s.key]: code,
    });
  }
  const link = `${location.href.split('#')[0]}#checkin/${s.key}/${code}`;
  let redraw = null;
  return modal((close) => {
    const count = h('div', { class: 'qr-count' });
    const draw = () => {
      const st = stateOf(s);
      fill(count, `${st.reg.present.size + st.reg.walkIns.length} checked in · ${st.r.booked.length} booked`);
    };
    redraw = draw;
    sheets.add(draw);
    draw();
    return h(
      'div',
      { class: 'sheet-body share-dialog' },
      sheetNav({ title: 'Check In', right: { label: 'Done', bold: true, onClick: () => close() } }),
      h('div', { class: 'qr-title' }, `${venueOf(s).short} · ${dayShort(s)}`),
      h(
        'div',
        { class: 'qr-wrap' },
        qrSvg(link, { label: `QR code to check in to ${venueOf(s).name}` }),
        h('div', { class: 'qr-caption' }, 'Point your phone’s camera at this, or type the code in the session.'),
      ),
      h(
        'div',
        { class: 'share-code', 'aria-label': `Check-in code ${code.split('').join(' ')}` },
        formatCheckinCode(code),
      ),
      count,
    );
  }).finally(() => sheets.delete(redraw));
}

/** Member: type the code shown at the door. */
async function askCheckin(s, m) {
  const typed = await promptText({
    title: 'Check In',
    message: 'Scan the QR code at the door with your camera, or type the code shown under it.',
    placeholder: 'ABCD-2345',
    confirm: 'Check In',
    maxLength: 12,
    attrs: { autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Check-in code' },
  });
  if (typed === null) return;
  const code = normalizeCheckinCode(typed);
  if (!code) return toast('That code doesn’t look right (8 letters and numbers)', { ms: 3500 });
  await checkInWith(s, m, code);
}

async function checkInWith(s, m, code) {
  if (attendanceOf(S.attendance[s.key]).present.has(m.id)) return checkedInSheet(s);
  try {
    await api.checkIn(s.key, m.id, m.key, code);
    checkedInSheet(s);
  } catch (e) {
    toast(/permission/.test(e.message) ? 'That code isn’t right for this session' : e.message, { ms: 4000 });
  }
}

function checkedInSheet(s) {
  return modal(
    (close) =>
      h(
        'div',
        { class: 'alert checked-alert' },
        h(
          'div',
          { class: 'alert-body' },
          h('div', { class: 'big-check' }, icon('checkCircle')),
          h('h2', {}, 'You’re checked in'),
          h('p', {}, `${venueOf(s).name} · ${dayShort(s)} · ${timeRange(s)}`),
        ),
        h(
          'div',
          { class: 'alert-actions' },
          button('Done', () => close(), 'alert-btn bold'),
        ),
      ),
    { kind: 'alert' },
  );
}

/** Opened from the QR code: check in with the booking on this phone, or book first. */
async function checkinFromLink({ session: key, code }) {
  history.replaceState(null, '', location.pathname + location.search);
  const s = [...sessionsAt(), ...recentSessions(Date.now(), { days: 1, config: S.config })].find((x) => x.key === key);
  if (!s) return toast('That session isn’t on the timetable', { ms: 4000 });
  if (!checkinOpen(s)) {
    return confirmDialog({
      title: Date.now() < s.startMs ? 'Check-in isn’t open yet' : 'This session has finished',
      message: `${venueOf(s).name} · ${dayShort(s)} · ${timeRange(s)}. Check-in opens an hour before the start.`,
      confirm: 'OK',
      cancel: 'Close',
    });
  }
  const m = myBooking(s);
  if (m) return checkInWith(s, m, code);
  const st = stateOf(s);
  if (st.closed) return toast('This session has been cancelled', { ms: 4000 });
  const ok = await confirmDialog({
    title: 'No booking on this phone',
    message: `You haven’t booked ${venueOf(s).short}, ${dayShort(s)} on this phone. Book now and check in?`,
    confirm: 'Book & Check In',
  });
  if (!ok) return;
  const booked = await bookSheet(s); // resolves with the new booking
  if (booked) await checkInWith(s, booked, code);
}

/** Organiser: add someone who turned up without booking. */
function walkInSheet(s) {
  return modal((close) => {
    const name = h('input', {
      class: 'input',
      placeholder: 'Full name',
      maxlength: 60,
      autocomplete: 'off',
      'aria-label': 'Walk-in name',
    });
    const member = h('input', {
      class: 'input',
      placeholder: 'Membership / student no. (optional)',
      autocapitalize: 'characters',
      autocomplete: 'off',
      maxlength: 20,
      'aria-label': 'Walk-in membership number',
    });
    const add = button('Add Walk-in', go, 'btn-filled btn-block btn-large');
    async function go() {
      const n = cleanName(name.value);
      const num = member.value.trim().toUpperCase();
      if (n.length < 2) return toast('Enter their name');
      if (num && validateBooking({ name: n, member: num })) return toast(validateBooking({ name: n, member: num }));
      add.disabled = true;
      try {
        const extra = { walkIn: true, name: n };
        if (num) extra.enc = await encryptFor(S.keys.publicKey, num);
        await api.setAttendance(s.key, `w${newId().slice(1)}`, true, S.org.secret, extra);
        close();
        toast(`${n} added`);
      } catch (e) {
        toast(e.message, { ms: 4000 });
        add.disabled = false;
      }
    }
    return h(
      'form',
      { class: 'sheet-body', onSubmit: (e) => (e.preventDefault(), go()) },
      sheetNav({ title: 'Walk-in', left: { label: 'Cancel', onClick: () => close() } }),
      group(
        { footer: 'Someone who turned up without booking. The number is encrypted like a booking’s.' },
        row({ title: name, cls: 'row-inline' }),
        row({ title: member, cls: 'row-inline' }),
      ),
      add,
    );
  });
}

const PERIODS = [
  ['4', '4 Weeks'],
  ['12', '12 Weeks'],
  ['all', 'All Time'],
];

/** Organiser: registers to take (today and the last week) and attendance over time. */
function attendanceSheet() {
  let period = '4';
  let data = null; // { from, sessions, attendance, closures }
  let loading = false;
  let redraw = null;
  const fromDate = () => (period === 'all' ? '2000-01-01' : zonedDate(Date.now() - Number(period) * 7 * 86_400_000));
  async function load() {
    const from = fromDate();
    if (data?.from === from || loading) return;
    loading = true;
    redraw?.();
    try {
      const [sessions, attendance, closures] = await Promise.all(
        ['sessions', 'attendance', 'closures'].map((x) => api.fetchFrom(`booking/${x}`, from)),
      );
      data = { from, sessions: sessions ?? {}, attendance: attendance ?? {}, closures: closures ?? {} };
      const encs = Object.values(data.sessions).flatMap((x) => Object.values(x ?? {}));
      const walk = Object.values(data.attendance).flatMap((x) => Object.values(x ?? {}));
      for (const b of [...encs, ...walk]) {
        if (b?.enc && !S.members.has(b.enc)) S.members.set(b.enc, await decryptWith(S.org.privateKey, b.enc));
      }
    } catch (e) {
      toast(e.message, { ms: 4000 });
    }
    loading = false;
    redraw?.();
  }
  const capacityOf = (key) => {
    const all = [...sessionsAt(), ...recentSessions(Date.now(), { days: 400, config: S.config })];
    return all.find((x) => x.key === key)?.capacity ?? CAPACITY;
  };
  const personOf = (b) => {
    const num = b.enc && S.members.get(b.enc);
    return num && num !== '?'
      ? { key: `no:${num}`, name: cleanName(b.name), number: num }
      : { key: cleanName(b.name).toLowerCase(), name: cleanName(b.name) };
  };
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const draw = () => {
      const now = Date.now();
      const toTake = [
        ...sessionsAt(now).filter((x) => now >= x.startMs - CHECKIN_EARLY_MS),
        ...recentSessions(now, { days: 7, config: S.config }),
      ];
      const report = data && attendanceReport({ ...data, capacityOf, personOf, from: data.from });
      const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
      fill(
        body,
        sheetNav({ title: 'Attendance', right: { label: 'Done', bold: true, onClick: () => close() } }),
        group(
          {
            header: 'Registers',
            footer: 'Today’s sessions and the last week. Open one to tick people off or add walk-ins.',
          },
          ...(toTake.length
            ? toTake.map((x) => {
                const reg = attendanceOf(S.attendance[x.key]);
                const booked = roster(S.sessions[x.key], x.capacity).booked.length;
                const closed = closureOf(S.closures[x.key]);
                return row({
                  lead: tile(reg.taken ? 'check' : 'clock', reg.taken ? 'green' : 'gray'),
                  title: `${dayShort(x)} · ${venueOf(x).short}`,
                  subtitle: closed
                    ? 'Cancelled'
                    : reg.taken
                      ? `${reg.present.size + reg.walkIns.length} here · ${booked} booked`
                      : `Register not taken · ${booked} booked`,
                  chevron: true,
                  onClick: () => sessionSheet(x),
                  attrs: { 'aria-label': `Register for ${dayShort(x)} ${venueOf(x).name}` },
                });
              })
            : [row({ title: h('span', { class: 'row-sub' }, 'No sessions in the last week') })]),
        ),
        h(
          'div',
          { class: 'round-tabs' },
          segmented(PERIODS, period, (v) => ((period = v), load(), draw()), 'Period'),
        ),
        !report
          ? h('p', { class: 'sheet-status' }, loading ? 'Loading…' : '')
          : [
              h(
                'div',
                { class: 'stat-tiles' },
                h('div', { class: 'stat' }, h('b', {}, report.sessions), h('span', {}, 'registers')),
                h(
                  'div',
                  { class: 'stat' },
                  h('b', {}, pct(report.attended - report.walkIns, report.places)),
                  h('span', {}, 'turned up'),
                ),
                h('div', { class: 'stat warn' }, h('b', {}, report.noShows), h('span', {}, 'no-shows')),
                h('div', { class: 'stat' }, h('b', {}, report.walkIns), h('span', {}, 'walk-ins')),
              ),
              group(
                {
                  header: 'Members',
                  footer:
                    'Only sessions with a register count. A no-show had a place but wasn’t checked in; the waitlist doesn’t count. People are matched by membership number.',
                },
                ...(report.people.length
                  ? report.people.map((p) =>
                      row({
                        title: p.name,
                        subtitle: [
                          `Came ${p.attended}`,
                          p.walkIns ? ` (${p.walkIns} walk-in)` : '',
                          p.booked ? ` · ${pct(p.attended - p.walkIns, p.booked)} of bookings` : '',
                        ].join(''),
                        detail: p.noShows
                          ? h('span', { class: 'noshow' }, `${p.noShows} no-show${p.noShows === 1 ? '' : 's'}`)
                          : '',
                        attrs: { 'aria-label': `${p.name}: came ${p.attended}, ${p.noShows} no-shows` },
                      }),
                    )
                  : [row({ title: h('span', { class: 'row-sub' }, 'No registers taken in this period') })]),
              ),
              report.people.length > 0 &&
                group(
                  {},
                  row({
                    lead: tile('doc', 'green'),
                    title: 'Export Attendance (CSV)',
                    chevron: true,
                    onClick: () => exportAttendance(report, data.from),
                  }),
                ),
            ],
      );
    };
    redraw = draw;
    sheets.add(draw);
    draw();
    load();
    return body;
  }).finally(() => sheets.delete(redraw));
}

function exportAttendance(report, from) {
  const cell = (v) => {
    const x = String(v ?? '');
    return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const lines = [
    ['From', from].join(','),
    ['Registers', report.sessions].join(','),
    '',
    ['Name', 'Membership / student no.', 'Places booked', 'Attended', 'Of which walk-ins', 'No-shows'].join(','),
    ...report.people.map((p) =>
      [p.name, p.key.startsWith('no:') ? p.key.slice(3) : '', p.booked, p.attended, p.walkIns, p.noShows]
        .map(cell)
        .join(','),
    ),
  ];
  download(
    `training-attendance-${zonedDate(Date.now())}.csv`,
    new Blob(['﻿', lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
  );
}

/* ---------- start ---------- */

let started = null;
let streams = null; // opens the live streams; returns their close functions
let closers = [];

/** Book tab shown / hidden: open or close the live streams. */
export function resume() {
  if (!streams || closers.length) return;
  closers = streams();
}
export function pause() {
  for (const close of closers) close();
  closers = [];
}

/** Connect and start the live updates (once). */
export function start() {
  started ??= connect();
  return started;
}

/** Book → Sessions. */
export function showSessions() {
  render();
}

/** Book → Admin, drawn into `el`. */
export function showAdmin(el) {
  adminRoot = el;
  adminRoot.dataset.state = '';
  renderAdmin();
}

async function connect() {
  render();
  if (!api.serverUrl()) {
    toast('Bookings aren’t connected to a server yet');
    return;
  }
  const today = zonedDate(Date.now());
  const weekAgo = zonedDate(Date.now() - 7 * 86_400_000); // recent registers can still be taken
  const status = (st) => {
    if (S.status !== st) {
      S.status = st;
      render();
    }
  };
  let loaded;
  const sessionsLoaded = new Promise((resolve) => (loaded = resolve));
  // Live streams only while the Book tab is shown: each holds one of the
  // ~6 connections a browser allows per server, and writes need one too.
  streams = () => [
    api.watch('booking/sessions', {
      startAt: weekAgo,
      onChange: (t) => {
        S.sessions = t;
        loaded();
        render();
        if (S.org) decryptVisible(sessionsAt());
      },
      onStatus: status,
    }),
    api.watch('booking/closures', {
      startAt: weekAgo,
      onChange: (t) => ((S.closures = t), render()),
      onStatus: status,
    }),
    api.watch('booking/attendance', {
      startAt: weekAgo,
      onChange: (t) => {
        S.attendance = t;
        render();
        if (S.org) decryptVisible(sessionsAt());
      },
      onStatus: status,
    }),
    api.watch('booking/config', { onChange: (t) => ((S.config = t), render()), onStatus: status }),
    api.watch('booking/lessons', { startAt: today, onChange: (t) => ((S.lessons = t), render()), onStatus: status }),
  ];
  resume();
  try {
    S.keys = await api.getKeys();
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
  S.keysLoaded = true;
  render();
  // Check-in links from the QR code at the door (also when the page is already open).
  const onCheckinLink = async () => {
    const checkin = parseCheckinHash(location.hash);
    if (!checkin) return;
    await Promise.race([sessionsLoaded, new Promise((r) => setTimeout(r, 8000))]);
    checkinFromLink(checkin);
  };
  window.addEventListener('hashchange', onCheckinLink);
  onCheckinLink();
  setInterval(render, 60_000); // sessions drop off as they finish
  // Expose for debugging and end-to-end tests.
  window.__book = S;
}
