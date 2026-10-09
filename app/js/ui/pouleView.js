// Poules: history list, create form, and the poule sheet.

import {
  h,
  fill,
  button,
  holdButton,
  toast,
  clearToast,
  confirmDialog,
  actionSheet,
  modal,
  promptText,
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

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const prettyDate = (d) => {
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

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
      title: 'Sharing isn’t set up',
      message: 'This copy of Piste has no sharing server yet (see the README, “Shared poules”).',
      confirm: 'OK',
      cancel: 'Close',
    });
  }
  const input =
    code ??
    (await promptText({
      title: 'Join a shared poule',
      message: 'Type the 6-character code from the organiser.',
      placeholder: 'e.g. K7Q-M4X',
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
    const search = h('input', {
      class: 'input search',
      type: 'search',
      placeholder: 'Search by name or date',
      value: query,
      'aria-label': 'Search poules',
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
      fill(
        list,
        ...(items.length
          ? items.map(pouleCard)
          : [
              h(
                'div',
                { class: 'empty' },
                state.poules.size
                  ? 'No poules match.'
                  : h(
                      'div',
                      {},
                      h('p', {}, 'No poules yet.'),
                      h('p', { class: 'muted' }, 'Create one to generate the bout order and keep the sheet.'),
                    ),
              ),
            ]),
      );
    };
    search.addEventListener('input', () => {
      query = search.value;
      showMatches();
    });
    showMatches();
    fill(
      root,
      h(
        'section',
        { class: 'page' },
        h(
          'header',
          { class: 'topbar' },
          h('h1', {}, 'Poules'),
          button('Join', () => joinFlow(), 'btn-ghost', { 'aria-label': 'Join a shared poule with a code' }),
          button('＋ New', () => (location.hash = '#poules/new'), 'btn-primary'),
          button('⋯', pouleMenu, 'icon-btn', { 'aria-label': 'Menu' }),
        ),
        h('div', { class: 'page-body' }, search, list),
      ),
    );
  }

  function pouleCard(p) {
    const pr = progress(p);
    const nb = nextBout(p);
    return h(
      'div',
      { class: 'poule-card' },
      button(
        h(
          'div',
          { class: 'pc-main' },
          h('div', { class: 'pc-name' }, p.name),
          h(
            'div',
            { class: 'pc-meta' },
            `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]} · ${p.fencers.length} fencers`,
            p.share && h('span', { class: 'pc-share' }, ` · 🔗 ${formatCode(p.share.code)}`),
          ),
          h(
            'div',
            { class: 'pc-progress' },
            h('span', { class: 'bar' }, h('span', { style: { width: `${(pr.done / pr.total) * 100}%` } })),
            h(
              'span',
              { class: `pill ${p.status}` },
              p.status === 'finished' ? 'Finished' : `${pr.done}/${pr.total}${nb ? ' · resume' : ''}`,
            ),
          ),
        ),
        () => (location.hash = `#poule/${p.id}`),
        'pc-open',
      ),
      button('⋯', () => pouleActions(p), 'icon-btn', { 'aria-label': `Actions for ${p.name}` }),
    );
  }

  async function pouleActions(p) {
    const choice = await actionSheet({
      title: p.name,
      subtitle: `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]}`,
      actions: [
        { id: 'open', label: p.status === 'finished' ? 'Open sheet' : 'Resume', cls: 'btn-primary' },
        { id: 'rename', label: 'Rename' },
        { id: 'dup', label: 'Duplicate (same fencers, new results)' },
        { id: 'delete', label: 'Delete…', cls: 'btn-danger-ghost' },
      ],
    });
    if (choice === 'open') location.hash = `#poule/${p.id}`;
    else if (choice) await pouleAction(p, choice);
  }

  async function pouleMenu() {
    const choice = await actionSheet({
      title: 'Poules',
      actions: [
        { id: 'roster', label: `Manage roster (${state.roster.length})` },
        { id: 'settings', label: 'Settings & backup' },
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
          h('h2', {}, 'Roster'),
          h(
            'p',
            { class: 'muted small' },
            'Fencers saved here can be added to new poules with one tap. Removing someone does not change existing poules.',
          ),
          h(
            'div',
            { class: 'roster-list' },
            ...(state.roster.length
              ? state.roster.map((f) =>
                  h(
                    'div',
                    { class: 'roster-row' },
                    button(
                      h('span', {}, h('b', {}, f.name), f.club && h('small', { class: 'muted' }, ` ${f.club}`)),
                      async () => {
                        const name = await promptText({ title: 'Fencer name', value: f.name });
                        if (!name) return;
                        const club = await promptText({
                          title: `Club for ${name} (optional)`,
                          value: f.club ?? '',
                          confirm: 'Save',
                        });
                        rosterUpdate({ ...f, name, club: club ?? '' });
                        draw();
                      },
                      'grow left',
                    ),
                    button(
                      'Remove',
                      async () => {
                        if (
                          await confirmDialog({
                            title: `Remove ${f.name} from the roster?`,
                            confirm: 'Remove',
                            danger: true,
                          })
                        ) {
                          rosterRemove(f.id);
                          draw();
                        }
                      },
                      'btn-ghost',
                    ),
                  ),
                )
              : [
                  h(
                    'p',
                    { class: 'muted' },
                    'No saved fencers yet. They are added automatically when you create a poule.',
                  ),
                ]),
          ),
          button('Done', () => close(), 'btn-primary btn-block'),
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
      placeholder: `Poule ${prettyDate(d.date)}`,
      maxlength: 60,
      'aria-label': 'Poule name',
    });
    nameIn.addEventListener('input', () => (d.name = nameIn.value));
    const dateIn = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Date' });
    dateIn.addEventListener('change', () => (d.date = dateIn.value || today()));
    const weapon = h(
      'div',
      { class: 'segmented' },
      ...['foil', 'epee', 'sabre'].map((w) =>
        button(WEAPON_LABEL[w], () => ((d.weapon = w), renderCreate()), d.weapon === w ? 'on' : '', {
          'aria-pressed': String(d.weapon === w),
        }),
      ),
    );

    const full = d.fencers.length >= MAX_FENCERS;
    const fName = h('input', {
      class: 'input',
      placeholder: 'Name',
      maxlength: 40,
      enterkeyhint: 'next',
      'aria-label': 'New fencer name',
      disabled: full,
    });
    const fClub = h('input', {
      class: 'input',
      placeholder: 'Club (optional)',
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
    const rosterChips = state.roster.filter((f) => !chosen.has(f.id));
    const count = d.fencers.length;
    const valid = count >= MIN_FENCERS && count <= MAX_FENCERS;

    fill(
      root,
      h(
        'section',
        { class: 'page' },
        h(
          'header',
          { class: 'topbar' },
          button('‹ Back', () => (location.hash = '#poules'), 'btn-ghost'),
          h('h1', {}, 'New poule'),
        ),
        h(
          'div',
          { class: 'page-body' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameIn),
          h(
            'div',
            { class: 'row gap' },
            h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, 'Date'), dateIn),
          ),
          h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Weapon'), weapon),
          h(
            'div',
            { class: 'field' },
            h(
              'div',
              { class: 'field-label row between' },
              h('span', {}, `Fencers (${count}/${MAX_FENCERS})`),
              count > 1 &&
                button('Shuffle', () => (shuffle(d.fencers), renderCreate()), 'btn-ghost', {
                  'aria-label': 'Shuffle the order of fencers',
                }),
            ),
            h(
              'ol',
              { class: 'fencer-list' },
              ...d.fencers.map((f, i) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'pos' }, i + 1),
                  h(
                    'span',
                    { class: 'grow' },
                    h('b', {}, f.name),
                    f.club && h('small', { class: 'muted' }, ` ${f.club}`),
                  ),
                  i > 0 &&
                    button(
                      '↑',
                      () => (d.fencers.splice(i - 1, 0, d.fencers.splice(i, 1)[0]), renderCreate()),
                      'icon-btn',
                      { 'aria-label': `Move ${f.name} up` },
                    ),
                  button('✕', () => (d.fencers.splice(i, 1), renderCreate()), 'icon-btn', {
                    'aria-label': `Remove ${f.name}`,
                  }),
                ),
              ),
            ),
            h('div', { class: 'add-fencer' }, fName, fClub, button('Add', add, 'btn-primary', { disabled: full })),
          ),
          rosterChips.length > 0 &&
            h(
              'div',
              { class: 'field' },
              h('div', { class: 'field-label' }, 'From roster (tap to add)'),
              h(
                'div',
                { class: 'chips' },
                ...rosterChips.map((f) =>
                  button(
                    h('span', {}, f.name, f.club && h('small', {}, ` ${f.club}`)),
                    () => {
                      if (d.fencers.length >= MAX_FENCERS) return toast(`A poule has at most ${MAX_FENCERS} fencers`);
                      d.fencers.push(f);
                      renderCreate();
                    },
                    'chip',
                    { disabled: full },
                  ),
                ),
              ),
            ),
        ),
        h(
          'footer',
          { class: 'page-foot' },
          button(
            valid
              ? `Create poule · ${(count * (count - 1)) / 2} bouts`
              : `Add ${Math.max(0, MIN_FENCERS - count)} more fencer${MIN_FENCERS - count === 1 ? '' : 's'}`,
            create,
            'btn-primary btn-block',
            { disabled: !valid },
          ),
        ),
      ),
    );

    function create() {
      const p = makePoule({
        name: d.name.trim() || `Poule ${prettyDate(d.date)}`,
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
        h('div', { class: 'nc-label' }, `Bout ${live.n} of ${pr.total} · in progress`),
        h(
          'div',
          { class: 'nc-match' },
          h('span', { class: 'l' }, cur.left.name),
          h('span', { class: 'nc-score' }, `${cur.left.score}–${cur.right.score}`),
          h('span', { class: 'r' }, cur.right.name),
        ),
        button('Resume bout ▶', () => (location.hash = '#bout'), 'btn-primary btn-block btn-big'),
      );
    } else if (nb) {
      nextCard = h(
        'div',
        { class: 'next-card' },
        h('div', { class: 'nc-label' }, `Next: bout ${nb.n} of ${pr.total}`),
        h(
          'div',
          { class: 'nc-match' },
          h('span', { class: 'l' }, name(nb.leftId)),
          h('span', { class: 'nc-v' }, 'v'),
          h('span', { class: 'r' }, name(nb.rightId)),
        ),
        button('Next bout ▶', () => startNextBout(p, nb), 'btn-primary btn-block btn-big'),
        afterNext &&
          h('div', { class: 'nc-deck muted' }, `On deck: ${name(afterNext.leftId)} v ${name(afterNext.rightId)}`),
      );
    } else {
      const top = ranking(p).filter((r) => r.rank === 1);
      nextCard = h(
        'div',
        { class: 'next-card done' },
        h('div', { class: 'nc-label' }, 'Poule complete'),
        h('div', { class: 'nc-match' }, `🏆 ${top.map((r) => r.fencer.name).join(' & ')}`),
        h(
          'div',
          { class: 'row gap' },
          button('CSV', () => exportCsv(p), 'grow'),
          button('Image', () => exportImage(p), 'grow'),
          button('Print', () => printPoule(p), 'grow'),
        ),
      );
    }

    fill(
      root,
      h(
        'section',
        { class: 'page' },
        h(
          'header',
          { class: 'topbar' },
          button('‹', () => (location.hash = '#poules'), 'icon-btn', { 'aria-label': 'All poules' }),
          h('h1', { class: 'truncate' }, p.name),
          button('⋯', () => sheetMenu(p), 'icon-btn', { 'aria-label': 'Poule actions' }),
        ),
        h(
          'div',
          { class: 'page-body' },
          h(
            'div',
            { class: 'meta muted' },
            `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]} · ${pr.done}/${pr.total} bouts`,
          ),
          p.share && shareBar(p),
          nextCard,
          h('h2', { class: 'section' }, 'Sheet', h('small', { class: 'muted' }, ' · tap a cell to enter or edit')),
          sheetTable(p, nb, live),
          h('h2', { class: 'section' }, 'Standings'),
          standings(p),
          h('h2', { class: 'section' }, 'Bout order'),
          boutList(p, nb, live),
          h('h2', { class: 'section' }, 'Export'),
          h(
            'div',
            { class: 'row gap' },
            button('CSV', () => exportCsv(p), 'grow'),
            button('Image', () => exportImage(p), 'grow'),
            button('Print', () => printPoule(p), 'grow'),
          ),
        ),
      ),
    );
  }

  function sheetTable(p, nb, live) {
    const st = stats(p);
    const ranks = new Map(ranking(p).map((r) => [r.id, rankLabel(r)]));
    const n = p.fencers.length;
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
                h('span', { class: 'pos' }, r + 1),
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
              h('td', { class: 'res' }, s.Ind > 0 ? `+${s.Ind}` : s.Ind),
              h('td', { class: 'res rank' }, s.M ? ranks.get(f.id) : '–'),
            );
          }),
        ),
      ),
      n > 4 && h('div', { class: 'scroll-hint muted small' }, 'Swipe the sheet sideways for results →'),
    );
  }

  function standings(p) {
    const rows = ranking(p);
    return h(
      'table',
      { class: 'standings' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Rk'),
          h('th', { class: 'l' }, 'Fencer'),
          h('th', {}, 'V/M'),
          h('th', {}, 'Ind'),
          h('th', {}, 'TS'),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h('td', { class: 'rank' }, r.M ? rankLabel(r) : '–'),
            h(
              'td',
              { class: 'l' },
              r.fencer.name,
              r.fencer.club && h('small', { class: 'muted' }, ` ${r.fencer.club}`),
            ),
            h('td', {}, `${r.V}/${r.M}`),
            h('td', {}, r.Ind > 0 ? `+${r.Ind}` : r.Ind),
            h('td', {}, r.TS),
          ),
        ),
      ),
    );
  }

  function boutList(p, nb, live) {
    const name = (id) => fencerById(p, id)?.name ?? '?';
    return h(
      'ol',
      { class: 'bout-list' },
      ...p.bouts.map((b) => {
        const done = isDone(b);
        const isLive = live?.id === b.id;
        const cls = done ? 'done' : isLive ? 'live' : nb?.id === b.id ? 'next' : '';
        const wl = (id) => (done ? (b.winnerId === id ? 'w' : 'l') : '');
        return h(
          'li',
          { class: cls },
          button(
            h(
              'span',
              { class: 'bl' },
              h('span', { class: 'bn' }, b.n),
              h('span', { class: `bf ${wl(b.leftId)}` }, name(b.leftId)),
              h('span', { class: 'bs' }, done ? `${b.scoreL}–${b.scoreR}` : isLive ? 'live' : 'v'),
              h('span', { class: `bf r ${wl(b.rightId)}` }, name(b.rightId)),
            ),
            () => resultDialog(p, b, b.leftId),
            'bout-row',
          ),
        );
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
          h(
            'div',
            { class: 'st-row' },
            button('−', () => (set(Math.max(0, get() - 1)), draw()), 'st-btn', { 'aria-label': `${label} minus one` }),
            h('span', { class: 'st-val' }, get()),
            button('+', () => (set(Math.min(99, get() + 1)), draw()), 'st-btn', { 'aria-label': `${label} plus one` }),
          ),
          button(`= ${target}`, () => (set(target), draw()), 'btn-ghost', { 'aria-label': `${label} ${target}` }),
        );
      const draw = () => {
        if (!manualWinner) winner = sa === sb ? null : sa > sb ? aId : bId;
        const v = validateResult({ leftId: aId, rightId: bId }, { scoreL: sa, scoreR: sb, winnerId: winner });
        fill(
          body,
          h('h2', {}, `Bout ${b.n}: ${A.name} v ${B.name}`),
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
          h(
            'div',
            { class: 'field' },
            h('div', { class: 'field-label' }, sa === sb ? 'Level score: who won on priority?' : 'Winner'),
            h(
              'div',
              { class: 'segmented' },
              ...[
                [aId, A.name],
                [bId, B.name],
              ].map(([id, n]) =>
                button(n, () => ((winner = id), (manualWinner = true), draw()), winner === id ? 'on' : '', {
                  'aria-pressed': String(winner === id),
                }),
              ),
            ),
          ),
          h(
            'div',
            { class: 'row gap' },
            button('Cancel', () => close(), 'btn-ghost grow'),
            button(
              'Save',
              () => {
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
              },
              'btn-primary grow',
              { disabled: !v.ok },
            ),
          ),
          h(
            'div',
            { class: 'row gap' },
            button('Fence this bout ▶', () => (close(), startNextBout(p, b)), 'grow'),
            done &&
              holdButton('Clear', () => (savePoule(clearResult(p, b.id)), close(), toast('Result cleared')), {
                cls: 'btn-danger-ghost',
                hint: 'Press and hold to clear this result',
              }),
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
          ? { id: 'share', label: `Sharing code: ${formatCode(p.share.code)}`, cls: 'btn-primary' }
          : { id: 'share', label: 'Share with a code…', cls: 'btn-primary' },
        { id: 'csv', label: 'Export CSV' },
        { id: 'img', label: 'Share as image' },
        { id: 'print', label: 'Print / save as PDF' },
        { id: 'rename', label: 'Rename' },
        { id: 'dup', label: 'Duplicate' },
        { id: 'delete', label: 'Delete…', cls: 'btn-danger-ghost' },
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
      const name = await promptText({ title: 'Rename poule', value: p.name, maxLength: 60 });
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
          ? `Removes it from this phone only. Everyone else with code ${formatCode(p.share.code)} keeps it.`
          : `${pr.done} of ${pr.total} bouts recorded. This can’t be undone (unless you have a backup).`,
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
      if (pb) pb.scrollTop = y;
      const ss = root.querySelector('.sheet-scroll');
      if (ss) ss.scrollLeft = x;
    }
  });

  /* ---------- sharing ---------- */

  function shareBar(p) {
    const { status, pending } = syncStatus(p);
    const label = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' }[status];
    return button(
      h(
        'span',
        { class: 'share-bar-inner' },
        h('span', { class: `dot ${status}` }),
        h('b', {}, `🔗 ${formatCode(p.share.code)}`),
        h('span', { class: 'muted' }, ` · ${label}${pending ? ` · ${pending} to send` : ''}`),
      ),
      () => showCode(p),
      'share-bar',
      { 'aria-label': `Shared poule, code ${formatCode(p.share.code)}, ${label}` },
    );
  }

  async function shareFlow(p) {
    if (p.share) return showCode(p);
    if (!sharingEnabled()) return notConfigured();
    const ok = await confirmDialog({
      title: 'Share this poule?',
      message:
        'You get a code. Anyone with the code can see the sheet and enter or edit results from their own phone, and changes appear live on every phone. The poule is stored on the sharing server.',
      confirm: 'Create code',
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
    return modal(
      (close) =>
        h(
          'div',
          { class: 'dialog share-dialog' },
          h('h2', {}, p.share.role === 'owner' ? 'Share this poule' : 'Shared poule'),
          h('p', { class: 'muted' }, 'Anyone with this code can enter and edit results. In Piste: Poules → Join.'),
          h('div', { class: 'share-code', 'aria-label': `Code ${code.split('').join(' ')}` }, formatCode(code)),
          h(
            'div',
            { class: 'row gap' },
            button(
              'Copy code',
              async () => {
                try {
                  await navigator.clipboard.writeText(formatCode(code));
                  toast('Code copied');
                } catch {
                  toast(formatCode(code));
                }
              },
              'grow',
            ),
            button(
              'Send link',
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
              'btn-primary grow',
            ),
          ),
          button('Done', () => close(), 'btn-ghost btn-block'),
        ),
      { kind: 'center' },
    );
  }

  function notConfigured() {
    return confirmDialog({
      title: 'Sharing isn’t set up',
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
