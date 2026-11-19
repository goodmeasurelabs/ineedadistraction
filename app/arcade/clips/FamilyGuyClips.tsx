'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { FAMILY_GUY_CLIPS, shuffledClips } from './catalog';
import { mountClipPlayer, playWhileVisible } from './youtube';
import './clips.css';

type Props = { suspended: boolean; sound: boolean; onBack(): void };

export default function FamilyGuyClips({ suspended, sound, onBack }: Props) {
  const [deck, setDeck] = useState(() => shuffledClips());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const clip = deck[0];
  const unavailable = useRef(new Set<string>());
  const position = useRef({ id: clip.id, seconds: 0 });
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof mountClipPlayer> | null>(null);
  const initialSound = useRef(sound);
  const showPlayer = !suspended && !error;

  function nextClip() {
    const remaining = deck.slice(1).filter((entry) => !unavailable.current.has(entry.id));
    const next = remaining.length ? remaining : shuffledClips(clip.id, unavailable.current);
    if (!next.length) {
      setError('These three clips are unavailable here.');
      return;
    }
    // Reset even if only one playable clip remains in the collection.
    session.current?.stop();
    position.current = { id: next[0].id, seconds: 0 };
    setDeck(next);
    setNotice('');
    setError('');
  }

  const advance = useRef(nextClip);
  useLayoutEffect(() => { advance.current = nextClip; });
  useLayoutEffect(() => { initialSound.current = sound; session.current?.setSound(sound); }, [sound]);
  useLayoutEffect(() => {
    if (!showPlayer || !host.current) return;
    const element = host.current;
    const bookmark = position.current;
    return playWhileVisible(element, () => {
      setNotice('Loading clip…');
      const player = mountClipPlayer(element, clip, {
        start: bookmark.id === clip.id ? bookmark.seconds : 0,
        sound: initialSound.current,
      }, {
        onPlaying: () => setNotice(''),
        onPressPlay: () => setNotice('Press Play in the video to start.'),
        onEnded: () => advance.current(),
        onUnavailable: () => { unavailable.current.add(clip.id); advance.current(); },
        onFailure: setError,
      });
      session.current = player;
      return () => {
        bookmark.seconds = player.stop();
        session.current = null;
      };
    });
    // The deck changes on every Next, including a replay of the only available clip.
  }, [showPlayer, clip, deck]);

  function retry() {
    if (unavailable.current.size === FAMILY_GUY_CLIPS.length) unavailable.current.clear();
    setError('');
  }

  return (
    <section className="family-clips" aria-label="Family Guy clips">
      <div className="family-clips-screen">
        {showPlayer ? <div key="player" className="family-clips-frame" ref={host} /> : (
          <div key="paused" className="family-clips-rest">
            <strong>{error || 'Clip paused'}</strong>
            {error && !suspended && <button type="button" onClick={retry}>Try again</button>}
          </div>
        )}
      </div>
      <div className="family-clips-caption">
        <button type="button" className="family-clips-back" onClick={onBack}>← Games</button>
        <div><h1>{clip.title}</h1><p>{clip.channel} on YouTube</p></div>
        <button type="button" disabled={suspended || unavailable.current.size === FAMILY_GUY_CLIPS.length} onClick={nextClip}>Next clip →</button>
      </div>
      <p className="family-clips-status" role="status">{showPlayer && notice}</p>
    </section>
  );
}
