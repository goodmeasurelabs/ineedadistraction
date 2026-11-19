'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { AgentRunSnapshot } from '../../lib/agentSession';
import { FAMILY_GUY_CLIPS } from './catalog';
import { trackClipTurn, type ClipTurn } from './clipTurn';
import { markClipOffered, selectClip } from './rotation';
import { mountClipPlayer, playWhileVisible } from './youtube';
import './clips.css';

type Props = { foreground?: AgentRunSnapshot; suspended: boolean; sound: boolean; onBack(): void };

export default function FamilyGuyClips({ foreground, suspended, sound, onBack }: Props) {
  // A fresh selection object also restarts playback if only one clip can be embedded.
  const [selection, setSelection] = useState(() => ({ clip: selectClip() ?? FAMILY_GUY_CLIPS[0] }));
  const { clip } = selection;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const unavailable = useRef(new Set<string>());
  const turn = useRef<ClipTurn | undefined>(undefined);
  const bookmark = useRef({ selection, seconds: 0, offered: false });
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof mountClipPlayer> | null>(null);
  const initialSound = useRef(sound);
  const showPlayer = !suspended && !error;

  const nextClip = useCallback(() => {
    const otherClips = new Set(unavailable.current).add(clip.id);
    const next = selectClip(otherClips) ?? selectClip(unavailable.current);
    if (!next) {
      setError(`All ${FAMILY_GUY_CLIPS.length} clips are unavailable here.`);
      return;
    }
    session.current?.stop();
    const nextSelection = { clip: next };
    bookmark.current = { selection: nextSelection, seconds: 0, offered: false };
    setSelection(nextSelection);
    setNotice('');
    setError('');
  }, [clip.id]);

  useLayoutEffect(() => {
    const update = trackClipTurn(turn.current, foreground);
    turn.current = update.turn;
    if (update.rotate && bookmark.current.offered) nextClip();
  }, [foreground, nextClip]);
  useLayoutEffect(() => { initialSound.current = sound; session.current?.setSound(sound); }, [sound]);
  useLayoutEffect(() => {
    const current = bookmark.current;
    if (!showPlayer || !host.current || current.selection !== selection) return;
    const element = host.current;
    return playWhileVisible(element, () => {
      // Count a clip when it is offered in a visible popup, even if the user skips during loading.
      if (!current.offered) {
        markClipOffered(clip.id);
        current.offered = true;
      }
      setNotice('Loading clip…');
      const player = mountClipPlayer(element, clip, {
        start: current.seconds,
        sound: initialSound.current,
      }, {
        onPlaying: () => setNotice(''),
        onPressPlay: () => setNotice('Press Play in the video to start.'),
        onEnded: nextClip,
        onUnavailable: () => { unavailable.current.add(clip.id); nextClip(); },
        onFailure: setError,
      });
      session.current = player;
      return () => {
        current.seconds = player.stop();
        session.current = null;
      };
    });
  }, [showPlayer, clip, selection, nextClip]);

  function retry() {
    if (unavailable.current.size === FAMILY_GUY_CLIPS.length) {
      unavailable.current.clear();
      nextClip();
      return;
    }
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
        <div><h1>{clip.title}</h1><p>{FAMILY_GUY_CLIPS.length} clips · {clip.channel} on YouTube</p></div>
        <button type="button" disabled={suspended || unavailable.current.size === FAMILY_GUY_CLIPS.length} onClick={nextClip}>Next clip →</button>
      </div>
      <p className="family-clips-status" role="status">{showPlayer && notice}</p>
    </section>
  );
}
