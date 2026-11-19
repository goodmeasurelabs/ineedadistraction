import type { Clip } from './catalog';

type VideoPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
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

/** A player belongs to one attempt. Cancel before releasing its frame or running any fallback. */
export function mountClipPlayer(
  host: HTMLDivElement,
  clip: Clip,
  options: { start: number; sound: boolean },
  events: ClipPlayerEvents,
  loadApi = loadYouTubeApi,
) {
  let active = true;
  let player: VideoPlayer | undefined;
  let frame: HTMLIFrameElement | undefined;
  let position = options.start;
  let sound = options.sound;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (active) {
      active = false;
      clearTimeout(watchdog);
      // Each bridge method can fail independently if the iframe never loaded.
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
  const applySound = (target: VideoPlayer) => { if (sound) target.unMute(); else target.mute(); };

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
          applySound(target);
          // Native controls remain available when this attempt is blocked.
          events.onPressPlay();
          target.playVideo();
        } catch { fail('YouTube could not start this clip.'); }
      },
      onStateChange({ data }) {
        if (!canPlay()) return;
        if (data === 1) events.onPlaying();
        if (data === 0) { stop(); events.onEnded(); }
      },
      onAutoplayBlocked() { if (canPlay()) events.onPressPlay(); },
      onError({ data }) {
        if (!active) return;
        if ([100, 101, 150].includes(data)) { stop(); events.onUnavailable(); }
        else fail(data === 153 ? 'YouTube could not identify this popup.' : 'YouTube could not play this clip.');
      },
    } });
  }).catch(() => fail('YouTube could not load. Check your connection and try again.'));

  return { stop, setSound(next: boolean) {
    sound = next;
    if (active && player) { try { applySound(player); } catch { /* onReady will apply it */ } }
  } };
}
