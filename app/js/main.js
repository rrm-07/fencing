// Entry point: load data, mount views, route between tabs, register the
// service worker.

import { state, load, subscribe } from './state.js';
import { mountBoutView } from './ui/boutView.js';
import { mountPoulesView, joinFlow } from './ui/pouleView.js';
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
  const bout = mountBoutView(boutRoot);
  const poules = mountPoulesView(poulesRoot);
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
    closeAllModals();
    if (document.body.dataset.tab !== tab) clearToast();
    document.body.dataset.tab = tab;
    boutRoot.hidden = tab !== 'bout';
    poulesRoot.hidden = tab !== 'poules';
    tabs.forEach((t) => t.setAttribute('aria-current', String(t.dataset.tab === tab)));
    if (tab === 'poules') poules.show(sub);
    bout.render();
    if (joinCode) joinFlow(joinCode);
  }

  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      if (t.dataset.tab === 'bout') location.hash = '#bout';
      else {
        // Return to the poule you were last looking at, if any.
        const last = sessionStorage.getItem('piste:lastPoule');
        location.hash =
          last && state.poules.has(last) && document.body.dataset.tab !== 'poules' ? `#poule/${last}` : '#poules';
      }
    }),
  );
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#poule\/(.+)$/);
    try {
      if (m) sessionStorage.setItem('piste:lastPoule', decodeURIComponent(m[1]));
      else if (location.hash === '#poules') sessionStorage.removeItem('piste:lastPoule');
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
  // Only reload for an update the user accepted, never on the first install.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of Piste is ready', {
              action: 'Reload',
              ms: 15000,
              onAction: () => w.postMessage('skipWaiting'),
            });
          }
        });
      });
    })
    .catch((e) => console.warn('SW registration failed', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view-bout').textContent = `Piste failed to start: ${e.message}`;
});

// Exposed for debugging and end-to-end tests.
window.__piste = { state, button };
