// QR code as an SVG element (dark modules on white, with the quiet zone
// scanners need). Uses the vendored qrcode-generator library.

import qrcode from '../vendor/qrcode.js';

const NS = 'http://www.w3.org/2000/svg';

export function qrSvg(text, { ecc = 'M', margin = 4, label = 'QR code' } = {}) {
  const q = qrcode(0, ecc);
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}
