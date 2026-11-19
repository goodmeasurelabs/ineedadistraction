type Bounds = { left: number; top: number; width: number; height: number };

const GAME_BOUNDS_KEY = 'inad:game-window-bounds:v1';

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

/** Called after a marked, dedicated launcher window is successfully paired. */
export function positionGamePopup() {
  const available = availableScreen();
  const width = Math.min(460, available.width);
  const height = Math.min(800, available.height);
  applyBounds({
    width, height,
    left: available.left + Math.max(0, available.width - width - 24),
    top: available.top + Math.round((available.height - height) / 2),
  });
}

function savedGameBounds(): Bounds | undefined {
  try {
    // Reloading an expanded popup must still restore the original game window.
    const raw = window.sessionStorage.getItem(GAME_BOUNDS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && [saved.left, saved.top, saved.width, saved.height].every(Number.isFinite) && saved.width > 0 && saved.height > 0) return saved;
    }
  } catch { /* The current bounds also work without storage. */ }
}

/** A reload may land in games or Off while the native window still has its clip geometry. */
export function restoreClipWindow(original = savedGameBounds()) {
  if (!original) return;
  applyBounds(original);
  try { window.sessionStorage.removeItem(GAME_BOUNDS_KEY); } catch { /* optional */ }
}

/** Expand only the paired popup; returning to games restores its previous bounds. */
export function enterClipWindow(isPluginPopup: boolean): (() => void) | undefined {
  if (!isPluginPopup) return;
  const original = savedGameBounds() ?? {
    left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight,
  };
  try { window.sessionStorage.setItem(GAME_BOUNDS_KEY, JSON.stringify(original)); } catch { /* optional */ }
  const available = availableScreen();
  const inset = Math.min(24, Math.round(Math.min(available.width, available.height) * 0.02));
  applyBounds({
    left: available.left + inset,
    top: available.top + inset,
    width: available.width - 2 * inset,
    height: available.height - 2 * inset,
  });
  return () => restoreClipWindow(original);
}
