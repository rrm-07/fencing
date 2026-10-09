// Small DOM helpers: element builder, dialogs, bottom sheets, numeric keypad,
// press-and-hold buttons and toasts. No framework, no hover-dependent UI.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
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

/* ---------- toasts ---------- */

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
  toastTimer = setTimeout(() => el.remove(), ms);
}

/* ---------- modal layer ---------- */

const stack = [];

/**
 * Open a modal. `build(close)` returns the content node. Returns a promise
 * resolved with whatever is passed to close(). Tapping the backdrop or the
 * Back gesture (Escape) closes with `undefined`.
 */
export function modal(build, { kind = 'sheet', dismissable = true, cls = '' } = {}) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      wrap.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(close), 1);
      setTimeout(() => wrap.remove(), 120);
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
    panel.append(build(close));
    root.append(wrap);
    stack.push(close);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      wrap.classList.add('open');
      panel.querySelector('[autofocus]')?.focus();
    });
  });
}

export const closeAllModals = () => [...stack].reverse().forEach((c) => c(undefined));
export const modalOpen = () => stack.length > 0;

export function confirmDialog({ title, message = '', confirm = 'OK', cancel = 'Cancel', danger = false }) {
  return modal(
    (close) =>
      h(
        'div',
        { class: 'dialog' },
        h('h2', {}, title),
        message && h('p', { class: 'muted' }, message),
        h(
          'div',
          { class: 'row gap' },
          button(cancel, () => close(false), 'btn-ghost grow'),
          button(confirm, () => close(true), `${danger ? 'btn-danger' : 'btn-primary'} grow`),
        ),
      ),
    { kind: 'center' },
  ).then((v) => v === true);
}

export function promptText({ title, value = '', placeholder = '', confirm = 'Save', maxLength = 40 }) {
  return modal(
    (close) => {
      const input = h('input', {
        class: 'input',
        value,
        placeholder,
        maxlength: maxLength,
        autofocus: true,
        enterkeyhint: 'done',
      });
      const submit = () => close(input.value.trim() || null);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      setTimeout(() => input.select(), 50);
      return h(
        'form',
        { class: 'dialog', onSubmit: (e) => (e.preventDefault(), submit()) },
        h('h2', {}, title),
        input,
        h(
          'div',
          { class: 'row gap' },
          button('Cancel', () => close(null), 'btn-ghost grow'),
          h('button', { type: 'submit', class: 'btn btn-primary grow' }, confirm),
        ),
      );
    },
    { kind: 'center' },
  ).then((v) => v ?? null);
}

/**
 * Big on-screen keypad (no OS keyboard). mode 'time' shows mm:ss and fills
 * digits from the right like a microwave; mode 'number' is a plain integer.
 * Resolves with the typed digit string, or null.
 */
export function keypad({ title, mode = 'number', initial = '', maxDigits = mode === 'time' ? 4 : 2, hint = '' }) {
  return modal(
    (close) => {
      let digits = '';
      const display = h('div', { class: 'keypad-display', 'aria-live': 'polite' });
      const render = () => {
        if (mode === 'time') {
          const d = (digits || '').padStart(3, '0');
          const mm = d.slice(0, -2).replace(/^0(?=\d)/, '');
          display.textContent = `${mm}:${d.slice(-2)}`;
          display.classList.toggle('placeholder', !digits);
          if (!digits) display.textContent = initial || '0:00';
        } else {
          display.textContent = digits || initial || '0';
          display.classList.toggle('placeholder', !digits);
        }
      };
      const press = (k) => {
        if (k === 'del') digits = digits.slice(0, -1);
        else if (digits.length < maxDigits) digits = (digits + k).replace(/^0+(?=\d)/, '');
        render();
      };
      const key = (k, label = k, cls = '') =>
        button(label, () => press(k), `key ${cls}`, { 'aria-label': k === 'del' ? 'Delete' : label });
      render();
      return h(
        'div',
        { class: 'dialog keypad' },
        h('h2', {}, title),
        hint && h('p', { class: 'muted small' }, hint),
        display,
        h(
          'div',
          { class: 'keys' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => key(k)),
          button('Cancel', () => close(null), 'key key-muted'),
          key('0'),
          key('del', '⌫', 'key-muted'),
        ),
        button('Set', () => close(digits || null), 'btn-primary btn-block'),
      );
    },
    { kind: 'center' },
  ).then((v) => v ?? null);
}

/** Bottom sheet with a title and a list of action buttons. Resolves with the chosen id. */
export function actionSheet({ title, subtitle, actions }) {
  return modal((close) =>
    h(
      'div',
      { class: 'sheet-body' },
      title && h('h2', {}, title),
      subtitle && h('p', { class: 'muted' }, subtitle),
      h(
        'div',
        { class: 'stack' },
        ...actions
          .filter(Boolean)
          .map((a) =>
            a.hold
              ? holdButton(a.label, () => close(a.id), { cls: a.cls ?? '', hint: a.hint })
              : button(a.label, () => close(a.id), a.cls ?? ''),
          ),
      ),
      button('Cancel', () => close(null), 'btn-ghost btn-block'),
    ),
  );
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

export function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
