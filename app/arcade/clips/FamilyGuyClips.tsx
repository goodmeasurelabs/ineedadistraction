'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { FAMILY_GUY_CLIPS, shuffledClips } from './catalog';
import { mountClipPlayer } from './youtube';
import './clips.css';

type Props = { suspended: boolean; sound: boolean; onBack(): void };

export default function FamilyGuyClips({ suspended, sound, onBack }: Props) {
  const [deck, setDeck] = useState(() => shuffledClips());
  const [requested, setRequested] = useState(!suspended);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const clip = deck[0];
  const unavailable = useRef(new Set<string>());
  const position = useRef({ id: clip.id, seconds: 0 });
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof mountClipPlayer> | null>(null);
  const initialSound = useRef(sound);
  const showPlayer = requested && !suspended && !error;

  function nextClip() {
    const remaining = deck.slice(1).filter((entry) => !unavailable.current.has(entry.id));
    const next = remaining.length ? remaining : shuffledClips(clip.id, unavailable.current);
    if (!next.length) {
      setError('These three clips are unavailable here.');
      setRequested(false);
      return;
    }
    // Reset even if only one playable clip remains in the collection.
    session.current?.stop();
    position.current = { id: next[0].id, seconds: 0 };
    setDeck(next);
    setNotice('');
    setError('');
    setRequested(true);
  }

  const advance = useRef(nextClip);
  useLayoutEffect(() => { advance.current = nextClip; });
  useLayoutEffect(() => { initialSound.current = sound; session.current?.setSound(sound); }, [sound]);
  useLayoutEffect(() => {
    if (suspended) { setRequested(false); setNotice(''); }
  }, [suspended]);

  useLayoutEffect(() => {
    if (!showPlayer || !host.current) return;
    if (document.hidden) { setRequested(false); return; }
    const element = host.current;
    const bookmark = position.current;
    setNotice('Loading clip…');
    const player = mountClipPlayer(element, clip, {
      start: bookmark.id === clip.id ? bookmark.seconds : 0,
      sound: initialSound.current,
    }, {
      onPlaying: () => setNotice(''),
      onPressPlay: () => setNotice('Press Play in the video if playback hasn’t started.'),
      onEnded: () => advance.current(),
      onUnavailable: () => { unavailable.current.add(clip.id); advance.current(); },
      onFailure: (message) => { setError(message); setRequested(false); },
    });
    session.current = player;
    function pause() {
      if (session.current !== player) return;
      player.stop();
      setRequested(false);
      setNotice('');
    }
    const visibilityChanged = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pause);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.intersectionRatio < 0.5)) pause();
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.removeEventListener('pagehide', pause);
      document.removeEventListener('visibilitychange', visibilityChanged);
      bookmark.seconds = player.stop();
      session.current = null;
    };
    // The deck changes on every Next, including a replay of the only available clip.
  }, [showPlayer, clip, deck]);

  function resume() {
    if (suspended || document.hidden) return;
    if (unavailable.current.size === FAMILY_GUY_CLIPS.length) unavailable.current.clear();
    setError('');
    setRequested(true);
  }

  return (
    <section className="family-clips" aria-label="Family Guy clips">
      <div className="family-clips-heading">
        <button type="button" onClick={onBack}>← Games</button>
        <h1>Family Guy clips</h1>
      </div>
      <div className="family-clips-screen">
        {showPlayer ? <div key="player" className="family-clips-frame" ref={host} /> : (
          <div key="paused" className="family-clips-rest">
            <strong>{error || 'Clip paused'}</strong>
            {!suspended && <button type="button" onClick={resume}>{error ? 'Try again' : 'Resume clip'}</button>}
          </div>
        )}
      </div>
      <div className="family-clips-caption">
        <div><h2>{clip.title}</h2><p>{clip.channel} on YouTube</p></div>
        <button type="button" disabled={suspended || unavailable.current.size === FAMILY_GUY_CLIPS.length} onClick={nextClip}>Next clip →</button>
      </div>
      <p className="family-clips-status" role="status">{showPlayer && notice}</p>
    </section>
  );
}
