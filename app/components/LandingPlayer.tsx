'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GameStage from './GameStage';
import { getBreakGame, randomSeed } from '../lib/breakGames';
import { trackEvent, trackToolUse } from '../lib/analytics';

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function LandingPlayer({ slugs, initialSeed, mode }: { slugs: string[]; initialSeed: number; mode: 'class' | 'work' | 'quick' }) {
  const [slug, setSlug] = useState(slugs[0]);
  const [seed, setSeed] = useState(initialSeed);
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const game = getBreakGame(slug);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const hide = useCallback(() => {
    if (mode !== 'work') return;
    setHidden(true);
    trackToolUse('landing_player', 'hide_screen', slug);
  }, [mode, slug]);

  useEffect(() => {
    if (mode !== 'work') return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setHidden((value) => !value);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  useEffect(() => { if (hidden) docRef.current?.focus(); }, [hidden]);

  function choose(next: string) {
    setSlug(next);
    setSeed(randomSeed());
    trackEvent('another_one_click', { pick_id: next, pick_kind: 'break', location: `landing_${mode}` });
  }

  function another() {
    const others = slugs.filter((s) => s !== slug);
    choose(others[Math.floor(Math.random() * others.length)] ?? slug);
  }

  function projector() {
    trackToolUse('landing_player', 'projector_mode', slug);
    wrapRef.current?.requestFullscreen?.().catch(() => {});
  }

  if (!game) return null;

  return (
    <div className="bb-landing-player" ref={wrapRef}>
      <div className="bb-landing-bar">
        <span className="bb-timer" aria-label={`Break time ${clock(elapsed)}`}>⏱ On break for <strong>{clock(elapsed)}</strong></span>
        <div className="bb-landing-actions">
          {mode === 'class' && <button type="button" className="bb-quiet" onClick={projector}>Projector mode ⤢</button>}
          {mode === 'work' && <button type="button" className="bb-quiet" onClick={hide}>Hide screen (Esc)</button>}
          <button type="button" className="magic-primary" onClick={another}>Another one <span aria-hidden="true">↻</span></button>
        </div>
      </div>
      <div className="bb-chips" role="group" aria-label="Choose a game">
        {slugs.map((s) => {
          const g = getBreakGame(s);
          return g ? <button key={s} type="button" aria-pressed={s === slug} onClick={() => choose(s)}><span aria-hidden="true">{g.emoji}</span> {g.name}</button> : null;
        })}
      </div>
      <GameStage slug={slug} seed={seed} location={`landing_${mode}`} share={{ kind: 'game', slug, title: game.name }} onHide={mode === 'work' ? hide : undefined} />
      {hidden && (
        <div className="bb-cover" ref={docRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Hidden screen. Press Escape or click to return." onClick={() => setHidden(false)}>
          <div className="bb-cover-doc">
            <p className="bb-cover-title">Untitled document</p>
            <h2>Notes</h2>
            <p>Follow up on the open items from Tuesday. Confirm owners and dates before the end of the week.</p>
            <ul><li>Review the draft and leave comments</li><li>Update the tracker with current status</li><li>Send a summary to the group</li></ul>
            <p>Next check-in: same time next week.</p>
            <p className="bb-cover-hint">Press Esc or click anywhere to go back to your game.</p>
          </div>
        </div>
      )}
    </div>
  );
}
