// Direct elimination tableau: the create form (seeded from poules or a list of
// fencers) and the tableau page (bracket by round, results, final ranking).
// Lives in the Poules tab: pouleView hands over the page shell and sharing.

import {
  h,
  fill,
  button,
  iconButton,
  icon,
  holdButton,
  toast,
  confirmDialog,
  modal,
  sheetNav,
  group,
  row,
  tile,
  segmented,
  toggle,
} from './dom.js';
import { haptics } from './device.js';
import { state, savePoule, rosterAdd } from '../state.js';
import * as Tab from '../core/tableau.js';
import { progress as pouleProgress, formatVM, validateResult } from '../core/poule.js';
import { isTableau } from '../core/kinds.js';
import { WEAPON_LABEL } from '../core/bout.js';
import { exportCsv, exportImage, printPoule } from './exportPoule.js';

const today = () => new Date().toLocaleDateString('en-CA');
const prettyDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, opts);
};
const shortDate = (d) => prettyDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * ctx: { root, page, navbar, backButton, shareCta, shareFlow, menu, startBout }
 */
export function tableauView(ctx) {
  const { root } = ctx;
  const shownRound = new Map(); // tableau id -> round size picked by the user
  let draft = null;

  /* ---------- tableau page ---------- */

  function renderSheet(t) {
    const rounds = Tab.bracket(t);
    const pr = Tab.progress(t);
    const nb = Tab.nextBout(t);
    const name = (id) => Tab.fencerById(t, id)?.name ?? '?';
    const cur = state.bout;
    const liveId = cur.pouleRef?.pouleId === t.id && cur.status !== 'confirmed' ? cur.pouleRef.boutId : null;
    const live = liveId && Tab.boutOf(t, liveId);
    const ranking = Tab.finalRanking(t);

    // Show the round being fenced unless the user picked another.
    const current = live?.round ?? nb?.round ?? 2;
    let sel = shownRound.get(t.id) ?? current;
    if (!rounds.some((r) => r.size === sel)) sel = current;

    let nextCard;
    if (live && live.ready) {
      nextCard = h(
        'div',
        { class: 'next-card live' },
        h('div', { class: 'nc-label' }, `${live.roundName} · In progress`),
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
      const others = Tab.pendingBouts(t).filter((b) => b.id !== nb.id);
      nextCard = h(
        'div',
        { class: 'next-card' },
        h('div', { class: 'nc-label' }, `Up next · ${nb.roundName} · Bout ${nb.n}`),
        h(
          'div',
          { class: 'nc-match' },
          h('span', { class: 'l' }, name(nb.leftId)),
          h('span', { class: 'nc-v' }, 'vs'),
          h('span', { class: 'r' }, name(nb.rightId)),
        ),
        button([icon('play'), 'Next Bout'], () => ctx.startBout(t, nb), 'btn-filled btn-block btn-large'),
        others.length > 0 &&
          h(
            'div',
            { class: 'nc-deck' },
            `Also ready: ${others.length} bout${others.length === 1 ? '' : 's'} (fence them on other pistes)`,
          ),
      );
    } else {
      const podium = ranking.filter((r) => r.place != null && r.place <= 3);
      nextCard = h(
        'div',
        { class: 'next-card done' },
        h('div', { class: 'nc-label' }, 'Tableau complete'),
        h('div', { class: 'nc-winner' }, icon('trophy'), name(rounds.at(-1).bouts[0].winnerId)),
        h(
          'div',
          { class: 'podium' },
          ...podium.map((r) =>
            h('div', { class: `pod p${r.place}` }, h('b', {}, Tab.placeLabel(r)), h('span', {}, r.fencer.name)),
          ),
        ),
        h(
          'div',
          { class: 'row-buttons', style: { display: 'flex', gap: '8px' } },
          button([icon('photo'), 'Image'], () => exportImage(t), 'btn-tinted', { style: { flex: 1 } }),
          button([icon('doc'), 'CSV'], () => exportCsv(t), 'btn-tinted', { style: { flex: 1 } }),
        ),
      );
    }

    const round = rounds.find((r) => r.size === sel);
    const feeder = (r, i, side) => {
      const prev = rounds.find((x) => x.size === r.size * 2);
      const src = prev?.bouts[2 * i + (side === 'left' ? 0 : 1)];
      return src?.n ? `Winner of bout ${src.n}` : 'To be decided';
    };
    const line = (b, side, r) => {
      const id = b[`${side}Id`];
      const f = id && Tab.fencerById(t, id);
      const won = b.done && b.winnerId === id;
      return h(
        'span',
        { class: `de-line${won ? ' w' : b.done ? ' l' : ''}${f ? '' : ' tbd'}` },
        h('span', { class: 'de-seed' }, f ? f.seed : ''),
        h('span', { class: 'de-name' }, f ? f.name : feeder(r, b.i, side)),
        h('span', { class: 'de-score' }, b.done ? b[side === 'left' ? 'scoreL' : 'scoreR'] : b.bye && f ? 'bye' : ''),
      );
    };
    const boutCard = (b, r) => {
      const isLive = liveId === b.id;
      const tag = isLive
        ? h('span', { class: 'tag tag-live' }, 'Live')
        : nb?.id === b.id
          ? h('span', { class: 'tag tag-next' }, 'Up next')
          : b.ready
            ? h('span', { class: 'tag tag-gray' }, 'Ready')
            : null;
      const label = b.bye
        ? `${name(b.leftId ?? b.rightId)} has a bye`
        : `Bout ${b.n}: ${b.leftId ? name(b.leftId) : 'to be decided'} v ${b.rightId ? name(b.rightId) : 'to be decided'}${b.done ? `, ${b.scoreL}–${b.scoreR}` : ''}`;
      return h(
        'button',
        {
          type: 'button',
          class: `row tappable de-bout${b.bye ? ' bye' : ''}`,
          'aria-label': label,
          onClick: () => {
            if (b.bye) return toast(`${name(b.leftId ?? b.rightId)} goes straight through (bye)`);
            if (!b.leftId || !b.rightId) return toast('Waiting for the bouts before this one');
            resultDialog(t, b);
          },
        },
        h('span', { class: 'bout-n' }, b.n ?? ''),
        h('span', { class: 'de-lines' }, line(b, 'left', r), b.bye ? null : line(b, 'right', r)),
        tag,
      );
    };

    fill(
      root,
      ctx.page({
        nav: ctx.navbar({
          title: t.name,
          large: true,
          left: ctx.backButton('Poules', () => (location.hash = '#poules'), 'All poules'),
          right: [
            iconButton('share', () => ctx.shareFlow(t), t.share ? 'Show sharing code' : 'Share tableau'),
            iconButton('ellipsis', () => ctx.menu(t), 'Tableau actions'),
          ],
        }),
        body: [
          h('h1', { class: 'large-title' }, t.name),
          h(
            'div',
            { class: 'summary' },
            h(
              'div',
              { class: 'summary-line' },
              `${prettyDate(t.date)} · ${WEAPON_LABEL[t.weapon]} · ${t.fencers.length} fencers · bouts to ${t.target}`,
            ),
            h(
              'div',
              { class: `progress${t.status === 'finished' ? ' done' : ''}` },
              h('span', { style: { width: `${(pr.done / pr.total) * 100}%` } }),
            ),
          ),
          group({}, ctx.shareCta(t)),
          nextCard,
          h(
            'div',
            { class: 'round-tabs' },
            segmented(
              rounds.map((r) => [r.size, r.short]),
              sel,
              (v) => (shownRound.set(t.id, v), renderSheet(t)),
              'Round',
            ),
          ),
          group(
            {
              header: round.name,
              cls: 'de-round',
              footer:
                round.size === t.size && round.bouts.some((b) => b.bye)
                  ? 'Top seeds without an opponent go straight through (bye). Tap a bout to enter, edit or fence it.'
                  : `Tap a bout to enter, edit or fence it. Bouts are to ${t.target}.`,
            },
            ...round.bouts.map((b) => boutCard(b, round)),
          ),
          group(
            {
              header: t.status === 'finished' ? 'Final Ranking' : 'Ranking So Far',
              cls: 'standings',
              footer: 'Losing semi-finalists are 3rd equal. Fencers out in the same round are placed by seed.',
            },
            ...ranking.map((r) =>
              row({
                lead: h('span', { class: `rank-badge${r.place === 1 ? ' gold' : ''}` }, Tab.placeLabel(r)),
                title: r.fencer.name,
                subtitle: r.fencer.club || null,
                detail: r.place == null ? 'Still in' : r.out ? `Out in ${Tab.roundShort(r.out)}` : 'Winner',
              }),
            ),
          ),
          group(
            { header: 'Export' },
            row({ lead: tile('photo', 'indigo'), title: 'Share Image', chevron: true, onClick: () => exportImage(t) }),
            row({ lead: tile('doc', 'green'), title: 'Export CSV', chevron: true, onClick: () => exportCsv(t) }),
            row({ lead: tile('printer', 'gray'), title: 'Print', chevron: true, onClick: () => printPoule(t) }),
          ),
        ],
      }),
    );
  }

  /** Later results a change to this bout would clear. */
  function knockOn(before, after) {
    const had = new Set(before.bouts.filter((b) => b.winnerId).map((b) => b.id));
    return after.bouts.filter((b) => had.has(b.id) && !b.winnerId).length;
  }

  async function confirmKnockOn(t, next, boutId) {
    const n = knockOn(t, next) - (next.bouts.find((b) => b.id === boutId).winnerId ? 0 : 1);
    if (n <= 0) return true;
    return confirmDialog({
      title: 'Clear later results?',
      message: `This changes who goes through, so ${n} later result${n === 1 ? '' : 's'} will be cleared.`,
      confirm: 'Continue',
      danger: true,
    });
  }

  /** Enter or correct a bout by hand. Scores are kept in bracket order (upper fencer first). */
  function resultDialog(t, b) {
    const A = Tab.fencerById(t, b.leftId);
    const B = Tab.fencerById(t, b.rightId);
    let sa = b.done ? b.scoreL : 0;
    let sb = b.done ? b.scoreR : 0;
    let winner = b.done ? b.winnerId : null;
    let manualWinner = b.done && sa === sb;
    const target = t.target;

    return modal((close) => {
      const body = h('div', { class: 'sheet-body result-dialog' });
      const stepper = (f, get, set) =>
        h(
          'div',
          { class: 'stepper' },
          h('div', { class: 'st-name' }, f.name),
          h('span', { class: 'st-val' }, get()),
          h(
            'div',
            { class: 'st-row' },
            button(icon('minus'), () => (set(Math.max(0, get() - 1)), draw()), 'st-btn', {
              'aria-label': `${f.name} minus one`,
            }),
            button(icon('plus'), () => (set(Math.min(99, get() + 1)), draw()), 'st-btn', {
              'aria-label': `${f.name} plus one`,
            }),
          ),
          button(`Set ${target}`, () => (set(target), draw()), 'st-target', { 'aria-label': `${f.name} ${target}` }),
        );
      const save = async () => {
        const v = validateResult(b, { scoreL: sa, scoreR: sb, winnerId: winner });
        if (!v.ok) return toast(v.error);
        const latest = state.poules.get(t.id) ?? t;
        let next;
        try {
          next = Tab.recordResult(latest, b.id, { scoreL: sa, scoreR: sb, winnerId: winner, reason: 'manual' });
        } catch (e) {
          return toast(e.message);
        }
        if (!(await confirmKnockOn(latest, next, b.id))) return;
        savePoule(next);
        haptics.tap();
        close();
      };
      const clear = async () => {
        const latest = state.poules.get(t.id) ?? t;
        const next = Tab.clearResult(latest, b.id);
        if (!(await confirmKnockOn(latest, next, b.id))) return;
        savePoule(next);
        close();
        toast('Result cleared');
      };
      const draw = () => {
        if (!manualWinner) winner = sa === sb ? null : sa > sb ? A.id : B.id;
        const v = validateResult(b, { scoreL: sa, scoreR: sb, winnerId: winner });
        fill(
          body,
          sheetNav({
            title: `${b.roundName ?? Tab.roundName(b.round)} · Bout ${b.n}`,
            left: { label: 'Cancel', onClick: () => close() },
            right: { label: 'Save', bold: true, onClick: save, disabled: !v.ok },
          }),
          h(
            'div',
            { class: 'steppers' },
            stepper(
              A,
              () => sa,
              (x) => (sa = x),
            ),
            stepper(
              B,
              () => sb,
              (x) => (sb = x),
            ),
          ),
          group(
            { header: sa === sb ? 'Level score: who won on priority?' : 'Winner' },
            segmented(
              [
                [A.id, A.name],
                [B.id, B.name],
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
              onClick: () => (close(), ctx.startBout(t, b)),
            }),
            b.done &&
              holdButton([icon('trash'), h('span', { class: 'row-title' }, 'Hold to Clear Result')], clear, {
                cls: 'row tappable tone-danger',
                hint: 'Press and hold to clear this result',
              }),
          ),
        );
      };
      draw();
      return body;
    });
  }

  /* ---------- create ---------- */

  function poulesForSeeding() {
    return [...state.poules.values()]
      .filter((p) => !isTableau(p))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  function newDraft(fromId) {
    const poules = poulesForSeeding();
    const from = fromId && state.poules.get(fromId);
    // Default: the chosen poule, or every poule from the latest date.
    const latest = poules[0]?.date;
    const picked = from ? [from] : poules.filter((p) => p.date === latest);
    return {
      name: '',
      date: from?.date ?? today(),
      weapon: from?.weapon ?? picked[0]?.weapon ?? state.bout.weapon ?? 'foil',
      target: 15,
      source: poules.length ? 'poules' : 'list',
      pouleIds: new Set(picked.map((p) => p.id)),
      out: new Set(), // fencer ids left out of the tableau
      list: [],
    };
  }

  function renderCreate(fromId = null) {
    if (!draft || draft.fromId !== fromId) draft = { ...newDraft(fromId), fromId };
    const d = draft;
    const y = root.querySelector('.page-body')?.scrollTop ?? 0;
    const poules = poulesForSeeding();
    const chosen = poules.filter((p) => d.pouleIds.has(p.id));
    const seeding = d.source === 'poules' ? Tab.seedFromPoules(chosen) : [];
    const entrants =
      d.source === 'poules' ? seeding.filter((r) => !d.out.has(r.fencer.id)).map((r) => r.fencer) : d.list;
    const n = entrants.length;
    const valid = n >= Tab.MIN_FENCERS && n <= Tab.MAX_FENCERS;
    const size = valid ? Tab.tableSize(n) : 0;
    const byes = size - n;
    const unfinished = chosen.filter((p) => p.status !== 'finished');

    const nameIn = h('input', {
      class: 'input',
      value: d.name,
      placeholder: chosen.length === 1 ? `${chosen[0].name} · Elimination` : `Elimination ${shortDate(d.date)}`,
      maxlength: 60,
      'aria-label': 'Tableau name',
    });
    nameIn.addEventListener('input', () => (d.name = nameIn.value));
    const dateIn = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Date' });
    dateIn.addEventListener('change', () => (d.date = dateIn.value || today()));

    let sourceGroups;
    if (d.source === 'poules') {
      sourceGroups = [
        group(
          {
            header: 'Seed From',
            footer: unfinished.length
              ? `${unfinished.map((p) => p.name).join(', ')} ${unfinished.length === 1 ? 'isn’t' : 'aren’t'} finished: seeding uses the bouts fenced so far.`
              : 'Everyone is ranked together by V/M, then indicator, then touches scored.',
          },
          ...poules.map((p) => {
            const pr = pouleProgress(p);
            return row({
              lead: h('span', { class: 'tile tile-blue' }, WEAPON_LABEL[p.weapon][0]),
              title: p.name,
              subtitle: `${shortDate(p.date)} · ${p.fencers.length} fencers · ${pr.done}/${pr.total} bouts`,
              trailing: toggle(
                d.pouleIds.has(p.id),
                (on) => (on ? d.pouleIds.add(p.id) : d.pouleIds.delete(p.id), renderCreate(fromId)),
                `Seed from ${p.name}`,
              ),
            });
          }),
        ),
        seeding.length > 0 &&
          group(
            {
              header: `Seeding · ${n} of ${seeding.length} through`,
              footer: 'Switch someone off to leave them out (e.g. a withdrawal, or a cut after the poules).',
            },
            ...seeding.map((r) => {
              const inIt = !d.out.has(r.fencer.id);
              const seed = inIt ? entrants.indexOf(r.fencer) + 1 : null;
              return row({
                lead: h('span', { class: `num-badge${inIt ? '' : ' muted'}` }, seed ?? '–'),
                title: r.fencer.name,
                subtitle: `${r.poule} · ${r.V}/${r.M} · ${formatVM(r.VM)} · ${signed(r.Ind)}`,
                trailing: toggle(
                  inIt,
                  (on) => (on ? d.out.delete(r.fencer.id) : d.out.add(r.fencer.id), renderCreate(fromId)),
                  `Include ${r.fencer.name}`,
                ),
              });
            }),
          ),
      ];
    } else {
      const fName = h('input', {
        class: 'input',
        placeholder: 'Add fencer',
        maxlength: 40,
        enterkeyhint: 'done',
        'aria-label': 'New fencer name',
      });
      const add = () => {
        const nm = fName.value.trim();
        if (!nm) return fName.focus();
        const f = rosterAdd(nm, '');
        if (d.list.some((x) => x.id === f.id)) return toast(`${f.name} is already in`);
        d.list.push(f);
        renderCreate(fromId);
        root.querySelector('input[aria-label="New fencer name"]')?.focus();
      };
      fName.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));
      const inList = new Set(d.list.map((f) => f.id));
      const fromRoster = state.roster.filter((f) => !inList.has(f.id));
      sourceGroups = [
        group(
          {
            header: `Fencers · ${d.list.length}`,
            headerAction:
              d.list.length > 1 &&
              button(
                [icon('shuffle'), 'Shuffle'],
                () => {
                  for (let i = d.list.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [d.list[i], d.list[j]] = [d.list[j], d.list[i]];
                  }
                  renderCreate(fromId);
                },
                'btn-plain',
                { 'aria-label': 'Shuffle the seeding' },
              ),
            footer: 'The order is the seeding: number 1 meets the lowest seed. Shuffle to draw it at random.',
          },
          ...d.list.map((f, i) =>
            row({
              lead: h('span', { class: 'num-badge' }, i + 1),
              title: f.name,
              subtitle: f.club || null,
              trailing: [
                i > 0 &&
                  button(
                    icon('arrowUp'),
                    () => (d.list.splice(i - 1, 0, d.list.splice(i, 1)[0]), renderCreate(fromId)),
                    'mini',
                    { 'aria-label': `Move ${f.name} up` },
                  ),
                button(icon('minusCircle'), () => (d.list.splice(i, 1), renderCreate(fromId)), 'mini del', {
                  'aria-label': `Remove ${f.name}`,
                }),
              ],
            }),
          ),
          h('div', { class: 'add-fencer' }, fName, button('Add', add, 'btn-plain')),
        ),
        fromRoster.length > 0 &&
          group(
            { header: 'From Roster' },
            ...fromRoster.map((f) =>
              row({
                lead: h('span', { class: 'add-lead' }, icon('plusCircle')),
                title: f.name,
                subtitle: f.club || null,
                onClick: () => (d.list.push(f), renderCreate(fromId)),
                attrs: { 'aria-label': `Add ${f.name}` },
              }),
            ),
          ),
      ];
    }

    fill(
      root,
      ctx.page({
        nav: ctx.navbar({
          title: 'New Tableau',
          left: button('Cancel', () => (location.hash = fromId ? `#poule/${fromId}` : '#poules'), 'nav-text'),
        }),
        body: [
          h(
            'p',
            { class: 'intro' },
            'A direct elimination: one bout each, the winner goes through. Seeds 1 and 2 can only meet in the final.',
          ),
          group({}, row({ title: nameIn, cls: 'row-inline' }), row({ title: 'Date', trailing: dateIn })),
          group(
            { header: 'Weapon' },
            segmented(
              ['foil', 'epee', 'sabre'].map((w) => [w, WEAPON_LABEL[w]]),
              d.weapon,
              (w) => ((d.weapon = w), renderCreate(fromId)),
              'Weapon',
            ),
          ),
          group(
            { header: 'Bouts To', footer: '15 touches in three periods of 3 minutes, or 10 for younger fencers.' },
            segmented(
              [
                [15, '15'],
                [10, '10'],
                [5, '5'],
              ],
              d.target,
              (v) => ((d.target = v), renderCreate(fromId)),
              'Bouts to',
            ),
          ),
          group(
            {
              header: 'Fencers',
              footer: valid
                ? `${n} fencers: a table of ${size}${byes ? `, with ${byes} bye${byes === 1 ? '' : 's'} for the top seeds` : ''}.`
                : null,
            },
            segmented(
              [
                ['poules', 'From Poules'],
                ['list', 'Enter Fencers'],
              ],
              d.source,
              (v) => ((d.source = v), renderCreate(fromId)),
              'Fencers from',
            ),
          ),
          ...(d.source === 'poules' && !poules.length
            ? [h('p', { class: 'intro' }, 'No poules yet. Enter the fencers instead, in seed order.')]
            : sourceGroups),
        ],
        foot: h(
          'footer',
          { class: 'page-foot' },
          button(
            valid ? `Create Tableau · ${n} Fencers` : 'Add at least two fencers',
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
      const t = Tab.createTableau({
        name: d.name.trim() || nameIn.placeholder,
        date: d.date,
        weapon: d.weapon,
        target: d.target,
        fencers: entrants,
        source: d.source === 'poules' ? { pouleIds: chosen.map((p) => p.id) } : null,
      });
      savePoule(t);
      draft = null;
      haptics.tap();
      location.replace(`#poule/${t.id}`);
    }
  }

  return { renderSheet, renderCreate, resetDraft: () => (draft = null) };
}
