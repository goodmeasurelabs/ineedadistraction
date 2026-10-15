'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Widget } from '../lib/store';
import { trackContentEngagement, trackToolUse, trackShareClick, trackCTAClick } from '../lib/analytics';

function storedVotes(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('voted_widgets') ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

function saveVotes(ids: string[]) {
  try { localStorage.setItem('voted_widgets', JSON.stringify(ids)); } catch { /* Voting still works when storage is blocked. */ }
}

const COLORS = ['#425346', '#54435c', '#475767', '#735345', '#52624b', '#4f5b56'];

export default function WidgetCard({ widget, onPlay }: { widget: Widget; onPlay: (widget: Widget) => void }) {
  const router = useRouter();
  const [votes, setVotes] = useState(widget.votes);
  const [voted, setVoted] = useState(false);
  const [voting, setVoting] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { setVoted(storedVotes().includes(widget.id)); }, [widget.id]);
  const color = COLORS[Array.from(widget.id).reduce((sum, c) => sum + c.charCodeAt(0), 0) % COLORS.length];

  function play() {
    trackContentEngagement({ content_type: 'game', content_id: widget.id, engagement_type: 'interaction' });
    onPlay(widget);
  }

  async function handleVote() {
    if (voting) return;
    setVoting(true);
    setStatus('');
    try {
      const res = await fetch(`/api/widgets/${widget.id}/vote`, { method: voted ? 'DELETE' : 'POST' });
      if (!res.ok) throw new Error('Vote failed');
      const ids = storedVotes();
      saveVotes(voted ? ids.filter((id) => id !== widget.id) : [...new Set([...ids, widget.id])]);
      setVotes((count) => Math.max(0, count + (voted ? -1 : 1)));
      setVoted(!voted);
      trackToolUse('game', voted ? 'unlike' : 'like', widget.id);
    } catch { setStatus('Couldn’t save your like. Try again.'); }
    finally { setVoting(false); }
  }

  async function share() {
    try {
      const native = typeof navigator.share === 'function';
      const url = `${window.location.origin}/play/${widget.id}?utm_source=share&utm_medium=friend`;
      if (native) await navigator.share({ title: widget.title, text: 'Your next tiny distraction.', url });
      else await navigator.clipboard.writeText(url);
      setStatus(native ? 'Shared. Pass the fun along.' : 'Link copied. Pass the fun along.');
      trackShareClick({ method: native ? 'native' : 'clipboard', content_type: 'game', content_id: widget.id });
    } catch { setStatus('Couldn’t copy the link. Open the game to share its address.'); }
  }

  return (
    <article className="game-card">
      <a href={`/play/${widget.id}`} className="game-card-art" style={{ '--card-color': color } as React.CSSProperties} onClick={() => trackContentEngagement({ content_type: 'game', content_id: widget.id, engagement_type: 'interaction' })} aria-label={`Play ${widget.title}`}>
        <span aria-hidden="true">{widget.emoji}</span><span className="card-type">{widget.type === 'user-created' ? 'COMMUNITY MADE' : 'A LITTLE CLASSIC'}</span><span className="card-play-label" aria-hidden="true">PLAY SOMETHING GOOD ↗</span>
      </a>
      <div className="game-card-body">
        <h3>{widget.title}</h3>
        <p className="game-card-description">{widget.description}</p>
        <p className="game-card-credit">{widget.author && widget.type === 'user-created' ? `Made by ${widget.author}` : 'A quick escape'}{widget.parent ? ` · A twist on ${widget.parent.title}` : ''}</p>
        <div className="game-card-actions">
          <a href={`/play/${widget.id}`} className="game-card-play">Play now ↗</a>
          {(widget.html || widget.hasHtml) && widget.remixable !== false && <button className="game-card-remix" onClick={() => { trackCTAClick({ cta_text: 'Remix', cta_location: 'widget_card' }); router.push(`/template/${widget.id}`); }} aria-label={`Remix ${widget.title}`}>Remix ✧</button>}
          <button className="game-card-like" onClick={handleVote} disabled={voting} aria-label={voted ? `Unlike ${widget.title}` : `Like ${widget.title}`} aria-pressed={voted}>{voted ? '♥' : '♡'}{widget.type === 'user-created' && votes > 0 ? ` ${votes}` : ''}</button>
          <button className="game-card-share" onClick={share} aria-label={`Copy link to ${widget.title}`}>↗</button>
        </div>
        {status && <p className="game-card-status" role="status">{status}</p>}
      </div>
    </article>
  );
}
