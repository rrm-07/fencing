// Entry point: load data, mount views, route between tabs, register the
// service worker.

import { state, load, subscribe, exportBackup, importBackup, boutInProgress } from './state.js';
import { movedAway, homeReady, receiveMove, goHome, moveHome, localData, homeUrl } from './move.js';
import { mountBoutView } from './ui/boutView.js';
import { mountPoulesView, joinFlow } from './ui/pouleView.js';
import { mountTeamsView } from './ui/teamView.js';
import { startSync, setSyncActive } from './sync.js';
import { applyTheme } from './ui/settings.js';
import { setHapticsEnabled, vibrate } from './ui/device.js';
import { closeAllModals, clearToast, setHaptic, toast, button, confirmDialog } from './ui/dom.js';
import { mountShell, reveal, TABS } from './ui/shell.js';
import { mountAboutView } from './ui/aboutView.js';
import { haptics } from './ui/device.js';

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
  if (moved?.page === 'book') {
    // The booking page now lives in the app: /book/#checkin/… → /#checkin/…
    const h = moved.hash ?? '';
    history.replaceState(null, '', h.startsWith('#checkin/') ? h : '#book');
  }
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
  const bookRoot = document.getElementById('book');
  const adminRoot = document.getElementById('view-admin');
  const aboutRoot = document.getElementById('view-about');
  const sections = Object.fromEntries(TABS.map((t) => [t.id, document.getElementById(`tab-${t.id}`)]));
  const bout = mountBoutView(boutRoot);
  const poules = mountPoulesView(poulesRoot);
  const teams = mountTeamsView(teamsRoot);
  const about = mountAboutView(aboutRoot);
  let book = null; // the booking module, loaded on first visit
  const loadBook = async () => {
    book ??= await import('../book/book.js');
    await book.start();
    return book;
  };

  const store = {
    get: (k) => {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (v == null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
  };
  const order = { bout: 0, poules: 1, teams: 2, book: 3, admin: 4, about: 5 };
  let shown = null; // the mode on screen

  const shell = mountShell({
    onTab(tab) {
      haptics.tap();
      const here = document.body.dataset.main === tab;
      if (tab === 'about') location.hash = '#about';
      else if (tab === 'book') location.hash = here ? '#book' : (store.get('piste:lastBook') ?? '#book');
      else if (here)
        location.hash = `#${document.body.dataset.tab}`; // tap again: back to the top of the mode
      else location.hash = store.get('piste:lastFence') ?? '#bout';
    },
    onMode(mode) {
      haptics.tap();
      if (mode === 'bout') location.hash = '#bout';
      else if (mode === 'book') location.hash = '#book';
      else if (mode === 'admin') location.hash = '#book/admin';
      else if (mode === 'teams') {
        const last = store.get('piste:lastMatch');
        location.hash =
          last && state.matches.has(last) && document.body.dataset.tab !== 'teams' ? `#team/${last}` : '#teams';
      } else {
        // Return to the poule you were last looking at, if any.
        const last = store.get('piste:lastPoule');
        location.hash =
          last && state.poules.has(last) && document.body.dataset.tab !== 'poules' ? `#poule/${last}` : '#poules';
      }
    },
  });

  function route() {
    const hash = location.hash.replace(/^#/, '');
    let mode = 'bout';
    let sub = { view: 'list' };
    let joinCode = null;
    if (hash.startsWith('join/')) {
      // A shared link: uclfencing.com/#join/K7QM4X
      mode = 'poules';
      joinCode = decodeURIComponent(hash.slice(5));
      history.replaceState(null, '', '#poules');
    } else if (hash.startsWith('poule/')) {
      mode = 'poules';
      sub = { view: 'sheet', id: decodeURIComponent(hash.slice(6)) };
    } else if (hash.startsWith('poules/tableau')) {
      mode = 'poules';
      sub = { view: 'newTableau', from: decodeURIComponent(hash.split('/')[2] ?? '') || null };
    } else if (hash === 'poules/new') {
      mode = 'poules';
      sub = { view: 'new' };
    } else if (hash.startsWith('poules')) mode = 'poules';
    else if (hash.startsWith('fixture/')) {
      mode = 'teams';
      sub = { view: 'fixture', id: decodeURIComponent(hash.slice(8)) };
    } else if (hash.startsWith('team/')) {
      mode = 'teams';
      sub = { view: 'match', id: decodeURIComponent(hash.slice(5)) };
    } else if (hash === 'teams/new') {
      mode = 'teams';
      sub = { view: 'new' };
    } else if (hash.startsWith('teams')) mode = 'teams';
    else if (hash === 'book/admin' || hash === 'organiser') mode = 'admin';
    else if (hash.startsWith('book') || hash.startsWith('checkin/')) mode = 'book';
    else if (hash === 'about') mode = 'about';
    const tab = mode === 'book' || mode === 'admin' ? 'book' : mode === 'about' ? 'about' : 'fence';

    closeAllModals();
    if (document.body.dataset.tab !== mode) clearToast();
    const before = shown;
    document.body.dataset.tab = mode;
    document.body.dataset.main = tab;
    for (const [id, el] of Object.entries(sections)) el.hidden = id !== tab;
    boutRoot.hidden = mode !== 'bout';
    poulesRoot.hidden = mode !== 'poules';
    teamsRoot.hidden = mode !== 'teams';
    bookRoot.hidden = mode !== 'book';
    adminRoot.hidden = mode !== 'admin';
    shell.set(tab, mode);
    if (mode === 'poules') poules.show(sub);
    if (mode === 'teams') teams.show(sub);
    // Keep live streams (one connection each) to the tab on screen.
    if (mode === 'about') about.show();
    else about.hide();
    setSyncActive(tab === 'fence');
    if (tab !== 'book') book?.pause();
    if (tab === 'book')
      loadBook()
        .then((b) => {
          if (document.body.dataset.main !== 'book') return;
          b.resume();
          if (mode === 'admin') b.showAdmin(adminRoot);
          else b.showSessions();
        })
        .catch((e) => toast(e.message));
    bout.render();
    if (joinCode) joinFlow(joinCode);
    // Slide the new screen in from the side it sits on.
    if (before && before !== mode) {
      const el = { bout: boutRoot, poules: poulesRoot, teams: teamsRoot, book: bookRoot, admin: adminRoot }[mode];
      reveal(el ?? sections[tab], Math.sign(order[mode] - order[before]));
    }
    shown = mode;
    if (tab === 'fence') store.set('piste:lastFence', `#${hash || 'bout'}`);
    if (tab === 'book' && !hash.startsWith('checkin/')) store.set('piste:lastBook', `#${hash}`);
  }

  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#poule\/(.+)$/);
    const t = location.hash.match(/^#team\/(.+)$/);
    if (m) store.set('piste:lastPoule', decodeURIComponent(m[1]));
    else if (location.hash === '#poules') store.set('piste:lastPoule', null);
    if (t) store.set('piste:lastMatch', decodeURIComponent(t[1]));
    else if (location.hash === '#teams') store.set('piste:lastMatch', null);
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
    title: 'We’ve Moved',
    message: `The app now lives at ${host}. Move this phone’s poules, team matches and training bookings there? Shared poules keep working either way.`,
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
