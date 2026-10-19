// The app's chrome: the bottom tab bar (Fence · Book · About) and, above it,
// the row of modes for the current tab (Scorer · Poules · Teams, or
// Sessions · Admin), with the transitions between them.

import { h, icon } from './dom.js';

export const TABS = [
  {
    id: 'fence',
    label: 'Fence',
    icon: 'fencing',
    modes: [
      ['bout', 'Scorer'],
      ['poules', 'Poules'],
      ['teams', 'Teams'],
    ],
  },
  {
    id: 'book',
    label: 'Book',
    icon: 'calendar',
    modes: null, // Admin is a button at the top of Book
  },
  { id: 'about', label: 'About', icon: 'info', modes: null },
];

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Slide and fade a newly shown element in (dir: -1 from the left, 1 from the right, 0 from below). */
export function reveal(el, dir = 0) {
  if (!el || reduced() || !el.animate) return;
  const from = dir ? `translateX(${dir * 28}px)` : 'translateY(10px)';
  el.animate(
    [
      { opacity: 0, transform: from },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 280, easing: EASE },
  );
}

/**
 * Build the tab bar and mode rows. onTab(id) when a tab is tapped,
 * onMode(mode) when a mode is tapped. Returns { set(tab, mode) } to
 * reflect the current route.
 */
export function mountShell({ onTab, onMode }) {
  const bar = document.querySelector('.tabbar');
  const slot = document.querySelector('.modebar-slot');
  const indicator = h('span', { class: 'tab-indicator', 'aria-hidden': 'true' }, h('span', {}));
  const tabButtons = TABS.map((t) =>
    h(
      'button',
      { type: 'button', 'data-main': t.id, 'aria-current': 'false', onClick: () => onTab(t.id) },
      h('span', { class: 'tab-icon' }, icon(t.icon)),
      h('span', { class: 'tab-label' }, t.label),
    ),
  );
  bar.replaceChildren(indicator, ...tabButtons);

  const modebars = new Map();
  for (const t of TABS.filter((x) => x.modes)) {
    const thumb = h('span', { class: 'mode-thumb', 'aria-hidden': 'true' });
    const el = h(
      'div',
      {
        class: 'modebar',
        role: 'tablist',
        'aria-label': `${t.label} modes`,
        'data-for': t.id,
        style: { '--n': t.modes.length },
        hidden: true,
      },
      thumb,
      ...t.modes.map(([id, label]) =>
        h(
          'button',
          { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': 'false', onClick: () => onMode(id) },
          label,
        ),
      ),
    );
    modebars.set(t.id, el);
    slot.append(el);
  }

  let current = null;
  return {
    set(tab, mode) {
      const i = TABS.findIndex((t) => t.id === tab);
      bar.style.setProperty('--i', i);
      tabButtons.forEach((b, k) => {
        const on = k === i;
        if (on && b.getAttribute('aria-current') !== 'true' && current && !reduced()) {
          b.querySelector('.tab-icon').animate(
            [
              { transform: 'scale(1)' },
              { transform: 'scale(0.82)' },
              { transform: 'scale(1.12)' },
              { transform: 'scale(1)' },
            ],
            { duration: 420, easing: 'ease-out' },
          );
        }
        b.setAttribute('aria-current', String(on));
      });
      for (const [id, el] of modebars) {
        const show = id === tab;
        if (show && el.hidden && current) reveal(el, 0);
        el.hidden = !show;
        if (!show) continue;
        const modes = TABS.find((t) => t.id === id).modes;
        const k = Math.max(
          0,
          modes.findIndex(([m]) => m === mode),
        );
        el.style.setProperty('--i', k);
        el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === mode)));
      }
      slot.classList.toggle('no-modes', !modebars.has(tab));
      current = tab;
    },
  };
}
