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

/** Shared by the clip players in one popup. Native volume changes stay local to clips. */
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

/** Start a new attempt whenever the popup shows the player, and release it before it disappears. */
export function playWhileVisible(element: HTMLElement, start: () => () => void): () => void {
  let watching = true;
  let pageShown = true;
  let inView = false;
  let stop: (() => void) | undefined;
  function update() {
    if (watching && pageShown && !document.hidden && inView) {
      stop ??= start();
    } else if (stop) {
      stop();
      stop = undefined;
    }
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
  window.addEventListener('pagehide', pageVisibility);
  window.addEventListener('pageshow', pageVisibility);
  return () => {
    if (!watching) return;
    watching = false;
    observer.disconnect();
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('pagehide', pageVisibility);
    window.removeEventListener('pageshow', pageVisibility);
    update();
  };
}

/** A player belongs to one attempt. Cancel before releasing its frame or running any fallback. */
export function mountClipPlayer(
  host: HTMLDivElement,
  clip: Clip,
  options: { start: number; audio: ClipAudio },
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
  let autoplayMuted = false;
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
          // A browser-enforced mute is temporary. A native unmute is a choice.
          if (typeof muted === 'boolean' && (!autoplayMuted || !muted)) audio.sound = !muted;
          const volume = player.getVolume();
          if (Number.isInteger(volume) && volume >= 0 && volume <= 100) audio.volume = volume;
        } catch { /* keep the last known audio settings */ }
      }
      try { const t = player?.getCurrentTime(); if (t && Number.isFinite(t)) position = t; } catch { /* not ready */ }
      try { player?.pauseVideo(); } catch { /* not ready */ }
      try { player?.destroy(); } catch { /* remove the iframe ourselves below */ }
      frame?.remove();
    }
    return position;
  };
  const fail = (message: string) => {
    if (!active) return;
    stop();
    events.onFailure(message);
  };
  const canPlay = () => active && host.isConnected && !document.hidden;

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
          // Start a cold popup quietly. When replacing a playing clip, try its
          // actual audio settings; the browser can still request a muted retry.
          startedMuted = !audio.sound || (audio.volume === undefined && !window.navigator?.userActivation?.hasBeenActive);
          autoplayMuted = startedMuted && audio.sound;
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
          autoplayMuted = true;
          try {
            target.mute();
            target.playVideo();
          } catch { events.onPressPlay(); }
        } else {
          events.onPressPlay();
        }
      },
      onError({ data }) {
        if (!active) return;
        if ([100, 101, 150].includes(data)) { stop(); events.onUnavailable(); }
        else fail(data === 153 ? 'YouTube could not identify this popup.' : 'YouTube could not play this clip.');
      },
    } });
  }).catch(() => fail('YouTube could not load. Check your connection and try again.'));

  return {
    stop,
    setSound(next: boolean) {
      if (!active) return;
      audio.sound = next;
      startedMuted = !next;
      autoplayMuted = false;
      try {
        if (next) player?.unMute();
        else player?.mute();
      } catch { /* onReady will apply it */ }
    },
  };
}
