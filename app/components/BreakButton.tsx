'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import GameStage from './GameStage';
import { getBreakGame, makeConfig, randomSeed, variantTitle } from '../lib/breakGames';
import { buildPool, LAST_PICK_KEY, pickNext } from '../lib/distract';
import { trackEvent } from '../lib/analytics';

export type CommunityGame = { id: string; title: string; emoji: string; author?: string };
export type DailyTeaser = { date: string; number: number; title: string; emoji: string; roundLabel: string };

type Current =
  | { kind: 'break'; slug: string; seed: number }
  | { kind: 'community'; game: CommunityGame; html: string | null; failed: boolean };

function orbitSeedFor(twist: string): number {
  for (let seed = 1; seed < 500; seed++) if (makeConfig('orbit-pop', seed).twist === twist) return seed;
  return 1;
}

function readLast(): string | null {
  try { return sessionStorage.getItem(LAST_PICK_KEY); } catch { return null; }
}
function writeLast(id: string) {
  try { sessionStorage.setItem(LAST_PICK_KEY, id); } catch { /* The picker still works without storage. */ }
}

export default function BreakButton({ community, daily }: { community: CommunityGame[]; daily: DailyTeaser }) {
  const params = useSearchParams();
  const pool = useMemo(() => buildPool(community.map((game) => game.id)), [community]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [backToWork, setBackToWork] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const lastRef = useRef<string | null>(null);

  const rawChallenge = params.get('challenge');
  const challenge = rawChallenge && /^\d{1,6}$/.test(rawChallenge) ? Number(rawChallenge) : null;
  const challengeTwist = params.get('twist') === 'chaos' ? 'chaos' : 'classic';

  // A friend's Orbit Pop challenge link (/?challenge=350&twist=classic) opens
  // straight into that game so the old share links keep working.
  useEffect(() => {
    if (challenge !== null) {
      trackEvent('challenge_open', { game_id: 'orbit-pop' });
      setCurrent({ kind: 'break', slug: 'orbit-pop', seed: orbitSeedFor(challengeTwist) });
      lastRef.current = 'orbit-pop';
    }
  }, [challenge, challengeTwist]);

  useEffect(() => {
    if (current) stageRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }, [current]);

  async function load(event: 'distract_me_click' | 'another_one_click') {
    const pick = pickNext(pool, lastRef.current ?? readLast());
    lastRef.current = pick.id;
    writeLast(pick.id);
    setBackToWork(false);
    trackEvent(event, { pick_id: pick.id, pick_kind: pick.kind });
    if (pick.kind === 'break') {
      setCurrent({ kind: 'break', slug: pick.id, seed: randomSeed() });
      return;
    }
    const game = community.find((g) => `community:${g.id}` === pick.id) as CommunityGame;
    setCurrent({ kind: 'community', game, html: null, failed: false });
    trackEvent('game_open', { game_id: game.id, source: 'distract_me' });
    try {
      const response = await fetch(`/api/widgets/${encodeURIComponent(game.id)}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { html?: string };
      if (!data.html) throw new Error();
      setCurrent((now) => now?.kind === 'community' && now.game.id === game.id ? { ...now, html: data.html as string } : now);
    } catch {
      setCurrent((now) => now?.kind === 'community' && now.game.id === game.id ? { ...now, failed: true } : now);
    }
  }

  function goBackToWork() {
    trackEvent('back_to_work_click', { pick_id: lastRef.current ?? '' });
    setCurrent(null);
    setBackToWork(true);
    setTimeout(() => doneRef.current?.focus(), 0);
  }

  const controls = (
    <div className="bb-controls">
      <button type="button" className="magic-primary" onClick={() => load('another_one_click')}>Another one <span aria-hidden="true">↻</span></button>
      <button type="button" className="bb-quiet" onClick={goBackToWork}>Back to work</button>
    </div>
  );

  const breakGame = current?.kind === 'break' ? getBreakGame(current.slug) : undefined;
  const breakTitle = current?.kind === 'break' ? variantTitle(current.slug, makeConfig(current.slug, current.seed)) : '';

  return (
    <section className="bb-hero" aria-labelledby="bb-title">
      <p className="magic-eyebrow"><span /> THE BREAK BUTTON</p>
      <h1 id="bb-title">Need a <span className="magic-word">distraction?</span></h1>
      <p className="bb-lede">One press gives you a tiny game sized for a break. Play it, get a score, get back to work.</p>
      <button type="button" className="bb-button" onClick={() => load('distract_me_click')}>Distract me</button>
      <p className="bb-sub">A tiny game, about 2 minutes · no sign-up · no sound</p>
      {challenge !== null && <p className="bb-challenge">A friend scored <strong>{challenge}</strong> in Orbit Pop. Your turn.</p>}

      {current && (
        <div className="bb-stage-wrap" ref={stageRef}>
          {current.kind === 'break' && breakGame ? (
            <>
              <p className="bb-now"><span aria-hidden="true">{breakGame.emoji}</span> Now playing: <strong>{breakTitle}</strong> · {breakGame.roundLabel} · <a href={`/games/${current.slug}`}>game page</a></p>
              <GameStage slug={current.slug} seed={current.seed} location="distract_me" share={{ kind: 'game', slug: current.slug, title: breakGame.name }} footer={controls} />
            </>
          ) : current.kind === 'community' ? (
            <>
              <p className="bb-now"><span aria-hidden="true">{current.game.emoji}</span> Now playing: <strong>{current.game.title}</strong>{current.game.author ? ` · made by ${current.game.author}` : ''} · <a href={`/play/${current.game.id}`}>full page</a></p>
              <div className="bb-stage">
                {current.html
                  ? <iframe srcDoc={current.html} sandbox="allow-scripts" title={`Play ${current.game.title}`} className="bb-frame" />
                  : <div className="bb-frame bb-loading" role="status">{current.failed ? 'That one wouldn’t load. Try another.' : 'Loading a player-made game…'}</div>}
                <div className="bb-stage-bar"><div className="bb-stage-footer">{controls}</div></div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {backToWork && <p className="bb-done" ref={doneRef} tabIndex={-1}>Back to it. The button will be here for your next break.</p>}

      <a className="bb-daily" href="/daily" onClick={() => trackEvent('cta_click', { cta_text: 'Daily teaser', cta_location: 'home_hero' })}>
        <span className="bb-daily-emoji" aria-hidden="true">{daily.emoji}</span>
        <span><small>TODAY’S DAILY · #{daily.number}</small><strong>{daily.title}</strong><em>Same challenge for everyone today · {daily.roundLabel}</em></span>
        <span aria-hidden="true" className="bb-daily-arrow">↗</span>
      </a>
    </section>
  );
}
