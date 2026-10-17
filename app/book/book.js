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
} from '../js/ui/dom.js';
import { CLUB, CAPACITY } from './schedule.js';
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
  registerCsv,
} from './core.js';
import * as api from './api.js';
import { createOrganiserKeys, unlockOrganiser, encryptFor, decryptWith, randomKey } from './crypto.js';

const root = document.getElementById('book');
const S = {
  keys: { publicKey: null, privateKey: null },
  keysLoaded: false,
  sessions: {},
  closures: {},
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
  const r = roster(S.sessions[s.key], CAPACITY);
  const closed = closureOf(S.closures[s.key]);
  const m = myBooking(s);
  const place = m ? placeOf(r, m.id) : { status: null };
  return { r, closed, m, place, started: s.startMs <= now, left: Math.max(0, CAPACITY - r.booked.length) };
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
  const sessions = upcomingSessions(now);
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
      h(
        'div',
        { class: 'summary-line' },
        h('span', { class: `dot ${S.status}` }),
        ` ${CLUB.subtitle} · ${CAPACITY} places each`,
      ),
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
      v.badge && h('span', { class: 'badge-text' }, ` · ${v.badge}`),
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
  const v = venueOf(s);
  let redraw = null;
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const draw = () => {
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
              ? `You’re booked (place ${st.place.position} of ${CAPACITY}).`
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
              h('span', { style: { width: `${(st.r.booked.length / CAPACITY) * 100}%` } }),
            ),
            h('span', {}, `${st.r.booked.length} of ${CAPACITY} places taken`),
          ),
        ),
        st.closed &&
          group(
            {},
            row({ lead: tile('xmark', 'red'), title: 'Session cancelled', subtitle: st.closed.reason || null }),
          ),
        action,
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
        decryptVisible(upcomingSessions());
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

async function exportCsv(sessions) {
  await decryptVisible(sessions);
  const rows = [];
  for (const s of sessions) {
    const r = roster(S.sessions[s.key], CAPACITY);
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
      if (S.org) decryptVisible(upcomingSessions());
    },
    onStatus: status,
  });
  api.watch('booking/closures', { startAt: today, onChange: (t) => ((S.closures = t), render()), onStatus: status });
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
