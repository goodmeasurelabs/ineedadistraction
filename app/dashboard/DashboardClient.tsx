'use client';

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, UserButton, SignInButton } from "@clerk/nextjs";
import type { Widget } from "@/app/lib/store";
import type { Draft } from "@/app/lib/drafts";
import WidgetCard from "@/app/components/WidgetCard";
import CreateModal from "@/app/components/CreateModal";
import MagicArcade from "@/app/components/MagicArcade";
import { trackCTAClick, trackContentEngagement } from "@/app/lib/analytics";

type Sort = "trending" | "new" | "mine";

async function safeJson<T>(res: Response): Promise<T | { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: res.ok ? 'Unexpected server response' : `Request failed with ${res.status}` };
  }
}

function WelcomeBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-2xl p-4 mb-6 flex items-center justify-between neon-glow-pink">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🎉</span>
        <p className="font-semibold">
          You're signed in! Your games and drafts are ready when you are.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="opacity-70 hover:opacity-100 text-lg ml-4"
      >
        ✕
      </button>
    </div>
  );
}

function HomeContent({ initialWidgets }: { initialWidgets: Widget[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSignedIn } = useAuth();
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [sort, setSort] = useState<Sort>(() => {
    const tab = searchParams.get("tab");
    if (tab === "new" || tab === "mine") return tab;
    return "trending";
  });
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [myWidgets, setMyWidgets] = useState<Widget[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [deletingDraft, setDeletingDraft] = useState<string | null>(null);
  const [busyWidget, setBusyWidget] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    searchParams.get("welcome") === "1"
  );

  useEffect(() => {
    if (sort === "mine" && isSignedIn) {
      setMyLoading(true);
      Promise.all([
        fetch("/api/widgets?filter=mine").then((r) => safeJson<Widget[]>(r)),
        fetch("/api/drafts").then((r) => safeJson<Draft[]>(r))
      ]).then(([widgets, draftData]) => {
        setMyWidgets(Array.isArray(widgets) ? widgets : []);
        setDrafts(Array.isArray(draftData) ? draftData : []);
        setMyLoading(false);
      }).catch((error) => {
        console.error("[dashboard] mine fetch failed", error);
        setMyWidgets([]);
        setDrafts([]);
        setMyLoading(false);
      });
    }
  }, [sort, isSignedIn]);

  async function handleDeleteDraft(draftId: string) {
    setDeletingDraft(draftId);
    await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    setDeletingDraft(null);
  }

  async function handleUnpublish(widget: Widget) {
    if (!confirm(`Take "${widget.title}" off the market? You can republish anytime.`)) return;
    setBusyWidget(widget.id);
    try {
      const res = await fetch(`/api/widgets/${widget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: false }),
      });
      if (!res.ok) throw new Error("Failed");
      setMyWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, published: false } : w)));
    } finally {
      setBusyWidget(null);
    }
  }

  async function handleRepublish(widget: Widget) {
    setBusyWidget(widget.id);
    try {
      const res = await fetch(`/api/widgets/${widget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: true }),
      });
      if (!res.ok) throw new Error("Failed");
      setMyWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, published: true } : w)));
    } finally {
      setBusyWidget(null);
    }
  }

  async function handleDeleteWidget(widget: Widget) {
    if (!confirm(`Permanently delete "${widget.title}"? This removes the game and all its votes — can't be undone.`)) return;
    setBusyWidget(widget.id);
    try {
      const res = await fetch(`/api/widgets/${widget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setMyWidgets((prev) => prev.filter((w) => w.id !== widget.id));
    } finally {
      setBusyWidget(null);
    }
  }

  function handleTabChange(tab: Sort) {
    trackContentEngagement({ content_type: 'sort_tab', content_id: tab, engagement_type: 'interaction' });
    setSort(tab);
    const url = new URL(window.location.href);
    if (tab === "trending") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }

  const sorted = [...widgets].sort((a, b) =>
    sort === "trending" ? b.views - a.views || b.createdAt - a.createdAt : b.createdAt - a.createdAt
  );

  return (
    <div className="distraction-home">
      <header className="distraction-header">
        <div className="distraction-nav">
          <a className="distraction-brand" href="/" aria-label="I Need a Distraction home"><span className="brand-symbol" aria-hidden="true">✳</span><span>i need a<br /><strong>distraction.</strong></span></a>
          <nav aria-label="Main navigation" className="distraction-nav-links">
            <a href="#community" onClick={() => handleTabChange('trending')}>The arcade</a>
            <button onClick={() => handleTabChange('mine')}>My games</button>
          </nav>
          <div className="distraction-account">
            {isSignedIn ? <UserButton /> : <SignInButton mode="redirect"><button className="magic-sign-in">Sign in</button></SignInButton>}
            <button className="magic-nav-create" onClick={() => { trackCTAClick({ cta_text: 'Make a game', cta_location: 'header' }); setShowCreate(true); }}>Make a game <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </header>
      <main className="distraction-main">
        {showWelcome && <WelcomeBanner onDismiss={() => setShowWelcome(false)} />}
        {sort !== 'mine' && <MagicArcade />}
        <section className="community-intro" id="community">
          <div><p className="magic-eyebrow">SMALL GAMES. VERY GOOD DISTRACTIONS.</p><h2>{sort === 'mine' ? 'Your little universe.' : 'Find your next “one more.”'}</h2></div>
          <p>{sort === 'mine' ? 'Keep a good idea going.' : 'Pick a game. Get curious. Put your own spin on it.'}</p>
        </section>

        {/* Sort tabs */}
        <div className="discovery-tabs">
          {(
            [
              ["trending", "Discover"],
              ["new", "Fresh finds"],
              ["mine", "My games"]
            ] as [Sort, string][]
          ).map(([s, label]) => (
            <button
              key={s}
              onClick={() => handleTabChange(s)}
              aria-pressed={sort === s}
              className={sort === s ? 'discovery-tab selected' : 'discovery-tab'}
            >
              {label}
            </button>
          ))}
          <span className="discovery-count">
            {sort === "mine"
              ? `${myWidgets.length} games`
              : `${widgets.length} games`}
          </span>
        </div>

        {/* Game grid */}
        {sort === "mine" ? (
          !isSignedIn ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <p className="text-5xl">🔐</p>
              <h3 className="font-pixel text-sm text-purple-100">
                Sign in to see your games
              </h3>
              <p className="text-purple-300/50 text-sm">
                All the games you create will appear here.
              </p>
            </div>
          ) : myLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-52 rounded-2xl bg-[#150f24] border border-purple-500/10 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Drafts section */}
              {drafts.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-purple-300/60 uppercase tracking-wide mb-3">
                    Drafts ({drafts.length})
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {drafts.map((draft) => {
                      // Drafts whose templateId matches one of your published widgets
                      // are edit-mode sessions, not standalone remixes — resume in
                      // edit mode so save commits back to the widget instead of
                      // creating a new one.
                      const isEditDraft = myWidgets.some((w) => w.id === draft.templateId);
                      const continueUrl = isEditDraft
                        ? `/template/${draft.templateId}?edit=1&draft=${draft.id}`
                        : `/template/${draft.templateId}?draft=${draft.id}`;
                      return (
                      <div
                        key={draft.id}
                        className="flex flex-col gap-3 p-4 rounded-2xl border-2 border-dashed border-purple-500/25 bg-[#150f24]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{draft.emoji}</span>
                            <div>
                              <p className="font-bold text-purple-100 text-sm leading-tight">
                                {draft.title}
                              </p>
                              <p className="text-xs text-purple-300/40">
                                {new Date(draft.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                            isEditDraft
                              ? 'bg-amber-900/30 text-amber-400 border border-amber-700/40'
                              : 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40'
                          }`}>
                            {isEditDraft ? 'editing published' : 'draft'}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-auto">
                          <button
                            onClick={() => router.push(continueUrl)}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-2 rounded-xl transition-colors"
                          >
                            {isEditDraft ? 'Resume editing →' : 'Continue editing →'}
                          </button>
                          <button
                            onClick={() => handleDeleteDraft(draft.id)}
                            disabled={deletingDraft === draft.id}
                            className="text-xs text-purple-300/40 hover:text-red-400 px-2 py-2 rounded-xl hover:bg-red-900/20 transition-colors disabled:opacity-40"
                          >
                            {deletingDraft === draft.id ? "..." : "🗑"}
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const publishedMine = myWidgets.filter((w) => w.published !== false);
                const unpublishedMine = myWidgets.filter((w) => w.published === false);
                const empty = myWidgets.length === 0 && drafts.length === 0;

                if (empty) {
                  return (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                      <p className="text-5xl">🎮</p>
                      <h3 className="font-pixel text-sm text-purple-100">
                        No games yet
                      </h3>
                      <p className="text-purple-300/50 text-sm">
                        Create your first game and it'll show up here!
                      </p>
                      <button
                        onClick={() => setShowCreate(true)}
                        className="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold px-5 py-2.5 rounded-xl neon-glow-purple"
                      >
                        ✨ Create a Game
                      </button>
                    </div>
                  );
                }

                return (
                  <>
                    {publishedMine.length > 0 && (
                      <div>
                        {drafts.length > 0 && (
                          <h3 className="text-sm font-semibold text-purple-300/60 uppercase tracking-wide mb-3">
                            Published ({publishedMine.length})
                          </h3>
                        )}
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {publishedMine.map((widget) => (
                            <div key={widget.id} className="flex flex-col gap-2">
                              <WidgetCard
                                widget={widget}
                                onPlay={(w) => router.push(`/play/${w.id}`)}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => router.push(`/template/${widget.id}?edit=1`)}
                                  className="flex-1 text-xs font-semibold text-purple-100 bg-[#150f24] border border-purple-500/30 hover:border-purple-400 rounded-xl py-2 transition-colors"
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  onClick={() => handleUnpublish(widget)}
                                  disabled={busyWidget === widget.id}
                                  className="flex-1 text-xs font-semibold text-amber-400 bg-[#150f24] border border-amber-700/40 hover:border-amber-500 rounded-xl py-2 transition-colors disabled:opacity-50"
                                >
                                  {busyWidget === widget.id ? "…" : "👁️‍🗨️ Unpublish"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {unpublishedMine.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-purple-300/60 uppercase tracking-wide mb-3">
                          Unpublished ({unpublishedMine.length})
                        </h3>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {unpublishedMine.map((widget) => (
                            <div
                              key={widget.id}
                              className="flex flex-col gap-3 p-4 rounded-2xl border-2 border-dashed border-amber-700/40 bg-amber-900/10"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl opacity-60">{widget.emoji}</span>
                                  <div>
                                    <p className="font-bold text-purple-100 text-sm leading-tight">
                                      {widget.title}
                                    </p>
                                    <p className="text-xs text-purple-300/40">
                                      {widget.votes} {widget.votes === 1 ? "vote" : "votes"} · hidden
                                    </p>
                                  </div>
                                </div>
                                <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-amber-900/30 text-amber-400 border border-amber-700/40">
                                  unpublished
                                </span>
                              </div>
                              <div className="flex gap-2 mt-auto">
                                <button
                                  onClick={() => handleRepublish(widget)}
                                  disabled={busyWidget === widget.id}
                                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-2 rounded-xl transition-colors disabled:opacity-50"
                                >
                                  {busyWidget === widget.id ? "…" : "🚀 Republish"}
                                </button>
                                <button
                                  onClick={() => router.push(`/template/${widget.id}?edit=1`)}
                                  className="text-xs text-purple-300/60 hover:text-purple-200 px-3 py-2 rounded-xl border border-purple-500/20 hover:border-purple-400 transition-colors"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => handleDeleteWidget(widget)}
                                  disabled={busyWidget === widget.id}
                                  className="text-xs text-purple-300/40 hover:text-red-400 px-2 py-2 rounded-xl hover:bg-red-900/20 transition-colors disabled:opacity-40"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )
        ) : loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-52 rounded-2xl bg-[#150f24] border border-purple-500/10 animate-pulse"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="arcade-empty" role="status"><p>The community arcade couldn’t load just now.</p><p>You can still play Orbit Pop above, or refresh to try again.</p><button className="magic-nav-create" onClick={() => window.location.reload()}>Try again ↻</button></div>
        ) : sorted.length === 0 ? (
          <div className="arcade-empty"><h3>A little room for something new.</h3><p>Play the featured game above, or make the first community distraction.</p><button className="magic-primary" onClick={() => setShowCreate(true)}>Make a game ↗</button></div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sorted.map((widget) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                onPlay={(w) => router.push(`/play/${w.id}`)}
              />
            ))}
          </div>
        )}

        <section className="arcade-outro">
          <span aria-hidden="true">✧</span>
          <h3>A good break can turn into a great idea.</h3>
          <button onClick={() => setShowCreate(true)}>Start with a game. Make it yours. ↗</button>
        </section>
        <footer className="distraction-footer">
          <span>A little corner of the internet for playing.</span>
          <div><span>© {new Date().getFullYear()} I Need a Distraction</span><a href="/make-a-game">AI game maker</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
        </footer>
      </main>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export default function DashboardClient({ initialWidgets }: { initialWidgets: Widget[] }) {
  return (
    <Suspense>
      <HomeContent initialWidgets={initialWidgets} />
    </Suspense>
  );
}
