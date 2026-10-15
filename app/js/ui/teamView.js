// Team matches: list, create form and the match sheet.

import {
  h,
  fill,
  button,
  iconButton,
  icon,
  holdButton,
  toast,
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
import { state, subscribe, saveMatch, deleteMatch, startTeamLeg, boutInProgress } from '../state.js';
import * as Team from '../core/team.js';
import { WEAPON_LABEL } from '../core/bout.js';
import { openSettings } from './settings.js';
import { exportTeamCsv, exportTeamImage, printTeam } from './exportPoule.js';

const WEAPON_TILE = { foil: 'blue', epee: 'purple', sabre: 'orange' };
const today = () => new Date().toLocaleDateString('en-CA');
const prettyDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, opts);
};
const shortDate = (d) => prettyDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Open the scorer on a match's next (or a given) leg. */
export async function startNextLeg(m, leg = Team.nextLeg(m)) {
  if (!leg) return toast('Match complete');
  const cur = state.bout;
  const same = cur.teamRef?.matchId === m.id && cur.teamRef.leg === leg.n && cur.status !== 'confirmed';
  if (!same && boutInProgress()) {
    const ok = await confirmDialog({
      title: 'Replace the bout in progress?',
      message: `${cur.left.name} ${cur.left.score}–${cur.right.score} ${cur.right.name} will be discarded.`,
      confirm: 'Replace',
      danger: true,
    });
    if (!ok) return;
  }
  if (!same) startTeamLeg(m, leg);
  location.hash = '#bout';
}

function navbar({ title, left, right = [], large = false }) {
  return h(
    'header',
    { class: `navbar${large ? ' large' : ''}` },
    h('div', { class: 'nav-l' }, left),
    h('div', { class: 'nav-title' }, title),
    h('div', { class: 'nav-r' }, ...right),
  );
}

function page({ nav, body, foot }) {
  const pb = h('div', { class: 'page-body' }, ...body);
  pb.addEventListener('scroll', () => nav.classList.toggle('scrolled', pb.scrollTop > 8), { passive: true });
  return h('section', { class: 'page' }, nav, pb, foot);
}

export function mountTeamsView(root) {
  let route = { view: 'list' };
  let draft = null;

  function render() {
    if (route.view === 'match') {
      const m = state.matches.get(route.id);
      if (!m) {
        location.hash = '#teams';
        return;
      }
      renderMatch(m);
    } else if (route.view === 'new') renderCreate();
    else renderList();
  }

  /* ---------- list ---------- */

  function matchRow(m) {
    const { a, b } = Team.score(m);
    const done = m.legs.filter(Team.legDone).length;
    const finished = m.status === 'finished';
    return h(
      'div',
      { class: 'poule-row' },
      row({
        lead: h('span', { class: `tile tile-${WEAPON_TILE[m.weapon]}` }, WEAPON_LABEL[m.weapon][0]),
        title: m.name,
        subtitle: finished
          ? `${shortDate(m.date)} · ${m.teams[m.winner].name} won`
          : `${shortDate(m.date)} · ${done ? `Leg ${done} of ${Team.LEGS}` : 'Not started'}`,
        detail: h('span', { class: 'score-detail' }, `${a}–${b}`),
        chevron: true,
        onClick: () => (location.hash = `#team/${m.id}`),
        cls: 'match-open',
      }),
      iconButton('ellipsis', () => matchActions(m), `Actions for ${m.name}`),
    );
  }

  function renderList() {
    const all = [...state.matches.values()].sort((x, y) => y.date.localeCompare(x.date) || y.createdAt - x.createdAt);
    const active = all.filter((m) => m.status !== 'finished');
    const done = all.filter((m) => m.status === 'finished');
    fill(
      root,
      page({
        nav: navbar({
          title: 'Teams',
          large: true,
          right: [
            iconButton('plus', () => (location.hash = '#teams/new'), 'New team match'),
            iconButton('ellipsis', openSettings, 'Menu'),
          ],
        }),
        body: [
          h('h1', { class: 'large-title' }, 'Teams'),
          !all.length &&
            h(
              'div',
              { class: 'empty' },
              icon('people'),
              h('h2', {}, 'No Team Matches'),
              h(
                'p',
                {},
                'Relay matches of three against three: nine legs to 45, with the score carried from leg to leg.',
              ),
              button([icon('plus'), 'New Team Match'], () => (location.hash = '#teams/new'), 'btn-filled btn-large'),
            ),
          active.length > 0 && group({ header: 'In Progress' }, ...active.map(matchRow)),
          done.length > 0 && group({ header: 'Finished' }, ...done.map(matchRow)),
        ],
      }),
    );
  }

  async function matchActions(m) {
    const choice = await actionSheet({
      title: m.name,
      subtitle: `${prettyDate(m.date)} · ${WEAPON_LABEL[m.weapon]}`,
      actions: [
        { id: 'open', label: 'Open', icon: 'chevronRight' },
        { id: 'rename', label: 'Rename', icon: 'pencil' },
        { id: 'rematch', label: 'Rematch', icon: 'copy' },
        { id: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
      ],
    });
    if (choice === 'open') location.hash = `#team/${m.id}`;
    else if (choice) await matchAction(m, choice);
  }

  async function matchAction(m, id) {
    if (id === 'rename') {
      const name = await promptText({ title: 'Rename Match', value: m.name, maxLength: 60 });
      if (name) saveMatch({ ...m, name, updatedAt: Date.now() });
    } else if (id === 'rematch') {
      const r = Team.rematch(m);
      saveMatch(r);
      toast('Rematch created');
      location.hash = `#team/${r.id}`;
    } else if (id === 'delete') {
      const done = m.legs.filter(Team.legDone).length;
      const ok = await confirmDialog({
        title: `Delete “${m.name}”?`,
        message: `${done} of ${Team.LEGS} legs recorded. This can’t be undone.`,
        confirm: 'Delete',
        danger: true,
      });
      if (ok) {
        deleteMatch(m.id);
        toast('Match deleted');
        if (route.view !== 'list') location.hash = '#teams';
      }
    } else if (id === 'sub') substituteFlow(m);
  }

  /* ---------- create ---------- */

  function renderCreate() {
    if (!draft)
      draft = {
        name: '',
        date: today(),
        weapon: state.bout.weapon ?? 'foil',
        A: { name: '', fencers: ['', '', ''], reserve: '' },
        B: { name: '', fencers: ['', '', ''], reserve: '' },
      };
    const d = draft;
    const y = root.querySelector('.page-body')?.scrollTop ?? 0;
    const roster = h('datalist', { id: 'roster-names' }, ...state.roster.map((f) => h('option', { value: f.name })));
    const input = (value, placeholder, onInput, aria) => {
      const el = h('input', {
        class: 'input',
        value,
        placeholder,
        maxlength: 40,
        list: 'roster-names',
        autocomplete: 'off',
        'aria-label': aria,
      });
      el.addEventListener('input', () => {
        onInput(el.value);
        updateCreate();
      });
      return el;
    };
    const teamGroup = (k, color) => {
      const t = d[k];
      const base = k === 'A' ? 0 : 3;
      return group(
        { header: `Team ${k === 'A' ? 1 : 2} · ${color}` },
        row({
          lead: h('span', { class: `team-dot ${k === 'A' ? 'red' : 'green'}` }),
          title: input(
            t.name,
            k === 'A' ? 'Team name, e.g. Ealing' : 'Team name, e.g. Salle Paul',
            (v) => (t.name = v),
            `Team ${k} name`,
          ),
          cls: 'row-inline',
        }),
        ...t.fencers.map((f, i) =>
          row({
            lead: h('span', { class: 'num-badge' }, base + i + 1),
            title: input(f, `Fencer ${base + i + 1}`, (v) => (t.fencers[i] = v), `Team ${k} fencer ${i + 1}`),
            cls: 'row-inline',
          }),
        ),
        row({
          lead: h('span', { class: 'num-badge muted' }, 'R'),
          title: input(t.reserve, 'Reserve (optional)', (v) => (t.reserve = v), `Team ${k} reserve`),
          cls: 'row-inline',
        }),
      );
    };
    const nameIn = h('input', {
      class: 'input',
      value: d.name,
      placeholder: 'Match name (optional)',
      maxlength: 60,
      'aria-label': 'Match name',
    });
    nameIn.addEventListener('input', () => (d.name = nameIn.value));
    const dateIn = h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'Date' });
    dateIn.addEventListener('change', () => (d.date = dateIn.value || today()));
    const createBtn = button('Create Match', create, 'btn-filled btn-block btn-large', { disabled: true });

    fill(
      root,
      roster,
      page({
        nav: navbar({ title: 'New Team Match', left: button('Cancel', () => (location.hash = '#teams'), 'nav-text') }),
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
          teamGroup('A', 'Red'),
          teamGroup('B', 'Green'),
          h(
            'p',
            { class: 'group-footer', style: { marginTop: '-18px', marginBottom: '24px' } },
            'Positions set the FIE relay order: 3–6, 1–5, 2–4, 1–6, 3–4, 2–5, 1–4, 2–6, 3–5. Each leg is fenced to the next multiple of 5, up to 45.',
          ),
        ],
        foot: h('footer', { class: 'page-foot' }, createBtn),
      }),
    );
    const pb = root.querySelector('.page-body');
    if (pb) pb.scrollTop = y;
    updateCreate();

    function valid() {
      return ['A', 'B'].every((k) => d[k].fencers.every((f) => f.trim()));
    }
    function updateCreate() {
      createBtn.disabled = !valid();
      createBtn.textContent = valid() ? 'Create Match · 9 Legs to 45' : 'Enter three fencers per team';
    }
    function create() {
      if (!valid()) return;
      const m = Team.createTeamMatch({
        name: d.name,
        date: d.date,
        weapon: d.weapon,
        teamA: d.A,
        teamB: d.B,
      });
      saveMatch(m);
      draft = null;
      haptics.tap();
      location.hash = `#team/${m.id}`;
    }
  }

  /* ---------- match sheet ---------- */

  function renderMatch(m) {
    const { a, b } = Team.score(m);
    const A = m.teams.A;
    const B = m.teams.B;
    const name = (id) => Team.fencerById(m, id)?.name ?? '?';
    const cur = state.bout;
    const liveLeg =
      cur.teamRef?.matchId === m.id && cur.status !== 'confirmed' ? m.legs.find((l) => l.n === cur.teamRef.leg) : null;
    const nl = Team.nextLeg(m);
    const done = m.legs.filter(Team.legDone).length;

    let action;
    if (liveLeg && !Team.legDone(liveLeg)) {
      action = [
        h('div', { class: 'nc-label live' }, `Leg ${liveLeg.n} in progress · ${cur.left.score}–${cur.right.score}`),
        button([icon('play'), 'Resume Leg'], () => (location.hash = '#bout'), 'btn-filled btn-block btn-large'),
      ];
    } else if (nl) {
      action = [
        h(
          'div',
          { class: 'nc-deck' },
          h('b', {}, `Leg ${nl.n} of ${Team.LEGS}`),
          ` · to ${nl.target} · `,
          h('span', { class: 'red-text' }, name(nl.aId)),
          ' vs ',
          h('span', { class: 'green-text' }, name(nl.bId)),
        ),
        button([icon('play'), 'Next Leg'], () => startNextLeg(m, nl), 'btn-filled btn-block btn-large'),
      ];
    } else {
      action = [
        h(
          'div',
          { class: 'nc-winner' },
          icon('trophy'),
          `${m.teams[m.winner].name} win${m.decided?.reason === 'priority' ? ' on priority' : ''}`,
        ),
      ];
    }

    fill(
      root,
      page({
        nav: navbar({
          title: m.name,
          large: true,
          left: button([icon('chevronLeft'), 'Teams'], () => (location.hash = '#teams'), 'nav-back', {
            'aria-label': 'All team matches',
          }),
          right: [
            iconButton('share', () => exportTeamImage(m), 'Share results'),
            iconButton('ellipsis', () => matchMenu(m), 'Match actions'),
          ],
        }),
        body: [
          h('h1', { class: 'large-title' }, m.name),
          h(
            'div',
            { class: 'summary' },
            h(
              'div',
              { class: 'summary-line' },
              `${prettyDate(m.date)} · ${WEAPON_LABEL[m.weapon]} · ${done} of ${Team.LEGS} legs`,
            ),
          ),
          h(
            'div',
            { class: 'next-card scoreboard' },
            h(
              'div',
              { class: 'sb' },
              h(
                'div',
                { class: 'sb-team red' },
                h('span', { class: 'sb-name' }, A.name),
                h('span', { class: 'sb-score' }, a),
              ),
              h(
                'div',
                { class: 'sb-team green' },
                h('span', { class: 'sb-name' }, B.name),
                h('span', { class: 'sb-score' }, b),
              ),
            ),
            h('div', { class: 'progress' }, h('span', { style: { width: `${(done / Team.LEGS) * 100}%` } })),
            ...action,
          ),
          group(
            { header: 'Legs', cls: 'leg-list', footer: 'Tap a leg to enter, edit or fence it.' },
            ...m.legs.map((l) => {
              const isDone = Team.legDone(l);
              const s = Team.legStart(m, l.n);
              const isLive = liveLeg?.n === l.n;
              return row({
                lead: h('span', { class: 'bout-n' }, l.n),
                title: h(
                  'span',
                  { class: 'bout-names' },
                  h('span', { class: isDone && l.touchesA > l.touchesB ? 'w' : '' }, name(l.aId)),
                  h('span', { class: 'l' }, ' vs '),
                  h('span', { class: isDone && l.touchesB > l.touchesA ? 'w' : '' }, name(l.bId)),
                ),
                subtitle: isDone ? `${l.touchesA}–${l.touchesB} in this leg · to ${l.target}` : `To ${l.target}`,
                trailing: isDone
                  ? h('span', { class: 'score-detail' }, `${s.a + l.touchesA}–${s.b + l.touchesB}`)
                  : isLive
                    ? h('span', { class: 'tag tag-live' }, 'Live')
                    : nl?.n === l.n
                      ? h('span', { class: 'tag tag-next' }, 'Up next')
                      : null,
                onClick: () => legDialog(m, l),
                cls: 'leg-row',
              });
            }),
          ),
          ...['A', 'B'].map((k) =>
            group(
              { header: m.teams[k].name },
              ...Team.fencerStats(m)
                .filter((s) => s.team === k)
                .map((s) =>
                  row({
                    lead: h('span', { class: `team-dot ${k === 'A' ? 'red' : 'green'}` }),
                    title: `${s.name}${s.reserve ? ' (reserve)' : ''}`,
                    subtitle: `${s.legs} leg${s.legs === 1 ? '' : 's'} · ${s.TS} scored · ${s.TR} received`,
                    detail: s.legs ? signed(s.Ind) : '',
                  }),
                ),
            ),
          ),
          group(
            { header: 'Export' },
            row({
              lead: tile('photo', 'indigo'),
              title: 'Share Image',
              chevron: true,
              onClick: () => exportTeamImage(m),
            }),
            row({ lead: tile('doc', 'green'), title: 'Export CSV', chevron: true, onClick: () => exportTeamCsv(m) }),
            row({ lead: tile('printer', 'gray'), title: 'Print', chevron: true, onClick: () => printTeam(m) }),
          ),
        ],
      }),
    );
  }

  async function matchMenu(m) {
    const canSub = ['A', 'B'].some((k) => m.teams[k].reserve && !m.teams[k].subbed);
    const choice = await actionSheet({
      title: m.name,
      actions: [
        canSub && m.status !== 'finished' && { id: 'sub', label: 'Bring On Reserve…', icon: 'people' },
        { id: 'img', label: 'Share Image', icon: 'photo' },
        { id: 'csv', label: 'Export CSV', icon: 'doc' },
        { id: 'print', label: 'Print', icon: 'printer' },
        { id: 'rename', label: 'Rename', icon: 'pencil' },
        { id: 'rematch', label: 'Rematch', icon: 'copy' },
        { id: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
      ],
    });
    if (choice === 'img') exportTeamImage(m);
    else if (choice === 'csv') exportTeamCsv(m);
    else if (choice === 'print') printTeam(m);
    else if (choice) await matchAction(m, choice);
  }

  async function substituteFlow(m) {
    const teams = ['A', 'B'].filter((k) => m.teams[k].reserve && !m.teams[k].subbed);
    const k =
      teams.length === 1
        ? teams[0]
        : await actionSheet({
            title: 'Which team?',
            actions: teams.map((t) => ({ id: t, label: m.teams[t].name })),
          });
    if (!k) return;
    const t = m.teams[k];
    const out = await actionSheet({
      title: `${t.reserve.name} replaces…`,
      subtitle: 'The reserve fences every remaining leg of the fencer they replace. One substitution per team.',
      actions: t.fencers.map((f) => ({ id: f.id, label: f.name })),
    });
    if (!out) return;
    saveMatch(Team.substitute(m, k, out));
    toast(`${t.reserve.name} is on`);
  }

  /** Enter or correct a leg by hand. */
  function legDialog(m, l) {
    const A = Team.fencerById(m, l.aId);
    const B = Team.fencerById(m, l.bId);
    const start = Team.legStart(m, l.n);
    const isDone = Team.legDone(l);
    let ta = isDone ? l.touchesA : 0;
    let tb = isDone ? l.touchesB : 0;
    const final = l.n === Team.LEGS;
    let pri = m.decided?.leg === l.n && m.decided.reason === 'priority' ? m.decided.winner : null;

    return modal((close) => {
      const body = h('div', { class: 'sheet-body result-dialog' });
      const stepper = (f, k, get, set) =>
        h(
          'div',
          { class: 'stepper' },
          h('div', { class: 'st-name' }, f.name),
          h('span', { class: 'st-val' }, (k === 'A' ? start.a : start.b) + get()),
          h('div', { class: 'st-sub' }, `+${get()} this leg`),
          h(
            'div',
            { class: 'st-row' },
            button(icon('minus'), () => (set(Math.max(0, get() - 1)), draw()), 'st-btn', {
              'aria-label': `${f.name} minus one`,
            }),
            button(icon('plus'), () => (set(Math.min(Team.MATCH_TARGET, get() + 1)), draw()), 'st-btn', {
              'aria-label': `${f.name} plus one`,
            }),
          ),
        );
      const save = () => {
        const endLevel = start.a + ta === start.b + tb;
        if (final && endLevel && !pri) return toast('Level after the last leg: choose who won on priority');
        saveMatch(
          Team.recordLeg(m, l.n, {
            touchesA: ta,
            touchesB: tb,
            reason: 'manual',
            decided: final && endLevel ? { winner: pri, reason: 'priority' } : null,
          }),
        );
        haptics.tap();
        close();
      };
      const draw = () => {
        const endLevel = start.a + ta === start.b + tb;
        fill(
          body,
          sheetNav({
            title: `Leg ${l.n} · to ${l.target}`,
            left: { label: 'Cancel', onClick: () => close() },
            right: { label: 'Save', bold: true, onClick: save },
          }),
          h('p', { class: 'keypad-hint', style: { marginBottom: '12px' } }, `Starts at ${start.a}–${start.b}`),
          h(
            'div',
            { class: 'steppers' },
            stepper(
              A,
              'A',
              () => ta,
              (x) => (ta = x),
            ),
            stepper(
              B,
              'B',
              () => tb,
              (x) => (tb = x),
            ),
          ),
          final &&
            endLevel &&
            group(
              { header: 'Level: who won on priority?' },
              segmented(
                [
                  ['A', m.teams.A.name],
                  ['B', m.teams.B.name],
                ],
                pri,
                (v) => ((pri = v), draw()),
                'Priority',
              ),
            ),
          group(
            {},
            row({
              lead: icon('play'),
              title: 'Fence This Leg',
              tone: 'accent',
              onClick: () => (close(), startNextLeg(m, l)),
            }),
            isDone &&
              holdButton(
                [icon('trash'), h('span', { class: 'row-title' }, 'Hold to Clear Leg')],
                () => (saveMatch(Team.clearLeg(m, l.n)), close(), toast('Leg cleared')),
                { cls: 'row tappable tone-danger', hint: 'Press and hold to clear this leg' },
              ),
          ),
        );
      };
      draw();
      return body;
    });
  }

  subscribe((evt) => {
    if (document.body.dataset.tab !== 'teams') return;
    if (route.view === 'new') return;
    if (evt.type === 'matches' || evt.type === 'bout') {
      const y = root.querySelector('.page-body')?.scrollTop ?? 0;
      render();
      const pb = root.querySelector('.page-body');
      if (pb) {
        pb.scrollTop = y;
        pb.dispatchEvent(new Event('scroll'));
      }
    }
  });

  return {
    show(r) {
      if (r.view === 'new' && route.view !== 'new') draft = null;
      route = r;
      render();
      root.querySelector('.page-body')?.scrollTo?.(0, 0);
    },
  };
}
