'use client';

import { useEffect, useState } from 'react';
import GameStage, { type ArcadeControls } from '../engine/GameStage';
import type { GameModule } from '../engine/types';
import { GAMES, getGame } from '../registry';

const LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  afterglow: () => import('../afterglow/game'),
  tessel: () => import('../tessel/game'),
  'critical-mass': () => import('../critical-mass/game'),
  'prime-time': () => import('../prime-time/game'),
};

export default function GameClient({ slug, arcade, allowedSlugs }: { slug: string; arcade?: ArcadeControls; allowedSlugs?: string[] }) {
  const info = getGame(slug)!;
  const [module, setModule] = useState<GameModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setModule(null); setFailed(false);
    LOADERS[slug]().then((loaded) => { if (alive) setModule(loaded.default); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [slug]);

  if (failed) return <div className="stage stage-loading"><p>This game could not load. <a href={`/games/${slug}`}>Try again</a></p></div>;
  if (!module) return <div className="stage stage-loading" style={{ '--accent': info.accent } as React.CSSProperties}><span className="stage-spinner" aria-label="Loading" /></div>;

  const others = GAMES.filter((game) => game.slug !== slug && (!allowedSlugs || allowedSlugs.includes(game.slug))).map(({ slug: s, title, emoji }) => ({ slug: s, title, emoji }));
  return <GameStage key={slug} slug={slug} title={info.title} hint={info.hint} accent={info.accent} module={module} others={others} arcade={arcade} />;
}
