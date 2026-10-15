'use client';

import { trackShareClick, trackEvent } from '../../lib/analytics';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import type { Widget } from '../../lib/store';
import BrainTeaser from '../../components/BrainTeaser';
import MemoryGame from '../../components/MemoryGame';
import FactGenerator from '../../components/FactGenerator';

function BuiltinGame({ component, onBack }: { component: string; onBack: () => void }) {
  switch (component) {
    case 'BrainTeaser':  return <BrainTeaser onBack={onBack} />;
    case 'MemoryGame':   return <MemoryGame onBack={onBack} />;
    case 'FactGenerator':return <FactGenerator onBack={onBack} />;
    default: return <p className="text-center text-purple-300/50 p-8">Game not found</p>;
  }
}

function NewGameBanner() {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  async function handleCopy() {
    try { await navigator.clipboard.writeText(window.location.href.split('?')[0] + '?from=author&utm_source=share&utm_medium=creator'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* Page address is also shareable. */ }
  }

  return (
    <div className="shrink-0 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm">Your game is live!</span>
        <span className="text-sm opacity-80">Share it with anyone.</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button onClick={() => setVisible(false)} className="opacity-60 hover:opacity-100 text-sm">
          ✕
        </button>
      </div>
    </div>
  );
}

function formatCount(n: number, singular: string, plural: string) {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

function PlayPageInner({ id, initialWidget }: { id: string; initialWidget: Widget }) {
  const router = useRouter();
  const params = useSearchParams();
  const isNew = params.get('new') === '1';
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  const [widget, setWidget] = useState<Widget | null>(initialWidget);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [votes, setVotes] = useState(initialWidget.votes);
  const [actionError, setActionError] = useState('');
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [reportState, setReportState] = useState<'idle' | 'open' | 'sending' | 'sent'>('idle');

  async function submitReport(reason: string) {
    if (!widget) return;
    setReportState('sending');
    try {
      const response = await fetch(`/api/widgets/${widget.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error();
      setReportState('sent');
    } catch { setReportState('idle'); setActionError('Report could not be sent. Please try again.'); }
  }

  useEffect(() => {
    try { setVoted(JSON.parse(localStorage.getItem('voted_widgets') ?? '[]').includes(id)); } catch { /* Optional local preference. */ }
    const viewKey = `inad_viewed_${id}_${new Date().toISOString().slice(0, 10)}`;
    let seen = false;
    try { seen = !!localStorage.getItem(viewKey); } catch { /* Track without storage. */ }
    if (!seen) fetch(`/api/widgets/${id}/view`, { method: 'POST' }).then(async r => {
      if (!r.ok) return;
      const data = await r.json();
      setWidget(w => w ? { ...w, views: data.views ?? w.views } : w);
      try { localStorage.setItem(viewKey, '1'); } catch { /* Optional. */ }
    }).catch(() => {});
    trackEvent('game_open', { game_id: id, source: params.get('utm_source') ?? 'direct' });
  }, [id]);

  async function handleVote() {
    if (!widget || voting) return;
    setVoting(true); setActionError('');
    try {
      const response = await fetch(`/api/widgets/${id}/vote`, { method: voted ? 'DELETE' : 'POST' });
      if (!response.ok) throw new Error();
      setVotes(v => Math.max(0, v + (voted ? -1 : 1)));
      setVoted(!voted);
      try {
        const raw = JSON.parse(localStorage.getItem('voted_widgets') ?? '[]');
        const stored: string[] = Array.isArray(raw) ? raw : [];
        localStorage.setItem('voted_widgets', JSON.stringify(voted ? stored.filter(v => v !== id) : [...new Set([...stored, id])]));
      } catch { /* Optional. */ }
    } catch { setActionError('Couldn’t save your like. Try again.'); }
    finally { setVoting(false); }
  }

  // Author of this widget? Computed early (with optional chaining on `widget`)
  // so handleShare can use it before the not-found / loading early returns.
  // The share URL gets a `?from=author` tag when the creator shares their own
  // game — drives the "Check out this game I made!" preview in iMessage etc.
  const isAuthor = !!(isSignedIn && user && widget?.userId && widget.userId === user.id);

  async function handleShare() {
    const url = new URL(`/play/${id}`, window.location.origin);
    if (isAuthor) url.searchParams.set('from', 'author');
    url.searchParams.set('utm_source', 'share'); url.searchParams.set('utm_medium', 'friend');
    const native = typeof navigator.share === 'function';
    try {
      if (native) await navigator.share({ title: widget?.title, text: isAuthor ? 'I made this little game. Try it!' : 'Found your next tiny distraction.', url: url.toString() });
      else await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      trackShareClick({ method: native ? 'native' : 'clipboard', content_type: 'game', content_id: id });
      setTimeout(() => setCopied(false), 2500);
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setActionError('Couldn’t share. Copy this page’s address instead.'); }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0a0612] text-white">
        <p className="text-5xl">😕</p>
        <h1 className="font-pixel text-base neon-text">Game not found</h1>
        <button
          onClick={() => router.push('/')}
          className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-purple-500 neon-glow-purple transition-colors"
        >
          Back to all games
        </button>
      </div>
    );
  }

  if (!widget) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0612]">
        <div className="animate-spin text-4xl">⚙️</div>
      </div>
    );
  }

  const canRemix = widget.html && widget.remixable !== false;
  const remixHref = `/template/${widget.id}`;

  return (
    <div className="play-shell h-dvh flex flex-col bg-[#0a0612] text-white overflow-hidden">
      {/* New game banner */}
      {isNew && <NewGameBanner />}

      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-purple-500/25 bg-[#150f24]">
        <button
          onClick={() => router.push('/')}
          className="text-sm text-purple-300/60 hover:text-purple-100 transition-colors"
        >
          ← All games
        </button>

        <div className="flex items-center gap-2">
          <span className="text-lg">{widget.emoji}</span>
          <div className="text-center">
            <h1 className="font-pixel text-[11px] leading-tight neon-text">{widget.title}</h1>
            {widget.author && widget.type === 'user-created' && (
              <p className="text-xs text-purple-300/40">by {widget.author}</p>
            )}
            <div className="mt-1 flex items-center justify-center gap-2 text-[11px] font-arcade text-cyan-300/60 tracking-wide">
              <span>{formatCount(widget.views, 'play', 'plays')}</span>
              <span>•</span>
              <span>{formatCount(widget.remixCount ?? 0, 'remix', 'remixes')}</span>
            </div>
            {widget.parent && (
              <p className="text-[11px] text-purple-300/40">
                remixed from {widget.parent.emoji} {widget.parent.title}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleVote}
            disabled={voting} aria-pressed={voted} title={voted ? 'Unlike' : 'Like this game'}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              voted ? 'bg-purple-800/60 text-purple-300' : 'text-purple-300/50 hover:text-purple-100 hover:bg-purple-500/10'
            }`}
          >
            {voted ? '❤️' : '🤍'} {votes}
          </button>
          <button
            onClick={handleShare}
            title="Share this game" aria-label="Share this game"
            className="text-xs text-purple-300/50 hover:text-purple-100 px-2.5 py-1.5 rounded-lg hover:bg-purple-500/10 transition-colors"
          >
            {copied ? 'Done!' : 'Share ↗'}
          </button>
          {!isAuthor && (
            <button
              onClick={() => setReportState('open')}
              title="Report this game"
              className="text-xs text-purple-300/40 hover:text-red-300 px-2 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              ⚐
            </button>
          )}
          {isAuthor ? (
            <button
              onClick={() => router.push(`/template/${widget.id}?edit=1`)}
              title="You created this — edit it directly"
              className="flex items-center gap-1 text-xs font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-3 py-1.5 rounded-lg hover:from-emerald-500 hover:to-teal-500 transition-all"
            >
              ✏️ Edit
            </button>
          ) : (
            canRemix && (
              <button
                onClick={() => router.push(remixHref)}
                className="flex items-center gap-1 text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-600 text-white px-3 py-1.5 rounded-lg hover:from-purple-500 hover:to-pink-500 neon-glow-purple transition-all"
              >
                ✨ Remix
              </button>
            )
          )}
        </div>
      </header>

      {actionError && <p role="status" className="px-4 py-2 text-sm text-amber-200">{actionError}</p>}
      {/* How to play — collapsible */}
      {widget.description && (
        <div className="shrink-0 border-b border-purple-500/25">
          <button
            onClick={() => setShowHowTo((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-purple-300/60 hover:bg-purple-500/10 transition-colors"
          >
            <span>How to Play</span>
            <span>{showHowTo ? '▲' : '▼'}</span>
          </button>
          {showHowTo && (
            <p className="px-4 pb-3 text-xs text-purple-200/60 leading-relaxed">
              {widget.description}
            </p>
          )}
        </div>
      )}

      {/* Game area — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {widget.type === 'builtin' && widget.component && !widget.html ? (
          <div className="h-full overflow-auto">
            <BuiltinGame component={widget.component} onBack={() => router.push('/')} />
          </div>
        ) : widget.html ? (
          <iframe
            srcDoc={widget.html}
            sandbox="allow-scripts"
            className="w-full h-full block border-0"
            title={widget.title}
          />
        ) : (
          <p className="text-center text-purple-300/50 p-8">No game content</p>
        )}
      </div>

      {/* Report modal */}
      {reportState !== 'idle' && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => reportState !== 'sending' && setReportState('idle')}
        >
          <div
            className="bg-[#150f24] rounded-2xl border border-purple-500/30 w-full max-w-sm p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {reportState === 'sent' ? (
              <>
                <p className="text-3xl">🙏</p>
                <h3 className="mt-2 font-bold text-purple-100">Thanks for the heads-up</h3>
                <p className="mt-1 text-sm text-purple-300/60">We&rsquo;ll review this game.</p>
                <button
                  onClick={() => setReportState('idle')}
                  className="mt-5 w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 rounded-xl transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h3 className="font-bold text-purple-100">Report this game</h3>
                <p className="mt-1 text-sm text-purple-300/60">What&rsquo;s wrong with it?</p>
                <div className="mt-4 flex flex-col gap-2">
                  {([
                    ['inappropriate', '🚫 Inappropriate or offensive'],
                    ['broken', '🐛 Broken / doesn’t work'],
                    ['spam', '🗑 Spam or misleading'],
                    ['other', '⚠️ Something else'],
                  ] as [string, string][]).map(([reason, label]) => (
                    <button
                      key={reason}
                      disabled={reportState === 'sending'}
                      onClick={() => submitReport(reason)}
                      className="w-full text-left text-sm text-purple-100 bg-[#0a0612] border border-purple-500/20 hover:border-pink-400/60 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setReportState('idle')}
                  disabled={reportState === 'sending'}
                  className="mt-4 text-xs text-purple-300/50 hover:text-purple-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayClient({ id, initialWidget }: { id: string; initialWidget: Widget }) {
  return (
    <Suspense>
      <PlayPageInner id={id} initialWidget={initialWidget} />
    </Suspense>
  );
}
