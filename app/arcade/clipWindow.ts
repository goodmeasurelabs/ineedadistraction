type Bounds = { left: number; top: number; width: number; height: number };

const GAME_BOUNDS_KEY = 'inad:game-window-bounds:v1';

export function popupHasFocus() {
  return !document.hidden && document.hasFocus();
}

/** A focus request can fail or take time. Wait for the popup to actually leave and return. */
export function onPopupRefocus(onReturn: () => void) {
  let left = !popupHasFocus();
  function checkFocus() {
    if (!popupHasFocus()) left = true;
    else if (left) {
      left = false;
      onReturn();
    }
  }
  window.addEventListener('blur', checkFocus);
  window.addEventListener('focus', checkFocus);
  document.addEventListener('visibilitychange', checkFocus);
  return () => {
    window.removeEventListener('blur', checkFocus);
    window.removeEventListener('focus', checkFocus);
    document.removeEventListener('visibilitychange', checkFocus);
  };
}

function availableScreen(): Bounds {
  // Chromium exposes the current monitor's usable origin as well as its size.
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return { left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight };
}

function applyBounds(bounds: Bounds) {
  try {
    window.resizeTo(bounds.width, bounds.height);
    window.moveTo(bounds.left, bounds.top);
  } catch {
    // Some window managers own the geometry. The player still uses its entire viewport.
  }
}

function compactBounds(available: Bounds): Bounds {
  const width = Math.min(460, available.width);
  const height = Math.min(800, available.height);
  return {
    width, height,
    left: available.left + Math.max(0, available.width - width - 24),
    top: available.top + Math.round((available.height - height) / 2),
  };
}

function takeLegacyBounds(): Bounds | undefined {
  try {
    const raw = window.sessionStorage.getItem(GAME_BOUNDS_KEY);
    if (raw) {
      window.sessionStorage.removeItem(GAME_BOUNDS_KEY);
      const saved = JSON.parse(raw);
      if (saved && [saved.left, saved.top, saved.width, saved.height].every(Number.isFinite) && saved.width > 0 && saved.height > 0) return saved;
    }
  } catch { /* The current bounds also work without storage. */ }
}

export function initializePopupWindow({ popup, freshLaunch }: { popup: boolean; freshLaunch: boolean }) {
  if (!popup) return;
  const saved = takeLegacyBounds();
  if (!freshLaunch && !saved) return;
  const available = availableScreen();
  if (freshLaunch) {
    applyBounds(compactBounds(available));
    return;
  }

  // Older clip windows saved their original bounds before automatically expanding.
  // Migrate one on reload only if it still has the rectangle that release assigned.
  const inset = Math.min(24, Math.round(Math.min(available.width, available.height) * 0.02));
  const matches = (actual: number, expected: number) => Math.abs(actual - expected) <= 2;
  if (saved && matches(window.screenX, available.left + inset) && matches(window.screenY, available.top + inset)
    && matches(window.outerWidth, available.width - 2 * inset) && matches(window.outerHeight, available.height - 2 * inset)) {
    const width = Math.min(saved.width, available.width);
    const height = Math.min(saved.height, available.height);
    applyBounds({
      width, height,
      left: Math.max(available.left, Math.min(saved.left, available.left + available.width - width)),
      top: Math.max(available.top, Math.min(saved.top, available.top + available.height - height)),
    });
  }
}
