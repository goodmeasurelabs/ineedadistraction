import type { Clip } from './catalog';

type VideoPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume(): number;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  destroy(): void;
};

type PlayerEvent = { target: VideoPlayer; data: number };
export type YouTubeApi = {
  Player: new (frame: HTMLIFrameElement, options: { events: {
    onReady(event: PlayerEvent): void;
    onStateChange(event: PlayerEvent): void;
    onAutoplayBlocked(event: PlayerEvent): void;
    onError(event: PlayerEvent): void;
  } }) => VideoPlayer;
};
type YouTubeWindow = Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTubeApi> | undefined;

/** Audible playback is chosen for this viewing session. Volume may survive a pause. */
export type ClipAudio = { sound: boolean; volume?: number };

function loadYouTubeApi(): Promise<YouTubeApi> {
  const browser = window as YouTubeWindow;
  if (browser.YT?.Player) return Promise.resolve(browser.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = browser.onYouTubeIframeAPIReady;
    const cleanup = () => {
      clearTimeout(timer);
      if (browser.onYouTubeIframeAPIReady === ready) browser.onYouTubeIframeAPIReady = previous;
      script.onerror = null;
    };
    const failed = () => {
      cleanup();
      script.remove();
      apiPromise = undefined;
      reject(new Error('YouTube could not load.'));
    };
    const ready = () => {
      if (!browser.YT?.Player) { failed(); return; }
      cleanup();
      resolve(browser.YT);
      previous?.();
    };
    const timer = setTimeout(failed, 15_000);
    browser.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = failed;
    document.head.append(script);
  });
  return apiPromise;
}

export type ClipPlayerEvents = {
  onPlaying(): void;
  onPressPlay(): void;
  onEnded(): void;
  onUnavailable(): void;
  onFailure(message: string): void;
};

function popupHasFocus() {
  return !document.hidden && document.hasFocus();
}

/** Only the focused popup may play, even when its window remains visible beside another app. */
export function playWhileVisible(element: HTMLElement, start: (onFocusLost: () => void) => () => void, onLeave?: () => void): () => void {
  let watching = true;
  let pageShown = true;
  let inView: boolean | undefined;
  let away = false;
  let stop: (() => void) | undefined;
  let focusCheck: ReturnType<typeof setInterval> | undefined;
  function update() {
    const left = !pageShown || !popupHasFocus() || inView === false;
    const leaving = left && !away;
    away = left;
    if (watching && !left && inView) {
      if (!stop) {
        stop = start(update);
        // When YouTube's cross-origin controls own focus, an app switch can
        // reach only that frame. Check the top document while the player is live.
        focusCheck = setInterval(update, 200);
      }
    } else if (stop) {
      clearInterval(focusCheck);
      const release = stop;
      stop = undefined;
      release();
    }
    // Sample the outgoing player's volume first. An ordinary clip change
    // also releases the player, but belongs to the same viewing session.
    if (watching && leaving) onLeave?.();
  }
  function pageVisibility(event: PageTransitionEvent) {
    pageShown = event.type === 'pageshow';
    update();
  }
  const observer = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].intersectionRatio >= 0.5;
    update();
  }, { threshold: 0.5 });
  observer.observe(element);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  window.addEventListener('pagehide', pageVisibility);
  window.addEventListener('pageshow', pageVisibility);
  update();
  return () => {
    if (!watching) return;
    watching = false;
    observer.disconnect();
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
    window.removeEventListener('pagehide', pageVisibility);
    window.removeEventListener('pageshow', pageVisibility);
    update();
  };
}

/** A player belongs to one attempt. Cancel before releasing its frame or running any fallback. */
export function mountClipPlayer(
  host: HTMLDivElement,
  clip: Clip,
  options: { start: number; audio: ClipAudio; onFocusLost?(): void },
  events: ClipPlayerEvents,
  loadApi = loadYouTubeApi,
) {
  let active = true;
  let player: VideoPlayer | undefined;
  let frame: HTMLIFrameElement | undefined;
  let position = options.start;
  const audio = options.audio;
  let played = false;
  let startedMuted = true;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (active) {
      active = false;
      clearTimeout(watchdog);
      // Each bridge method can fail independently if the iframe never loaded.
      // Sample before destroying the player, including when YouTube ends the clip.
      // Native YouTube controls do not emit a public volume-change event.
      if (played && player) {
        try {
          const muted = player.isMuted();
          if (typeof muted === 'boolean') audio.sound = !muted;
          const volume = player.getVolume();
          if (Number.isInteger(volume) && volume >= 0 && volume <= 100) audio.volume = volume;
        } catch { /* keep the last known audio settings */ }
      }
      try { const t = player?.getCurrentTime(); if (t && Number.isFinite(t)) position = t; } catch { /* not ready */ }
      // Removing a focused cross-origin frame can leave the popup without
      // document focus. Hand it back before replacing native YouTube controls.
      if (frame && host.isConnected && document.activeElement === frame && popupHasFocus()) {
        host.tabIndex = -1;
        try { host.focus({ preventScroll: true }); } catch { /* always release the iframe */ }
      }
      try { player?.pauseVideo(); } catch { /* not ready */ }
      try { player?.destroy(); } catch { /* remove the iframe ourselves below */ }
      frame?.remove();
    }
    return position;
  };
  const canPlay = () => {
    if (!active || !host.isConnected) return false;
    if (popupHasFocus()) return true;
    // A one-shot SDK callback can arrive before the focus check. Release
    // this attempt now so refocusing gets a fresh player and ready event.
    options.onFocusLost?.();
    return false;
  };
  const fail = (message: string) => {
    if (!canPlay()) return;
    stop();
    events.onFailure(message);
  };

  void loadApi().then((api) => {
    if (!canPlay()) return;
    frame = document.createElement('iframe');
    const url = new URL(`https://www.youtube-nocookie.com/embed/${clip.id}`);
    url.search = new URLSearchParams({ enablejsapi: '1', origin: window.location.origin,
      playsinline: '1', autoplay: '0', fs: '0', start: String(Math.max(0, Math.floor(position))),
    }).toString();
    frame.title = `${clip.title} on YouTube`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = "autoplay; encrypted-media; fullscreen 'none'; picture-in-picture 'none'";
    frame.src = url.href;
    host.append(frame);
    watchdog = setTimeout(() => fail('The YouTube player did not respond.'), 18_000);
    player = new api.Player(frame, { events: {
      onReady({ target }) {
        if (!canPlay()) return;
        clearTimeout(watchdog);
        try {
          startedMuted = !audio.sound;
          if (audio.volume !== undefined) target.setVolume(audio.volume);
          if (startedMuted) target.mute();
          else target.unMute();
          target.playVideo();
        } catch { fail('YouTube could not start this clip.'); }
      },
      onStateChange({ data }) {
        if (!canPlay()) return;
        if (data === 1) {
          played = true;
          events.onPlaying();
        }
        if (data === 0) { stop(); events.onEnded(); }
      },
      onAutoplayBlocked({ target }) {
        if (!canPlay()) return;
        if (!startedMuted) {
          startedMuted = true;
          audio.sound = false;
          try {
            target.mute();
            target.playVideo();
          } catch { events.onPressPlay(); }
        } else {
          events.onPressPlay();
        }
      },
      onError({ data }) {
        if (!canPlay()) return;
        if ([100, 101, 150].includes(data)) { stop(); events.onUnavailable(); }
        else fail(data === 153 ? 'YouTube could not identify this popup.' : 'YouTube could not play this clip.');
      },
    } });
  }).catch(() => fail('YouTube could not load. Check your connection and try again.'));

  return {
    stop,
    setSound(next: boolean) {
      if (!active || (next && !canPlay())) return;
      audio.sound = next;
      startedMuted = !next;
      try {
        if (next) player?.unMute();
        else player?.mute();
      } catch { /* onReady will apply it */ }
    },
  };
}
