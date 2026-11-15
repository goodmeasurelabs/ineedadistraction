import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPattern, scoreHand, targetFor, newCharm, onDiscard, onRoundCleared, offerCharms, shuffledBag, type Tile } from '../app/games/prime-time/rules';

let nextId = 1;
const t = (n: number, c = 0): Tile => ({ id: nextId++, n, c });
const hand = (...ns: number[]) => ns.map((n, i) => t(n, i % 4));
const ctx = { discardsLeft: 0, handsPlayed: 1, playsLeft: 2 };

test('detects each base pattern', () => {
  assert.equal(detectPattern(hand(9, 4))!.id, 'high');
  assert.equal(detectPattern(hand(7, 7, 2))!.id, 'pair');
  assert.equal(detectPattern(hand(4, 4, 8, 8, 1))!.id, 'twopair');
  assert.equal(detectPattern(hand(4, 6, 5))!.id, 'run3');
  assert.equal(detectPattern(hand(6, 6, 6, 1))!.id, 'triple');
  assert.equal(detectPattern(hand(2, 3, 4, 5, 9))!.id, 'run4');
  assert.equal(detectPattern(hand(3, 3, 3, 8, 8))!.id, 'full');
  assert.equal(detectPattern(hand(5, 6, 7, 8, 9))!.id, 'run5');
  assert.equal(detectPattern(hand(2, 2, 2, 2, 6))!.id, 'quad');
  assert.equal(detectPattern(hand(9, 9, 9, 9, 9))!.id, 'five');
  assert.equal(detectPattern([]), null);
});

test('only pattern tiles score, highest pair and single are chosen', () => {
  const pair = detectPattern(hand(7, 2, 7, 9))!;
  assert.deepEqual(pair.scoring, [0, 2]);
  assert.deepEqual(detectPattern(hand(3, 9, 4))!.scoring, [1]);
  assert.deepEqual(detectPattern(hand(2, 2, 8, 9, 8))!.id, 'twopair');
});

test('prime and spectrum bonuses make every tile score and rename the hand', () => {
  const prime = detectPattern(hand(2, 5, 7))!;
  assert.equal(prime.prime, true); assert.equal(prime.name, 'Prime Hand'); assert.equal(prime.scoring.length, 3);
  const primeRun = detectPattern(hand(2, 3, 5, 7))!;
  assert.equal(primeRun.name, 'Prime Hand'); // 2 3 is only two in a row, so no run
  const spectrum = detectPattern([t(1, 2), t(4, 2), t(6, 2), t(9, 2)])!;
  assert.equal(spectrum.spectrum, true); assert.equal(spectrum.name, 'Spectrum');
  assert.equal(detectPattern([t(1, 2), t(4, 2), t(6, 2)])!.spectrum, false);
  assert.equal(detectPattern([t(1, 2), t(4, 2), t(6, 2)], { spectrumMin: 3 })!.spectrum, true);
  assert.equal(detectPattern([t(3, 1), t(3, 1), t(3, 1), t(5, 1)])!.name, 'Prime Spectrum Triple');
});

test('runs wrap only with the flag, and 1 is prime only with the flag', () => {
  assert.equal(detectPattern(hand(8, 9, 1))!.id, 'high');
  assert.equal(detectPattern(hand(8, 9, 1), { wrap: true })!.id, 'run3');
  assert.equal(detectPattern(hand(7, 8, 9, 1, 2), { wrap: true })!.id, 'run5');
  assert.equal(detectPattern(hand(1, 2, 3))!.prime, false);
  assert.equal(detectPattern(hand(1, 2, 3), { oneIsPrime: true })!.prime, true);
});

test('score is (pattern chips + tile values) x mult', () => {
  const result = scoreHand(hand(7, 7, 4), [], ctx)!;
  assert.equal(result.chips, 10 + 14); assert.equal(result.mult, 2); assert.equal(result.total, 48);
  // 7 7 2 is all prime, so it becomes a Prime Pair and the 2 scores too.
  const primePair = scoreHand(hand(7, 7, 2), [], ctx)!;
  assert.equal(primePair.detected.name, 'Prime Pair'); assert.equal(primePair.total, (10 + 15 + 16) * (2 + 2));
  const run = scoreHand(hand(4, 5, 6, 7), [], ctx)!;
  assert.equal(run.total, (35 + 22) * 4);
  const prime = scoreHand(hand(2, 3, 5), [], ctx)!; // Prime Hand: 5 + 15 chips, 1 + 2 mult, all three score
  assert.equal(prime.total, (5 + 15 + 10) * 3);
});

test('charms trigger in order with running totals', () => {
  const result = scoreHand(hand(7, 7), [newCharm('ember'), newCharm('odd')], ctx)!;
  // (10 + 14) chips, (2 + 4) mult, then x2
  assert.equal(result.total, 24 * 12);
  assert.deepEqual(result.events.map((e) => e.src), ['tile', 'tile', 'charm', 'charm']);
  assert.equal(result.events.at(-1)!.mult, 12);
  // Slot order does not matter: additions always land before multiplications.
  assert.equal(scoreHand(hand(7, 7), [newCharm('odd'), newCharm('ember')], ctx)!.mult, 12);
});

test('retriggers, per-tile charms and rule benders', () => {
  assert.equal(scoreHand(hand(7, 7), [newCharm('sevens')], ctx)!.chips, 10 + 28);
  assert.equal(scoreHand(hand(5, 5), [newCharm('echo')], ctx)!.chips, 10 + 20);
  assert.equal(scoreHand(hand(2, 2), [newCharm('sieve')], ctx)!.chips, 10 + 4 + 24);
  assert.equal(scoreHand(hand(9, 9), [newCharm('squares')], ctx)!.mult, 2 * 1.5 * 1.5);
  assert.equal(scoreHand(hand(6, 6), [newCharm('generous')], ctx)!.total, (30 + 12) * 3);
  assert.equal(scoreHand(hand(8, 9, 1), [newCharm('ouroboros')], ctx)!.detected.id, 'run3');
  assert.equal(scoreHand(hand(4, 4), [newCharm('opener')], { ...ctx, handsPlayed: 0 })!.mult, 4);
  assert.equal(scoreHand(hand(4, 4), [newCharm('opener')], ctx)!.mult, 2);
  assert.equal(scoreHand(hand(4, 4), [newCharm('thrift')], { ...ctx, discardsLeft: 3 })!.mult, 8);
  assert.equal(scoreHand(hand(4, 4), [newCharm('lastcall')], { ...ctx, playsLeft: 1 })!.mult, 6);
  assert.equal(scoreHand(hand(4, 4), [newCharm('momentum')], { ...ctx, handsPlayed: 3 })!.mult, 11);
  assert.equal(scoreHand(hand(4, 4, 6, 6), [newCharm('rainbow')], ctx)!.mult, 10);
  assert.equal(scoreHand(hand(5, 6, 7, 8, 9), [newCharm('quintet')], ctx)!.mult, 10);
  assert.equal(scoreHand(hand(4, 4, 1), [newCharm('minimalist')], ctx)!.mult, 6);
});

test('growing charms grow', () => {
  const charms = [newCharm('snowball'), newCharm('compost')];
  onRoundCleared(charms); onDiscard(charms, 5);
  assert.equal(charms[0].v, 2); assert.equal(charms[1].v, 15);
  onDiscard(charms, 500); assert.equal(charms[1].v, 120); charms[1].v = 15;
  assert.equal(scoreHand(hand(4, 4), charms, ctx)!.total, (10 + 8 + 15) * (2 + 2));
});

test('targets rise every round and the bag and offers are well formed', () => {
  for (let r = 1; r < 30; r++) assert.ok(targetFor(r + 1) > targetFor(r), `round ${r}`);
  let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bag = shuffledBag(rng, 1);
  assert.equal(bag.length, 72); assert.equal(new Set(bag.map((b) => b.id)).size, 72);
  const offer = offerCharms(rng, [newCharm('ember')]);
  assert.equal(offer.length, 3); assert.equal(new Set(offer).size, 3); assert.ok(!offer.includes('ember'));
});
