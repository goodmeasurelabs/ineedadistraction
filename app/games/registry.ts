// First-party games. Metadata only (safe to import on the server); the game
// code itself is loaded on demand by GameClient.
export type GameInfo = {
  slug: string;
  title: string;
  emoji: string;
  /** One line under the title on cards. */
  tagline: string;
  /** Shown over the board until the first input. */
  hint: string;
  /** Longer description for the page metadata and cards. */
  description: string;
  accent: string;
  /** Two-colour gradient for the card art. */
  art: [string, string];
  tags: string[];
  /** Good with one hand on the mouse while watching a terminal. */
  pace: 'Take your time' | 'Quick shots' | 'Real time';
};

export const GAMES: GameInfo[] = [
  {
    slug: 'afterglow',
    title: 'Afterglow',
    emoji: '✺',
    tagline: 'One click. A very long chain reaction.',
    hint: 'Click anywhere to set off a pulse',
    description: 'Drop one pulse into a drifting field of sparks and watch the chain reaction climb. Ten shots, rising multipliers, and upgrades between shots.',
    accent: '#7cf6ff',
    art: ['#0b2a4a', '#3a1466'],
    tags: ['chain reaction', 'arcade'],
    pace: 'Quick shots',
  },
  {
    slug: 'tessel',
    title: 'Tessel',
    emoji: '▦',
    tagline: 'Place three shapes. Clear lines. Keep the streak.',
    hint: 'Drag or click a shape',
    description: 'An untimed shape-placing puzzle. Fill rows and columns to shatter them, chain clears for a growing streak multiplier, and last as long as you can.',
    accent: '#ffd166',
    art: ['#3a2408', '#5a1030'],
    tags: ['puzzle', 'no timer'],
    pace: 'Take your time',
  },
  {
    slug: 'critical-mass',
    title: 'Critical Mass',
    emoji: '◉',
    tagline: 'Drop numbers. Equal ones fuse and double.',
    hint: 'Move to aim, click to drop',
    description: 'Drop glowing number cores into the chamber. Matching cores fuse into their sum and set off chain fusions. Do not let the pile reach the line.',
    accent: '#ff7ac6',
    art: ['#3d0b3a', '#0b2447'],
    tags: ['physics', 'merge'],
    pace: 'Take your time',
  },
  {
    slug: 'prime-time',
    title: 'Prime Time',
    emoji: '✖',
    tagline: 'Build number hands. Stack multipliers. Break the target.',
    hint: 'Pick up to five tiles, then play the hand',
    description: 'A number-tile run builder. Play runs, pairs and primes for chips times multiplier, then pick rule-bending charms between rounds to beat a rising target.',
    accent: '#b7f36b',
    art: ['#0f3324', '#2a1454'],
    tags: ['brain game', 'run builder'],
    pace: 'Take your time',
  },
];

export const getGame = (slug: string) => GAMES.find((game) => game.slug === slug);
