// Timestamp-based countdown timer. Pure functions over a plain, serialisable
// object so the clock survives backgrounding, screen lock and even a page
// reload: remaining time is always derived from wall-clock timestamps, never
// from counting interval ticks.
//
// Timer shape: { presetMs, remainingMs, running, startedAt }
//   remainingMs  time left at the moment the timer was last started/stopped
//   startedAt    Date.now()-style timestamp when it was started (null if paused)

export const MIN = 60_000;

export function createTimer(presetMs = 3 * MIN) {
  return { presetMs, remainingMs: presetMs, running: false, startedAt: null };
}

export function remaining(t, now) {
  if (!t.running) return t.remainingMs;
  return Math.max(0, t.remainingMs - Math.max(0, now - t.startedAt));
}

export function isExpired(t, now) {
  return remaining(t, now) <= 0;
}

export function start(t, now) {
  if (t.running || t.remainingMs <= 0) return t;
  return { ...t, running: true, startedAt: now };
}

export function stop(t, now) {
  if (!t.running) return t;
  return { ...t, running: false, startedAt: null, remainingMs: remaining(t, now) };
}

export function toggle(t, now) {
  return t.running ? stop(t, now) : start(t, now);
}

/** Load a preset: sets both the preset (reset target) and the clock. Paused. */
export function setPreset(t, presetMs) {
  return { presetMs, remainingMs: presetMs, running: false, startedAt: null };
}

/** Reset to the last preset. Paused. */
export function reset(t) {
  return setPreset(t, t.presetMs);
}

/** Set an exact remaining time (clock correction). Keeps the preset. Paused. */
export function setRemaining(t, ms) {
  return { ...t, remainingMs: Math.max(0, Math.round(ms)), running: false, startedAt: null };
}

/**
 * Format for display. Under 10 s shows tenths ("9.4"), otherwise m:ss.
 * Rounds *up* to the whole second above 10 s, as scoring machines do, so
 * "3:00" is shown for the whole first second and "0:00" only at expiry.
 */
export function format(ms) {
  if (ms <= 0) return '0:00';
  if (ms < 10_000) {
    // ceil keeps "0.1" visible until the very end; cap so 9.95 s reads "9.9"
    const tenths = Math.min(99, Math.ceil(ms / 100));
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const secs = Math.ceil(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Plain m:ss (no tenths), used for presets and the time editor. */
export function formatMmSs(ms) {
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/**
 * Parse user input into ms. Accepts "2:15", "215" (→ 2:15), "45" (→ 0:45),
 * "1:5" (→ 1:05). Returns null if invalid.
 */
export function parseMmSs(str) {
  const s = String(str).trim();
  let m;
  let sec;
  if (s.includes(':')) {
    const [a, b] = s.split(':');
    if (!/^\d{0,2}$/.test(a) || !/^\d{1,2}$/.test(b)) return null;
    m = Number(a || 0);
    sec = Number(b);
  } else {
    if (!/^\d{1,4}$/.test(s)) return null;
    const n = s.padStart(3, '0');
    m = Number(n.slice(0, -2));
    sec = Number(n.slice(-2));
  }
  if (sec > 59 || m > 99) return null;
  return (m * 60 + sec) * 1000;
}
