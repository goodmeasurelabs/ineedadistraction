// Share links carry only the score (plus campaign tags). No names, no ids.
import { formatScore, getBreakGame } from './breakGames';

export const SITE_URL = 'https://www.ineedadistraction.com';

export type ShareTarget =
  | { kind: 'daily'; date: string; number: number; title: string }
  | { kind: 'game'; slug: string; title: string };

export function sharePath(target: ShareTarget, score: number): string {
  const base = target.kind === 'daily' ? `/daily/${target.date}` : `/games/${target.slug}`;
  return `${base}?score=${score}&utm_source=share&utm_medium=friend`;
}

export function cardPath(target: ShareTarget, score: number): string {
  return target.kind === 'daily' ? `/daily/${target.date}/card?score=${score}` : `/games/${target.slug}/card?score=${score}`;
}

export function shareText(target: ShareTarget, slug: string, score: number): string {
  const game = getBreakGame(slug);
  const shown = game ? formatScore(game.unit, score) : String(score);
  return target.kind === 'daily'
    ? `I got ${shown} on today's distraction (Daily #${target.number}: ${target.title}). Your turn:`
    : `I got ${shown} on ${target.title}. Your turn:`;
}
