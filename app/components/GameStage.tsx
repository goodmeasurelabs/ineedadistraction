'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createBreakGameHtml, formatScore, getBreakGame, parseScore } from '../lib/breakGames';
import { cardPath, sharePath, shareText, type ShareTarget } from '../lib/share';
import { trackEvent, trackShareClick } from '../lib/analytics';

let firstPlaySent = false;
const pageStarted = typeof performance !== 'undefined' ? performance.now() : 0;

export default function GameStage({ slug, seed, share, location, dailyNumber, onComplete, onHide, footer, label }: {
  slug: string;
  seed: number;
  share: ShareTarget;
  location: string;
  dailyNumber?: number;
  onComplete?: (score: number) => void;
  onHide?: () => void;
  footer?: ReactNode;
  label?: string;
}) {
  const game = getBreakGame(slug);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [score, setScore] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const html = useMemo(() => createBreakGameHtml(slug, seed), [slug, seed]);
  const callbacks = useRef({ onComplete, onHide });
  callbacks.current = { onComplete, onHide };

  useEffect(() => {
    setScore(null);
    setStatus('');
    function onMessage(event: MessageEvent) {
      if (!game || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      const fromGame = data?.source === 'inad-game' && data.slug === slug;
      const fromOrbit = data?.source === 'orbit-pop' && slug === 'orbit-pop';
      if (!fromGame && !fromOrbit) return;
      if (data.event === 'hide') callbacks.current.onHide?.();
      if (data.event === 'start' || data.event === 'replay') {
        setScore(null);
        setStatus('');
        trackEvent('game_start', { game_id: slug, replay: data.event === 'replay', location });
        if (dailyNumber && data.event === 'start') trackEvent('daily_start', { daily_number: dailyNumber, game_id: slug });
        if (!firstPlaySent) {
          firstPlaySent = true;
          trackEvent('first_play', { game_id: slug, elapsed_ms: Math.round(performance.now() - pageStarted) });
        }
      }
      if (data.event === 'complete') {
        const value = parseScore(game.unit, data.score);
        if (value === null) return;
        setScore(value);
        trackEvent('game_complete', { game_id: slug, score: value, location });
        if (dailyNumber) trackEvent('daily_complete', { daily_number: dailyNumber, game_id: slug, score: value });
        callbacks.current.onComplete?.(value);
      }
    }
    window.addEventListener('message', onMessage);
    frameRef.current?.contentWindow?.postMessage({ source: 'arcade-host', event: 'ready-request' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [slug, seed, location, dailyNumber, game]);

  if (!game) return null;

  async function handleShare() {
    if (score === null) return;
    const url = new URL(sharePath(share, score), window.location.origin).toString();
    const text = shareText(share, slug, score);
    const contentId = share.kind === 'daily' ? `daily-${share.number}` : slug;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: share.title, text, url });
        trackShareClick({ method: 'native', content_type: share.kind, content_id: contentId });
        setStatus('Shared. Your friends have a score to beat.');
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        trackShareClick({ method: 'clipboard', content_type: share.kind, content_id: contentId });
        setStatus('Copied. Paste it anywhere.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setStatus('Couldn’t share. Copy the page address instead.');
    }
  }

  return (
    <div className="bb-stage">
      <iframe
        key={`${slug}-${seed}`}
        ref={frameRef}
        srcDoc={html}
        sandbox="allow-scripts"
        title={label ?? `Play ${share.title}`}
        className="bb-frame"
      />
      <div className="bb-stage-bar">
        {score !== null && (
          <div className="bb-result">
            <p><span>Your {game.scoreLabel}</span><strong>{formatScore(game.unit, score)}</strong></p>
            <div className="bb-result-actions">
              <button type="button" className="magic-primary" onClick={handleShare}>Share my score <span aria-hidden="true">↗</span></button>
              <a className="bb-link" href={cardPath(share, score)} target="_blank" rel="noopener" onClick={() => trackShareClick({ method: 'score_card', content_type: share.kind, content_id: share.kind === 'daily' ? `daily-${share.number}` : slug })}>Score card image</a>
            </div>
          </div>
        )}
        {footer && <div className="bb-stage-footer">{footer}</div>}
        <p className="bb-status" role="status">{status}</p>
      </div>
    </div>
  );
}
