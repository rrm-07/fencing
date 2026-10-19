// About: the club's page — a rotating photo album and the club's links
// (Students' Union, WhatsApp, Instagram, TikTok), plus installing the app.
// Organisers edit the links and photos from Book → Admin.

import { h, fill, button, icon, toast, modal, sheetNav, group, row, holdButton, promptText } from './dom.js';
import { CLUB_PAGE, LINKS } from '../club.js';
import * as api from '../../book/api.js';

const S = { about: null, photos: [], loaded: false, users: 0, close: null };
const views = new Set(); // redraw functions (the About page and open admin sheets)
const redraw = () => views.forEach((fn) => fn());

/** The live club page: defaults overlaid with what organisers saved. */
function page() {
  const saved = S.about ?? {};
  const links = { ...CLUB_PAGE.links };
  for (const [k] of LINKS) if (typeof saved[k] === 'string') links[k] = saved[k];
  return { tagline: saved.tagline || CLUB_PAGE.tagline, links };
}

function take(t) {
  S.about = t?.about ?? null;
  S.photos = Object.entries(t?.photos ?? {})
    .filter(([, p]) => p && !p.deleted && typeof p.src === 'string' && p.src.startsWith('data:image/'))
    .map(([id, p]) => ({ id, src: p.src, caption: p.caption ?? '', at: p.at ?? 0 }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  S.loaded = true;
  redraw();
}

/** One-off read of the club page (the admin sheets, which sit beside the booking streams). */
async function load() {
  take(await api.fetchFrom('club'));
}

/** Stream the club page while the About tab shows it; returns a function to stop. */
function watch() {
  if (!api.serverUrl()) return () => {};
  S.users += 1;
  S.close ??= api.watch('club', { onChange: take });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    S.users -= 1;
    if (!S.users) {
      S.close?.();
      S.close = null;
    }
  };
}

/* ---------- installing ---------- */

let installPrompt = null; // Android / Chrome: the deferred install prompt
globalThis.addEventListener?.('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  redraw();
});
const standalone = () =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true;
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function install() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    return redraw();
  }
  modal((close) =>
    h(
      'div',
      { class: 'sheet-body' },
      sheetNav({ title: 'Install the App', right: { label: 'Done', bold: true, onClick: () => close() } }),
      h(
        'p',
        { class: 'sheet-status' },
        'Add UCL Fencing to your home screen. It opens full screen like any other app and works offline.',
      ),
      group(
        {},
        ...(isIOS()
          ? [
              row({
                lead: h('span', { class: 'num-badge' }, '1'),
                title: 'Tap the Share button in Safari',
                trailing: icon('share'),
              }),
              row({ lead: h('span', { class: 'num-badge' }, '2'), title: 'Choose “Add to Home Screen”' }),
              row({ lead: h('span', { class: 'num-badge' }, '3'), title: 'Tap Add' }),
            ]
          : [
              row({ lead: h('span', { class: 'num-badge' }, '1'), title: 'Open the browser menu (⋮)' }),
              row({
                lead: h('span', { class: 'num-badge' }, '2'),
                title: 'Choose “Install app” or “Add to Home screen”',
              }),
            ]),
      ),
    ),
  );
}

/* ---------- photo album ---------- */

const PLACEHOLDERS = [
  { title: 'Beginners welcome', sub: 'Kit provided at training', tint: 'a' },
  { title: 'Foil · Épée · Sabre', sub: 'Weekly sessions in Bloomsbury', tint: 'b' },
  { title: 'Book training here', sub: 'Book tab → pick a session', tint: 'c' },
];
const ROTATE_MS = 5000;

function album() {
  const photos = S.photos;
  const slides = photos.length
    ? photos.map((p) =>
        h(
          'figure',
          { class: 'slide' },
          h('img', { src: p.src, alt: p.caption || 'Club photo', decoding: 'async', draggable: 'false' }),
          p.caption && h('figcaption', {}, p.caption),
        ),
      )
    : PLACEHOLDERS.map((p) =>
        h(
          'figure',
          { class: `slide placeholder tint-${p.tint}` },
          h('div', { class: 'ph-art' }, icon('fencing')),
          h('figcaption', {}, h('b', {}, p.title), h('span', {}, p.sub)),
        ),
      );
  const dots = h(
    'div',
    { class: 'dots', role: 'tablist', 'aria-label': 'Photos' },
    ...slides.map((_, i) =>
      h('button', {
        type: 'button',
        class: 'dot-btn',
        'aria-label': `Photo ${i + 1} of ${slides.length}`,
        onClick: () => go(i, true),
      }),
    ),
  );
  const el = h('div', { class: 'album', 'aria-roledescription': 'carousel' }, ...slides, dots);
  let i = 0;
  let timer = null;
  function go(n, user = false) {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    [...dots.children].forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    if (user) schedule();
  }
  function schedule() {
    clearInterval(timer);
    if (slides.length > 1)
      timer = setInterval(() => (el.isConnected && !document.hidden ? go(i + 1) : null), ROTATE_MS);
  }
  // Swipe between photos.
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  el.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1), true);
  });
  go(0);
  schedule();
  el.stop = () => clearInterval(timer);
  return el;
}

/* ---------- the page ---------- */

export function mountAboutView(root) {
  let current = null;
  function render() {
    current?.stop?.();
    const { tagline, links } = page();
    const visible = LINKS.filter(([k]) => links[k]);
    const href = (k) => (k === 'email' && !links[k].startsWith('mailto:') ? `mailto:${links[k]}` : links[k]);
    current = album();
    const body = h(
      'div',
      { class: 'page-body about' },
      h(
        'header',
        { class: 'about-hero' },
        h('div', { class: 'crest', 'aria-hidden': 'true' }, icon('fencing')),
        h('h1', { class: 'about-name' }, CLUB_PAGE.name),
        h('p', { class: 'about-tagline' }, tagline),
      ),
      current,
      h(
        'nav',
        { class: 'linktree', 'aria-label': 'Club links' },
        button(
          [
            h('span', { class: 'lt-icon tile-blue' }, icon('calendar')),
            h(
              'span',
              { class: 'lt-text' },
              h('b', {}, 'Book Training'),
              h('small', {}, 'Reserve your place at a session'),
            ),
            icon('chevronRight', 'lt-go'),
          ],
          () => (location.hash = '#book'),
          'lt-btn',
        ),
        ...visible.map(([k, label, ic, tint, hint]) =>
          h(
            'a',
            { class: 'lt-btn', href: href(k), target: '_blank', rel: 'noopener', 'data-link': k },
            h('span', { class: `lt-icon lt-${tint}` }, icon(ic)),
            h('span', { class: 'lt-text' }, h('b', {}, label), hint && h('small', {}, hint)),
            icon('arrowUpRight', 'lt-go'),
          ),
        ),
        !standalone() &&
          button(
            [
              h('span', { class: 'lt-icon tile-gray' }, icon('download')),
              h(
                'span',
                { class: 'lt-text' },
                h('b', {}, 'Install the App'),
                h('small', {}, 'Full screen, on your home screen, works offline'),
              ),
              icon('chevronRight', 'lt-go'),
            ],
            install,
            'lt-btn',
          ),
      ),
      h(
        'p',
        { class: 'group-footer center-foot' },
        'Scoring, poules and team matches work offline. Bookings need a connection.',
      ),
    );
    fill(root, h('section', { class: 'page' }, body));
  }
  views.add(() => !root.closest('[hidden]') && render());
  let stop = null;
  return {
    show() {
      stop ??= watch();
      render();
    },
    hide() {
      stop?.();
      stop = null;
      current?.stop?.();
    },
  };
}

/* ---------- organiser: edit links and photos ---------- */

const URL_OK = /^https:\/\/[^\s]+$/;

/** Organiser: change the links and tagline. */
export async function editAboutSheet(secret) {
  try {
    await load(); // start from what's saved, not the defaults
  } catch (e) {
    return toast(e.message, { ms: 4000 });
  }
  return modal((close) => {
    const { tagline, links } = page();
    const fields = {};
    const input = (k, placeholder, value, type = 'url') => {
      fields[k] = h('input', {
        class: 'input',
        type,
        value: value ?? '',
        placeholder,
        maxlength: 300,
        'aria-label': placeholder,
        autocapitalize: 'off',
        spellcheck: 'false',
      });
      return row({ title: fields[k], cls: 'row-inline' });
    };
    const save = async () => {
      const value = { tagline: fields.tagline.value.trim().slice(0, 120) };
      for (const [k, label] of LINKS) {
        let v = fields[k].value.trim();
        if (k === 'email' && v && !v.startsWith('mailto:')) {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('Check the email address');
        } else if (v && !URL_OK.test(v)) {
          if (/^[\w.-]+\.[a-z]{2,}\//i.test(v)) v = `https://${v}`;
          else return toast(`${label}: paste the full link (https://…)`, { ms: 3500 });
        }
        value[k] = v;
      }
      try {
        await api.saveClub({ about: value }, secret);
        await load().catch(() => {});
        close();
        toast('Club page updated');
      } catch (e) {
        toast(e.message, { ms: 4000 });
      }
    };
    return h(
      'form',
      { class: 'sheet-body', onSubmit: (e) => (e.preventDefault(), save()) },
      sheetNav({
        title: 'Club Links',
        left: { label: 'Cancel', onClick: () => close() },
        right: { label: 'Save', bold: true, onClick: save },
      }),
      group({ header: 'Tagline' }, input('tagline', 'Tagline', tagline, 'text')),
      group(
        {
          header: 'Links',
          footer:
            'Paste each full link. Empty links are hidden. Examples: https://chat.whatsapp.com/…, https://instagram.com/…, https://tiktok.com/@…',
        },
        ...LINKS.map(([k, label]) =>
          input(k, k === 'email' ? 'Email address' : `${label} link`, links[k], k === 'email' ? 'email' : 'url'),
        ),
      ),
    );
  });
}

/** Shrink a photo for the database: JPEG, longest side 1600px. */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  let w = bmp.width;
  let hgt = bmp.height;
  const scale = Math.min(1, 1600 / Math.max(w, hgt));
  w = Math.round(w * scale);
  hgt = Math.round(hgt * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  for (const q of [0.82, 0.7, 0.55]) {
    const src = canvas.toDataURL('image/jpeg', q);
    if (src.length <= 900_000) return src;
  }
  throw new Error('That photo is too large');
}

/** Organiser: add, caption and remove photos. */
export function photosSheet(secret) {
  let draw = null;
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const picker = h('input', {
      type: 'file',
      accept: 'image/*',
      multiple: true,
      hidden: true,
      'aria-label': 'Choose photos',
    });
    picker.addEventListener('change', async () => {
      const files = [...picker.files];
      picker.value = '';
      let n = 0;
      for (const f of files) {
        try {
          toast(`Uploading ${++n} of ${files.length}…`, { ms: 20000 });
          const src = await shrink(f);
          const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          await api.saveClub({ [`photos/${id}`]: { src, caption: '', at: Date.now() } }, secret);
          await load();
        } catch (e) {
          toast(e.message, { ms: 4000 });
          return;
        }
      }
      toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
    });
    draw = () =>
      fill(
        body,
        sheetNav({ title: 'Photos', right: { label: 'Done', bold: true, onClick: () => close() } }),
        picker,
        button([icon('plus'), 'Add Photos'], () => picker.click(), 'btn-filled btn-block btn-large'),
        group(
          {
            header: `Album · ${S.photos.length}`,
            footer:
              'The About page rotates through these. Tap one to add a caption; press and hold the bin to remove it.',
          },
          ...(S.photos.length
            ? S.photos.map((p, i) =>
                row({
                  lead: h('img', { class: 'thumb', src: p.src, alt: '' }),
                  title: p.caption || h('span', { class: 'row-sub' }, `Photo ${i + 1} · add a caption`),
                  onClick: async () => {
                    const caption = await promptText({
                      title: 'Caption',
                      value: p.caption,
                      maxLength: 80,
                      confirm: 'Save',
                    });
                    if (caption === null) return;
                    await api
                      .saveClub({ [`photos/${p.id}`]: { src: p.src, caption, at: p.at } }, secret)
                      .then(load)
                      .catch((e) => toast(e.message));
                  },
                  trailing: holdButton(
                    icon('trash'),
                    () =>
                      api
                        .saveClub({ [`photos/${p.id}`]: { deleted: true } }, secret)
                        .then(load)
                        .catch((e) => toast(e.message)),
                    {
                      cls: 'mini del',
                      hint: 'Press and hold to remove this photo',
                      attrs: { 'aria-label': `Remove photo ${i + 1}` },
                    },
                  ),
                }),
              )
            : [
                row({
                  title: h('span', { class: 'row-sub' }, 'No photos yet: the About page shows club cards instead.'),
                }),
              ]),
        ),
      );
    views.add(draw);
    draw();
    load().catch((e) => toast(e.message));
    return body;
  }).finally(() => views.delete(draw));
}
