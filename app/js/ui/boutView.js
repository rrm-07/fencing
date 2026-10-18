// The bout scorer screen.

import {
  h,
  fill,
  button,
  iconButton,
  icon,
  holdButton,
  toast,
  keypad,
  promptText,
  confirmDialog,
  modal,
  actionSheet,
  modalOpen,
  sheetNav,
  group,
  row,
  segmented,
  toggle,
  tile,
} from './dom.js';
import { haptics, setWakeLock } from './device.js';
import { state, dispatch, subscribe, confirmBout, newBout, boutInProgress } from '../state.js';
import { WEAPON_LABEL, BOUT_MS, other, REASON_TEXT, doubleBlocked } from '../core/bout.js';
import * as T from '../core/timer.js';
import { ops, isTableau, pendingBouts, boutFor } from '../core/kinds.js';
const progress = (p) => ops(p).progress(p);
const nextBout = (p) => ops(p).nextBout(p);
import { openSettings } from './settings.js';
import { startNextBout } from './pouleView.js';
import { startNextLeg } from './teamView.js';
import * as Team from '../core/team.js';

const SIDE_LABEL = { left: 'Left (red)', right: 'Right (green)' };

export function mountBoutView(root) {
  const el = {};
  // Clicks landing within this window after a tap-to-stop are swallowed, so
  // the tap that stops the clock can never also score a touch.
  let suppressUntil = 0;
  const suppressed = () => performance.now() < suppressUntil;

  const side = (s) => {
    const name = button('', () => editName(s), 'name', { 'aria-label': `Edit ${SIDE_LABEL[s]} name` });
    const cards = h('span', { class: 'card-chips', 'aria-hidden': 'true' });
    const prio = h('span', { class: 'prio-badge', hidden: true }, 'PRIORITY');
    const num = h('span', { class: 'num' }, '0');
    const teamLabel = h('span', { class: 'team-label', hidden: true });
    const score = h(
      'button',
      { type: 'button', class: 'score', 'aria-label': `Add touch ${SIDE_LABEL[s]}` },
      cards,
      prio,
      num,
      teamLabel,
    );
    score.addEventListener('click', () => {
      if (suppressed()) return;
      if (dispatch({ type: 'score', side: s, delta: 1 })) haptics.score();
    });
    const minus = button(
      '−1',
      () => {
        if (dispatch({ type: 'score', side: s, delta: -1 })) haptics.tap();
      },
      'minus',
      { 'aria-label': `Remove touch ${SIDE_LABEL[s]}` },
    );
    const card = button([h('span', { class: 'card-icon' }), 'Card'], () => cardSheet(s), 'card-btn', {
      'aria-label': `Card ${SIDE_LABEL[s]}`,
    });
    el[s] = { name, score, num, cards, prio, minus, card, teamLabel, lastScore: null };
    return h('div', { class: `side ${s}` }, name, score, h('div', { class: 'side-ctl' }, minus, card));
  };

  el.format = button('', openFormat, 'format', { 'aria-label': 'Bout format' });
  el.undo = iconButton('undo', doUndo, 'Undo last action', 'undo');
  el.swap = iconButton('swap', doSwap, 'Swap sides');
  const menu = iconButton('ellipsis', openSettings, 'Menu');

  el.time = h('span', { class: 'time' }, '3:00');
  el.clockStatus = h('span', { class: 'clock-status' });
  el.clock = h(
    'button',
    { type: 'button', class: 'btn clock', 'aria-label': 'Start or stop the clock' },
    el.time,
    el.clockStatus,
  );
  el.clock.addEventListener('click', () => {
    if (suppressed()) return;
    toggleClock();
  });
  el.start = button(icon('play'), () => !suppressed() && toggleClock(), 'round startstop', {
    'aria-label': 'Start clock',
  });
  el.reset = holdButton([icon('reset'), 'Reset'], doReset, {
    onTap: confirmReset,
    cls: 'round reset',
    attrs: { 'aria-label': 'Reset clock (press and hold)' },
  });
  el.p3 = button('3:00', () => preset(BOUT_MS), 'preset');
  el.p1 = button('1:00', () => preset(T.MIN), 'preset');
  el.set = button('Set', setTime, 'preset set', { 'aria-label': 'Set exact time' });
  el.double = button('Double', doDouble, 'double');
  el.period = button('', choosePeriod, 'period');
  el.clockRow = h('div', { class: 'clock-row' }, el.reset, el.clock, el.start);
  el.clockCtl = h('div', { class: 'clock-ctl' }, el.p3, el.p1, el.set);
  el.extra = h('div', { class: 'extra' }, el.double, el.period);

  el.banner = h('div', { class: 'banner', hidden: true, role: 'alertdialog', 'aria-live': 'assertive' });
  el.overlay = h(
    'div',
    { class: 'run-overlay', hidden: true },
    h('div', { class: 'run-hint' }, 'Tap anywhere to stop'),
  );
  el.overlay.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stopFromOverlay();
  });
  // Swallow the click that follows the stopping tap.
  el.overlay.addEventListener('click', (e) => e.stopPropagation());
  el.flash = h('div', { class: 'time-flash', hidden: true });

  el.center = h('div', { class: 'center' }, el.clockRow, el.clockCtl, el.extra);
  el.root = h(
    'section',
    { class: 'bout' },
    h(
      'div',
      { class: 'arena' },
      h('header', { class: 'topbar' }, el.format, el.undo, el.swap, menu),
      side('left'),
      el.center,
      side('right'),
    ),
    el.banner,
    el.overlay,
    el.flash,
  );
  fill(root, el.root);

  /* ---------- actions ---------- */

  function toggleClock() {
    const b = state.bout;
    if (b.status !== 'active' || b.tiedAtTime || b.periodEnded) return;
    if (!b.timer.running && T.remaining(b.timer, Date.now()) <= 0) {
      toast('Clock is at 0:00 — reset or set the time first');
      return;
    }
    dispatch({ type: 'timerToggle' });
    haptics.tap();
  }

  function stopFromOverlay() {
    suppressUntil = performance.now() + 450;
    if (state.bout.timer.running) {
      dispatch({ type: 'timerToggle' });
      haptics.tap();
    }
  }

  async function preset(ms) {
    const t = state.bout.timer;
    const rem = T.remaining(t, Date.now());
    if (rem > 0 && rem !== t.presetMs && rem !== ms) {
      const ok = await confirmDialog({
        title: `Set clock to ${T.formatMmSs(ms)}?`,
        message: `The clock shows ${T.format(rem)}.`,
        confirm: `Set ${T.formatMmSs(ms)}`,
      });
      if (!ok) return;
    }
    dispatch({ type: 'timerPreset', ms });
  }

  function doReset() {
    if (dispatch({ type: 'timerReset' }))
      toast(`Clock reset to ${T.formatMmSs(state.bout.timer.presetMs)}`, { action: 'Undo', onAction: doUndo });
  }

  async function confirmReset() {
    const ok = await confirmDialog({
      title: `Reset clock to ${T.formatMmSs(state.bout.timer.presetMs)}?`,
      message: 'Tip: press and hold Reset to skip this question.',
      confirm: 'Reset',
      danger: true,
    });
    if (ok) doReset();
  }

  async function setTime() {
    const t = state.bout.timer;
    if (t.running) return;
    const v = await keypad({
      title: 'Set clock',
      mode: 'time',
      initial: T.formatMmSs(T.remaining(t, Date.now())),
      hint: 'Type minutes and seconds, e.g. 1 4 5 → 1:45',
    });
    if (v == null) return;
    const ms = T.parseMmSs(v);
    if (ms == null) return toast('Seconds must be 00–59');
    dispatch({ type: 'timerSet', ms });
  }

  function doUndo() {
    const h = state.bout.history;
    if (!h.length || state.bout.status === 'confirmed') return;
    const label = h[h.length - 1].label;
    dispatch({ type: 'undo' });
    haptics.undo();
    toast(`Undone: ${label}`);
  }

  function doSwap() {
    dispatch({ type: 'swap' });
    haptics.tap();
    toast('Sides swapped');
  }

  function doDouble() {
    const why = doubleBlocked(state.bout);
    if (why) return toast(why);
    if (dispatch({ type: 'double' })) haptics.score();
  }

  async function editName(s) {
    const name = await promptText({ title: `${SIDE_LABEL[s]} fencer`, value: state.bout[s].name });
    if (name) dispatch({ type: 'setName', side: s, name });
  }

  async function cardSheet(s) {
    const b = state.bout;
    if (b.status !== 'active') return toast('The bout is over');
    const f = b[s];
    const opp = b[other(s)];
    const carded = f.cards.yellow > 0 || f.cards.red > 0;
    const choice = await actionSheet({
      title: `Card for ${f.name}`,
      subtitle: `${cardSummary(f.cards) ? `Has ${cardSummary(f.cards)}. ` : ''}A red card gives ${opp.name} a touch.`,
      actions: [
        { id: 'yellow', label: carded ? 'Yellow → Red Card' : 'Yellow Card', icon: 'card', cls: 'card-y' },
        { id: 'red', label: 'Red Card', icon: 'card', cls: 'card-r' },
        {
          id: 'black',
          label: 'Hold for Black Card',
          icon: 'card',
          cls: 'card-b',
          tone: 'danger',
          hold: true,
          hint: 'Press and hold to give a black card',
        },
      ],
    });
    if (!choice) return;
    dispatch({ type: 'card', side: s, card: choice });
    haptics.score();
    const last = state.bout.history.at(-1);
    toast(last?.label ?? 'Card given', { action: 'Undo', onAction: doUndo });
  }

  async function choosePeriod() {
    const b = state.bout;
    const choice = await actionSheet({
      title: 'Period',
      actions: [1, 2, 3].map((p) => ({ id: p, label: `Period ${p}${p === b.period ? '  ✓' : ''}` })),
    });
    if (choice) dispatch({ type: 'setPeriod', period: choice });
  }

  async function openFormat() {
    await modal((close) => formatSheet(close));
  }

  function formatSheet(close) {
    const body = h('div', { class: 'sheet-body' });
    const draw = () => {
      const b = state.bout;
      const custom = b.target !== 5 && b.target !== 15;
      const poule = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
      fill(
        body,
        sheetNav({ title: 'Bout', right: { label: 'Done', bold: true, onClick: () => close() } }),
        group(
          {},
          row({
            lead: tile('grid', 'blue'),
            title: 'Choose Bout',
            subtitle: 'Referee a bout from a poule or team match',
            chevron: true,
            onClick: () => (close(), chooseBout()),
          }),
        ),
        group(
          { header: 'Weapon' },
          segmented(
            [
              ['foil', 'Foil'],
              ['epee', 'Épée'],
              ['sabre', 'Sabre'],
            ],
            b.weapon,
            (w) => (dispatch({ type: 'setFormat', weapon: w }), draw()),
            'Weapon',
          ),
        ),
        group(
          { header: 'Touches to win', footer: '5 for poule bouts, 15 for direct elimination.' },
          segmented(
            [
              [5, '5'],
              [15, '15'],
              ['custom', custom ? `${b.target}` : 'Custom'],
            ],
            custom ? 'custom' : b.target,
            async (v) => {
              if (v === 'custom') {
                const n = await keypad({
                  title: 'Touches to Win',
                  mode: 'number',
                  initial: String(b.target),
                  maxDigits: 2,
                });
                if (n == null || Number(n) < 1) return;
                v = Number(n);
              }
              dispatch({ type: 'setFormat', target: v, de: v >= 10 });
              draw();
            },
            'Touches to win',
          ),
        ),
        group(
          {
            footer:
              b.weapon === 'sabre'
                ? 'Sabre bouts usually run without a clock.'
                : 'Periods: three 3-minute periods with a 1-minute break.',
          },
          row({
            title: 'Periods',
            subtitle: 'For direct elimination',
            trailing: toggle(b.de, (v) => (dispatch({ type: 'setFormat', de: v }), draw()), 'Periods'),
          }),
          b.weapon === 'sabre' &&
            row({
              title: 'Show Clock',
              trailing: toggle(
                b.showTimer,
                (v) => (dispatch({ type: 'setFormat', showTimer: v }), draw()),
                'Show clock in sabre',
              ),
            }),
        ),
        group(
          {},
          poule &&
            row({
              title: 'Poule Sheet',
              subtitle: poule.name,
              chevron: true,
              onClick: () => (close(), (location.hash = `#poule/${poule.id}`)),
            }),
          holdButton(h('span', { class: 'row-title' }, 'New Bout'), () => (close(), newBout(), toast('New bout')), {
            cls: 'row tappable tone-danger',
            onTap: async () => {
              if (boutInProgress()) {
                const ok = await confirmDialog({
                  title: 'Start a new bout?',
                  message: 'The current score and clock will be cleared.',
                  confirm: 'New Bout',
                  danger: true,
                });
                if (!ok) return;
              }
              close();
              newBout();
            },
            attrs: { 'aria-label': 'New bout' },
          }),
        ),
      );
    };
    draw();
    return body;
  }

  /* ---------- banner (bout over / time / period end) ---------- */

  function renderBanner(b) {
    const parts = [];
    let mode = '';
    const who = (side) => h('span', { class: `who ${side}` }, b[side].name);
    const sc = () => h('span', { class: 'sc' }, `${b[b.winner].score}–${b[other(b.winner)].score}`);
    const undoBtn = () => button([icon('undo'), 'Undo'], doUndo, 'btn-gray');
    const match = b.teamRef && state.matches.get(b.teamRef.matchId);
    const teamScore = () =>
      h(
        'div',
        { class: 'banner-result' },
        h('span', { class: 'who left' }, b.left.team),
        h('span', { class: 'sc' }, ` ${b.left.score}–${b.right.score} `),
        h('span', { class: 'who right' }, b.right.team),
      );
    if (b.relay && b.status === 'over') {
      mode = 'over';
      const reason = REASON_TEXT[b.reason];
      const ends = b.relay.final || b.reason === 'black' || Math.max(b.left.score, b.right.score) >= Team.MATCH_TARGET;
      parts.push(
        h(
          'div',
          { class: 'banner-kicker' },
          `${ends ? 'Match over' : `Leg ${b.relay.leg} of ${b.relay.legs} over`}${reason ? ` · ${reason}` : ''}`,
        ),
        ends && b.winner
          ? h(
              'div',
              { class: 'banner-result' },
              h('span', { class: `who ${b.winner}` }, b[b.winner].team),
              ' win ',
              sc(),
            )
          : teamScore(),
        h(
          'div',
          { class: 'actions' },
          undoBtn(),
          button(ends ? 'Confirm result' : 'Confirm leg', onConfirm, 'btn-filled'),
        ),
      );
    } else if (b.relay && b.status === 'confirmed') {
      mode = 'done';
      const mid = match?.id;
      const more = match && Team.nextLeg(match);
      parts.push(
        match?.status === 'finished'
          ? h(
              'div',
              { class: 'banner-result' },
              icon('checkCircle'),
              h(
                'span',
                { class: `who ${match.winner === b.left.id ? 'left' : 'right'}` },
                match.teams[match.winner].name,
              ),
              ' won ',
              h('span', { class: 'sc' }, `${Team.score(match).a}–${Team.score(match).b}`),
            )
          : h(
              'div',
              { class: 'banner-result' },
              icon('checkCircle'),
              `Leg ${b.relay.leg} · `,
              h('span', { class: 'sc' }, `${b.left.score}–${b.right.score}`),
            ),
        h(
          'div',
          { class: 'actions' },
          mid && button('Match', () => (location.hash = `#team/${mid}`), 'btn-gray'),
          more
            ? button([icon('play'), 'Next leg'], () => startNextLeg(state.matches.get(mid)), 'btn-filled')
            : button('Choose bout', chooseBout, 'btn-filled'),
        ),
      );
    } else if (b.status === 'over') {
      mode = 'over';
      const reason = REASON_TEXT[b.reason];
      parts.push(
        h('div', { class: 'banner-kicker' }, reason ? `Bout over · ${reason}` : 'Bout over'),
        h('div', { class: 'banner-result' }, who(b.winner), ' wins ', sc()),
        h('div', { class: 'actions' }, undoBtn(), button('Confirm result', onConfirm, 'btn-filled')),
      );
    } else if (b.status === 'confirmed') {
      mode = 'done';
      const poule = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
      const more = poule && nextBout(poule);
      const pid = poule?.id;
      // Look the poule up again on tap: the result is written after this renders.
      const goNext = () => startNextBout(state.poules.get(pid));
      parts.push(
        h('div', { class: 'banner-result' }, icon('checkCircle'), who(b.winner), ' won ', sc()),
        poule
          ? h(
              'div',
              { class: 'actions' },
              button(isTableau(poule) ? 'Tableau' : 'Poule sheet', () => (location.hash = `#poule/${pid}`), 'btn-gray'),
              more
                ? button([icon('play'), 'Next bout'], goNext, 'btn-filled')
                : button('New bout', () => newBout(), 'btn-filled'),
            )
          : h(
              'div',
              { class: 'actions' },
              pendingCount() > 0 && button('Choose bout', chooseBout, 'btn-gray'),
              button('New bout', () => newBout(), 'btn-filled'),
            ),
      );
    } else if (b.tiedAtTime) {
      mode = 'time';
      parts.push(
        h('div', { class: 'banner-kicker' }, 'Time'),
        h(
          'div',
          { class: 'banner-result' },
          'Level at ',
          h('span', { class: 'sc' }, `${b.left.score}–${b.right.score}`),
        ),
        h('div', { class: 'banner-note' }, 'One minute of sudden death. Draw priority first.'),
        h('div', { class: 'actions' }, undoBtn(), button('Draw priority', drawPriority, 'btn-filled')),
      );
    } else if (b.periodEnded) {
      mode = 'period';
      parts.push(
        h('div', { class: 'banner-kicker' }, `End of period ${b.period}`),
        h(
          'div',
          { class: 'actions' },
          iconButton('undo', doUndo, 'Undo', 'btn-gray'),
          button('1:00 break', () => dispatch({ type: 'startBreak' }), 'btn-tinted'),
          button(`Period ${b.period + 1}`, () => dispatch({ type: 'nextPeriod' }), 'btn-filled'),
        ),
      );
    }
    const pr = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
    const mt = b.teamRef && state.matches.get(b.teamRef.matchId);
    const key = `${mode}|${b.winner}|${b.status}|${b.period}|${b.left.score}-${b.right.score}|${b.left.name}|${b.right.name}|${pr ? progress(pr).done : ''}|${mt ? `${mt.status}${mt.updatedAt}` : ''}`;
    if (el.banner.dataset.key === key) return;
    el.banner.dataset.key = key;
    el.banner.hidden = !mode;
    el.banner.className = `banner banner-${mode}`;
    fill(el.banner, ...parts);
  }

  function onConfirm() {
    const saved = confirmBout();
    haptics.win();
    if (saved?.kind === 'team') {
      const sc = Team.score(saved);
      toast(`Leg saved · ${saved.teams.A.name} ${sc.a}–${sc.b} ${saved.teams.B.name}`);
    } else if (saved) toast(`Saved to ${saved.name} (${progress(saved).done}/${progress(saved).total})`);
    else toast('Result saved');
  }

  /** How many poule bouts / team legs are waiting to be fenced. */
  function pendingCount() {
    let n = 0;
    for (const p of state.poules.values()) if (p.status !== 'finished') n += pendingBouts(p).length;
    for (const m of state.matches.values()) if (m.status !== 'finished') n += 1;
    return n;
  }

  /** Pick a poule bout (or a team leg) to referee from the scorer. */
  function chooseBout() {
    return modal((close) => {
      const go = (fn) => () => (close(), fn());
      const poules = [...state.poules.values()]
        .filter((p) => p.status !== 'finished')
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const matches = [...state.matches.values()].filter((m) => m.status !== 'finished');
      const cur = state.bout;
      return h(
        'div',
        { class: 'sheet-body' },
        sheetNav({ title: 'Choose Bout', right: { label: 'Done', bold: true, onClick: () => close() } }),
        !poules.length &&
          !matches.length &&
          h(
            'div',
            { class: 'empty', style: { paddingTop: '24px' } },
            icon('grid'),
            h('h2', {}, 'Nothing to Referee'),
            h('p', {}, 'Create a poule or a team match first, then pick its bouts here.'),
          ),
        ...poules.map((p) => {
          const nb = nextBout(p);
          const nm = (id) => p.fencers.find((f) => f.id === id)?.name ?? '?';
          const pr = progress(p);
          return group(
            {
              header: p.name,
              footer: `${isTableau(p) ? 'Elimination · ' : ''}${pr.done} of ${pr.total} bouts fenced`,
            },
            ...pendingBouts(p).map((x) =>
              row({
                lead: h('span', { class: 'bout-n' }, x.n),
                title: h(
                  'span',
                  { class: 'bout-names' },
                  h('span', { class: 'red-text' }, nm(x.leftId)),
                  h('span', { class: 'l' }, ' vs '),
                  h('span', { class: 'green-text' }, nm(x.rightId)),
                ),
                subtitle: isTableau(p) ? x.roundName : null,
                trailing:
                  cur.pouleRef?.boutId === x.id && cur.status !== 'confirmed'
                    ? h('span', { class: 'tag tag-live' }, 'On piste')
                    : nb?.id === x.id
                      ? h('span', { class: 'tag tag-next' }, 'Up next')
                      : null,
                chevron: true,
                onClick: go(() => startNextBout(p, x)),
                attrs: { 'aria-label': `Bout ${x.n}: ${nm(x.leftId)} vs ${nm(x.rightId)}` },
              }),
            ),
          );
        }),
        ...matches.map((m) => {
          const l = Team.nextLeg(m);
          const nm = (id) => Team.fencerById(m, id)?.name ?? '?';
          const sc = Team.score(m);
          return group(
            { header: m.name, footer: `Team match · ${sc.a}–${sc.b}` },
            l &&
              row({
                lead: h('span', { class: 'bout-n' }, `L${l.n}`),
                title: h(
                  'span',
                  { class: 'bout-names' },
                  h('span', { class: 'red-text' }, nm(l.aId)),
                  h('span', { class: 'l' }, ' vs '),
                  h('span', { class: 'green-text' }, nm(l.bId)),
                ),
                subtitle: `Leg ${l.n} of ${Team.LEGS} · to ${l.target}`,
                chevron: true,
                onClick: go(() => startNextLeg(m, l)),
                attrs: { 'aria-label': `Leg ${l.n}: ${nm(l.aId)} vs ${nm(l.bId)}` },
              }),
          );
        }),
        group(
          { footer: 'A free bout isn’t saved to any poule.' },
          row({
            lead: icon('plus'),
            title: 'Free Bout',
            tone: 'accent',
            onClick: go(async () => {
              if (boutInProgress()) {
                const ok = await confirmDialog({
                  title: 'Start a new bout?',
                  message: 'The current score and clock will be cleared.',
                  confirm: 'New Bout',
                  danger: true,
                });
                if (!ok) return;
              }
              newBout({ keepNames: !cur.pouleRef && !cur.teamRef });
            }),
          }),
        ),
      );
    });
  }

  let drawing = false;
  function drawPriority() {
    if (drawing) return;
    drawing = true;
    const winner = Math.random() < 0.5 ? 'left' : 'right';
    // Alternate the highlight with a slowing rhythm, landing on the winner.
    const steps = 9 + (winner === 'right' ? 1 : 0);
    let i = 0;
    el.root.classList.add('drawing');
    const tick = () => {
      const s = i % 2 === 0 ? 'left' : 'right';
      el.root.dataset.draw = s;
      haptics.tap();
      i += 1;
      if (i < steps) setTimeout(tick, 70 + i * i * 4);
      else
        setTimeout(() => {
          el.root.classList.remove('drawing');
          delete el.root.dataset.draw;
          drawing = false;
          dispatch({ type: 'assignPriority', side: winner });
          haptics.score();
          toast(`Priority: ${state.bout[winner].name}`);
        }, 700);
    };
    tick();
  }

  /* ---------- render ---------- */

  function cardSummary(c) {
    return [c.yellow && 'yellow', c.red && `${c.red} red`, c.black && 'black'].filter(Boolean).join(', ');
  }

  function renderSide(b, s) {
    const f = b[s];
    const e = el[s];
    fill(e.name, h('span', { class: 'nm' }, f.name), icon('pencil'));
    e.teamLabel.hidden = !f.team;
    e.teamLabel.textContent = f.team ?? '';
    e.num.textContent = f.score;
    if (e.lastScore !== null && e.lastScore !== f.score) {
      e.score.classList.remove('flash');
      void e.score.offsetWidth; // restart the animation
      e.score.classList.add('flash');
    }
    e.lastScore = f.score;
    fill(
      e.cards,
      ...(f.cards.yellow ? [h('i', { class: 'c-yellow' })] : []),
      ...Array.from({ length: f.cards.red }, () => h('i', { class: 'c-red' })),
      ...(f.cards.black ? [h('i', { class: 'c-black' })] : []),
    );
    e.prio.hidden = b.priority !== s;
    const active = b.status === 'active';
    e.score.disabled = !active;
    e.minus.disabled = !active || f.score === 0;
    e.card.disabled = !active;
    e.score.classList.toggle('winner', b.winner === s && b.status !== 'active');
  }

  let lastRemaining = null;
  function renderClock(b, now = Date.now()) {
    const rem = T.remaining(b.timer, now);
    el.time.textContent = T.format(rem);
    el.clock.classList.toggle('running', b.timer.running);
    el.clock.classList.toggle('low', rem < 10_000);
    el.clock.classList.toggle('zero', rem <= 0);
    el.clock.classList.toggle('break', b.phase === 'break');
    let status = '';
    if (b.phase === 'break') status = 'Break';
    else if (b.timer.running) status = b.priorityMinute ? 'Priority' : b.de ? `Period ${b.period}` : '';
    else if (b.status !== 'active') status = '';
    else if (rem <= 0) status = 'Time';
    else if (rem === b.timer.presetMs && !b.priorityMinute) status = 'Ready';
    else status = b.priorityMinute ? 'Priority · Halt' : 'Halt';
    el.clockStatus.textContent = status;

    // Haptics at 10 s and at 0:00 (only when crossed live, not after a long background).
    if (b.timer.running && lastRemaining != null) {
      if (lastRemaining > 10_000 && rem <= 10_000 && lastRemaining - rem < 2_000) haptics.tenSeconds();
    }
    lastRemaining = b.timer.running ? rem : null;
    // Defer so expiry never dispatches in the middle of a render.
    if (b.timer.running && rem <= 0) queueMicrotask(onExpired);
  }

  function onExpired() {
    const b = state.bout;
    if (!b.timer.running || T.remaining(b.timer, Date.now()) > 0) return;
    const wasBreak = b.phase === 'break';
    dispatch({ type: 'timeExpired' });
    haptics.timeUp();
    el.flash.hidden = false;
    el.flash.classList.remove('go');
    void el.flash.offsetWidth;
    el.flash.classList.add('go');
    setTimeout(() => (el.flash.hidden = true), 2200);
    if (wasBreak) toast(`Break over — period ${state.bout.period}`);
  }

  function render() {
    const b = state.bout;
    el.root.className = `bout weapon-${b.weapon} status-${b.status}${b.de ? ' de' : ''}${b.showTimer ? '' : ' no-timer'}${el.root.classList.contains('drawing') ? ' drawing' : ''}`;
    // The format chip doubles as the poule / match label, or invites you to
    // pick a poule bout when this is a free bout.
    const poule = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
    const pb = poule?.bouts.find((x) => x.id === b.pouleRef.boutId);
    const match = b.teamRef && state.matches.get(b.teamRef.matchId);
    let main = `${WEAPON_LABEL[b.weapon]} · ${b.target}`;
    let sub = null;
    if (match) {
      main = `Leg ${b.teamRef.leg} · to ${b.target}`;
      sub = match.name;
    } else if (poule && isTableau(poule)) {
      sub = `${poule.name} · ${boutFor(poule, b.pouleRef.boutId)?.roundName ?? 'Elimination'}`;
    } else if (poule) sub = `${poule.name} · Bout ${pb?.n ?? '?'} of ${poule.bouts.length}`;
    else if (!boutInProgress() && pendingCount() > 0) sub = 'Choose a poule bout ›';
    fill(
      el.format,
      h(
        'span',
        { class: 'fmt-text' },
        h('span', { class: 'fmt-main' }, main),
        sub && h('span', { class: `fmt-sub${!poule && !match ? ' accent' : ''}` }, sub),
      ),
      icon('chevronDown'),
    );
    el.undo.disabled = !b.history.length || b.status === 'confirmed';
    el.swap.disabled = b.status === 'confirmed';
    renderSide(b, 'left');
    renderSide(b, 'right');
    renderClock(b);
    const showClock = b.showTimer;
    el.clockRow.hidden = !showClock;
    el.clockCtl.hidden = !showClock;
    fill(el.start, icon(b.timer.running ? 'pause' : 'play'));
    el.start.classList.toggle('running', b.timer.running);
    el.start.setAttribute('aria-label', b.timer.running ? 'Stop clock' : 'Start clock');
    el.start.disabled = el.clock.disabled = b.status !== 'active' || b.tiedAtTime || b.periodEnded;
    const timerBusy = b.timer.running;
    el.set.disabled = timerBusy || b.status !== 'active';
    el.p3.disabled = el.p1.disabled = timerBusy || b.status !== 'active';
    el.reset.disabled = timerBusy;
    el.double.hidden = b.weapon !== 'epee';
    el.double.disabled = b.status !== 'active';
    el.period.hidden = !b.de;
    el.period.textContent = `Period ${b.period} of 3`;
    el.extra.hidden = el.double.hidden && el.period.hidden;
    renderBanner(b);

    // Tap-anywhere-to-stop zone while the clock runs.
    if (b.timer.running) {
      clearTimeout(overlayTimer);
      el.overlay.hidden = false;
    } else if (!el.overlay.hidden) {
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => (el.overlay.hidden = true), 350);
    }
    setWakeLock(
      document.body.dataset.tab === 'bout' && b.status !== 'confirmed' && (b.timer.running || boutInProgress()),
    );
    loop();
  }
  let overlayTimer;

  // Display loop: requestAnimationFrame while visible, plus a coarse interval
  // so expiry is still detected if rAF is throttled.
  let raf = 0;
  function frame() {
    raf = 0;
    if (!state.bout.timer.running) return;
    renderClock(state.bout);
    loop();
  }
  function loop() {
    if (state.bout.timer.running && !raf) raf = requestAnimationFrame(frame);
  }
  setInterval(() => {
    if (state.bout.timer.running) renderClock(state.bout);
  }, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });

  // Keyboard shortcuts for desktop use: space = clock, z = undo.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.tab !== 'bout' || modalOpen() || e.target.closest('input,textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.bout.timer.running) stopFromOverlay();
      else toggleClock();
    } else if (e.key === 'z' || e.key === 'Z') doUndo();
  });

  subscribe((evt) => {
    if (evt.type === 'bout' || evt.type === 'poules' || evt.type === 'matches' || evt.type === 'tab') render();
  });
  render();
  return { render };
}
