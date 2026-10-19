// A small set of line icons in the spirit of SF Symbols (24×24, currentColor).

const P = {
  chevronLeft: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  chevronRight: '<path d="m9 4.5 7.5 7.5L9 19.5"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  ellipsis:
    '<circle cx="12" cy="12" r="9.5"/><circle cx="7.6" cy="12" r="1.2" class="f"/><circle cx="12" cy="12" r="1.2" class="f"/><circle cx="16.4" cy="12" r="1.2" class="f"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  swap: '<path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5M20 16H5m3.5-3.5L5 16l3.5 3.5"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 7.5 3 3"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/>',
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" class="f"/>',
  pause:
    '<rect x="6" y="4.5" width="4" height="15" rx="1.2" class="f"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" class="f"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4.5h4.5"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>',
  swords:
    '<path d="M4 4l10.5 10.5M4 4v3.2L13.3 16.5M4 4h3.2l9.3 9.3"/><path d="m13 18 5-5M16 20l4-4M18 18l2.5 2.5"/><path d="M20 4l-6.5 6.5M20 4v3.2l-4 4M20 4h-3.2l-4 4"/><path d="m11 18-5-5M8 20l-4-4M6 18l-2.5 2.5"/>',
  share:
    '<path d="M12 3.5V15M8 7.5l4-4 4 4"/><path d="M7.5 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>',
  download: '<path d="M12 3.5V15M8 11l4 4 4-4"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  doc: '<path d="M6.5 3.5h7l4.5 4.5v12.5h-11.5Z"/><path d="M13.5 3.5V8H18M9 13h6M9 16.5h6"/>',
  photo:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14.5h10v6H7Z"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4h5v3"/>',
  copy: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5"/><path d="M16 8V5.5A2 2 0 0 0 14 3.5H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8"/>',
  people:
    '<circle cx="9" cy="8" r="3.3"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.3.2 4 1.6 4.5 4.4"/>',
  shuffle:
    '<path d="M3.5 7H7l10 10h3.5M3.5 17H7l3-3M14 10l3-3h3.5"/><path d="m18 4.5 2.5 2.5L18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  arrowUp: '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10" class="f"/><path d="m7.5 12.3 3 3 6-6.3" class="knock"/>',
  minusCircle: '<circle cx="12" cy="12" r="10" class="f"/><path d="M7.5 12h9" class="knock"/>',
  plusCircle: '<circle cx="12" cy="12" r="10" class="f"/><path d="M12 7.5v9M7.5 12h9" class="knock"/>',
  xmark: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
  card: '<rect x="6" y="3" width="12" height="18" rx="2.5" class="f"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  deleteLeft: '<path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12Z"/><path d="m11 9.5 5 5m0-5-5 5"/>',
  trophy:
    '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4v1.5a3.5 3.5 0 0 0 3.5 3.5M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v3.5M8.5 20.5h7M10 17.5h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.8"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z" class="f"/>',
  // Foil, épée and sabre crossed (the Fence tab).
  fencing:
    '<g stroke-width="1.5"><path d="M2.5 2.5 17.6 17.6M21.5 2.5 6.4 17.6M12 1.5v16.3"/><path d="m16.2 19.2 3-3M7.8 19.2l-3-3"/><path d="m18.6 18.6 2.6 2.6M5.4 18.6l-2.6 2.6"/><path d="M12 20.4v2.3"/></g><path d="M9.7 17.9h4.6a2.3 2.5 0 0 1-4.6 0Z" class="f"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M8 17h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" class="f"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9c-2.6-2.5-3.8-5.5-3.8-9S9.4 5.5 12 3Z"/>',
  instagram:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" class="f"/>',
  tiktok: '<path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8"/><path d="M14 3.5c.4 2.6 2.3 4.4 5 4.6"/>',
  whatsapp:
    '<path d="M4.2 19.8 5.3 16A8.3 8.3 0 1 1 8.2 19z"/><path d="M9.2 8.6c-.3.9.1 2.4 1.5 3.9s2.9 2.1 3.9 1.8l.7-1.2-1.7-1-.9.6c-.6-.3-1.3-1-1.7-1.7l.6-.9-1-1.7Z" class="f"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
};

const NS = 'http://www.w3.org/2000/svg';

/** <svg> icon element. `cls` adds classes (e.g. 'i-lg'). */
export function icon(name, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.innerHTML = P[name] ?? '';
  return svg;
}
