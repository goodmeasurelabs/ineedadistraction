'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Game, GameHost, GameModule, RunResult } from './types';
import { Sfx } from './sfx';
import { hashString } from './fx';
import { readAgentToken, useAgentSync } from './useAgentSync';
import { trackEvent, trackShareClick } from '../../lib/analytics';
import AgentQueue from '../../components/AgentQueue';

type OtherGame = { slug: string; title: string; emoji: string };

type Props = {
  slug: string;
  title: string;
  hint: string;
  accent: string;
  module: GameModule;
  others: OtherGame[];
};

type PauseCause = null | 'manual' | 'blur' | 'agent';
type Mode = 'endless' | 'daily';

type SeededRng = (() => number) & { state: () => number; restore: (s: number) => void };
function makeRng(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  next.state = () => a;
  next.restore = (s: number) => { a = s >>> 0; };
  return next;
}

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* play works without storage */ } },
  del(key: string) { try { localStorage.removeItem(key); } catch { /* optional */ } },
};

export default function GameStage({ slug, title, hint, accent, module, others }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const live = useRef({
    w: 0, h: 0, dpr: 1, t: 0, shake: 0, freezeUntil: 0, pause: null as PauseCause, countdown: 0, over: false,
    dirty: true, score: 0, best: 0, started: 0, interacted: false, rng: makeRng(1), seed: 1, mode: 'endless' as Mode,
    reducedMotion: false, overAt: 0,
  });

  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [status, setStatus] = useState('');
  const [pause, setPauseState] = useState<PauseCause>(null);
  const [countdown, setCountdown] = useState(0);
  const [result, setResult] = useState<(RunResult & { newBest: boolean; previousBest: number }) | null>(null);
  const [mode, setMode] = useState<Mode>('endless');
  const [muted, setMuted] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [showHint, setShowHint] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const agent = useAgentSync();

  // Daily runs chase their own number: today's best on today's seed.
  const bestKey = mode === 'daily' ? `inad:daily:${slug}:${today()}` : `inad:best:${slug}`;
  const saveKey = (m: Mode) => `inad:save:${slug}:${m}${m === 'daily' ? `:${today()}` : ''}`;

  const setPause = useCallback((cause: PauseCause, withCountdown = false) => {
    const state = live.current;
    if (cause === null && withCountdown && module.realtime && !state.over) {
      state.countdown = 1.5; setCountdown(3);
    } else if (cause !== null) {
      state.countdown = 0; setCountdown(0);
    }
    state.pause = cause; state.dirty = true;
    setPauseState(cause);
  }, [module.realtime]);

  // ---- Run lifecycle --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    const state = live.current;
    const sfx = sfxRef.current ?? (sfxRef.current = new Sfx());
    setMuted(sfx.muted);
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.mode = mode;

    const scene = document.createElement('canvas');
    const bloomA = document.createElement('canvas');
    const bloomB = document.createElement('canvas');
    const main = canvas.getContext('2d', { alpha: false })!;
    const sceneCtx = scene.getContext('2d', { alpha: false })!;
    const aCtx = bloomA.getContext('2d', { alpha: false })!;
    const bCtx = bloomB.getContext('2d', { alpha: false })!;

    function measure() {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(240, Math.round(rect.width)), h = Math.max(240, Math.round(rect.height));
      if (w === state.w && h === state.h && dpr === state.dpr) return;
      state.w = w; state.h = h; state.dpr = dpr;
      canvas.width = scene.width = Math.round(w * dpr); canvas.height = scene.height = Math.round(h * dpr);
      bloomA.width = Math.max(1, Math.round(w / 3)); bloomA.height = Math.max(1, Math.round(h / 3));
      bloomB.width = Math.max(1, Math.round(w / 9)); bloomB.height = Math.max(1, Math.round(h / 9));
      gameRef.current?.resize?.(w, h);
      state.dirty = true;
    }
    state.w = 0; // each run owns fresh buffers, so always size them
    measure();

    // Seed and restore.
    const savedBest = Number(store.get(bestKey)) || 0;
    state.best = savedBest; setBest(savedBest);
    state.score = 0; setScore(0); setStatus(''); setResult(null); setShareNote('');
    state.over = false; state.t = 0; state.shake = 0; state.freezeUntil = 0; state.started = performance.now();
    state.pause = null; setPauseState(null); state.countdown = 0; setCountdown(0);

    let savedState: unknown = null;
    const seed = mode === 'daily' ? hashString(`${slug}:${today()}`) : (Math.random() * 2 ** 32) >>> 0;
    state.seed = seed; state.rng = makeRng(seed);
    try {
      const raw = store.get(saveKey(mode));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && typeof parsed.rng === 'number') {
          state.seed = parsed.seed; state.rng = makeRng(parsed.seed); state.rng.restore(parsed.rng);
          savedState = parsed.state ?? null;
          if (typeof parsed.score === 'number') { state.score = parsed.score; setScore(parsed.score); }
        }
      }
    } catch { savedState = null; }

    // Whether this browser is paired with the coding-agent plugin.
    const agentMode = readAgentToken() !== null;
    let reportedT = 0;
    function playedSinceReport() { const played = Math.round(state.t - reportedT); reportedT = state.t; return played; }

    const host: GameHost = {
      get w() { return state.w; },
      get h() { return state.h; },
      sfx,
      rng: () => state.rng(),
      get reducedMotion() { return state.reducedMotion; },
      best: savedBest,
      daily: mode === 'daily',
      setScore(value) { const v = Math.round(value); if (v !== state.score) { state.score = v; setScore(v); } },
      setStatus(text) { setStatus(text); },
      save(data) { if (!state.over) store.set(saveKey(mode), JSON.stringify({ v: 1, seed: state.seed, rng: state.rng.state(), score: state.score, state: data })); },
      endRun(run) {
        if (state.over) return;
        state.over = true; state.dirty = true; state.overAt = performance.now();
        store.del(saveKey(mode));
        const finalScore = Math.round(run.score);
        const newBest = finalScore > state.best;
        if (newBest) { store.set(bestKey, String(finalScore)); setBest(finalScore); }
        store.set(`inad:runs:${slug}`, String((Number(store.get(`inad:runs:${slug}`)) || 0) + 1));
        setResult({ ...run, score: finalScore, newBest: newBest && finalScore > 0, previousBest: state.best });
        if (newBest) state.best = finalScore;
        trackEvent('game_complete', { game_id: slug, score: finalScore, mode, duration_s: Math.round((performance.now() - state.started) / 1000), play_s: playedSinceReport(), new_best: newBest && finalScore > 0, agent_mode: agentMode });
      },
      shake(pixels) { if (!state.reducedMotion) state.shake = Math.max(state.shake, pixels); },
      hitStop(ms) { state.freezeUntil = Math.max(state.freezeUntil, performance.now() + Math.min(ms, 220)); },
    };

    let game: Game;
    try { game = module.create(host, savedState); }
    catch (error) {
      console.error('[game] could not restore saved run', error);
      store.del(saveKey(mode));
      state.rng = makeRng(seed); state.seed = seed; state.score = 0; setScore(0);
      game = module.create(host, null);
    }
    gameRef.current = game;
    if (savedState !== null) setShowHint(false); // a resumed run needs no tutorial
    store.set('inad:last-game', slug);
    trackEvent('game_start', { game_id: slug, mode, replay: runKey > 0, resumed: savedState !== null, agent_mode: agentMode });

    // Most runs of an endless game never reach a game over, so time played is
    // reported when a run is left as well: on restart, mode switch, navigation
    // or tab close. play_s is active seconds (state.t stops while paused) since
    // the last report, so the two events add up to total play time per game.
    function reportQuit() {
      if (state.over) return;
      const played = playedSinceReport();
      if (played < 1) return;
      trackEvent('game_quit', { game_id: slug, mode, score: state.score, play_s: played, agent_mode: agentMode });
    }
    window.addEventListener('pagehide', reportQuit);

    // ---- Frame loop ---------------------------------------------------------
    let raf = 0, last = performance.now(), lastCount = 0;
    const bloom = module.bloom ?? 0.5;
    function frame(nowMs: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(1 / 30, Math.max(0, (nowMs - last) / 1000));
      last = nowMs;

      let running = state.pause === null && !document.hidden;
      if (running && state.countdown > 0) {
        state.countdown -= dt;
        const shown = Math.max(0, Math.ceil(state.countdown / 0.5));
        if (shown !== lastCount) { lastCount = shown; setCountdown(shown); if (shown > 0) sfx.click(); }
        running = false; state.dirty = true;
      }
      const frozen = nowMs < state.freezeUntil;
      if (running && !frozen) { state.t += dt; try { game.update(dt); } catch (error) { console.error('[game] update failed', error); } }
      if (!running && !state.dirty) return;
      state.dirty = false;

      sceneCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      sceneCtx.globalAlpha = 1; sceneCtx.globalCompositeOperation = 'source-over';
      try { game.render(sceneCtx, state.t); } catch (error) { console.error('[game] render failed', error); }

      let ox = 0, oy = 0;
      if (state.shake > 0.3) {
        ox = (Math.random() * 2 - 1) * state.shake * state.dpr; oy = (Math.random() * 2 - 1) * state.shake * state.dpr;
        state.shake *= Math.exp(-14 * dt);
        state.dirty = true;
      } else state.shake = 0;

      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalCompositeOperation = 'source-over'; main.globalAlpha = 1;
      main.drawImage(scene, ox, oy);
      if (ox || oy) {
        // Fill the sliver the shake exposes with the scene's own edge colour.
        main.globalCompositeOperation = 'destination-over'; main.drawImage(scene, 0, 0); main.globalCompositeOperation = 'source-over';
      }
      if (bloom > 0) {
        // Bloom without shaders: shrink the frame twice, then add it back enlarged.
        aCtx.drawImage(scene, 0, 0, bloomA.width, bloomA.height);
        bCtx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
        main.globalCompositeOperation = 'lighter';
        main.imageSmoothingEnabled = true; main.imageSmoothingQuality = 'high';
        main.globalAlpha = bloom * 0.42; main.drawImage(bloomA, ox, oy, canvas.width, canvas.height);
        main.globalAlpha = bloom * 0.5; main.drawImage(bloomB, ox, oy, canvas.width, canvas.height);
        main.globalAlpha = 1; main.globalCompositeOperation = 'source-over';
      }
    }
    raf = requestAnimationFrame(frame);

    // ---- Input --------------------------------------------------------------
    function point(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * (state.w / rect.width), y: (event.clientY - rect.top) * (state.h / rect.height) };
    }
    function interacted() {
      if (state.interacted) return;
      state.interacted = true; setShowHint(false);
      trackEvent('first_play', { game_id: slug, elapsed_ms: Math.round(performance.now() - state.started) });
    }
    const blocked = () => state.pause !== null || state.over || state.countdown > 0;
    function onDown(event: PointerEvent) {
      sfx.unlock();
      if (blocked()) return;
      interacted();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* not all pointers capture */ }
      game.pointer?.({ type: 'down', ...point(event) });
    }
    function onMove(event: PointerEvent) { if (!blocked()) game.pointer?.({ type: 'move', ...point(event) }); }
    function onUp(event: PointerEvent) { if (!blocked()) game.pointer?.({ type: 'up', ...point(event) }); }
    function onLeave(event: PointerEvent) { if (!blocked()) game.pointer?.({ type: 'leave', ...point(event) }); }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);

    function onKey(event: KeyboardEvent) {
      if (state.pause === 'agent') return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const down = event.type === 'keydown';
      if (down && !event.repeat) {
        if (state.over) {
          // Give the score a moment on screen: keys mashed during the last move must not skip it.
          if (event.code === 'Enter' || event.code === 'Space' || event.code === 'KeyR') { event.preventDefault(); if (performance.now() - state.overAt > 700) setRunKey((k) => k + 1); }
          return;
        }
        if (event.code === 'KeyP' || event.code === 'Escape') {
          event.preventDefault();
          if (state.pause === null) setPause('manual'); else setPause(null, true);
          return;
        }
        if (event.code === 'KeyM') { sfx.setMuted(!sfx.muted); setMuted(sfx.muted); return; }
      }
      if (blocked()) return;
      if (down) { sfx.unlock(); interacted(); }
      if (/^(Space|Arrow)/.test(event.code)) event.preventDefault();
      game.key?.(event.code, down);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    function onBlur() { if (module.realtime && state.pause === null && !state.over && state.interacted) setPause('blur'); }
    function onVisibility() { if (document.hidden) onBlur(); else { last = performance.now(); state.dirty = true; } }
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    const observer = new ResizeObserver(measure);
    observer.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pagehide', reportQuit);
      reportQuit();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      try { game.destroy?.(); } catch { /* nothing to clean */ }
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, module, mode, runKey]);

  // ---- Agent Mode -----------------------------------------------------------
  const lastNotice = useRef('');
  useEffect(() => {
    const noticeKey = agent.notice ? `${agent.notice.run}:${agent.notice.revision}` : '';
    if (noticeKey) {
      setPause('agent');
      if (lastNotice.current !== noticeKey) sfxRef.current?.chime();
    } else if (live.current.pause === 'agent') {
      setPause(null, true);
    }
    lastNotice.current = noticeKey;
  }, [agent.notice, setPause, runKey]);

  // Tab title carries the agent's status, so it is visible from another window.
  const needsYou = agent.paired && !!agent.notice;
  useEffect(() => {
    if (!agent.paired) return;
    const base = `${title} · I Need a Distraction`;
    if (!needsYou) { document.title = agent.state === 'working' ? `▶ ${base}` : base; return; }
    let on = false;
    document.title = '● Your agent needs you';
    const timer = setInterval(() => { on = !on; document.title = on ? `${title} (paused)` : '● Your agent needs you'; }, 1100);
    return () => { clearInterval(timer); document.title = base; };
  }, [needsYou, agent.paired, agent.state, title]);

  // ---- Actions --------------------------------------------------------------
  function again() { if (live.current.over && performance.now() - live.current.overAt < 700) return; sfxRef.current?.unlock(); setRunKey((k) => k + 1); }
  function switchMode(next: Mode) { if (next !== mode) { setMode(next); setRunKey(0); } }
  function toggleMute() { const sfx = sfxRef.current; if (!sfx) return; sfx.unlock(); sfx.setMuted(!sfx.muted); setMuted(sfx.muted); }
  function restart() {
    if (!live.current.over && live.current.score > 0 && !confirm('Start over? This run will be lost.')) return;
    store.del(saveKey(mode)); live.current.overAt = 0; again();
  }
  async function share() {
    if (!result) return;
    const url = `${window.location.origin}/games/${slug}?utm_source=share&utm_medium=friend`;
    const text = `${title}: ${result.score.toLocaleString()}${mode === 'daily' ? ` on the ${today()} daily` : ''}. Your turn.`;
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ title, text, url }); setShareNote('Shared.'); }
      else { await navigator.clipboard.writeText(`${text} ${url}`); setShareNote('Copied. Paste it to a friend.'); }
      trackShareClick({ method: typeof navigator.share === 'function' ? 'native' : 'clipboard', content_type: 'game', content_id: slug });
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setShareNote('Could not share. Copy the page address instead.'); }
  }

  const gap = result && !result.newBest && result.previousBest > result.score ? result.previousBest - result.score : 0;

  return (
    <div className="stage" style={{ '--accent': accent } as React.CSSProperties}>
      <header className="stage-bar">
        <Link href="/" className="stage-back" aria-label="Back to all games">←</Link>
        <div className="stage-title">
          <strong>{title}</strong>
          <span className="stage-modes" role="group" aria-label="Game mode">
            <button aria-pressed={mode === 'endless'} onClick={() => switchMode('endless')}>Endless</button>
            <button aria-pressed={mode === 'daily'} onClick={() => switchMode('daily')} title="Same seed for everyone today">Daily</button>
          </span>
        </div>
        <div className="stage-score" aria-live="off">
          <b>{score.toLocaleString()}</b>
          <small>{best > 0 ? `${mode === 'daily' ? 'Today' : 'Best'} ${best.toLocaleString()}` : mode === 'daily' ? 'Daily seed' : 'No best yet'}{status ? ` · ${status}` : ''}</small>
        </div>
        <div className="stage-tools">
          <button onClick={toggleMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'} title="Sound (M)">{muted ? '🔇' : '🔊'}</button>
          <button onClick={restart} aria-label="Restart" title="Restart">↻</button>
          <button onClick={() => (pause === null ? setPause('manual') : setPause(null, true))} aria-label={pause === null ? 'Pause' : 'Resume'} title="Pause (P)">{pause === null ? '❙❙' : '▶'}</button>
        </div>
      </header>

      <AgentQueue agent={agent} />

      <div className="stage-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label={`${title} game`} />
        {showHint && !result && pause === null && <p className={`stage-hint${module.hintAt === 'top' ? ' stage-hint-top' : ''}`}>{hint}</p>}

        {countdown > 0 && pause === null && <div className="stage-countdown" aria-hidden="true">{countdown}</div>}

        {(pause === 'manual' || pause === 'blur') && !result && (
          <div className="stage-overlay" role="dialog" aria-label="Paused">
            <p className="overlay-eyebrow">PAUSED</p>
            <h2>Take your time.</h2>
            <button className="overlay-primary" autoFocus onClick={() => setPause(null, true)}>Resume <kbd>P</kbd></button>
          </div>
        )}

        {result && pause !== 'agent' && (
          <div className="stage-overlay result" role="dialog" aria-label="Run complete">
            <p className="overlay-eyebrow">{result.headline ?? 'RUN COMPLETE'}{mode === 'daily' ? ' · DAILY' : ''}</p>
            <div className="result-score">{result.score.toLocaleString()}</div>
            {result.newBest ? <p className="result-best">New best{result.previousBest > 0 ? `, up from ${result.previousBest.toLocaleString()}` : ''}.</p>
              : gap > 0 ? <p className="result-gap">{gap.toLocaleString()} short of your best.</p> : null}
            {result.detail && <p className="result-detail">{result.detail}</p>}
            <div className="result-actions">
              <button className="overlay-primary" autoFocus onClick={again}>Play again <kbd>↵</kbd></button>
              <button className="overlay-ghost" onClick={share}>Share score</button>
            </div>
            {shareNote && <p className="result-note" role="status">{shareNote}</p>}
            <div className="result-others">
              {others.map((other) => <Link key={other.slug} href={`/games/${other.slug}`}><span aria-hidden="true">{other.emoji}</span>{other.title}</Link>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
