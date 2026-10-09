// Settings / data menu, reachable from the ⋯ button on both tabs.

import { h, fill, button, modal, toast, download, confirmDialog } from './dom.js';
import { state, setSetting, exportBackup, importBackup } from '../state.js';
import { setHapticsEnabled, haptics } from './device.js';

export const APP_VERSION = '1.1.0';

export function applyTheme(theme = state.settings.theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0b0d10');
}

export function openSettings() {
  return modal((close) => {
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
            button(text, () => (onPick(v), draw()), v === current ? 'on' : '', {
              'aria-pressed': String(v === current),
            }),
          ),
        ),
      );
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const ok = await confirmDialog({
          title: 'Import backup?',
          message: `${data.poules?.length ?? 0} poules, ${data.fencers?.length ?? 0} fencers. Records with the same id are replaced; nothing else is deleted.`,
          confirm: 'Import',
        });
        if (!ok) return;
        const counts = await importBackup(data);
        toast(`Imported ${counts.poules} poules, ${counts.fencers} fencers`);
        close();
      } catch (e) {
        toast(`Import failed: ${e.message}`);
      } finally {
        fileInput.value = '';
      }
    });
    const draw = () => {
      fill(
        body,
        h('h2', {}, 'Settings'),
        seg(
          'Theme',
          [
            ['dark', 'Dark'],
            ['light', 'Light'],
          ],
          state.settings.theme,
          (v) => {
            setSetting('theme', v);
            applyTheme(v);
          },
        ),
        seg(
          'Vibration',
          [
            [true, 'On'],
            [false, 'Off'],
          ],
          state.settings.haptics,
          (v) => {
            setSetting('haptics', v);
            setHapticsEnabled(v);
            haptics.tap();
          },
        ),
        h(
          'div',
          { class: 'field' },
          h('div', { class: 'field-label' }, 'Your data'),
          h(
            'p',
            { class: 'muted small' },
            'Everything is stored on this device only (except poules you share with a code). Export a backup now and then, or to move to another phone.',
          ),
          h(
            'div',
            { class: 'row gap' },
            button(
              'Export backup',
              async () => {
                const data = await exportBackup();
                const stamp = new Date().toISOString().slice(0, 10);
                download(
                  `piste-backup-${stamp}.json`,
                  new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }),
                );
              },
              'grow',
            ),
            button('Import backup', () => fileInput.click(), 'grow'),
          ),
        ),
        fileInput,
        h('p', { class: 'muted small center' }, `Piste ${APP_VERSION} · works offline`),
        button('Done', () => close(), 'btn-primary btn-block'),
      );
    };
    draw();
    return body;
  });
}
