import { BREAK_GAMES } from './breakGames';
import { AT_WORK, BRAIN_BREAK, FIVE_MINUTE } from './landings';

// Public, indexable pages that exist without a database. Shared by
// sitemap.xml and llms.txt so they cannot drift apart.
export const STATIC_PATHS: string[] = [
  '/',
  '/daily',
  '/games',
  ...BREAK_GAMES.map((game) => `/games/${game.slug}`),
  BRAIN_BREAK.path,
  AT_WORK.path,
  FIVE_MINUTE.path,
  '/make-a-game',
  '/connections',
  '/privacy',
  '/terms',
];
