import { GAMES, type GameInfo } from '../games/registry';

export const GAME_CATEGORY_IDS = ['merge', 'logic', 'math', 'arcade', 'words', 'memory'] as const;
export type GameCategoryId = typeof GAME_CATEGORY_IDS[number];
export type DistractionPreferences = {
  version: 1;
  enabled: boolean;
  categories: GameCategoryId[];
  pace: 'any' | 'untimed';
  sound: boolean;
};

export const DEFAULT_DISTRACTION_PREFERENCES: DistractionPreferences = {
  version: 1, enabled: true, categories: ['merge', 'logic', 'math', 'arcade'], pace: 'any', sound: false,
};

export const GAME_CATEGORIES: {
  id: GameCategoryId; title: string; description: string; image: string; accent: string;
  available: boolean; examples: string[];
}[] = [
  { id: 'merge', title: 'Merge & match', description: 'Drop it. Match it. Make something bigger.', image: '/categories/merge.svg', accent: '#ff8cdb', available: true, examples: ['Critical Mass'] },
  { id: 'logic', title: 'Logic & brain teasers', description: 'A little puzzle. A very satisfying click.', image: '/categories/logic.svg', accent: '#ffd482', available: true, examples: ['Tessel'] },
  { id: 'math', title: 'Math & numbers', description: 'Number hands, clever combos, big scores.', image: '/categories/math.svg', accent: '#b7ef84', available: true, examples: ['Prime Time'] },
  { id: 'arcade', title: 'Retro arcade', description: 'One click. Watch the sparks fly.', image: '/categories/arcade.svg', accent: '#86e9ff', available: true, examples: ['Afterglow'] },
  { id: 'words', title: 'Word games', description: 'Letters, clues, and small discoveries.', image: '/categories/words.svg', accent: '#bba1ff', available: false, examples: [] },
  { id: 'memory', title: 'Memory & reaction', description: 'Spot the pattern. Find your rhythm.', image: '/categories/memory.svg', accent: '#ffab8f', available: false, examples: [] },
];

/** Strict at the API boundary; never turn an invalid preference into "all games". */
export function parseDistractionPreferences(value: unknown): DistractionPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['version', 'enabled', 'categories', 'pace', 'sound'].includes(key)) ||
      input.version !== 1 || typeof input.enabled !== 'boolean' || typeof input.sound !== 'boolean' ||
      (input.pace !== 'any' && input.pace !== 'untimed') || !Array.isArray(input.categories) ||
      input.categories.length < 1 || input.categories.length > GAME_CATEGORY_IDS.length ||
      input.categories.some((id) => !GAME_CATEGORY_IDS.includes(id as GameCategoryId)) ||
      new Set(input.categories).size !== input.categories.length) return null;
  const categories = input.categories as GameCategoryId[];
  return {
    version: 1, enabled: input.enabled, sound: input.sound, pace: input.pace,
    categories: GAME_CATEGORY_IDS.filter((id) => categories.includes(id)),
  };
}

const GAME_CATEGORY: Record<string, GameCategoryId> = {
  'critical-mass': 'merge', tessel: 'logic', 'prime-time': 'math', afterglow: 'arcade',
};

export function getEligibleGames(preferences: DistractionPreferences): GameInfo[] {
  return GAMES.filter((game) => preferences.categories.includes(GAME_CATEGORY[game.slug]) &&
    (preferences.pace !== 'untimed' || game.pace === 'Take your time'));
}

/** Only public installation instructions and nonsecret preferences belong in copied prompts. */
export function buildSetupPrompt(platform: 'codex' | 'claude', selection: DistractionPreferences | 'family-guy'): string {
  const agent = platform === 'codex' ? 'Codex' : 'Claude Code';
  const install = platform === 'codex'
    ? 'codex plugin marketplace add goodmeasurelabs/ineedadistraction\ncodex plugin add distraction@ineedadistraction'
    : 'claude plugin marketplace add goodmeasurelabs/ineedadistraction\nclaude plugin install distraction@ineedadistraction';
  const installation = `Read https://www.ineedadistraction.com/skill.md for the current setup instructions. Install or update the official distraction plugin from goodmeasurelabs/ineedadistraction (version 0.5.0 or newer with settings support). The installation commands are:\n\n${install}`;
  const review = `Guide me through any required native plugin or hook review${platform === 'codex' ? ' (Settings > Hooks in the desktop app, or /hooks in the CLI)' : ''}, and reload the plugin if required. Do not bypass trust or permissions.`;
  if (selection === 'family-guy') {
    return `I want to watch Family Guy clips in the I Need a Distraction popup while ${agent} works on this computer.\n\nIf the compatible plugin is already installed, use it. Otherwise set it up. ${installation}\n\n${review} Run the installed plugin’s scripts/open.sh to open my paired popup. Tell me to choose “Family Guy clips” in that popup the first time. If distractions are off, tell me I can choose “Keep distracting” to turn them on. If the plugin opens an ordinary browser tab, explain that clips require the dedicated Chromium popup.\n\nKeep my existing game and sound preferences. I can say “Stop distracting” to turn distractions off.`;
  }
  const valid = parseDistractionPreferences(selection);
  if (!valid) throw new Error('Choose at least one game category.');
  const mix = GAME_CATEGORIES.filter((category) => valid.categories.includes(category.id)).map((category) => category.title).join(', ');
  return `Set up I Need a Distraction for ${agent} on this computer so I can play while you work.\n\n${installation}\n\nMy game mix: ${mix}. ${valid.pace === 'untimed' ? 'Only games without time pressure.' : 'Any pace is fine.'} Sound ${valid.sound ? 'on' : 'off'}.\n\nAfter installation, locate the installed plugin and run its scripts/settings.py with Python 3:\nset --enabled ${valid.enabled} --categories ${valid.categories.join(',')} --pace ${valid.pace} --sound ${valid.sound}\n\n${review} Verify the settings were acknowledged by the plugin, then run its scripts/open.sh to open my paired distraction. If settings support is missing, tell me instead of claiming the preferences were saved.\n\nWhen I say “Stop distracting,” turn automatic distractions off persistently on this computer. When I say “Keep distracting,” turn them on again. I can change my game mix in the popup or by telling you. No account is needed.`;
}
