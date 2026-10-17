// Entry point: load data, mount views, route between tabs, register the
// service worker.

import { state, load, subscribe } from './state.js';
import { mountBoutView } from './ui/boutView.js';
import { mountPoulesView, joinFlow } from './ui/pouleView.js';
import { mountTeamsView } from './ui/teamView.js';
import { startSync } from './sync.js';
import { applyTheme } from './ui/settings.js';
import { setHapticsEnabled, vibrate } from './ui/device.js';
import { closeAllModals, clearToast, setHaptic, toast, button } from './ui/dom.js';

async function boot() {
  await load();
  applyTheme();
  setHapticsEnabled(state.settings.haptics !== false);
  setHaptic(vibrate);

  const boutRoot = document.getElementById('view-bout');
  const poulesRoot = document.getElementById('view-poules');
  const teamsRoot = document.getElementById('view-teams');
  const bout = mountBoutView(boutRoot);
  const poules = mountPoulesView(poulesRoot);
  const teams = mountTeamsView(teamsRoot);
  const tabs = document.querySelectorAll('.tabbar [data-tab]');

  function route() {
    const hash = location.hash.replace(/^#/, '');
    let tab = 'bout';
    let sub = { view: 'list' };
    let joinCode = null;
    if (hash.startsWith('join/')) {
      // A shared link: piste/#join/K7QM4X
      tab = 'poules';
      joinCode = decodeURIComponent(hash.slice(5));
      history.replaceState(null, '', '#poules');
    } else if (hash.startsWith('poule/')) {
      tab = 'poules';
      sub = { view: 'sheet', id: decodeURIComponent(hash.slice(6)) };
    } else if (hash === 'poules/new') {
      tab = 'poules';
      sub = { view: 'new' };
    } else if (hash.startsWith('poules')) tab = 'poules';
    else if (hash.startsWith('fixture/')) {
      tab = 'teams';
      sub = { view: 'fixture', id: decodeURIComponent(hash.slice(8)) };
    } else if (hash.startsWith('team/')) {
      tab = 'teams';
      sub = { view: 'match', id: decodeURIComponent(hash.slice(5)) };
    } else if (hash === 'teams/new') {
      tab = 'teams';
      sub = { view: 'new' };
    } else if (hash.startsWith('teams')) tab = 'teams';
    closeAllModals();
    if (document.body.dataset.tab !== tab) clearToast();
    document.body.dataset.tab = tab;
    boutRoot.hidden = tab !== 'bout';
    poulesRoot.hidden = tab !== 'poules';
    teamsRoot.hidden = tab !== 'teams';
    tabs.forEach((t) => t.setAttribute('aria-current', String(t.dataset.tab === tab)));
    if (tab === 'poules') poules.show(sub);
    if (tab === 'teams') teams.show(sub);
    bout.render();
    if (joinCode) joinFlow(joinCode);
  }

  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      if (t.dataset.tab === 'bout') location.hash = '#bout';
      else if (t.dataset.tab === 'teams') {
        const last = sessionStorage.getItem('piste:lastMatch');
        location.hash =
          last && state.matches.has(last) && document.body.dataset.tab !== 'teams' ? `#team/${last}` : '#teams';
      } else {
        // Return to the poule you were last looking at, if any.
        const last = sessionStorage.getItem('piste:lastPoule');
        location.hash =
          last && state.poules.has(last) && document.body.dataset.tab !== 'poules' ? `#poule/${last}` : '#poules';
      }
    }),
  );
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#poule\/(.+)$/);
    const t = location.hash.match(/^#team\/(.+)$/);
    try {
      if (m) sessionStorage.setItem('piste:lastPoule', decodeURIComponent(m[1]));
      else if (location.hash === '#poules') sessionStorage.removeItem('piste:lastPoule');
      if (t) sessionStorage.setItem('piste:lastMatch', decodeURIComponent(t[1]));
      else if (location.hash === '#teams') sessionStorage.removeItem('piste:lastMatch');
    } catch {
      /* storage blocked */
    }
    route();
  });
  subscribe((evt) => evt.type === 'settings' && applyTheme());
  route();
  startSync();
  document.body.classList.add('ready');
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // Installed apps are often resumed rather than relaunched, so also look
      // for a new version whenever Piste comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      // Older versions left the new one waiting: let it take over.
      if (reg.waiting && hadController) reg.waiting.postMessage('skipWaiting');
    })
    .catch((e) => console.warn('SW registration failed', e));

  // A new version has taken over. Reload into it now, unless that would
  // interrupt a running clock or an open dialog: then wait for a quiet moment.
  let reloaded = false;
  const reloadWhenIdle = () => {
    if (reloaded) return;
    const busy = state.bout?.timer.running || document.querySelector('.modal-wrap');
    if (busy) {
      toast('Piste has been updated', { action: 'Reload', ms: 10000, onAction: () => location.reload() });
      setTimeout(reloadWhenIdle, 15000);
      return;
    }
    reloaded = true;
    location.reload();
  };
  // The first install also "changes" the controller (from none): don't reload
  // for that, only when one version replaces another.
  let controlled = hadController;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) reloadWhenIdle();
    controlled = true;
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view-bout').textContent = `Piste failed to start: ${e.message}`;
});

// Exposed for debugging and end-to-end tests.
window.__piste = { state, button };
