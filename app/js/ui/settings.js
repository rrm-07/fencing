// Settings, reachable from the ⋯ button on both tabs.

import {
  h,
  fill,
  modal,
  toast,
  download,
  confirmDialog,
  sheetNav,
  group,
  row,
  tile,
  segmented,
  toggle,
} from './dom.js';
import { state, setSetting, exportBackup, importBackup } from '../state.js';
import { setHapticsEnabled, haptics } from './device.js';

export const APP_VERSION = '2.0.0';

const systemDark = () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;

/** 'dark' | 'light' | 'system' → applied to <html data-theme>. */
export function applyTheme(theme = state.settings.theme) {
  const resolved = theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#f2f2f7' : '#000000');
}
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (state.settings.theme === 'system') applyTheme();
});

export function openSettings() {
  return modal((close) => {
    const body = h('div', { class: 'sheet-body' });
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const ok = await confirmDialog({
          title: 'Import Backup?',
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
        sheetNav({ title: 'Settings', right: { label: 'Done', bold: true, onClick: () => close() } }),
        group(
          { header: 'Appearance' },
          segmented(
            [
              ['system', 'Automatic'],
              ['dark', 'Dark'],
              ['light', 'Light'],
            ],
            state.settings.theme,
            (v) => {
              setSetting('theme', v);
              applyTheme(v);
              draw();
            },
            'Appearance',
          ),
        ),
        group(
          { footer: 'Buzzes on touches, at 10 seconds and at time. Not available on iPhone.' },
          row({
            lead: tile('bolt', 'orange'),
            title: 'Vibration',
            trailing: toggle(
              state.settings.haptics !== false,
              (v) => {
                setSetting('haptics', v);
                setHapticsEnabled(v);
                haptics.tap();
              },
              'Vibration',
            ),
          }),
        ),
        group(
          {
            header: 'Your Data',
            footer:
              'Everything is stored on this device, except poules you share with a code. Export a backup now and then, or to move to another phone.',
          },
          row({
            lead: tile('share', 'blue'),
            title: 'Export Backup',
            chevron: true,
            onClick: async () => {
              const data = await exportBackup();
              const stamp = new Date().toISOString().slice(0, 10);
              download(
                `piste-backup-${stamp}.json`,
                new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }),
              );
            },
          }),
          row({
            lead: tile('download', 'green'),
            title: 'Import Backup',
            chevron: true,
            onClick: () => fileInput.click(),
          }),
        ),
        fileInput,
        h('p', { class: 'group-footer', style: { textAlign: 'center' } }, `UCL Fencing ${APP_VERSION} · Works offline`),
      );
    };
    draw();
    return body;
  });
}
