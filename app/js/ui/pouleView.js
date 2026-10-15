// Poules: history list, create form, and the poule sheet.

import {
  h,
  fill,
  button,
  iconButton,
  icon,
  holdButton,
  toast,
  clearToast,
  confirmDialog,
  actionSheet,
  modal,
  promptText,
  sheetNav,
  group,
  row,
  tile,
  segmented,
} from './dom.js';
import { haptics } from './device.js';
import {
  state,
  subscribe,
  savePoule,
  deletePoule,
  makePoule,
  rosterAdd,
  rosterRemove,
  rosterUpdate,
  startPouleBout,
  boutInProgress,
} from '../state.js';
import {
  MIN_FENCERS,
  MAX_FENCERS,
  nextBout,
  progress,
  fencerById,
  findBout,
  cellText,
  stats,
  ranking,
  rankLabel,
  formatVM,
  recordResult,
  clearResult,
  duplicatePoule,
  isDone,
  validateResult,
} from '../core/poule.js';
import { WEAPON_LABEL } from '../core/bout.js';
import { openSettings } from './settings.js';
import { exportCsv, exportImage, printPoule } from './exportPoule.js';
import { sharingEnabled, sharePoule, joinByCode, syncStatus } from '../sync.js';
import { formatCode } from '../core/share.js';

const WEAPON_TILE = { foil: 'blue', epee: 'purple', sabre: 'orange' };
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const prettyDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, opts);
};
const shortDate = (d) => prettyDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Open the scorer on a poule's next (or a given) bout. */
export async function startNextBout(poule, pb = nextBout(poule)) {
  if (!pb) return toast('All bouts fenced');
  const cur = state.bout;
  const same = cur.pouleRef?.boutId === pb.id && cur.status !== 'confirmed';
  if (!same && boutInProgress()) {
    const ok = await confirmDialog({
      title: 'Replace the bout in progress?',
      message: `${cur.left.name} ${cur.left.score}–${cur.right.score} ${cur.right.name} will be discarded.`,
      confirm: 'Replace',
      danger: true,
    });
    if (!ok) return;
  }
  if (!same) startPouleBout(poule, pb);
  location.hash = '#bout';
}

/** Join a shared poule: ask for the code (unless given), then open it. */
export async function joinFlow(code = null) {
  if (!sharingEnabled()) {
    return confirmDialog({
      title: 'Sharing Isn’t Set Up',
      message: 'This copy of Piste has no sharing server yet (see the README, “Shared poules”).',
      confirm: 'OK',
      cancel: 'Close',
    });
  }
  const input =
    code ??
    (await promptText({
      title: 'Join a Poule',
      message: 'Enter the 6-character code from the organiser.',
      placeholder: 'K7Q-M4X',
      confirm: 'Join',
      maxLength: 200,
      attrs: { autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Share code' },
    }));
  if (!input) return;
  try {
    const p = await joinByCode(input);
    toast(`Joined “${p.name}”`);
    location.replace(`#poule/${encodeURIComponent(p.id)}`);
  } catch (e) {
    toast(e.message, { ms: 4000 });
  }
}

/** Navigation bar. `large` shows a large title in the content that collapses into the bar on scroll. */
function navbar({ title, left, right = [], large = false }) {
  return h(
    'header',
    { class: `navbar${large ? ' large' : ''}` },
    h('div', { class: 'nav-l' }, left),
    h('div', { class: 'nav-title' }, title),
    h('div', { class: 'nav-r' }, ...right),
  );
}

function backButton(label, onClick, aria) {
  return button([icon('chevronLeft'), label], onClick, 'nav-back', { 'aria-label': aria ?? label });
}

/** Page shell: nav bar + scrolling body (+ optional footer), with the bar turning translucent on scroll. */
function page({ nav, body, foot }) {
  const pb = h('div', { class: 'page-body' }, ...body);
  pb.addEventListener('scroll', () => nav.classList.toggle('scrolled', pb.scrollTop > 8), { passive: true });
  return h('section', { class: 'page' }, nav, pb, foot);
}

export function mountPoulesView(root) {
  let route = { view: 'list' };
  let query = '';
  let draft = null;

  function render() {
    if (route.view === 'sheet') {
      const p = state.poules.get(route.id);
      if (!p) {
        location.hash = '#poules';
        return;
      }
      renderSheet(p);
    } else if (route.view === 'new') renderCreate();
    else renderList();
  }

  /* ---------- list ---------- */

  function renderList() {
    const input = h('input', {
      type: 'search',
      placeholder: 'Search',
      value: query,
      'aria-label': 'Search poules',
      enterkeyhint: 'search',
    });
    const list = h('div', { class: 'poule-list' });
    const showMatches = () => {
      const q = query.trim().toLowerCase();
      const items = [...state.poules.values()]
        .filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q) ||
            p.date.includes(q) ||
            prettyDate(p.date).toLowerCase().includes(q),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      const active = items.filter((p) => p.status !== 'finished');
      const done = items.filter((p) => p.status === 'finished');
      if (!state.poules.size) {
        fill(
          list,
          h(
            'div',
            { class: 'empty' },
            icon('grid'),
            h('h2', {}, 'No Poules'),
            h('p', {}, 'Create a poule to generate the bout order and keep the sheet as you fence.'),
            button([icon('plus'), 'New Poule'], () => (location.hash = '#poules/new'), 'btn-filled btn-large'),
            button([icon('link'), 'Join with a Code'], () => joinFlow(), 'btn-tinted btn-large'),
          ),
        );
        return;
      }
      fill(
        list,
        !items.length && h('div', { class: 'empty' }, h('p', {}, `No results for “${query}”`)),
        active.length > 0 && group({ header: 'In Progress' }, ...active.map(pouleRow)),
        done.length > 0 && group({ header: 'Finished' }, ...done.map(pouleRow)),
      );
    };
    input.addEventListener('input', () => {
      query = input.value;
      showMatches();
    });
    showMatches();
    fill(
      root,
      page({
        nav: navbar({
          title: 'Poules',
          large: true,
          right: [
            button('Join', () => joinFlow(), 'nav-text', { 'aria-label': 'Join a shared poule with a code' }),
            iconButton('plus', () => (location.hash = '#poules/new'), 'New poule'),
            iconButton('ellipsis', pouleMenu, 'Menu'),
          ],
        }),
        body: [
          h('h1', { class: 'large-title' }, 'Poules'),
          state.poules.size > 0 && h('label', { class: 'searchbar' }, icon('search'), input),
          list,
        ],
      }),
    );
  }

  function pouleRow(p) {
    const pr = progress(p);
    const finished = p.status === 'finished';
    const status = finished
      ? h('span', { class: 'status-done', 'aria-label': 'Finished' }, icon('checkCircle'))
      : h('span', { class: 'ring', style: { '--p': pr.done / pr.total }, 'aria-hidden': 'true' });
    return h(
      'div',
      { class: 'poule-row' },
      row({
        lead: h('span', { class: `tile tile-${WEAPON_TILE[p.weapon]}` }, WEAPON_LABEL[p.weapon][0]),
        title: p.name,
        subtitle: [
          p.share && icon('link', 'inline-icon'),
          `${shortDate(p.date)} · ${finished ? `${p.fencers.length} fencers` : `${pr.done} of ${pr.total} bouts`}`,
        ],
        trailing: status,
        chevron: true,
        onClick: () => (location.hash = `#poule/${p.id}`),
        cls: 'poule-open',
      }),
      iconButton('ellipsis', () => pouleActions(p), `Actions for ${p.name}`),
    );
  }

  async function pouleActions(p) {
    const choice = await actionSheet({
      title: p.name,
      subtitle: `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]}`,
      actions: [
        { id: 'open', label: p.status === 'finished' ? 'Open Sheet' : 'Resume', icon: 'chevronRight' },
        { id: 'rename', label: 'Rename', icon: 'pencil' },
        { id: 'dup', label: 'Duplicate', icon: 'copy' },
        { id: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
      ],
    });
    if (choice === 'open') location.hash = `#poule/${p.id}`;
    else if (choice) await pouleAction(p, choice);
  }

  async function pouleMenu() {
    const choice = await actionSheet({
      actions: [
        { id: 'roster', label: `Roster (${state.roster.length})`, icon: 'people' },
        { id: 'settings', label: 'Settings', icon: 'gear' },
      ],
    });
    if (choice === 'roster') rosterSheet();
    else if (choice === 'settings') openSettings();
  }

  function rosterSheet() {
    return modal((close) => {
      const body = h('div', { class: 'sheet-body' });
      const draw = () =>
        fill(
          body,
          sheetNav({ title: 'Roster', right: { label: 'Done', bold: true, onClick: () => close() } }),
          group(
            {
              footer:
                'Fencers are saved here when you add them to a poule, so you can reuse them with one tap. Removing someone doesn’t change existing poules.',
            },
            ...(state.roster.length
              ? state.roster.map((f) =>
                  row({
                    title: f.name,
                    subtitle: f.club || null,
                    onClick: async () => {
                      const name = await promptText({ title: 'Fencer Name', value: f.name });
                      if (!name) return;
                      const club = await promptText({ title: 'Club', message: 'Optional', value: f.club ?? '' });
                      rosterUpdate({ ...f, name, club: club ?? '' });
                      draw();
                    },
                    trailing: button(
                      icon('minusCircle'),
                      async (e) => {
                        e.stopPropagation();
                        if (await confirmDialog({ title: `Remove ${f.name}?`, confirm: 'Remove', danger: true })) {
                          rosterRemove(f.id);
                          draw();
                        }
                      },
                      'mini del',
                      { 'aria-label': `Remove ${f.name} from the roster` },
                    ),
                  }),
                )
              : [row({ title: h('span', { class: 'row-sub' }, 'No saved fencers yet') })]),
          ),
        );
      draw();
      return body;
    });
  }

  /* ---------- create ---------- */

  function renderCreate() {
    if (!draft) draft = { name: '', date: today(), weapon: state.bout.weapon ?? 'foil', fencers: [] };
    const d = draft;
    const nameIn = h('input', {
      class: 'input',
      value: d.name,
      placeholder: `Poule ${shortDate(d.date)}`,
      maxlength: 60,
      'aria-label': 'Poule name',
    });
    nameIn.addEventListener('input', () => (d.name = nameIn.value));
    const dateIn = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Date' });
    dateIn.addEventListener('change', () => (d.date = dateIn.value || today()));

    const full = d.fencers.length >= MAX_FENCERS;
    const fName = h('input', {
      class: 'input',
      placeholder: full ? 'Poule is full' : 'Add fencer',
      maxlength: 40,
      enterkeyhint: 'next',
      'aria-label': 'New fencer name',
      disabled: full,
    });
    const fClub = h('input', {
      class: 'input',
      placeholder: 'Club',
      maxlength: 40,
      enterkeyhint: 'done',
      'aria-label': 'Club',
      disabled: full,
    });
    const add = () => {
      const name = fName.value.trim();
      if (!name) return fName.focus();
      if (d.fencers.length >= MAX_FENCERS) return toast(`A poule has at most ${MAX_FENCERS} fencers`);
      const f = rosterAdd(name, fClub.value);
      if (d.fencers.some((x) => x.id === f.id)) return toast(`${f.name} is already in`);
      d.fencers.push(f);
      renderCreate();
      root.querySelector('input[aria-label="New fencer name"]')?.focus();
    };
    fName.addEventListener(
      'keydown',
      (e) => e.key === 'Enter' && (e.preventDefault(), fClub.value ? add() : fClub.focus()),
    );
    fClub.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));

    const chosen = new Set(d.fencers.map((f) => f.id));
    const fromRoster = state.roster.filter((f) => !chosen.has(f.id));
    const count = d.fencers.length;
    const valid = count >= MIN_FENCERS && count <= MAX_FENCERS;
    const bouts = (count * (count - 1)) / 2;
    const y = root.querySelector('.page-body')?.scrollTop ?? 0;

    fill(
      root,
      page({
        nav: navbar({
          title: 'New Poule',
          left: button('Cancel', () => (location.hash = '#poules'), 'nav-text'),
        }),
        body: [
          group({}, row({ title: nameIn, cls: 'row-inline' }), row({ title: 'Date', trailing: dateIn })),
          group(
            { header: 'Weapon' },
            segmented(
              ['foil', 'epee', 'sabre'].map((w) => [w, WEAPON_LABEL[w]]),
              d.weapon,
              (w) => ((d.weapon = w), renderCreate()),
              'Weapon',
            ),
          ),
          group(
            {
              header: `Fencers · ${count} of ${MAX_FENCERS}`,
              headerAction:
                count > 1 &&
                button([icon('shuffle'), 'Shuffle'], () => (shuffle(d.fencers), renderCreate()), 'btn-plain', {
                  'aria-label': 'Shuffle the order of fencers',
                }),
              footer: 'Positions set the bout order. Shuffle to draw them at random.',
            },
            ...d.fencers.map((f, i) =>
              row({
                lead: h('span', { class: 'num-badge' }, i + 1),
                title: f.name,
                subtitle: f.club || null,
                trailing: [
                  i > 0 &&
                    button(
                      icon('arrowUp'),
                      () => (d.fencers.splice(i - 1, 0, d.fencers.splice(i, 1)[0]), renderCreate()),
                      'mini',
                      { 'aria-label': `Move ${f.name} up` },
                    ),
                  button(icon('minusCircle'), () => (d.fencers.splice(i, 1), renderCreate()), 'mini del', {
                    'aria-label': `Remove ${f.name}`,
                  }),
                ],
              }),
            ),
            h('div', { class: 'add-fencer' }, fName, fClub, button('Add', add, 'btn-plain', { disabled: full })),
          ),
          fromRoster.length > 0 &&
            group(
              { header: 'From Roster' },
              ...fromRoster.map((f) =>
                row({
                  lead: h('span', { class: 'add-lead' }, icon('plusCircle')),
                  title: f.name,
                  subtitle: f.club || null,
                  onClick: () => {
                    if (d.fencers.length >= MAX_FENCERS) return toast(`A poule has at most ${MAX_FENCERS} fencers`);
                    d.fencers.push(f);
                    renderCreate();
                  },
                  attrs: { 'aria-label': `Add ${f.name}`, disabled: full },
                }),
              ),
            ),
        ],
        foot: h(
          'footer',
          { class: 'page-foot' },
          button(
            valid
              ? `Create Poule · ${bouts} Bouts`
              : `Add ${MIN_FENCERS - count} More Fencer${MIN_FENCERS - count === 1 ? '' : 's'}`,
            create,
            'btn-filled btn-block btn-large',
            { disabled: !valid },
          ),
        ),
      }),
    );
    const pb = root.querySelector('.page-body');
    if (pb) {
      pb.scrollTop = y;
      pb.dispatchEvent(new Event('scroll'));
    }

    function create() {
      const p = makePoule({
        name: d.name.trim() || `Poule ${shortDate(d.date)}`,
        date: d.date,
        weapon: d.weapon,
        fencers: d.fencers,
      });
      draft = null;
      haptics.tap();
      location.hash = `#poule/${p.id}`;
    }
  }

  /* ---------- sheet ---------- */

  function renderSheet(p) {
    const pr = progress(p);
    const nb = nextBout(p);
    const name = (id) => fencerById(p, id)?.name ?? '?';
    const cur = state.bout;
    const live =
      cur.pouleRef?.pouleId === p.id && cur.status !== 'confirmed'
        ? p.bouts.find((b) => b.id === cur.pouleRef.boutId)
        : null;
    const afterNext = nb && p.bouts.find((b) => !isDone(b) && b.id !== nb.id);

    let nextCard;
    if (live && !isDone(live)) {
      nextCard = h(
        'div',
        { class: 'next-card live' },
        h('div', { class: 'nc-label' }, `Bout ${live.n} of ${pr.total} · In progress`),
        h(
          'div',
          { class: 'nc-match' },
          h('span', { class: 'l' }, cur.left.name),
          h('span', { class: 'nc-score' }, `${cur.left.score}–${cur.right.score}`),
          h('span', { class: 'r' }, cur.right.name),
        ),
        button([icon('play'), 'Resume Bout'], () => (location.hash = '#bout'), 'btn-filled btn-block btn-large'),
      );
    } else if (nb) {
      nextCard = h(
        'div',
        { class: 'next-card' },
        h('div', { class: 'nc-label' }, `Up next · Bout ${nb.n} of ${pr.total}`),
        h(
          'div',
          { class: 'nc-match' },
          h('span', { class: 'l' }, name(nb.leftId)),
          h('span', { class: 'nc-v' }, 'vs'),
          h('span', { class: 'r' }, name(nb.rightId)),
        ),
        button([icon('play'), 'Next Bout'], () => startNextBout(p, nb), 'btn-filled btn-block btn-large'),
        afterNext && h('div', { class: 'nc-deck' }, `On deck: ${name(afterNext.leftId)} vs ${name(afterNext.rightId)}`),
      );
    } else {
      const top = ranking(p).filter((r) => r.rank === 1);
      nextCard = h(
        'div',
        { class: 'next-card done' },
        h('div', { class: 'nc-label' }, 'Poule complete'),
        h('div', { class: 'nc-winner' }, icon('trophy'), top.map((r) => r.fencer.name).join(' & ')),
        h(
          'div',
          { class: 'row-buttons', style: { display: 'flex', gap: '8px' } },
          button([icon('photo'), 'Image'], () => exportImage(p), 'btn-tinted', { style: { flex: 1 } }),
          button([icon('doc'), 'CSV'], () => exportCsv(p), 'btn-tinted', { style: { flex: 1 } }),
        ),
      );
    }

    fill(
      root,
      page({
        nav: navbar({
          title: p.name,
          large: true,
          left: backButton('Poules', () => (location.hash = '#poules'), 'All poules'),
          right: [iconButton('ellipsis', () => sheetMenu(p), 'Poule actions')],
        }),
        body: [
          h('h1', { class: 'large-title' }, p.name),
          h(
            'div',
            { class: 'summary' },
            h(
              'div',
              { class: 'summary-line' },
              `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]} · ${pr.done} of ${pr.total} bouts`,
            ),
            h(
              'div',
              { class: `progress${p.status === 'finished' ? ' done' : ''}` },
              h('span', { style: { width: `${(pr.done / pr.total) * 100}%` } }),
            ),
          ),
          p.share && group({}, shareRow(p)),
          nextCard,
          group(
            {
              header: 'Sheet',
              footer: `Tap a cell to enter or edit a result.${p.fencers.length > 4 ? ' Swipe sideways for V, Ind and rank.' : ''}`,
            },
            sheetTable(p, nb, live),
          ),
          standings(p),
          boutList(p, nb, live),
          group(
            { header: 'Export' },
            row({ lead: tile('photo', 'indigo'), title: 'Share Image', chevron: true, onClick: () => exportImage(p) }),
            row({ lead: tile('doc', 'green'), title: 'Export CSV', chevron: true, onClick: () => exportCsv(p) }),
            row({ lead: tile('printer', 'gray'), title: 'Print', chevron: true, onClick: () => printPoule(p) }),
          ),
        ],
      }),
    );
  }

  function sheetTable(p, nb, live) {
    const st = stats(p);
    const ranks = new Map(ranking(p).map((r) => [r.id, rankLabel(r)]));
    const hl = live ?? nb;
    return h(
      'div',
      { class: 'sheet-scroll' },
      h(
        'table',
        { class: 'sheet' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { class: 'name-col' }, 'Fencer'),
            ...p.fencers.map((_, i) => h('th', { class: 'num-col' }, i + 1)),
            ...['V', 'V/M', 'TS', 'TR', 'Ind', 'Rk'].map((t) => h('th', { class: 'res' }, t)),
          ),
        ),
        h(
          'tbody',
          {},
          ...p.fencers.map((f, r) => {
            const s = st.get(f.id);
            return h(
              'tr',
              {},
              h(
                'th',
                { class: 'name-col', scope: 'row' },
                h('span', { class: 'num-badge' }, r + 1),
                h('span', { class: 'nm' }, f.name),
              ),
              ...p.fencers.map((o) => {
                if (o.id === f.id) return h('td', { class: 'diag', 'aria-hidden': 'true' });
                const t = cellText(p, f.id, o.id);
                const b = findBout(p, f.id, o.id);
                const isNext = hl && b.id === hl.id;
                return h(
                  'td',
                  {},
                  button(
                    t || (isNext ? '•' : ''),
                    () => resultDialog(p, b, f.id),
                    `cell ${t.startsWith('V') ? 'v' : t ? 'd' : ''} ${isNext ? 'next' : ''}`,
                    { 'aria-label': `${f.name} v ${o.name}: ${t || 'not fenced'}` },
                  ),
                );
              }),
              h('td', { class: 'res' }, s.V),
              h('td', { class: 'res' }, formatVM(s.VM)),
              h('td', { class: 'res' }, s.TS),
              h('td', { class: 'res' }, s.TR),
              h('td', { class: 'res' }, signed(s.Ind)),
              h('td', { class: 'res rank' }, s.M ? ranks.get(f.id) : '–'),
            );
          }),
        ),
      ),
    );
  }

  function standings(p) {
    return group(
      { header: 'Standings', cls: 'standings', footer: 'Ranked by V/M, then indicator, then touches scored.' },
      ...ranking(p).map((r) =>
        row({
          lead: h('span', { class: `rank-badge${r.M && r.rank === 1 ? ' gold' : ''}` }, r.M ? rankLabel(r) : '–'),
          title: r.fencer.name,
          subtitle: r.fencer.club || null,
          detail: `${r.V}/${r.M} · ${signed(r.Ind)}`,
        }),
      ),
    );
  }

  function boutList(p, nb, live) {
    const name = (id) => fencerById(p, id)?.name ?? '?';
    return group(
      { header: 'Bouts', cls: 'bout-list' },
      ...p.bouts.map((b) => {
        const done = isDone(b);
        const wl = (id) => (done ? (b.winnerId === id ? 'w' : 'l') : '');
        const isLive = live?.id === b.id;
        return row({
          lead: h('span', { class: 'bout-n' }, b.n),
          title: h(
            'span',
            { class: 'bout-names' },
            h('span', { class: wl(b.leftId) }, name(b.leftId)),
            h('span', { class: 'l' }, ' vs '),
            h('span', { class: wl(b.rightId) }, name(b.rightId)),
          ),
          trailing: done
            ? h('span', { class: 'score-detail' }, `${b.scoreL}–${b.scoreR}`)
            : isLive
              ? h('span', { class: 'tag tag-live' }, 'Live')
              : nb?.id === b.id
                ? h('span', { class: 'tag tag-next' }, 'Up next')
                : null,
          onClick: () => resultDialog(p, b, b.leftId),
          cls: 'bout-row',
        });
      }),
    );
  }

  /** Manual result entry, from the row fencer's point of view. */
  function resultDialog(p, b, rowId) {
    const aId = rowId;
    const bId = b.leftId === rowId ? b.rightId : b.leftId;
    const A = fencerById(p, aId);
    const B = fencerById(p, bId);
    const done = isDone(b);
    let sa = done ? (b.leftId === aId ? b.scoreL : b.scoreR) : 0;
    let sb = done ? (b.leftId === aId ? b.scoreR : b.scoreL) : 0;
    let winner = done ? b.winnerId : null;
    let manualWinner = done && sa === sb;
    const target = p.target ?? 5;

    return modal((close) => {
      const body = h('div', { class: 'sheet-body result-dialog' });
      const stepper = (label, get, set) =>
        h(
          'div',
          { class: 'stepper' },
          h('div', { class: 'st-name' }, label),
          h('span', { class: 'st-val' }, get()),
          h(
            'div',
            { class: 'st-row' },
            button(icon('minus'), () => (set(Math.max(0, get() - 1)), draw()), 'st-btn', {
              'aria-label': `${label} minus one`,
            }),
            button(icon('plus'), () => (set(Math.min(99, get() + 1)), draw()), 'st-btn', {
              'aria-label': `${label} plus one`,
            }),
          ),
          button(`Set ${target}`, () => (set(target), draw()), 'st-target', { 'aria-label': `${label} ${target}` }),
        );
      const save = () => {
        const v = validateResult({ leftId: aId, rightId: bId }, { scoreL: sa, scoreR: sb, winnerId: winner });
        if (!v.ok) return toast(v.error);
        savePoule(
          recordResult(p, b.id, {
            leftId: aId,
            rightId: bId,
            scoreL: sa,
            scoreR: sb,
            winnerId: winner,
            reason: 'manual',
          }),
        );
        haptics.tap();
        close();
      };
      const draw = () => {
        if (!manualWinner) winner = sa === sb ? null : sa > sb ? aId : bId;
        const v = validateResult({ leftId: aId, rightId: bId }, { scoreL: sa, scoreR: sb, winnerId: winner });
        fill(
          body,
          sheetNav({
            title: `Bout ${b.n}`,
            left: { label: 'Cancel', onClick: () => close() },
            right: { label: 'Save', bold: true, onClick: save, disabled: !v.ok },
          }),
          h(
            'div',
            { class: 'steppers' },
            stepper(
              A.name,
              () => sa,
              (x) => (sa = x),
            ),
            stepper(
              B.name,
              () => sb,
              (x) => (sb = x),
            ),
          ),
          group(
            { header: sa === sb ? 'Level score: who won on priority?' : 'Winner' },
            segmented(
              [
                [aId, A.name],
                [bId, B.name],
              ],
              winner,
              (id) => ((winner = id), (manualWinner = true), draw()),
              'Winner',
            ),
          ),
          group(
            {},
            row({
              lead: icon('play'),
              title: 'Fence This Bout',
              tone: 'accent',
              onClick: () => (close(), startNextBout(p, b)),
            }),
            done &&
              holdButton(
                [icon('trash'), h('span', { class: 'row-title' }, 'Hold to Clear Result')],
                () => (savePoule(clearResult(p, b.id)), close(), toast('Result cleared')),
                { cls: 'row tappable tone-danger', hint: 'Press and hold to clear this result' },
              ),
          ),
        );
      };
      draw();
      return body;
    });
  }

  async function sheetMenu(p) {
    const choice = await actionSheet({
      title: p.name,
      actions: [
        p.share
          ? { id: 'share', label: `Sharing Code ${formatCode(p.share.code)}`, icon: 'link' }
          : { id: 'share', label: 'Share with a Code…', icon: 'link' },
        { id: 'img', label: 'Share Image', icon: 'photo' },
        { id: 'csv', label: 'Export CSV', icon: 'doc' },
        { id: 'print', label: 'Print', icon: 'printer' },
        { id: 'rename', label: 'Rename', icon: 'pencil' },
        { id: 'dup', label: 'Duplicate', icon: 'copy' },
        { id: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
      ],
    });
    if (choice === 'share') shareFlow(p);
    else if (choice === 'csv') exportCsv(p);
    else if (choice === 'img') exportImage(p);
    else if (choice === 'print') printPoule(p);
    else if (choice) await pouleAction(p, choice);
  }

  /** Rename / duplicate / delete, shared by the list and the sheet menus. */
  async function pouleAction(p, id) {
    if (id === 'rename') {
      const name = await promptText({ title: 'Rename Poule', value: p.name, maxLength: 60 });
      if (name) savePoule({ ...p, name, updatedAt: Date.now() });
    } else if (id === 'dup') {
      const d = duplicatePoule(p);
      savePoule(d);
      toast('Poule duplicated');
      location.hash = `#poule/${d.id}`;
    } else if (id === 'delete') {
      const pr = progress(p);
      const ok = await confirmDialog({
        title: `Delete “${p.name}”?`,
        message: p.share
          ? `This removes it from this phone only. Everyone else with code ${formatCode(p.share.code)} keeps it.`
          : `${pr.done} of ${pr.total} bouts recorded. This can’t be undone.`,
        confirm: 'Delete',
        danger: true,
      });
      if (ok) {
        deletePoule(p.id);
        toast('Poule deleted');
        if (route.view !== 'list') location.hash = '#poules';
      }
    }
  }

  subscribe((evt) => {
    if (document.body.dataset.tab !== 'poules') return;
    if (evt.type === 'poules' || evt.type === 'roster' || evt.type === 'bout' || evt.type === 'sync') {
      // Don't rebuild the create form under the user's fingers.
      if (route.view === 'new') return;
      const y = root.querySelector('.page-body')?.scrollTop ?? 0;
      const x = root.querySelector('.sheet-scroll')?.scrollLeft ?? 0;
      render();
      const pb = root.querySelector('.page-body');
      if (pb) {
        pb.scrollTop = y;
        pb.dispatchEvent(new Event('scroll'));
      }
      const ss = root.querySelector('.sheet-scroll');
      if (ss) ss.scrollLeft = x;
    }
  });

  /* ---------- sharing ---------- */

  function shareRow(p) {
    const { status, pending } = syncStatus(p);
    const label = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' }[status];
    return row({
      lead: tile('link', 'blue'),
      title: `Shared · ${formatCode(p.share.code)}`,
      subtitle: h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '7px' } },
        h('span', { class: `dot ${status}` }),
        `${label}${pending ? ` · ${pending} to send` : ''}`,
      ),
      chevron: true,
      onClick: () => showCode(p),
      cls: 'share-bar',
      attrs: { 'aria-label': `Shared poule, code ${formatCode(p.share.code)}, ${label}` },
    });
  }

  async function shareFlow(p) {
    if (p.share) return showCode(p);
    if (!sharingEnabled()) return notConfigured();
    const ok = await confirmDialog({
      title: 'Share This Poule?',
      message:
        'You’ll get a code. Anyone with it can see the sheet and enter or edit results from their own phone, live.',
      confirm: 'Create Code',
    });
    if (!ok) return;
    try {
      toast('Creating code…');
      await sharePoule(p);
      clearToast();
      haptics.tap();
      showCode(state.poules.get(p.id));
    } catch (e) {
      toast(e.message);
    }
  }

  function shareLink(code) {
    return new URL(`#join/${code}`, location.href.split('#')[0]).href;
  }

  function showCode(p) {
    const code = p.share.code;
    const link = shareLink(code);
    return modal((close) =>
      h(
        'div',
        { class: 'sheet-body share-dialog' },
        sheetNav({
          title: p.share.role === 'owner' ? 'Share Poule' : 'Shared Poule',
          right: { label: 'Done', bold: true, onClick: () => close() },
        }),
        h(
          'div',
          { class: 'share-hero' },
          tile('link', 'blue'),
          h('p', {}, 'Anyone with this code can enter and edit results. In Piste: Poules → Join.'),
        ),
        h('div', { class: 'share-code', 'aria-label': `Code ${code.split('').join(' ')}` }, formatCode(code)),
        h(
          'div',
          { style: { display: 'flex', gap: '10px' } },
          button(
            [icon('copy'), 'Copy Code'],
            async () => {
              try {
                await navigator.clipboard.writeText(formatCode(code));
                toast('Code copied');
              } catch {
                toast(formatCode(code));
              }
            },
            'btn-tinted btn-large',
            { style: { flex: 1 } },
          ),
          button(
            [icon('share'), 'Send Link'],
            async () => {
              const text = `Join “${p.name}” in Piste: code ${formatCode(code)}`;
              try {
                if (navigator.share) await navigator.share({ title: p.name, text, url: link });
                else {
                  await navigator.clipboard.writeText(`${text}\n${link}`);
                  toast('Link copied');
                }
              } catch (e) {
                if (e?.name !== 'AbortError') toast(link, { ms: 8000 });
              }
            },
            'btn-filled btn-large',
            { style: { flex: 1 } },
          ),
        ),
      ),
    );
  }

  function notConfigured() {
    return confirmDialog({
      title: 'Sharing Isn’t Set Up',
      message:
        'This copy of Piste has no sharing server yet. Whoever deployed it needs to add a Firebase database URL (see the README, “Shared poules”).',
      confirm: 'OK',
      cancel: 'Close',
    });
  }

  return {
    show(r) {
      if (r.view === 'new' && route.view !== 'new') draft = null;
      route = r;
      render();
      root.querySelector('.page-body')?.scrollTo?.(0, 0);
    },
  };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
