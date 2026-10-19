// Entry point: load data, mount views, route between tabs, register the
// service worker.

import { state, load, subscribe, exportBackup, importBackup, boutInProgress } from './state.js';
import { movedAway, homeReady, receiveMove, goHome, moveHome, localData, homeUrl } from './move.js';
import { mountBoutView } from './ui/boutView.js';
import { mountPoulesView, joinFlow } from './ui/pouleView.js';
import { mountTeamsView } from './ui/teamView.js';
import { startSync } from './sync.js';
import { applyTheme } from './ui/settings.js';
import { setHapticsEnabled, vibrate } from './ui/device.js';
import { closeAllModals, clearToast, setHaptic, toast, button, confirmDialog } from './ui/dom.js';

const MOVED = 'piste:moved'; // on an old address: what has been moved ('all' | 'book')

async function boot() {
  // Arriving at the new address with data from the old one.
  const moved = await receiveMove();
  await load();
  if (moved?.backup) {
    const counts = await importBackup(moved.backup);
    const n = (counts.poules ?? 0) + (counts.matches ?? 0);
    setTimeout(
      () =>
        toast(
          n
            ? `Moved ${n} poule${n === 1 ? '' : 's'} and match${n === 1 ? '' : 'es'} to this address`
            : 'Moved to this address',
          { ms: 4000 },
        ),
      600,
    );
  }
  if (moved?.page === 'book') return location.replace(`book/${moved.hash ?? ''}`);
  // On an old address: send people on (with their data if there is any).
  if (movedAway() && (await homeReady())) {
    const hasData =
      state.poules.size ||
      state.matches.size ||
      state.roster.length ||
      boutInProgress() ||
      Object.keys(localData()).length;
    if (!hasData || localStorage.getItem(MOVED) === 'all') return goHome('app');
    setTimeout(() => offerMove(), 400);
  }
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
    } else if (hash.startsWith('poules/tableau')) {
      tab = 'poules';
      sub = { view: 'newTableau', from: decodeURIComponent(hash.split('/')[2] ?? '') || null };
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

async function offerMove() {
  const host = new URL(homeUrl()).host;
  const ok = await confirmDialog({
    title: 'Piste Has Moved',
    message: `Piste now lives at ${host}. Move this phone’s poules, team matches and training bookings there? Shared poules keep working either way.`,
    confirm: 'Move My Data',
    cancel: 'Not Now',
  });
  if (!ok) return;
  const backup = await exportBackup();
  try {
    localStorage.setItem(MOVED, 'all');
  } catch {
    /* storage blocked */
  }
  await moveHome({ page: 'app', backup: { ...backup, bouts: [] } }); // the free-bout log stays behind
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
