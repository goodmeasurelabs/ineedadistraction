'use client';

import { useState } from 'react';
import GameStage from './GameStage';
import { formatScore, makeConfig, randomSeed, variantTitle, type ScoreUnit } from '../lib/breakGames';
import { trackToolUse } from '../lib/analytics';

export default function GamePlayer({ slug, name, initialSeed, unit, friendScore }: { slug: string; name: string; initialSeed: number; unit: ScoreUnit; friendScore: number | null }) {
  const [seed, setSeed] = useState(initialSeed);
  const variant = variantTitle(slug, makeConfig(slug, seed));
  return (
    <div>
      {friendScore !== null && <p className="bb-challenge">A friend got <strong>{formatScore(unit, friendScore)}</strong> on {name}. Your turn.</p>}
      <GameStage slug={slug} seed={seed} location="game_page" share={{ kind: 'game', slug, title: name }} label={`Play ${variant}`}
        footer={<div className="bb-controls"><span className="bb-variant">{variant !== name ? `Today’s variant: ${variant}` : 'Today’s variant'}</span><button type="button" className="bb-quiet" onClick={() => { trackToolUse('game_page', 'new_variant', slug); setSeed(randomSeed()); }}>New variant ↻</button></div>} />
    </div>
  );
}
