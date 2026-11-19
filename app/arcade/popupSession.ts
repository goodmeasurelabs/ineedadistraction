import { isAgentToken } from '../lib/agentSession';

export const AGENT_TOKEN_KEY = 'inad:agent-token';
const POPUP_TOKEN_KEY = 'inad:plugin-popup-token:v1';
const CLIPS_KEY = 'inad:popup-family-guy:v1';

function isAppWindow() {
  return typeof window !== 'undefined' && window.top === window && !window.opener &&
    window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches;
}

function readWindowPairing(): string | null {
  if (!isAppWindow()) return null;
  return window.sessionStorage.getItem(POPUP_TOKEN_KEY);
}

/** This choice belongs to the dedicated player, including its next launch. */
export function prefersPopupClips(): boolean {
  try { return isAgentToken(readWindowPairing()) && localStorage.getItem(CLIPS_KEY) === 'on'; }
  catch { return false; }
}

export function rememberPopupClips(clips: boolean) {
  try {
    if (!isAgentToken(readWindowPairing())) return;
    if (clips) localStorage.setItem(CLIPS_KEY, 'on');
    else localStorage.removeItem(CLIPS_KEY);
  } catch { /* The choice still applies to this open player. */ }
}

/** All queue, settings and return requests in this window use the same pairing. */
export function readAgentToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const token = readWindowPairing() ?? localStorage.getItem(AGENT_TOKEN_KEY);
    return isAgentToken(token) ? token : null;
  } catch { return null; }
}

type Pairing = { popup: boolean; error?: 'invalid' | 'storage' };

export function initializeArcadePairing(fragment: URLSearchParams): Pairing {
  try {
    if (!fragment.has('t') && !fragment.has('popup')) {
      const saved = readWindowPairing();
      if (saved === null) return { popup: false };
      return isAgentToken(saved) ? { popup: true } : { popup: false, error: 'invalid' };
    }
    const token = fragment.get('t');
    const appWindow = isAppWindow();
    if (!isAgentToken(token) || fragment.getAll('t').length !== 1) {
      // An invalid app launch must not fall back to a different profile-wide
      // agent after its fragment is stripped or the window is reloaded.
      if (appWindow) window.sessionStorage.setItem(POPUP_TOKEN_KEY, '');
      return { popup: false, error: 'invalid' };
    }

    // The plugin marks only its --app launch. Printed links and normal browser
    // tabs retain the original profile-wide pairing behavior.
    const popup = appWindow && fragment.has('popup');
    if (popup) window.sessionStorage.setItem(POPUP_TOKEN_KEY, token);
    else {
      if (appWindow) window.sessionStorage.removeItem(POPUP_TOKEN_KEY);
      localStorage.setItem(AGENT_TOKEN_KEY, token);
    }
    const saved = popup ? readWindowPairing() : localStorage.getItem(AGENT_TOKEN_KEY);
    if (saved !== token) return { popup: false, error: 'storage' };
    if (popup && fragment.get('mode') === 'clips') rememberPopupClips(true);
    return { popup };
  } catch {
    return { popup: false, error: 'storage' };
  }
}
