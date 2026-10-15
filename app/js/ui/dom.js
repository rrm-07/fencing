// UI kit: element builder plus iOS-style components (grouped lists, switches,
// segmented controls, alerts, action sheets, sheets, keypad, HUD toasts and
// press-and-hold buttons). No framework, no hover-dependent UI.

import { icon } from './icons.js';

export { icon };

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** replaceChildren that, like h(), skips null/false children (for `cond && node`). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function button(label, onClick, cls = '', attrs = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onClick, ...attrs }, label);
}

/** Round icon button (toolbar style). */
export function iconButton(name, onClick, label, cls = '', attrs = {}) {
  return button(icon(name), onClick, `icon-btn ${cls}`, { 'aria-label': label, ...attrs });
}

/* ---------- grouped lists ---------- */

/** An inset grouped section, like iOS Settings. */
export function group({ header, footer, cls = '', headerAction } = {}, ...rows) {
  return h(
    'section',
    { class: `group-wrap ${cls}`.trim() },
    (header || headerAction) && h('div', { class: 'group-header' }, h('span', {}, header), headerAction),
    h('div', { class: 'group' }, ...rows),
    footer && h('div', { class: 'group-footer' }, footer),
  );
}

/**
 * A list row. With onClick it is a button; `chevron` adds a disclosure arrow.
 *   lead      node shown on the left (icon tile, number, …)
 *   title     main label;  subtitle  smaller line under it
 *   detail    secondary text on the right;  trailing  node on the right
 *   tone      'accent' | 'danger' for action rows
 */
export function row({ lead, title, subtitle, detail, trailing, chevron, onClick, tone, cls = '', attrs = {} }) {
  const body = [
    lead && h('span', { class: 'row-lead' }, lead),
    h(
      'span',
      { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      subtitle && h('span', { class: 'row-sub' }, subtitle),
    ),
    detail != null && detail !== '' && h('span', { class: 'row-detail' }, detail),
    trailing,
    chevron && icon('chevronRight', 'row-chev'),
  ];
  const c = `row ${tone ? `tone-${tone}` : ''} ${cls}`.trim();
  return onClick
    ? h('button', { type: 'button', class: `${c} tappable`, onClick, ...attrs }, ...body)
    : h('div', { class: c, ...attrs }, ...body);
}

/** Coloured rounded-square icon tile used as a row lead. */
export const tile = (name, color) => h('span', { class: `tile tile-${color}` }, icon(name));

/** iOS switch. */
export function toggle(checked, onChange, label) {
  const el = h(
    'button',
    { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(checked), 'aria-label': label },
    h('span', { class: 'switch-thumb' }),
  );
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return el;
}

/** iOS segmented control. options: [[value, label], …]. */
export function segmented(options, current, onPick, label = '') {
  const idx = Math.max(
    0,
    options.findIndex(([v]) => v === current),
  );
  return h(
    'div',
    {
      class: 'segmented',
      role: 'group',
      'aria-label': label || null,
      style: { '--n': options.length, '--i': idx },
    },
    h('span', { class: `seg-thumb${options.some(([v]) => v === current) ? '' : ' none'}` }),
    ...options.map(([v, text]) =>
      h(
        'button',
        {
          type: 'button',
          class: v === current ? 'on' : '',
          'aria-pressed': String(v === current),
          onClick: () => onPick(v),
        },
        text,
      ),
    ),
  );
}

/* ---------- toasts (top HUD pill) ---------- */

let toastTimer;
export function clearToast() {
  clearTimeout(toastTimer);
  $('#toast-root')?.replaceChildren();
}

export function toast(message, { action, onAction, ms = action ? 4000 : 2200 } = {}) {
  const root = $('#toast-root');
  root.replaceChildren();
  const el = h(
    'div',
    { class: `toast${action ? ' has-action' : ''}`, role: 'status' },
    h('span', {}, message),
    action &&
      button(
        action,
        () => {
          root.replaceChildren();
          onAction?.();
        },
        'toast-action',
      ),
  );
  root.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }, ms);
}

/* ---------- modal layer ---------- */

const stack = [];

/**
 * Open a modal. `build(close)` returns the content node. Returns a promise
 * resolved with whatever is passed to close(). Tapping the backdrop or
 * Escape closes with `undefined`.
 * kind: 'sheet' (bottom sheet) | 'alert' (centred) | 'action' (iOS action sheet)
 */
export function modal(build, { kind = 'sheet', dismissable = true, cls = '' } = {}) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      wrap.classList.add('closing');
      wrap.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(close), 1);
      setTimeout(() => wrap.remove(), 220);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable && stack[stack.length - 1] === close) close(undefined);
    };
    const panel = h('div', { class: `modal-panel ${kind} ${cls}`, role: 'dialog', 'aria-modal': 'true' });
    const wrap = h('div', { class: `modal-wrap ${kind}` }, panel);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && dismissable) close(undefined);
    });
    if (kind === 'sheet') panel.append(h('div', { class: 'grabber', 'aria-hidden': 'true' }));
    panel.append(build(close));
    root.append(wrap);
    stack.push(close);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        wrap.classList.add('open');
        panel.querySelector('[autofocus]')?.focus();
      }),
    );
  });
}

export const closeAllModals = () => [...stack].reverse().forEach((c) => c(undefined));
export const modalOpen = () => stack.length > 0;

/** Sheet navigation bar: [left]  Title  [right]. */
export function sheetNav({ title, left, right }) {
  const side = (b, cls) =>
    b
      ? button(b.label, b.onClick, `nav-text ${b.bold ? 'bold' : ''} ${cls}`, {
          disabled: b.disabled ?? false,
          ...(b.attrs ?? {}),
        })
      : h('span', { class: `nav-spacer ${cls}` });
  return h(
    'header',
    { class: 'sheet-nav' },
    side(left, 'l'),
    h('h2', { class: 'sheet-title' }, title),
    side(right, 'r'),
  );
}

/* ---------- alerts ---------- */

function alertButtons(buttons) {
  return h('div', { class: `alert-actions${buttons.length > 2 ? ' stacked' : ''}` }, ...buttons);
}

export function confirmDialog({ title, message = '', confirm = 'OK', cancel = 'Cancel', danger = false }) {
  return modal(
    (close) =>
      h(
        'div',
        { class: 'alert' },
        h('div', { class: 'alert-body' }, h('h2', {}, title), message && h('p', {}, message)),
        alertButtons([
          button(cancel, () => close(false), 'alert-btn'),
          button(confirm, () => close(true), `alert-btn bold ${danger ? 'danger' : ''}`),
        ]),
      ),
    { kind: 'alert' },
  ).then((v) => v === true);
}

/**
 * Alert with several stacked choices. buttons: [{ id, label, tone?: 'danger', bold? }]
 * A Cancel button is added last. Resolves with the chosen id, or null.
 */
export function choiceDialog({ title, message = '', buttons }) {
  return modal(
    (close) =>
      h(
        'div',
        { class: 'alert' },
        h('div', { class: 'alert-body' }, h('h2', {}, title), message && h('p', {}, message)),
        h(
          'div',
          { class: 'alert-actions stacked' },
          ...buttons.map((b) =>
            button(
              b.label,
              () => close(b.id),
              `alert-btn ${b.bold ? 'bold' : ''} ${b.tone === 'danger' ? 'danger' : ''}`,
            ),
          ),
          button('Cancel', () => close(null), 'alert-btn bold'),
        ),
      ),
    { kind: 'alert' },
  ).then((v) => v ?? null);
}

export function promptText({
  title,
  value = '',
  placeholder = '',
  confirm = 'Save',
  maxLength = 40,
  message = '',
  attrs = {},
}) {
  return modal(
    (close) => {
      const input = h('input', {
        class: 'alert-input',
        value,
        placeholder,
        maxlength: maxLength,
        autofocus: true,
        enterkeyhint: 'done',
        ...attrs,
      });
      const submit = () => close(input.value.trim() || null);
      setTimeout(() => input.select(), 60);
      return h(
        'form',
        { class: 'alert', onSubmit: (e) => (e.preventDefault(), submit()) },
        h('div', { class: 'alert-body' }, h('h2', {}, title), message && h('p', {}, message), input),
        alertButtons([
          button('Cancel', () => close(null), 'alert-btn'),
          h('button', { type: 'submit', class: 'btn alert-btn bold' }, confirm),
        ]),
      );
    },
    { kind: 'alert' },
  ).then((v) => v ?? null);
}

/**
 * Phone-style keypad (no OS keyboard). mode 'time' shows m:ss and fills
 * digits from the right like a microwave; mode 'number' is a plain integer.
 * Resolves with the typed digit string, or null.
 */
export function keypad({ title, mode = 'number', initial = '', maxDigits = mode === 'time' ? 4 : 2, hint = '' }) {
  return modal(
    (close) => {
      let digits = '';
      const display = h('div', { class: 'keypad-display', 'aria-live': 'polite' });
      const render = () => {
        if (!digits) display.textContent = initial || (mode === 'time' ? '0:00' : '0');
        else if (mode === 'time') {
          const d = digits.padStart(3, '0');
          display.textContent = `${d.slice(0, -2).replace(/^0(?=\d)/, '')}:${d.slice(-2)}`;
        } else display.textContent = digits;
        display.classList.toggle('placeholder', !digits);
        set.disabled = !digits;
      };
      const press = (k) => {
        if (k === 'del') digits = digits.slice(0, -1);
        else if (digits.length < maxDigits) digits = (digits + k).replace(/^0+(?=\d)/, '');
        render();
      };
      const key = (k) => button(k, () => press(k), 'key', { 'aria-label': k });
      const set = button('Set', () => close(digits || null), 'btn-filled btn-block');
      render();
      return h(
        'div',
        { class: 'keypad' },
        sheetNav({ title, left: { label: 'Cancel', onClick: () => close(null) } }),
        hint && h('p', { class: 'keypad-hint' }, hint),
        display,
        h(
          'div',
          { class: 'keys' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
          h('span'),
          key('0'),
          button(icon('deleteLeft'), () => press('del'), 'key key-del', { 'aria-label': 'Delete' }),
        ),
        set,
      );
    },
    { kind: 'sheet', cls: 'keypad-sheet' },
  ).then((v) => v ?? null);
}

/**
 * iOS action sheet. actions: { id, label, icon?, tone?: 'danger', hold?, hint? }
 * Resolves with the chosen id, or null.
 */
export function actionSheet({ title, subtitle, actions }) {
  return modal(
    (close) =>
      h(
        'div',
        { class: 'action-sheet' },
        h(
          'div',
          { class: 'action-group' },
          (title || subtitle) &&
            h(
              'div',
              { class: 'action-head' },
              title && h('div', { class: 'action-title' }, title),
              subtitle && h('div', { class: 'action-sub' }, subtitle),
            ),
          ...actions.filter(Boolean).map((a) => {
            const label = h('span', { class: 'action-label' }, a.icon && icon(a.icon), a.label);
            const cls = `action-btn ${a.tone ? `tone-${a.tone}` : ''} ${a.cls ?? ''}`;
            return a.hold
              ? holdButton(label, () => close(a.id), { cls, hint: a.hint })
              : button(label, () => close(a.id), cls);
          }),
        ),
        button('Cancel', () => close(null), 'action-btn action-cancel'),
      ),
    { kind: 'action' },
  ).then((v) => v ?? null);
}

/**
 * Press-and-hold button for destructive actions. Holding for `ms` fires
 * onHold. A quick tap calls onTap if given (e.g. to open a confirmation),
 * otherwise shows a "hold" hint.
 */
export function holdButton(label, onHold, { ms = 700, onTap, cls = '', hint = 'Press and hold', attrs = {} } = {}) {
  const el = h(
    'button',
    { type: 'button', class: `btn hold ${cls}`.trim(), ...attrs },
    h('span', { class: 'hold-fill' }),
    h('span', { class: 'hold-label' }, label),
  );
  let timer = null;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('holding');
  };
  el.style.setProperty('--hold-ms', `${ms}ms`);
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    el.classList.add('holding');
    timer = setTimeout(() => {
      fired = true;
      cancel();
      haptic?.(40);
      onHold();
    }, ms);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    if (fired) return;
    if (e.detail === 0) return onTap ? onTap() : onHold(); // keyboard activation
    if (onTap) onTap();
    else toast(hint);
  });
  return el;
}

let haptic = null;
export function setHaptic(fn) {
  haptic = fn;
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
