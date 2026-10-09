// The bout scorer screen.

import {
  h,
  fill,
  button,
  holdButton,
  toast,
  keypad,
  promptText,
  confirmDialog,
  modal,
  actionSheet,
  modalOpen,
} from './dom.js';
import { haptics, setWakeLock } from './device.js';
import { state, dispatch, subscribe, confirmBout, newBout, boutInProgress } from '../state.js';
import { WEAPON_LABEL, BOUT_MS, other, resultText, REASON_TEXT, doubleBlocked } from '../core/bout.js';
import * as T from '../core/timer.js';
import { progress, nextBout } from '../core/poule.js';
import { openSettings } from './settings.js';
import { startNextBout } from './pouleView.js';

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
    const prio = h('span', { class: 'prio-badge', hidden: true }, 'P');
    const num = h('span', { class: 'num' }, '0');
    const score = h(
      'button',
      { type: 'button', class: 'score', 'aria-label': `Add touch ${SIDE_LABEL[s]}` },
      cards,
      prio,
      num,
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
    const card = button(h('span', { class: 'card-icon' }), () => cardSheet(s), 'card-btn', {
      'aria-label': `Card ${SIDE_LABEL[s]}`,
    });
    card.append(' Card');
    el[s] = { name, score, num, cards, prio, minus, card, lastScore: null };
    return h('div', { class: `side ${s}` }, name, score, h('div', { class: 'side-ctl' }, minus, card));
  };

  el.format = button('', openFormat, 'chip format', { 'aria-label': 'Bout format' });
  el.undo = button(['↶', h('span', { class: 'lbl' }, ' Undo')], doUndo, 'undo', { 'aria-label': 'Undo last action' });
  el.swap = button('⇄', doSwap, 'icon-btn', { 'aria-label': 'Swap sides' });
  const menu = button('⋯', openSettings, 'icon-btn', { 'aria-label': 'Menu' });

  el.time = h('span', { class: 'time' }, '3:00');
  el.clockStatus = h('span', { class: 'clock-status' });
  el.clock = h(
    'button',
    { type: 'button', class: 'clock', 'aria-label': 'Start or stop the clock' },
    el.time,
    el.clockStatus,
  );
  el.clock.addEventListener('click', () => {
    if (suppressed()) return;
    toggleClock();
  });
  el.p3 = button('3:00', () => preset(BOUT_MS), 'preset');
  el.p1 = button('1:00', () => preset(T.MIN), 'preset');
  el.set = button('Set', setTime, 'preset', { 'aria-label': 'Set exact time' });
  el.reset = holdButton('Reset', doReset, {
    onTap: confirmReset,
    cls: 'preset reset',
    attrs: { 'aria-label': 'Reset clock (press and hold)' },
  });
  el.double = button('Double', doDouble, 'double');
  el.period = button('', choosePeriod, 'period');
  el.clockCtl = h('div', { class: 'clock-ctl' }, el.p3, el.p1, el.set, el.reset);
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

  el.center = h('div', { class: 'center' }, el.clock, el.clockCtl, el.extra);
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
      title: `Card: ${f.name}`,
      subtitle: `${SIDE_LABEL[s]} · ${cardSummary(f.cards) || 'no cards yet'}`,
      actions: [
        { id: 'yellow', label: carded ? `Yellow → Red (touch to ${opp.name})` : 'Yellow card', cls: 'btn-yellow' },
        { id: 'red', label: `Red card (touch to ${opp.name})`, cls: 'btn-red' },
        {
          id: 'black',
          label: 'Black card: hold to end bout',
          cls: 'btn-black',
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
      actions: [1, 2, 3].map((p) => ({
        id: p,
        label: `Period ${p}${p === b.period ? ' (current)' : ''}`,
        cls: p === b.period ? 'btn-primary' : '',
      })),
    });
    if (choice) dispatch({ type: 'setPeriod', period: choice });
  }

  async function openFormat() {
    await modal((close) => formatSheet(close));
  }

  function formatSheet(close) {
    const body = h('div', { class: 'sheet-body' });
    const seg = (label, options, current, onPick) =>
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, label),
        h(
          'div',
          { class: 'segmented' },
          ...options.map(([v, text]) =>
            button(text, () => onPick(v), v === current ? 'on' : '', { 'aria-pressed': String(v === current) }),
          ),
        ),
      );
    const draw = () => {
      const b = state.bout;
      const custom = b.target !== 5 && b.target !== 15;
      fill(
        body,
        h('h2', {}, 'Bout format'),
        seg(
          'Weapon',
          [
            ['foil', 'Foil'],
            ['epee', 'Épée'],
            ['sabre', 'Sabre'],
          ],
          b.weapon,
          (w) => (dispatch({ type: 'setFormat', weapon: w }), draw()),
        ),
        seg(
          'Touches to win',
          [
            [5, '5 · Poule'],
            [15, '15 · DE'],
            ['custom', custom ? `${b.target} · Custom` : 'Custom…'],
          ],
          custom ? 'custom' : b.target,
          async (v) => {
            if (v === 'custom') {
              const n = await keypad({
                title: 'Touches to win',
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
        ),
        seg(
          'Periods (DE: 3 × 3:00, 1:00 breaks)',
          [
            [false, 'Off'],
            [true, 'On'],
          ],
          b.de,
          (v) => (dispatch({ type: 'setFormat', de: v }), draw()),
        ),
        b.weapon === 'sabre' &&
          seg(
            'Clock in sabre',
            [
              [false, 'Hidden'],
              [true, 'Shown'],
            ],
            b.showTimer,
            (v) => (dispatch({ type: 'setFormat', showTimer: v }), draw()),
          ),
        h(
          'div',
          { class: 'row gap' },
          holdButton('New bout', () => (close(), newBout(), toast('New bout')), {
            cls: 'grow',
            onTap: async () => {
              if (boutInProgress()) {
                const ok = await confirmDialog({
                  title: 'Start a new bout?',
                  message: 'The current score and clock will be cleared.',
                  confirm: 'New bout',
                  danger: true,
                });
                if (!ok) return;
              }
              close();
              newBout();
            },
          }),
          button('Done', () => close(), 'btn-primary grow'),
        ),
        b.pouleRef &&
          state.poules.has(b.pouleRef.pouleId) &&
          button(
            'Poule sheet ›',
            () => (close(), (location.hash = `#poule/${b.pouleRef.pouleId}`)),
            'btn-ghost btn-block',
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
    if (b.status === 'over') {
      mode = 'over';
      const reason = REASON_TEXT[b.reason];
      parts.push(
        h('div', { class: 'banner-title' }, 'Bout over'),
        h('div', { class: `banner-result ${b.winner}` }, resultText(b), reason && h('small', {}, ` (${reason})`)),
        h(
          'div',
          { class: 'row gap' },
          button('↶ Undo', doUndo, 'btn-ghost grow'),
          button('Confirm result', onConfirm, 'btn-primary grow'),
        ),
      );
    } else if (b.status === 'confirmed') {
      mode = 'done';
      const poule = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
      const more = poule && nextBout(poule);
      const pid = poule?.id;
      // Look the poule up again on tap: the result is written after this renders.
      const goNext = () => startNextBout(state.poules.get(pid));
      parts.push(
        h('div', { class: `banner-result ${b.winner}` }, `✓ ${resultText(b)}`),
        poule
          ? h(
              'div',
              { class: 'row gap' },
              button('Poule sheet', () => (location.hash = `#poule/${pid}`), 'btn-ghost grow'),
              more
                ? button('Next bout ▶', goNext, 'btn-primary grow')
                : button('New bout', () => newBout(), 'btn-primary grow'),
            )
          : h(
              'div',
              { class: 'row gap' },
              button('New bout', () => newBout(), 'btn-primary grow'),
            ),
      );
    } else if (b.tiedAtTime) {
      mode = 'time';
      parts.push(
        h('div', { class: 'banner-title' }, `Time — level at ${b.left.score}–${b.right.score}`),
        h('div', { class: 'muted' }, 'One minute of sudden death. Draw priority first.'),
        h(
          'div',
          { class: 'row gap' },
          button('↶ Undo', doUndo, 'btn-ghost'),
          button('Draw priority', drawPriority, 'btn-primary grow'),
        ),
      );
    } else if (b.periodEnded) {
      mode = 'period';
      parts.push(
        h('div', { class: 'banner-title' }, `End of period ${b.period}`),
        h(
          'div',
          { class: 'row gap' },
          button('↶', doUndo, 'btn-ghost', { 'aria-label': 'Undo' }),
          button('1:00 break', () => dispatch({ type: 'startBreak' }), 'grow'),
          button(`Period ${b.period + 1}`, () => dispatch({ type: 'nextPeriod' }), 'btn-primary grow'),
        ),
      );
    }
    const pr = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
    const key = `${mode}|${b.winner}|${b.status}|${b.period}|${b.left.score}-${b.right.score}|${b.left.name}|${b.right.name}|${pr ? progress(pr).done : ''}`;
    if (el.banner.dataset.key === key) return;
    el.banner.dataset.key = key;
    el.banner.hidden = !mode;
    el.banner.className = `banner banner-${mode}`;
    fill(el.banner, ...parts);
  }

  function onConfirm() {
    const poule = confirmBout();
    haptics.win();
    if (poule) toast(`Saved to ${poule.name} (${progress(poule).done}/${progress(poule).total})`);
    else toast('Result saved');
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
    e.name.textContent = f.name;
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
    else if (b.timer.running) status = b.priorityMinute ? 'Priority minute' : b.de ? `Period ${b.period} of 3` : '';
    else if (b.status !== 'active') status = '';
    else if (rem <= 0) status = 'Time';
    else if (rem === b.timer.presetMs && !b.priorityMinute) status = 'Tap to start';
    else status = b.priorityMinute ? 'Priority — tap to resume' : 'Halt — tap to resume';
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
    // The format chip doubles as the poule label for poule bouts.
    const poule = b.pouleRef && state.poules.get(b.pouleRef.pouleId);
    const pb = poule?.bouts.find((x) => x.id === b.pouleRef.boutId);
    fill(
      el.format,
      h(
        'span',
        { class: 'fmt-main' },
        h('b', {}, WEAPON_LABEL[b.weapon]),
        ` · ${b.target}`,
        h('span', { class: 'chev' }, ' ▾'),
      ),
      ...(poule ? [h('span', { class: 'fmt-sub' }, `${poule.name} · bout ${pb?.n ?? '?'}/${poule.bouts.length}`)] : []),
    );
    el.undo.disabled = !b.history.length || b.status === 'confirmed';
    el.swap.disabled = b.status === 'confirmed';
    renderSide(b, 'left');
    renderSide(b, 'right');
    renderClock(b);
    const showClock = b.showTimer;
    el.clock.hidden = !showClock;
    el.clockCtl.hidden = !showClock;
    const timerBusy = b.timer.running;
    el.set.disabled = timerBusy || b.status !== 'active';
    el.p3.disabled = el.p1.disabled = timerBusy || b.status !== 'active';
    el.reset.disabled = timerBusy;
    el.clock.disabled = b.status !== 'active' || b.tiedAtTime || b.periodEnded;
    el.double.hidden = b.weapon !== 'epee';
    el.double.disabled = b.status !== 'active';
    el.period.hidden = !b.de;
    el.period.textContent = `Period ${b.period}/3`;
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
    if (evt.type === 'bout' || evt.type === 'poules' || evt.type === 'tab') render();
  });
  render();
  return { render };
}
