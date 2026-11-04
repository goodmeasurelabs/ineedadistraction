// The "Distract me" picker. The pool is every break game (each pick gets a
// fresh seed, so it is a new variant) plus community games made with the AI
// maker. Never the same entry twice in a row for a visitor.
import { BREAK_GAMES } from './breakGames';

export type PoolEntry = { id: string; kind: 'break' | 'community'; weight: number };

export const LAST_PICK_KEY = 'inad-last-distraction';

export function buildPool(communityIds: string[]): PoolEntry[] {
  return [
    ...BREAK_GAMES.map((game) => ({ id: game.slug, kind: 'break' as const, weight: 3 })),
    ...communityIds.map((id) => ({ id: `community:${id}`, kind: 'community' as const, weight: 1 })),
  ];
}

export function pickNext(pool: PoolEntry[], previousId: string | null | undefined, random: () => number = Math.random): PoolEntry {
  if (pool.length === 0) throw new Error('Empty pool');
  const candidates = pool.length > 1 ? pool.filter((entry) => entry.id !== previousId) : pool;
  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of candidates) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return candidates[candidates.length - 1];
}
