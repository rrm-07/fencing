// Device integrations. Every call fails silently where unsupported
// (e.g. iOS has no Vibration API; older browsers have no Wake Lock).

let hapticsOn = true;
export function setHapticsEnabled(on) {
  hapticsOn = on;
}

export function vibrate(pattern) {
  if (!hapticsOn) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export const haptics = {
  tap: () => vibrate(15),
  score: () => vibrate(30),
  undo: () => vibrate([20, 40, 20]),
  tenSeconds: () => vibrate([120, 80, 120]),
  timeUp: () => vibrate([600, 150, 600]),
  win: () => vibrate([80, 60, 80, 60, 250]),
};

// Screen Wake Lock: keep the phone awake while a bout is under way. The lock
// is released by the browser whenever the page is hidden, so re-acquire it
// when we come back.
let wanted = false;
let sentinel = null;

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock?.request('screen');
    sentinel?.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null; // denied (battery saver) or unsupported
  }
}

export function setWakeLock(on) {
  if (on === wanted) return;
  wanted = on;
  if (on) acquire();
  else {
    sentinel?.release().catch(() => {});
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});
