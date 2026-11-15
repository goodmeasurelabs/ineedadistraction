// Prime Time rules: pure functions, no canvas, no host. Everything that decides
// a score lives here so it can be unit tested and previewed before a play.

export type Tile = { id: number; n: number; c: number };

export const SUIT_COUNT = 4;
export const HAND_SIZE = 8;
export const MAX_SELECT = 5;
export const PLAYS_PER_ROUND = 4;
export const DISCARDS_PER_ROUND = 3;
export const MAX_CHARMS = 5;

export type PatternId = 'high' | 'pair' | 'twopair' | 'run3' | 'triple' | 'run4' | 'full' | 'run5' | 'quad' | 'five';

export const PATTERNS: Record<PatternId, { name: string; chips: number; mult: number; rank: number; example: string }> = {
  high: { name: 'High Tile', chips: 5, mult: 1, rank: 0, example: '9' },
  pair: { name: 'Pair', chips: 10, mult: 2, rank: 1, example: '7 7' },
  twopair: { name: 'Two Pair', chips: 20, mult: 2, rank: 2, example: '4 4 8 8' },
  run3: { name: 'Run of 3', chips: 20, mult: 3, rank: 3, example: '4 5 6' },
  triple: { name: 'Triple', chips: 30, mult: 3, rank: 4, example: '6 6 6' },
  run4: { name: 'Run of 4', chips: 35, mult: 4, rank: 5, example: '2 3 4 5' },
  full: { name: 'Full Set', chips: 45, mult: 4, rank: 6, example: '3 3 3 8 8' },
  run5: { name: 'Run of 5', chips: 55, mult: 5, rank: 7, example: '5 6 7 8 9' },
  quad: { name: 'Quad', chips: 65, mult: 7, rank: 8, example: '2 2 2 2' },
  five: { name: 'Five Alike', chips: 100, mult: 10, rank: 9, example: '9 9 9 9 9' },
};
export const PATTERN_ORDER: PatternId[] = ['high', 'pair', 'twopair', 'run3', 'triple', 'run4', 'full', 'run5', 'quad', 'five'];

// Bonuses that stack on any pattern when every played tile qualifies.
export const PRIME_BONUS = { chips: 15, mult: 2, min: 3 };
export const SPECTRUM_BONUS = { chips: 25, mult: 3, min: 4 };

export type DetectFlags = { wrap?: boolean; spectrumMin?: number; oneIsPrime?: boolean };

export function isPrime(n: number, oneIsPrime = false): boolean {
  return n === 2 || n === 3 || n === 5 || n === 7 || (oneIsPrime && n === 1);
}

export type Detected = {
  id: PatternId;
  name: string;
  /** Indices into the played tiles that score, left to right. */
  scoring: number[];
  prime: boolean;
  spectrum: boolean;
};

export function detectPattern(tiles: Tile[], flags: DetectFlags = {}): Detected | null {
  if (tiles.length === 0) return null;
  const byNumber = new Map<number, number[]>();
  tiles.forEach((tile, i) => { const list = byNumber.get(tile.n); if (list) list.push(i); else byNumber.set(tile.n, [i]); });
  const groups = [...byNumber.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);

  type Candidate = { id: PatternId; scoring: number[] };
  const candidates: Candidate[] = [];
  const top = groups[0], second = groups[1];
  if (top[1].length >= 5) candidates.push({ id: 'five', scoring: top[1].slice(0, 5) });
  if (top[1].length >= 4) candidates.push({ id: 'quad', scoring: top[1].slice(0, 4) });
  if (top[1].length >= 3 && second && second[1].length >= 2) candidates.push({ id: 'full', scoring: [...top[1].slice(0, 3), ...second[1].slice(0, 2)] });
  if (top[1].length >= 3) candidates.push({ id: 'triple', scoring: top[1].slice(0, 3) });
  if (top[1].length >= 2 && second && second[1].length >= 2) candidates.push({ id: 'twopair', scoring: [...top[1].slice(0, 2), ...second[1].slice(0, 2)] });
  if (top[1].length >= 2) {
    // Highest pair, not just the first group found.
    const pairs = groups.filter((g) => g[1].length >= 2).sort((a, b) => b[0] - a[0]);
    candidates.push({ id: 'pair', scoring: pairs[0][1].slice(0, 2) });
  }

  // Longest run of consecutive distinct numbers; highest one wins a tie.
  let bestRun: number[] = [];
  const has = (n: number) => byNumber.has(n);
  for (let start = 1; start <= 9; start++) {
    if (!has(start)) continue;
    const run = [start];
    for (let step = 1; step < 5; step++) {
      let next = start + step;
      if (next > 9) { if (!flags.wrap) break; next -= 9; }
      if (!has(next) || run.includes(next)) break;
      run.push(next);
    }
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    if (run.length > bestRun.length || (run.length === bestRun.length && sum(run) > sum(bestRun))) bestRun = run;
  }
  if (bestRun.length >= 3) {
    const id = (bestRun.length >= 5 ? 'run5' : bestRun.length === 4 ? 'run4' : 'run3') as PatternId;
    candidates.push({ id, scoring: bestRun.map((n) => byNumber.get(n)![0]) });
  }

  let highest = 0;
  tiles.forEach((tile, i) => { if (tile.n > tiles[highest].n) highest = i; });
  candidates.push({ id: 'high', scoring: [highest] });

  const best = candidates.reduce((a, b) => (PATTERNS[b.id].rank > PATTERNS[a.id].rank ? b : a));
  const prime = tiles.length >= PRIME_BONUS.min && tiles.every((tile) => isPrime(tile.n, flags.oneIsPrime));
  const spectrum = tiles.length >= (flags.spectrumMin ?? SPECTRUM_BONUS.min) && tiles.every((tile) => tile.c === tiles[0].c);
  const all = prime || spectrum;
  const scoring = (all ? tiles.map((_, i) => i) : [...best.scoring]).sort((a, b) => a - b);

  const prefix = `${prime ? 'Prime ' : ''}${spectrum ? 'Spectrum ' : ''}`;
  const name = best.id === 'high' && all ? (prime && spectrum ? 'Prime Spectrum' : prime ? 'Prime Hand' : 'Spectrum') : prefix + PATTERNS[best.id].name;
  return { id: best.id, name, scoring, prime, spectrum };
}

// ---- Charms -------------------------------------------------------------------

export type CharmId =
  | 'ember' | 'sieve' | 'odd' | 'even' | 'echo' | 'sevens' | 'ouroboros' | 'generous' | 'opener' | 'thrift' | 'snowball'
  | 'compost' | 'lowtide' | 'highroller' | 'minimalist' | 'quintet' | 'rainbow' | 'mono' | 'lastcall' | 'unit' | 'momentum' | 'squares';

/** Compost stops growing here, so discarding everything every round is not a strategy. */
export const COMPOST_CAP = 120;

export type Charm = { id: CharmId; v: number };

export type CharmDef = { id: CharmId; name: string; glyph: string; hue: number; initial: number; desc: (v: number) => string };

export const CHARMS: CharmDef[] = [
  { id: 'ember', name: 'Ember', glyph: '+4', hue: 12, initial: 0, desc: () => '+4 mult on every hand.' },
  { id: 'sieve', name: 'Sieve', glyph: 'P', hue: 48, initial: 0, desc: () => 'Each prime tile that scores (2, 3, 5, 7) gives +12 chips.' },
  { id: 'odd', name: 'Odd Job', glyph: '1·3', hue: 330, initial: 0, desc: () => '×2 mult when every tile you play is odd.' },
  { id: 'even', name: 'Even Keel', glyph: '2·4', hue: 200, initial: 0, desc: () => '×2 mult when every tile you play is even.' },
  { id: 'echo', name: 'Echo', glyph: '))', hue: 265, initial: 0, desc: () => 'The first scoring tile fires three times.' },
  { id: 'sevens', name: 'Lucky Streak', glyph: '77', hue: 140, initial: 0, desc: () => 'Every 7 that scores fires twice and gives +3 mult.' },
  { id: 'ouroboros', name: 'Loop', glyph: '9→1', hue: 172, initial: 0, desc: () => 'Runs may wrap around (8 9 1), and every Run gets +2 mult.' },
  { id: 'generous', name: 'Plus One', glyph: '2=3', hue: 28, initial: 0, desc: () => 'A Pair scores with a Triple’s base: 30 chips × 3.' },
  { id: 'opener', name: 'Opener', glyph: '1st', hue: 88, initial: 0, desc: () => '×2 mult on the first hand of each round.' },
  { id: 'thrift', name: 'Thrift', glyph: '+2', hue: 220, initial: 0, desc: () => '+2 mult for every discard you have not used.' },
  { id: 'snowball', name: 'Snowball', glyph: '❄', hue: 190, initial: 1, desc: (v) => `+${v} mult. Grows by 1 every round you clear.` },
  { id: 'compost', name: 'Compost', glyph: '♻', hue: 105, initial: 0, desc: (v) => `+${v} chips. Grows by 3 for every tile you discard, up to +${COMPOST_CAP}.` },
  { id: 'lowtide', name: 'Low Tide', glyph: '≤3', hue: 208, initial: 0, desc: () => 'Each 1, 2 or 3 that scores gives +2 mult.' },
  { id: 'highroller', name: 'High Roller', glyph: '8·9', hue: 0, initial: 0, desc: () => 'Each 8 or 9 that scores gives +20 chips.' },
  { id: 'minimalist', name: 'Minimalist', glyph: 'min', hue: 300, initial: 0, desc: () => '×3 mult when you play three tiles or fewer.' },
  { id: 'quintet', name: 'Quintet', glyph: 'V', hue: 58, initial: 0, desc: () => '×2 mult when all five played tiles score.' },
  { id: 'rainbow', name: 'Rainbow', glyph: '◆●', hue: 285, initial: 0, desc: () => '+8 mult when your played tiles show all four colours.' },
  { id: 'mono', name: 'Dye Lot', glyph: '■■■', hue: 245, initial: 0, desc: () => 'Spectrum needs only 3 tiles of one colour, and gives +2 more mult.' },
  { id: 'lastcall', name: 'Last Call', glyph: '4th', hue: 18, initial: 0, desc: () => '×3 mult on your final play of the round.' },
  { id: 'unit', name: 'Unit', glyph: '1=P', hue: 70, initial: 0, desc: () => '1 counts as a prime. Prime hands with a 1 get +2 mult.' },
  { id: 'momentum', name: 'Momentum', glyph: '»', hue: 155, initial: 0, desc: () => '+3 mult for each hand already played this round.' },
  { id: 'squares', name: 'Square Deal', glyph: 'n²', hue: 318, initial: 0, desc: () => 'Each 4 or 9 that scores multiplies mult by 1.5.' },
];

export const charmDef = (id: CharmId) => CHARMS.find((c) => c.id === id)!;
export const newCharm = (id: CharmId): Charm => ({ id, v: charmDef(id).initial });

export function detectFlags(charms: Charm[]): DetectFlags {
  const has = (id: CharmId) => charms.some((c) => c.id === id);
  return { wrap: has('ouroboros'), spectrumMin: has('mono') ? 3 : SPECTRUM_BONUS.min, oneIsPrime: has('unit') };
}

export type ScoreContext = {
  /** Discards not used yet this round. */
  discardsLeft: number;
  /** Hands already played this round, before this one. */
  handsPlayed: number;
  /** Plays remaining including this one. */
  playsLeft: number;
};

export type ScoreEvent = {
  src: 'tile' | 'charm';
  /** Index into the played tiles the event happens on (tile events and per-tile charms). */
  tile?: number;
  /** Index into the owned charms. */
  charm?: number;
  dChips: number;
  dMult: number;
  xMult: number;
  /** Running totals after this event. */
  chips: number;
  mult: number;
  again?: boolean;
};

export type ScoreResult = {
  detected: Detected;
  baseChips: number;
  baseMult: number;
  events: ScoreEvent[];
  chips: number;
  mult: number;
  total: number;
};

export function scoreHand(played: Tile[], charms: Charm[], context: ScoreContext): ScoreResult | null {
  const flags = detectFlags(charms);
  const detected = detectPattern(played, flags);
  if (!detected) return null;
  const has = (id: CharmId) => charms.some((c) => c.id === id);

  const base = detected.id === 'pair' && has('generous') ? PATTERNS.triple : PATTERNS[detected.id];
  let chips = base.chips + (detected.prime ? PRIME_BONUS.chips : 0) + (detected.spectrum ? SPECTRUM_BONUS.chips : 0);
  let mult = base.mult + (detected.prime ? PRIME_BONUS.mult : 0) + (detected.spectrum ? SPECTRUM_BONUS.mult : 0);
  const baseChips = chips, baseMult = mult;
  const events: ScoreEvent[] = [];
  const push = (e: Omit<ScoreEvent, 'chips' | 'mult'>) => {
    chips += e.dChips; mult = (mult + e.dMult) * e.xMult;
    events.push({ ...e, chips, mult });
  };

  detected.scoring.forEach((index, order) => {
    const tile = played[index];
    const fires = 1 + (order === 0 && has('echo') ? 2 : 0) + (tile.n === 7 && has('sevens') ? 1 : 0);
    for (let fire = 0; fire < fires; fire++) {
      push({ src: 'tile', tile: index, dChips: tile.n, dMult: 0, xMult: 1, again: fire > 0 });
      charms.forEach((charm, ci) => {
        if (charm.id === 'sieve' && isPrime(tile.n, flags.oneIsPrime)) push({ src: 'charm', charm: ci, tile: index, dChips: 12, dMult: 0, xMult: 1 });
        else if (charm.id === 'sevens' && tile.n === 7 && fire === 0) push({ src: 'charm', charm: ci, tile: index, dChips: 0, dMult: 3, xMult: 1 });
        else if (charm.id === 'lowtide' && tile.n <= 3) push({ src: 'charm', charm: ci, tile: index, dChips: 0, dMult: 2, xMult: 1 });
        else if (charm.id === 'highroller' && tile.n >= 8) push({ src: 'charm', charm: ci, tile: index, dChips: 20, dMult: 0, xMult: 1 });
        else if (charm.id === 'squares' && (tile.n === 4 || tile.n === 9)) push({ src: 'charm', charm: ci, tile: index, dChips: 0, dMult: 0, xMult: 1.5 });
      });
    }
  });

  const colours = new Set(played.map((tile) => tile.c)).size;
  // Additions always land before multiplications, whatever slot a charm sits in,
  // so the order you happened to collect charms in can never quietly halve a score.
  const TIMES: CharmId[] = ['odd', 'even', 'opener', 'minimalist', 'quintet', 'lastcall'];
  for (const pass of ['plus', 'times'] as const) {
    charms.forEach((charm, ci) => {
      if ((pass === 'times') !== TIMES.includes(charm.id)) return;
      const add = (dChips: number, dMult: number, xMult = 1) => push({ src: 'charm', charm: ci, dChips, dMult, xMult });
      switch (charm.id) {
        case 'ember': add(0, 4); break;
        case 'odd': if (played.every((tile) => tile.n % 2 === 1)) add(0, 0, 2); break;
        case 'even': if (played.every((tile) => tile.n % 2 === 0)) add(0, 0, 2); break;
        case 'opener': if (context.handsPlayed === 0) add(0, 0, 2); break;
        case 'thrift': if (context.discardsLeft > 0) add(0, 2 * context.discardsLeft); break;
        case 'snowball': if (charm.v > 0) add(0, charm.v); break;
        case 'compost': if (charm.v > 0) add(charm.v, 0); break;
        case 'minimalist': if (played.length <= 3) add(0, 0, 3); break;
        case 'quintet': if (detected.scoring.length === 5) add(0, 0, 2); break;
        case 'rainbow': if (colours === SUIT_COUNT) add(0, 8); break;
        case 'lastcall': if (context.playsLeft === 1) add(0, 0, 3); break;
        case 'momentum': if (context.handsPlayed > 0) add(0, 3 * context.handsPlayed); break;
        case 'ouroboros': if (detected.id.startsWith('run')) add(0, 2); break;
        case 'mono': if (detected.spectrum) add(0, 2); break;
        case 'unit': if (detected.prime && played.some((tile) => tile.n === 1)) add(0, 2); break;
        default: break;
      }
    });
  }

  return { detected, baseChips, baseMult, events, chips, mult, total: Math.round(chips * mult) };
}

/** Growing charms: call when tiles are discarded. */
export function onDiscard(charms: Charm[], count: number) { for (const charm of charms) if (charm.id === 'compost') charm.v = Math.min(COMPOST_CAP, charm.v + 3 * count); }
/** Growing charms: call when a round is cleared. */
export function onRoundCleared(charms: Charm[]) { for (const charm of charms) if (charm.id === 'snowball') charm.v += 1; }

// ---- Run structure --------------------------------------------------------------

/** Target for a 1-based round. Gentle for three rounds, then it needs a build. */
export function targetFor(round: number): number {
  // Hand-set through round 10 so discards matter from round 2 and there is no
  // sudden wall; after that it steepens until every build eventually falls.
  const table = [200, 400, 700, 1100, 1800, 2900, 4600, 7400, 11500, 18000];
  if (round <= table.length) return table[Math.max(0, round - 1)];
  const raw = 18000 * Math.pow(1.6, Math.min(round, 12) - 10) * Math.pow(1.9, Math.max(0, round - 12));
  const step = Math.pow(10, Math.max(1, Math.floor(Math.log10(raw)) - 1)) * 5;
  return Math.round(raw / step) * step;
}

export function shuffledBag(rng: () => number, firstId: number): Tile[] {
  const bag: Tile[] = [];
  let id = firstId;
  for (let copy = 0; copy < 2; copy++) for (let c = 0; c < SUIT_COUNT; c++) for (let n = 1; n <= 9; n++) bag.push({ id: id++, n, c });
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  return bag;
}

export function offerCharms(rng: () => number, owned: Charm[], count = 3): CharmId[] {
  const pool = CHARMS.map((c) => c.id).filter((id) => !owned.some((o) => o.id === id));
  const picks: CharmId[] = [];
  while (picks.length < count && pool.length) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picks;
}

export const sortHand = (hand: Tile[]) => hand.sort((a, b) => a.n - b.n || a.c - b.c || a.id - b.id);

/** Best-scoring subset of a hand (used by tests and balance checks, not by play). */
export function bestPlay(hand: Tile[], charms: Charm[], context: ScoreContext): { tiles: Tile[]; total: number } {
  let best = { tiles: [] as Tile[], total: -1 };
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let bits = 0; for (let m = mask; m; m &= m - 1) bits++;
    if (bits > MAX_SELECT) continue;
    const tiles = hand.filter((_, i) => mask & (1 << i));
    const result = scoreHand(tiles, charms, context);
    if (result && result.total > best.total) best = { tiles, total: result.total };
  }
  return best;
}
