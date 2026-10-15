'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createOrbitPopHtml, getOrbitTwist, ORBIT_TWISTS, type OrbitTwist } from '../lib/orbitPop';
import { trackCTAClick, trackEvent, trackShareClick, trackToolUse } from '../lib/analytics';

const IDEAS = [
  { label: 'A cat with a jetpack', prompt: 'Make a one-button game where a cat with a jetpack dodges clouds and collects fish. Playable on a phone, short rounds, and a big replay button.' },
  { label: 'An oddly satisfying garden', prompt: 'Make a cozy little garden game where tapping grows strange glowing plants. No timer, gentle surprises, playable on a phone.' },
  { label: 'Just one more jump', prompt: 'Make a one-button jumping game with surprising platforms, quick restarts, and a score to beat. Keep it simple and playable on a phone.' },
];

export default function MagicArcade() {
  const router = useRouter();
  const params = useSearchParams();
  const [twist, setTwist] = useState<OrbitTwist>(() => getOrbitTwist(params.get('twist')).id);
  const [idea, setIdea] = useState('');
  const [ready, setReady] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [shareStatus, setShareStatus] = useState('');
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const firstPlay = useRef(false);
  const visitStarted = useRef<number | null>(null);
  const config = getOrbitTwist(twist);
  const html = useMemo(() => createOrbitPopHtml(twist, true), [twist]);
  const rawChallenge = params.get('challenge');
  const challenge = rawChallenge && /^\d{1,6}$/.test(rawChallenge) ? Number(rawChallenge) : null;

  function remix() {
    trackCTAClick({ cta_text: 'Make it yours', cta_location: 'instant_arcade' });
    router.push(`/template/orbit-pop?twist=${twist}`);
  }

  useEffect(() => {
    visitStarted.current = performance.now();
    if (params.get('challenge')) trackEvent('challenge_open', { game_id: 'orbit-pop' });
  }, []);

  useEffect(() => {
    try { const best = Number(localStorage.getItem(`orbit-best-${twist}`)); setPersonalBest(best > 0 ? best : null); } catch { setPersonalBest(null); }
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'orbit-pop' || data.twist !== twist) return;
      if (data.event === 'ready') setReady(true);
      if (data.event === 'start' || data.event === 'replay') {
        setScore(null);
        setShareStatus('');
        trackEvent('game_start', { game_id: 'orbit-pop', variant: twist, replay: data.event === 'replay', location: 'homepage' });
        if (!firstPlay.current) {
          firstPlay.current = true;
          trackEvent('first_play', { game_id: 'orbit-pop', elapsed_ms: Math.round(performance.now() - (visitStarted.current ?? performance.now())) });
        }
      }
      if (data.event === 'complete' && Number.isSafeInteger(data.score) && data.score >= 0 && data.score <= 1_000_000) {
        setScore(data.score);
        if (twist !== 'garden') {
          setPersonalBest(best => Math.max(best ?? 0, data.score));
          try { localStorage.setItem(`orbit-best-${twist}`, String(Math.max(Number(localStorage.getItem(`orbit-best-${twist}`)) || 0, data.score))); } catch { /* Playing works without storage. */ }
        }
        trackEvent('game_complete', { game_id: 'orbit-pop', variant: twist, score: data.score });
      }
      if (data.event === 'remix') {
        trackCTAClick({ cta_text: 'Make it yours', cta_location: 'game_result' });
        router.push(`/template/orbit-pop?twist=${twist}`);
      }
    }
    window.addEventListener('message', onMessage);
    // The srcdoc may finish before React hydrates. Ask it to announce readiness
    // again rather than relying only on its initial message or load event.
    frameRef.current?.contentWindow?.postMessage({ source: 'arcade-host', event: 'ready-request' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [twist, router]);

  function selectTwist(next: OrbitTwist) {
    if (next === twist) return;
    trackToolUse('instant_arcade', 'preset_twist', next);
    setReady(false);
    setScore(null);
    setShareStatus('');
    setTwist(next);
  }

  function play() {
    trackCTAClick({ cta_text: 'Play a little', cta_location: 'hero' });
    frameRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    frameRef.current?.contentWindow?.postMessage({ source: 'arcade-host', event: 'start' }, '*');
    frameRef.current?.focus();
  }

  function create(prompt = idea) {
    if (!prompt.trim()) return;
    trackCTAClick({ cta_text: 'Make my game', cta_location: 'idea_bar' });
    router.push(`/template/blank?idea=${encodeURIComponent(prompt.trim().slice(0, 500))}`);
  }

  async function share() {
    const url = new URL('/', window.location.origin);
    url.searchParams.set('twist', twist);
    url.searchParams.set('utm_source', 'challenge');
    url.searchParams.set('utm_medium', 'friend');
    if (score !== null && twist !== 'garden') url.searchParams.set('challenge', String(score));
    const text = score !== null && twist !== 'garden' ? `I got ${score} in ${config.title}. Your turn.` : 'A tiny escape for your next break.';
    try {
      if (navigator.share) {
        await navigator.share({ title: config.title, text, url: url.toString() });
        trackShareClick({ method: 'native', content_type: 'game', content_id: 'orbit-pop' });
        setShareStatus('Shared. Pass the fun along.');
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        trackShareClick({ method: 'clipboard', content_type: 'game', content_id: 'orbit-pop' });
        setShareStatus('Challenge link copied.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareStatus('Couldn’t share. Try copying the page address.');
    }
  }

  async function downloadScore() {
    if (score === null) return;
    try {
      const response = await fetch(`/api/challenge-card?score=${score}&twist=${twist}`);
      if (!response.ok) throw new Error();
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `my-${config.title.toLowerCase().replaceAll(' ', '-')}-${score}.png`;
      link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      trackShareClick({ method: 'score_card_download', content_type: 'game', content_id: 'orbit-pop' });
      setShareStatus('Score card ready. Add it to your story with your challenge link.');
    } catch { setShareStatus('Couldn’t make the score card. The challenge link still works.'); }
  }

  return (
    <>
      <section className="magic-hero" aria-labelledby="magic-title">
        <div className="magic-intro">
          <p className="magic-eyebrow"><span /> A GOOD PLACE TO GET A LITTLE LOST</p>
          <h1 id="magic-title">Less scrolling.<br />More <span className="magic-word">oh, wow.<svg viewBox="0 0 340 20" aria-hidden="true"><path d="M4 13Q155-4 332 9M28 18Q171 4 305 15" /></svg></span></h1>
          <p className="magic-description">Tiny games. Happy accidents. A whole lot of<br className="hidden lg:block" /> “wait, let me try that again.”</p>
          <div className="magic-hero-actions">
            <button className="magic-primary" onClick={play} disabled={!ready}>Play a little <span aria-hidden="true">↗</span></button>
            <a href="#make-something" className="magic-text-link">Make something weird <span aria-hidden="true">✧</span></a>
          </div>
          <p className="magic-footnote">No downloads. No sign-up to play. Just a little joy.</p>
          <div className="magic-margin-note"><span aria-hidden="true">↳</span> Your next good idea might start with a game.</div>
        </div>

        <div className="magic-cabinet">
          <div className="magic-cabinet-top"><span><i /> READY WHEN YOU ARE</span><span>01 / THE LITTLE ARCADE</span></div>
          {challenge !== null && twist !== 'garden' && twist === getOrbitTwist(params.get('twist')).id && <p className="magic-challenge">A friend scored <strong>{challenge}</strong>. Your turn to try.</p>}
          <iframe ref={frameRef} srcDoc={html} sandbox="allow-scripts" title={`Play ${config.title}`} className="magic-game" onLoad={() => setReady(true)} />
          <div className="magic-twists">
            <div className="magic-twists-label"><span>Same game. New feeling.</span><small>Instant presets</small></div>
            <div className="magic-twist-buttons" aria-label="Choose an instant game twist">
              {ORBIT_TWISTS.map((item) => <button key={item.id} onClick={() => selectTwist(item.id)} aria-pressed={twist === item.id}><span aria-hidden="true">{item.id === 'classic' ? '✦' : item.id === 'garden' ? '❋' : '↯'}</span>{item.label}</button>)}
            </div>
            <div className="magic-cabinet-footer"><button onClick={remix}>Remix with AI <span aria-hidden="true">↗</span></button><button onClick={share}>{score !== null && twist !== 'garden' ? `Challenge a friend · ${score} pts` : 'Send a little distraction ↗'}</button></div>
            {twist !== 'garden' && personalBest !== null && <div className="magic-personal-best"><span>Your best on this device: <strong>{personalBest}</strong></span>{score !== null && <button onClick={downloadScore}>Save my score card ↓</button>}</div>}
            <p className="magic-share-status" role="status">{shareStatus}</p>
          </div>
        </div>
      </section>

      <section className="magic-create" id="make-something" aria-labelledby="create-title">
        <div className="magic-create-heading"><span className="magic-asterisk" aria-hidden="true">✳</span><div><p className="magic-eyebrow">YOUR IMAGINATION HAS A PLAY BUTTON</p><h2 id="create-title">What if this was a game?</h2></div><p>One small idea.<br />Your very own rabbit hole.</p></div>
        <form className="magic-idea-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
          <label className="sr-only" htmlFor="game-idea">Your game idea</label>
          <input id="game-idea" value={idea} onChange={(event) => setIdea(event.target.value)} maxLength={500} placeholder="A tiny astronaut running a very chaotic coffee shop…" required />
          <button type="submit" className="magic-primary">Make my game <span aria-hidden="true">↗</span></button>
        </form>
        <div className="magic-ideas"><span>Or follow a curious thought:</span>{IDEAS.map((item) => <button key={item.label} onClick={() => create(item.prompt)}>{item.label} <span aria-hidden="true">↗</span></button>)}</div>
        <p className="magic-create-note">AI builds take a moment. Play, experiment, and refine in the editor.</p>
      </section>
    </>
  );
}
