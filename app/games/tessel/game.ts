import type { Game, GameHost, GameModule, PointerEventLite } from '../engine/types';
import { Particles, Floaters, drawGlow, roundRect, FONT, clamp, lerp, damp, easeOutCubic, easeOutBack, hsl, TAU } from '../engine/fx';

// Tessel: an untimed shape-placing puzzle. Fill rows and columns of an 8x8
// board to shatter them; consecutive clears build a streak multiplier.

const N = 8;

// ---- Shapes -------------------------------------------------------------------

type Shape = { cells: [number, number][]; w: number; h: number; color: number; weight: number };

// One jewel colour per shape family: [hue, saturation, lightness].
const COLORS: [number, number, number][] = [
  [268, 82, 62], // 0 dot: violet
  [188, 88, 52], // 1 short lines: cyan
  [218, 90, 60], // 2 long lines: sapphire
  [44, 96, 54],  // 3 small square: gold
  [6, 88, 58],   // 4 big square: ruby
  [140, 72, 48], // 5 small corner: emerald
  [328, 86, 62], // 6 L: rose
  [24, 95, 55],  // 7 big corner: amber
  [166, 80, 46], // 8 T: teal
  [84, 78, 50],  // 9 S: lime
  [300, 74, 58], // 10 slab: orchid
];
const GREY = COLORS.length;

function shape(pattern: string, color: number, weight: number): Shape {
  const rows = pattern.split('/');
  const cells: [number, number][] = [];
  rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push([c, r]); });
  return { cells, w: Math.max(...rows.map((row) => row.length)), h: rows.length, color, weight };
}

const SHAPES: Shape[] = [
  shape('#', 0, 3),
  shape('##', 1, 2), shape('#/#', 1, 2),
  shape('###', 1, 3), shape('#/#/#', 1, 3),
  shape('####', 2, 2), shape('#/#/#/#', 2, 2),
  shape('#####', 2, 1.4), shape('#/#/#/#/#', 2, 1.4),
  shape('##/##', 3, 4),
  shape('###/###/###', 4, 1.5),
  shape('#./##', 5, 1.5), shape('.#/##', 5, 1.5), shape('##/#.', 5, 1.5), shape('##/.#', 5, 1.5),
  shape('#./#./##', 6, 1), shape('.#/.#/##', 6, 1), shape('##/#./#.', 6, 1), shape('##/.#/.#', 6, 1),
  shape('#../###', 6, 1), shape('..#/###', 6, 1), shape('###/#..', 6, 1), shape('###/..#', 6, 1),
  shape('#../#../###', 7, 0.8), shape('..#/..#/###', 7, 0.8), shape('###/#../#..', 7, 0.8), shape('###/..#/..#', 7, 0.8),
  shape('###/.#.', 8, 1), shape('.#./###', 8, 1), shape('#./##/#.', 8, 1), shape('.#/##/.#', 8, 1),
  shape('.##/##.', 9, 0.8), shape('##./.##', 9, 0.8), shape('#./##/.#', 9, 0.8), shape('.#/##/#.', 9, 0.8),
  shape('###/###', 10, 1), shape('##/##/##', 10, 1),
];

// ---- Tile sprites ---------------------------------------------------------------

const spriteCache = new Map<number, HTMLCanvasElement>();

/** A faceted glass tile, drawn once per colour and scaled when used. */
function tileSprite(color: number): HTMLCanvasElement {
  let sprite = spriteCache.get(color);
  if (sprite) return sprite;
  const [h, s, l] = color === GREY ? [224, 10, 24] : COLORS[color];
  const size = 128;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const g = sprite.getContext('2d')!;
  const edge = 3, r = size * 0.19, inset = size * 0.15;

  // Body.
  let grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, hsl(h, s, Math.min(88, l + 16)));
  grad.addColorStop(0.5, hsl(h, s, l));
  grad.addColorStop(1, hsl(h + 8, s, Math.max(8, l - 24)));
  roundRect(g, edge, edge, size - edge * 2, size - edge * 2, r);
  g.fillStyle = grad; g.fill();

  // Bevel facets: light from the top-left.
  g.save();
  roundRect(g, edge, edge, size - edge * 2, size - edge * 2, r); g.clip();
  const a = edge, b = size - edge, i0 = inset, i1 = size - inset;
  const facet = (points: number[], fill: string) => { g.beginPath(); g.moveTo(points[0], points[1]); for (let k = 2; k < points.length; k += 2) g.lineTo(points[k], points[k + 1]); g.closePath(); g.fillStyle = fill; g.fill(); };
  facet([a, a, b, a, i1, i0, i0, i0], 'rgba(255,255,255,0.34)');
  facet([a, a, i0, i0, i0, i1, a, b], 'rgba(255,255,255,0.14)');
  facet([b, a, b, b, i1, i1, i1, i0], 'rgba(0,0,0,0.20)');
  facet([a, b, i0, i1, i1, i1, b, b], 'rgba(0,0,0,0.36)');
  g.restore();

  // Inner face.
  grad = g.createLinearGradient(i0, i0, i1, i1);
  grad.addColorStop(0, hsl(h - 6, s, Math.min(90, l + 20)));
  grad.addColorStop(0.55, hsl(h, s, l + 2));
  grad.addColorStop(1, hsl(h + 10, s, Math.max(10, l - 12)));
  roundRect(g, i0, i0, i1 - i0, i1 - i0, r * 0.45);
  g.fillStyle = grad; g.fill();

  // Soft glare across the face.
  g.save();
  roundRect(g, i0, i0, i1 - i0, i1 - i0, r * 0.45); g.clip();
  const glare = g.createLinearGradient(i0, i0, i1, i1);
  glare.addColorStop(0, 'rgba(255,255,255,0.42)');
  glare.addColorStop(0.42, 'rgba(255,255,255,0.08)');
  glare.addColorStop(0.43, 'rgba(255,255,255,0)');
  g.fillStyle = glare; g.fillRect(i0, i0, i1 - i0, i1 - i0);
  g.restore();

  // Specular spark.
  const spark = g.createRadialGradient(size * 0.33, size * 0.3, 0, size * 0.33, size * 0.3, size * 0.13);
  spark.addColorStop(0, 'rgba(255,255,255,0.95)');
  spark.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spark; g.fillRect(0, 0, size, size);

  // Rim light.
  roundRect(g, edge + 1, edge + 1, size - edge * 2 - 2, size - edge * 2 - 2, r);
  const rim = g.createLinearGradient(0, 0, 0, size);
  rim.addColorStop(0, 'rgba(255,255,255,0.7)');
  rim.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  rim.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.strokeStyle = rim; g.lineWidth = 2.5; g.stroke();

  spriteCache.set(color, sprite);
  return sprite;
}

const colorCss = (color: number, lightShift = 0, alpha = 1) => {
  const [h, s, l] = COLORS[color] ?? [222, 8, 40];
  return hsl(h, s, clamp(l + lightShift, 0, 100), alpha);
};

// ---- Game -------------------------------------------------------------------------

const STREAK_CAP = 8;
type Saved = { board: number[]; tray: (number | null)[]; score: number; streak: number; since: number; lines: number; bestStreak: number };
type Slot = { x: number; y: number; w: number; h: number; cx: number; cy: number };
type Layout = { cell: number; bx: number; by: number; bs: number; wide: boolean; hud: { x: number; y: number; w: number; h: number }; slots: Slot[]; tcell: number };
type Held = { slot: number; mode: 'drag' | 'picked'; x: number; y: number; scale: number; downX: number; downY: number; moved: boolean };
type Breaking = { idx: number; color: number; at: number; order: number; fired: boolean };
type Beam = { row: boolean; index: number; t0: number };
type Ring = { x: number; y: number; t0: number; radius: number; color: string };
type Return = { x: number; y: number; scale: number; t0: number };

function isSaved(value: unknown): value is Saved {
  const s = value as Saved;
  return !!s && Array.isArray(s.board) && s.board.length === N * N && s.board.every((v) => Number.isInteger(v) && v >= 0 && v <= COLORS.length)
    && Array.isArray(s.tray) && s.tray.length === 3 && s.tray.every((v) => v === null || (Number.isInteger(v) && v >= 0 && v < SHAPES.length))
    && typeof s.score === 'number' && typeof s.streak === 'number';
}

function create(host: GameHost, saved: unknown | null): Game {
  const board: number[] = new Array(N * N).fill(0);
  const landAt: number[] = new Array(N * N).fill(-10);
  const greyed: boolean[] = new Array(N * N).fill(false);
  let tray: (number | null)[] = [null, null, null];
  let fits = [true, true, true];
  const enterAt = [0, 0, 0];
  const returns: (Return | null)[] = [null, null, null];

  let now = 0;
  let score = 0, streak = 0, since = 0, lines = 0, bestStreak = 0;
  let streakPopAt = -10, streakLostAt = -10;
  let held: Held | null = null;
  let target: { c: number; r: number } | null = null;
  const pointer = { x: host.w / 2, y: host.h / 2 };
  let over: { at: number; order: number[]; next: number; done: boolean } | null = null;
  let pendingOverCheck = -1;

  const particles = new Particles(host.reducedMotion ? 300 : 1100);
  const floaters = new Floaters();
  let breaking: Breaking[] = [];
  let beams: Beam[] = [];
  let rings: Ring[] = [];

  // ---- Layout ---------------------------------------------------------------
  function layout(): Layout {
    const w = host.w, h = host.h;
    const wide = w >= 720 && w > h * 1.18;
    const hudH = clamp(h * 0.075, 38, 56);
    if (wide) {
      const pad = clamp(h * 0.04, 16, 32);
      const sideW = clamp(w * 0.24, 200, 320);
      const gap = clamp(w * 0.03, 20, 44);
      const cell = Math.floor(Math.min((h - pad * 2 - hudH - 8) / N, (w - pad * 2 - sideW - gap) / N));
      const bs = cell * N;
      const bx = Math.round((w - (bs + gap + sideW)) / 2);
      const by = Math.round((h - (bs + hudH + 8)) / 2 + hudH + 8);
      const sx = bx + bs + gap, slotH = bs / 3;
      const slots: Slot[] = [0, 1, 2].map((i) => ({ x: sx, y: by + slotH * i, w: sideW, h: slotH, cx: sx + sideW / 2, cy: by + slotH * (i + 0.5) }));
      const tcell = Math.min(cell * 0.6, sideW / 5.8, slotH / 5.6);
      return { cell, bx, by, bs, wide, hud: { x: bx, y: by - hudH - 8, w: bs, h: hudH }, slots, tcell };
    }
    const pad = clamp(w * 0.035, 10, 22);
    const gap = clamp(h * 0.02, 8, 18);
    const trayH = clamp(h * 0.23, 104, 190);
    const cell = Math.floor(Math.min((w - pad * 2) / N, (h - hudH - trayH - gap * 2 - pad) / N));
    const bs = cell * N;
    const bx = Math.round((w - bs) / 2);
    const total = hudH + gap * 0.5 + bs + gap + trayH;
    const top = Math.max(4, Math.round((h - total) / 2));
    const by = Math.round(top + hudH + gap * 0.5);
    const trayW = Math.min(w - pad * 2, Math.max(bs, 300));
    const tx = (w - trayW) / 2, ty = by + bs + gap, slotW = trayW / 3;
    const slots: Slot[] = [0, 1, 2].map((i) => ({ x: tx + slotW * i, y: ty, w: slotW, h: trayH, cx: tx + slotW * (i + 0.5), cy: ty + trayH / 2 }));
    const tcell = Math.min(cell * 0.6, slotW / 5.6, trayH / 5.6);
    return { cell, bx, by, bs, wide, hud: { x: bx, y: top, w: bs, h: hudH }, slots, tcell };
  }

  // ---- Rules ----------------------------------------------------------------
  function fitsAt(s: Shape, c: number, r: number): boolean {
    if (c < 0 || r < 0 || c + s.w > N || r + s.h > N) return false;
    for (const [dc, dr] of s.cells) if (board[(r + dr) * N + c + dc]) return false;
    return true;
  }
  function fitsAnywhere(s: Shape): boolean {
    for (let r = 0; r <= N - s.h; r++) for (let c = 0; c <= N - s.w; c++) if (fitsAt(s, c, r)) return true;
    return false;
  }
  function refreshFits() { fits = tray.map((index) => index === null || fitsAnywhere(SHAPES[index])); }

  // The run gets harder as lines are cleared: every 10 lines is a level, and each
  // level shifts the deal toward awkward shapes and away from easy filler.
  // Without this a careful player never loses (a playtest bot ran 1,300 moves).
  function level() { return 1 + Math.floor(lines / 10); }
  function weightOf(index: number): number {
    const s = SHAPES[index], steps = level() - 1, size = s.cells.length;
    const awkward = size >= 5 || s.color === 9;
    if (awkward) return s.weight * Math.min(6, Math.pow(1.12, steps));
    if (size <= 2) return s.weight * Math.max(0.25, Math.pow(0.93, steps));
    return s.weight;
  }
  function weightedPick(pool: number[]): number {
    let total = 0;
    for (const index of pool) total += weightOf(index);
    let roll = host.rng() * total;
    for (const index of pool) { roll -= weightOf(index); if (roll <= 0) return index; }
    return pool[pool.length - 1];
  }

  function deal() {
    const all = SHAPES.map((_, index) => index);
    // No duplicate shapes in a hand, and early on at most one large piece.
    const picked: number[] = [];
    let pool = all.slice();
    for (let i = 0; i < 3; i++) {
      const choice = weightedPick(pool);
      picked.push(choice);
      pool = pool.filter((index) => index !== choice);
      if (level() < 3 && SHAPES[choice].cells.length >= 6) pool = pool.filter((index) => SHAPES[index].cells.length < 6);
    }
    // Fairness: never deal a dead hand when some shape could still be played.
    if (!picked.some((index) => fitsAnywhere(SHAPES[index]))) {
      const playable = all.filter((index) => fitsAnywhere(SHAPES[index]));
      if (playable.length) picked[Math.floor(host.rng() * 3)] = weightedPick(playable.filter((index) => !picked.includes(index)).length ? playable.filter((index) => !picked.includes(index)) : playable);
    }
    tray = picked;
    for (let i = 0; i < 3; i++) { enterAt[i] = now + i * 0.09; returns[i] = null; }
    host.sfx.whoosh();
  }

  function completedLines(extra: Set<number> | null): { rows: number[]; cols: number[] } {
    const filled = (idx: number) => board[idx] !== 0 || (extra !== null && extra.has(idx));
    const rows: number[] = [], cols: number[] = [];
    for (let i = 0; i < N; i++) {
      let row = true, col = true;
      for (let j = 0; j < N; j++) { if (!filled(i * N + j)) row = false; if (!filled(j * N + i)) col = false; }
      if (row) rows.push(i);
      if (col) cols.push(i);
    }
    return { rows, cols };
  }

  function status() { host.setStatus(`Level ${level()}`); }
  /** Placements allowed without a clear before the streak cools. Tighter once the streak is long. */
  function grace() { return streak >= 5 ? 2 : 3; }
  function snapshot(): Saved { return { board: board.slice(), tray: tray.slice(), score, streak, since, lines, bestStreak }; }

  function place(slot: number, c: number, r: number) {
    const index = tray[slot];
    if (index === null) return;
    const s = SHAPES[index];
    const L = layout();
    const placedCells: number[] = [];
    for (const [dc, dr] of s.cells) {
      const idx = (r + dr) * N + c + dc;
      board[idx] = s.color + 1; landAt[idx] = now; placedCells.push(idx);
    }
    tray[slot] = null; held = null; target = null; returns[slot] = null;
    score += s.cells.length;
    const ox = L.bx + (c + s.w / 2) * L.cell, oy = L.by + (r + s.h / 2) * L.cell;
    host.sfx.place();
    if (!host.reducedMotion) {
      for (const idx of placedCells) {
        particles.emit(L.bx + (idx % N + 0.5) * L.cell, L.by + (Math.floor(idx / N) + 0.9) * L.cell, { count: 3, color: colorCss(s.color, 18), speed: 90, life: 0.4, size: 2.5, gravity: 200, angle: Math.PI / 2, spread: Math.PI });
      }
    }

    const { rows, cols } = completedLines(null);
    const lineCount = rows.length + cols.length;
    if (lineCount > 0) {
      const cleared = new Set<number>();
      for (const row of rows) for (let j = 0; j < N; j++) cleared.add(row * N + j);
      for (const col of cols) for (let j = 0; j < N; j++) cleared.add(j * N + col);
      streak = streak > 0 ? streak + 1 : 1;
      const levelBefore = level();
      since = 0; lines += lineCount; bestStreak = Math.max(bestStreak, streak);
      streakPopAt = now;
      // The multiplier tops out at x8 so one long streak cannot dwarf every other run.
      let gain = cleared.size * 10 * lineCount * Math.min(streak, STREAK_CAP);
      // Clearing with the last shape of a hand pays extra, so the order you play them in matters.
      const lastOfHand = tray.every((v) => v === null);
      if (lastOfHand) gain += 300;
      if (level() > levelBefore) {
        floaters.add(L.bx + L.bs / 2, L.by - 6, `LEVEL ${level()}`, { color: '#9dfff0', size: clamp(L.cell * 0.5, 15, 24), life: 1.6, rise: -L.cell * 0.6 });
        host.sfx.chord([7, 9, 12], { base: 330, gain: 0.09, stagger: 0.08 });
      }

      const oc = c + s.w / 2 - 0.5, or = r + s.h / 2 - 0.5;
      const ordered = [...cleared].sort((a, b) => Math.hypot(a % N - oc, Math.floor(a / N) - or) - Math.hypot(b % N - oc, Math.floor(b / N) - or));
      ordered.forEach((idx, i) => {
        breaking.push({ idx, color: board[idx] - 1, at: now + 0.05 + i * 0.025, order: i, fired: false });
        board[idx] = 0;
      });
      for (const row of rows) beams.push({ row: true, index: row, t0: now });
      for (const col of cols) beams.push({ row: false, index: col, t0: now });
      rings.push({ x: ox, y: oy, t0: now, radius: L.cell * (3 + lineCount * 1.6), color: colorCss(s.color, 20) });
      host.shake(3 + lineCount * 3);
      host.hitStop(35 + lineCount * 28);

      const allClear = board.every((v) => v === 0);
      if (allClear) gain += 500 * Math.min(streak, STREAK_CAP);
      score += gain;

      const cx = L.bx + L.bs / 2, cy = L.by + L.bs / 2;
      floaters.add(clamp(ox, L.bx + L.cell * 1.4, L.bx + L.bs - L.cell * 1.4), Math.max(oy - L.cell * 0.4, L.by + L.cell * 1.7), `+${gain.toLocaleString()}`, { color: '#fff3c4', size: clamp(L.cell * 0.62, 18, 34), life: 1.1, rise: L.cell * 1.3 });
      const callout = allClear ? 'ALL CLEAR!' : lineCount >= 4 ? 'TESSELLATED!' : lineCount === 3 ? 'TRIPLE!' : lineCount === 2 ? 'DOUBLE!' : '';
      if (callout) {
        floaters.add(cx, cy, callout, { color: allClear ? '#9dfff0' : '#ffd166', size: clamp(L.cell * 1.05, 26, 60), life: 1.4, rise: L.cell * 0.9 });
        host.sfx.chord(allClear ? [5, 9, 12, 14, 17] : [4, 7, 9, 12].slice(0, lineCount + 1), { stagger: 0.06, dur: 0.6 });
      }
      if (lastOfHand && !allClear) floaters.add(cx, L.by + L.bs - L.cell * 0.6, 'CLEAN HAND +300', { color: '#b7f36b', size: clamp(L.cell * 0.42, 13, 22), life: 1.2, rise: L.cell * 0.4 });
      if (streak >= 2) floaters.add(cx, callout ? cy + L.cell * 1.3 : cy, streak >= STREAK_CAP ? `STREAK ×${STREAK_CAP} MAX` : `STREAK ×${streak}`, { color: '#ffb86b', size: clamp(L.cell * 0.5, 14, 26), life: 1.2, rise: L.cell * 0.5 });
      if (allClear) { host.sfx.sparkle(); rings.push({ x: cx, y: cy, t0: now + 0.12, radius: L.bs * 0.9, color: '#9dfff0' }); }
    } else {
      since++;
      if (streak > 0 && since >= grace()) {
        if (streak > 1) { floaters.add(L.hud.x + L.hud.w / 2, L.hud.y + L.hud.h + 14, 'streak ended', { color: '#93a0b8', size: 13, life: 1.3, rise: 14 }); host.sfx.tone({ freq: 330, slideTo: 220, dur: 0.25, gain: 0.05 }); }
        streak = 0; streakLostAt = now;
      }
    }

    host.setScore(score); status();
    if (tray.every((v) => v === null)) deal();
    refreshFits();
    host.save(snapshot());
    if (!fits.some((fit, i) => fit && tray[i] !== null)) pendingOverCheck = now + (lineCount > 0 ? 0.7 : 0.3);
  }

  function startOver() {
    if (over) return;
    held = null; target = null;
    const order: number[] = [];
    for (let idx = 0; idx < N * N; idx++) if (board[idx]) order.push(idx);
    over = { at: now + 0.35, order, next: 0, done: false };
    host.sfx.lose();
  }

  // ---- Input ----------------------------------------------------------------
  function slotAt(L: Layout, x: number, y: number): number {
    for (let i = 0; i < 3; i++) {
      const s = L.slots[i];
      if (tray[i] !== null && x >= s.x && x <= s.x + s.w && y >= s.y - 6 && y <= s.y + s.h + 6) return i;
    }
    return -1;
  }

  /** Tray size for a shape: small shapes are drawn larger so the tray never looks sparse. */
  function traySize(L: Layout, s: Shape): number {
    const slot = L.slots[0];
    return Math.min(L.cell * 0.66, (slot.w - 22) / s.w, (slot.h - 26) / s.h);
  }

  function liftFor(L: Layout, h: Held): number {
    const index = tray[h.slot];
    if (index === null || h.mode === 'picked') return 0;
    return (SHAPES[index].h / 2 + 0.85) * L.cell;
  }

  function computeTarget(L: Layout): { c: number; r: number } | null {
    if (!held) return null;
    const index = tray[held.slot];
    if (index === null) return null;
    const s = SHAPES[index];
    // Aim from where the piece is heading, not its smoothed position, so drops feel exact.
    const ax = pointer.x, ay = pointer.y - liftFor(L, held);
    const fx = (ax - L.bx) / L.cell - s.w / 2, fy = (ay - L.by) / L.cell - s.h / 2;
    if (fx < -1.4 || fy < -1.4 || fx > N - s.w + 1.4 || fy > N - s.h + 1.4) return null;
    // Overhanging the edge slides the piece back onto the board; that is the only
    // long-range forgiveness. Otherwise a drop must be within ~0.6 of a cell of a
    // legal spot, so aiming at an occupied cell never lands on its neighbour.
    const ec = clamp(Math.round(fx), 0, N - s.w), er = clamp(Math.round(fy), 0, N - s.h);
    const offBoard = fx < -0.5 || fy < -0.5 || fx > N - s.w + 0.5 || fy > N - s.h + 0.5;
    if (fitsAt(s, ec, er) && (offBoard || Math.hypot(ec - fx, er - fy) <= 0.75)) return { c: ec, r: er };
    let best: { c: number; r: number } | null = null, bestD = 0.62;
    const rc = Math.round(fx), rr = Math.round(fy);
    for (let r = rr - 1; r <= rr + 1; r++) for (let c = rc - 1; c <= rc + 1; c++) {
      if (!fitsAt(s, c, r)) continue;
      const d = Math.hypot(c - fx, r - fy);
      if (d < bestD) { bestD = d; best = { c, r }; }
    }
    return best;
  }

  function pick(L: Layout, slot: number, x: number, y: number, mode: 'drag' | 'picked') {
    const home = L.slots[slot];
    held = { slot, mode, x: home.cx, y: home.cy, scale: traySize(L, SHAPES[tray[slot]!]) / L.cell, downX: x, downY: y, moved: false };
    returns[slot] = null;
    host.sfx.tone({ freq: 520, slideTo: 760, dur: 0.07, type: 'sine', gain: 0.1 });
  }

  function release(L: Layout, deny: boolean) {
    if (!held) return;
    returns[held.slot] = { x: held.x, y: held.y, scale: held.scale, t0: now };
    if (deny) host.sfx.deny();
    held = null; target = null;
  }

  function pointerEvent(event: PointerEventLite) {
    if (over) return;
    const L = layout();
    pointer.x = event.x; pointer.y = event.y;
    if (event.type === 'down') {
      if (held && held.mode === 'picked') {
        const slot = slotAt(L, event.x, event.y);
        if (slot >= 0 && slot !== held.slot) { release(L, false); pick(L, slot, event.x, event.y, 'drag'); return; }
        if (slot === held.slot) { release(L, false); return; }
        const t = computeTarget(L);
        if (t) { place(held.slot, t.c, t.r); return; }
        const nearBoard = event.x > L.bx - L.cell && event.x < L.bx + L.bs + L.cell && event.y > L.by - L.cell && event.y < L.by + L.bs + L.cell;
        release(L, nearBoard);
        return;
      }
      const slot = slotAt(L, event.x, event.y);
      if (slot >= 0) pick(L, slot, event.x, event.y, 'drag');
    } else if (event.type === 'move') {
      if (held && held.mode === 'drag' && !held.moved && Math.hypot(event.x - held.downX, event.y - held.downY) > 7) held.moved = true;
    } else if (event.type === 'up') {
      if (held && held.mode === 'drag') {
        if (!held.moved) { held.mode = 'picked'; return; } // a click: carry the shape until the next click
        const t = computeTarget(L);
        if (t) place(held.slot, t.c, t.r);
        else {
          const overBoard = event.y - liftFor(L, held) < L.by + L.bs + L.cell * 0.5 && !L.wide || (L.wide && event.x < L.bx + L.bs + L.cell * 0.5);
          release(L, overBoard);
        }
      }
    }
  }

  function key(code: string, down: boolean) {
    if (!down || over) return;
    const slot = code === 'Digit1' ? 0 : code === 'Digit2' ? 1 : code === 'Digit3' ? 2 : -1;
    if (slot < 0 || tray[slot] === null) return;
    const L = layout();
    if (held) { const same = held.slot === slot; release(L, false); if (same) return; }
    pick(L, slot, pointer.x, pointer.y, 'picked');
  }

  // ---- Simulation -----------------------------------------------------------
  function update(dt: number) {
    now += dt;
    const L = layout();
    particles.update(dt);
    floaters.update(dt);

    if (held) {
      const lift = liftFor(L, held);
      const rate = host.reducedMotion ? 60 : 26;
      held.x = damp(held.x, pointer.x, rate, dt);
      held.y = damp(held.y, pointer.y - lift, rate, dt);
      held.scale = damp(held.scale, 1, 22, dt);
      target = computeTarget(L);
    }

    for (const b of breaking) {
      if (b.fired || now < b.at) continue;
      b.fired = true;
      const x = L.bx + (b.idx % N + 0.5) * L.cell, y = L.by + (Math.floor(b.idx / N) + 0.5) * L.cell;
      host.sfx.note(Math.min(b.order, 22) + Math.min(streak, 6), { gain: 0.14, dur: 0.2 });
      const light = colorCss(b.color, 22), base = colorCss(b.color, 0);
      if (host.reducedMotion) particles.emit(x, y, { count: 3, color: light, speed: 80, life: 0.4, size: 3 });
      else {
        particles.emit(x, y, { count: 7, color: [base, light, '#ffffff'], speed: 320, minSpeed: 80, life: 0.75, size: L.cell * 0.2, gravity: 620, drag: 1.4, kind: 'shard' });
        particles.emit(x, y, { count: 5, color: [light, '#ffffff'], speed: 200, life: 0.55, size: L.cell * 0.11, drag: 3 });
        particles.emit(x, y, { count: 3, color: light, speed: 420, minSpeed: 200, life: 0.3, size: 2.2, kind: 'spark' });
      }
    }
    breaking = breaking.filter((b) => now < b.at + 0.3);
    beams = beams.filter((b) => now < b.t0 + 0.5);
    rings = rings.filter((ring) => now < ring.t0 + 0.7);

    if (pendingOverCheck >= 0 && now >= pendingOverCheck && !over) {
      pendingOverCheck = -1;
      refreshFits();
      if (!fits.some((fit, i) => fit && tray[i] !== null)) startOver();
    }

    if (over && !over.done) {
      while (over.next < over.order.length && now >= over.at + over.next * 0.016) {
        greyed[over.order[over.next]] = true;
        if (over.next % 3 === 0) host.sfx.tone({ freq: 420 - over.next * 4, dur: 0.05, type: 'triangle', gain: 0.035 });
        over.next++;
      }
      if (now >= over.at + over.order.length * 0.016 + 0.75) {
        over.done = true;
        host.endRun({
          score, headline: 'NO MOVES LEFT',
          detail: `Level ${level()} · ${lines} ${lines === 1 ? 'line' : 'lines'}${bestStreak > 1 ? ` · best streak x${bestStreak}` : ''}`,
        });
      }
    }
  }

  // ---- Drawing --------------------------------------------------------------
  function drawTile(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, size: number, alpha = 1, sx = 1, sy = 1) {
    const w = (size - 2) * sx, h = (size - 2) * sy;
    ctx.globalAlpha = alpha;
    ctx.drawImage(tileSprite(color), x + size / 2 - w / 2, y + size / 2 - h / 2 + (size - 2 - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }

  function drawPiece(ctx: CanvasRenderingContext2D, s: Shape, cx: number, cy: number, size: number, alpha: number, grey: boolean) {
    const x0 = cx - (s.w * size) / 2, y0 = cy - (s.h * size) / 2;
    for (const [dc, dr] of s.cells) drawTile(ctx, grey ? GREY : s.color, x0 + dc * size, y0 + dr * size, size, alpha);
  }

  function drawBackground(ctx: CanvasRenderingContext2D, L: Layout, fill: number) {
    const w = host.w, h = host.h;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a0c16'); bg.addColorStop(0.55, '#0c0a15'); bg.addColorStop(1, '#07080e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // Aurora: a few huge, slow lights.
    const t = now * (host.reducedMotion ? 0.02 : 0.11);
    const reach = Math.max(w, h);
    const lights: [string, number, number, number, number][] = [
      ['#2b5cff', 0.20, 0.25, 0.9, 0.2],
      ['#b02bd8', 0.80, 0.20, 1.3, 0.17],
      ['#ff8a2b', 0.60, 0.95, 0.7, 0.13],
      ['#12c9a6', 0.10, 0.85, 1.1, 0.13],
    ];
    lights.forEach(([color, px, py, speed, alpha], i) => {
      const x = w * (px + 0.16 * Math.sin(t * speed + i * 2.1)), y = h * (py + 0.12 * Math.cos(t * speed * 0.8 + i * 1.3));
      drawGlow(ctx, x, y, reach * 0.62, color, alpha);
    });
    if (fill > 0.55) {
      const danger = (fill - 0.55) / 0.45;
      const pulse = 0.75 + 0.25 * Math.sin(now * 3.2);
      drawGlow(ctx, L.bx + L.bs / 2, L.by + L.bs / 2, L.bs * 0.95, '#ff2a3d', danger * 0.2 * pulse);
    }

    // Dust motes.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 46; i++) {
      const px = ((i * 137.5) % 100) / 100, py = ((i * 61.8 + 13) % 100) / 100;
      const drift = now * (0.004 + (i % 5) * 0.0016);
      const x = ((px + drift) % 1) * w, y = ((py + Math.sin(now * 0.2 + i) * 0.01 + 1) % 1) * h;
      ctx.globalAlpha = 0.07 + 0.09 * (0.5 + 0.5 * Math.sin(now * (0.6 + (i % 7) * 0.2) + i));
      const r = 0.6 + (i % 3) * 0.5;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;
  }

  function drawBoard(ctx: CanvasRenderingContext2D, L: Layout, fill: number) {
    const { bx, by, bs, cell } = L;
    const m = clamp(cell * 0.2, 6, 12);
    const danger = fill > 0.55 ? (fill - 0.55) / 0.45 : 0;

    // Drop shadow, then the well.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx - m, by - m + cell * 0.14, bs + m * 2, bs + m * 2, cell * 0.36); ctx.fill();
    const well = ctx.createLinearGradient(0, by - m, 0, by + bs + m);
    well.addColorStop(0, '#171c2e'); well.addColorStop(1, '#0d101c');
    roundRect(ctx, bx - m, by - m, bs + m * 2, bs + m * 2, cell * 0.36);
    ctx.fillStyle = well; ctx.fill();
    const rim = ctx.createLinearGradient(0, by - m, 0, by + bs + m);
    rim.addColorStop(0, `rgba(${Math.round(lerp(190, 255, danger))},${Math.round(lerp(205, 110, danger))},${Math.round(lerp(255, 120, danger))},${0.34 + danger * 0.3})`);
    rim.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.stroke();

    // Empty sockets with a slow travelling shimmer.
    const pad = Math.max(1.5, cell * 0.05), radius = cell * 0.2;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const wave = host.reducedMotion ? 0 : Math.max(0, Math.sin(now * 0.9 - (c + r) * 0.42));
      roundRect(ctx, bx + c * cell + pad, by + r * cell + pad, cell - pad * 2, cell - pad * 2, radius);
      ctx.fillStyle = `rgba(150,170,255,${0.045 + wave * wave * 0.035})`; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function render(ctx: CanvasRenderingContext2D) {
    const L = layout();
    const { bx, by, bs, cell } = L;
    let filled = 0;
    for (let i = 0; i < N * N; i++) if (board[i]) filled++;
    const fill = filled / (N * N);

    drawBackground(ctx, L, fill);
    drawBoard(ctx, L, fill);

    // What would this drop complete?
    const heldShape = held && tray[held.slot] !== null ? SHAPES[tray[held.slot]!] : null;
    let preview: { rows: number[]; cols: number[] } | null = null;
    const ghost = new Set<number>();
    if (heldShape && target) {
      for (const [dc, dr] of heldShape.cells) ghost.add((target.r + dr) * N + target.c + dc);
      preview = completedLines(ghost);
    }
    const lit = (idx: number) => !!preview && (preview.rows.includes(Math.floor(idx / N)) || preview.cols.includes(idx % N));

    // Placed tiles.
    for (let idx = 0; idx < N * N; idx++) {
      const value = board[idx];
      if (!value) continue;
      const x = bx + (idx % N) * cell, y = by + Math.floor(idx / N) * cell;
      const age = (now - landAt[idx]) / 0.34;
      let sx = 1, sy = 1;
      if (age >= 0 && age < 1 && !host.reducedMotion) { const k = Math.sin(age * Math.PI * 2.2) * (1 - age) * 0.2; sy = 1 - k; sx = 1 + k * 0.7; }
      if (greyed[idx]) { drawTile(ctx, GREY, x, y, cell, 0.85); continue; }
      drawTile(ctx, value - 1, x, y, cell, 1, sx, sy);
      if (age >= 0 && age < 1) drawGlow(ctx, x + cell / 2, y + cell / 2, cell * 1.3, colorCss(value - 1, 14), (1 - age) * 0.55);
      if (lit(idx)) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 11);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${0.07 + pulse * 0.13})`;
        roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, cell * 0.2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Lines that the hovering shape would complete.
    if (preview) {
      const pulse = 0.6 + 0.4 * Math.sin(now * 11);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,214,120,${0.1 + pulse * 0.08})`;
      for (const row of preview.rows) { roundRect(ctx, bx - 3, by + row * cell, bs + 6, cell, cell * 0.24); ctx.fill(); }
      for (const col of preview.cols) { roundRect(ctx, bx + col * cell, by - 3, cell, bs + 6, cell * 0.24); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Ghost of the drop.
    if (heldShape && target) {
      for (const idx of ghost) {
        const x = bx + (idx % N) * cell, y = by + Math.floor(idx / N) * cell;
        drawTile(ctx, heldShape.color, x, y, cell, 0.34);
        roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, cell * 0.2);
        ctx.strokeStyle = colorCss(heldShape.color, 24, 0.85); ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // Tiles waiting to shatter, then their flash.
    for (const b of breaking) {
      const x = bx + (b.idx % N) * cell, y = by + Math.floor(b.idx / N) * cell;
      if (now < b.at) {
        const charge = clamp(1 - (b.at - now) / 0.12, 0, 1);
        drawTile(ctx, b.color, x, y, cell, 1, 1 + charge * 0.08, 1 + charge * 0.08);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${0.25 + charge * 0.55})`;
        roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, cell * 0.2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        const k = (now - b.at) / 0.3;
        drawGlow(ctx, x + cell / 2, y + cell / 2, cell * (1 + k * 1.6), colorCss(b.color, 24), (1 - k) * 0.9);
      }
    }

    // Beams along cleared lines.
    ctx.globalCompositeOperation = 'lighter';
    for (const beam of beams) {
      const k = (now - beam.t0) / 0.5;
      const thick = cell * (0.9 - k * 0.8);
      ctx.fillStyle = `rgba(255,240,200,${(1 - k) * 0.5})`;
      if (beam.row) ctx.fillRect(bx - 8, by + (beam.index + 0.5) * cell - thick / 2, bs + 16, thick);
      else ctx.fillRect(bx + (beam.index + 0.5) * cell - thick / 2, by - 8, thick, bs + 16);
    }
    for (const ring of rings) {
      const k = (now - ring.t0) / 0.7;
      if (k < 0) continue;
      ctx.strokeStyle = ring.color; ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = cell * 0.13 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius * easeOutCubic(k), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    drawTray(ctx, L);
    particles.render(ctx);
    drawHud(ctx, L);

    // The carried shape rides above everything.
    if (held && heldShape) {
      const size = cell * held.scale * 0.98;
      const shadow = clamp(held.scale, 0, 1) * cell * 0.22;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      const x0 = held.x - (heldShape.w * size) / 2, y0 = held.y - (heldShape.h * size) / 2;
      for (const [dc, dr] of heldShape.cells) { roundRect(ctx, x0 + dc * size + shadow * 0.4, y0 + dr * size + shadow, size - 2, size - 2, size * 0.2); ctx.fill(); }
      ctx.globalAlpha = 1;
      drawGlow(ctx, held.x, held.y, cell * Math.max(heldShape.w, heldShape.h) * 1.1, colorCss(heldShape.color, 10), 0.28);
      drawPiece(ctx, heldShape, held.x, held.y, size, target ? 0.95 : 0.82, false);
    }

    floaters.render(ctx, FONT);
  }

  function drawTray(ctx: CanvasRenderingContext2D, L: Layout) {
    for (let i = 0; i < 3; i++) {
      const slot = L.slots[i];
      // Pedestal.
      const inset = clamp(Math.min(slot.w, slot.h) * 0.06, 4, 10);
      roundRect(ctx, slot.x + inset, slot.y + inset, slot.w - inset * 2, slot.h - inset * 2, 16);
      const pedestal = ctx.createLinearGradient(0, slot.y, 0, slot.y + slot.h);
      pedestal.addColorStop(0, 'rgba(255,255,255,0.045)'); pedestal.addColorStop(1, 'rgba(255,255,255,0.012)');
      ctx.fillStyle = pedestal; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

      const index = tray[i];
      if (index === null || (held && held.slot === i)) continue;
      const s = SHAPES[index];
      const enter = clamp((now - enterAt[i]) / 0.55, 0, 1);
      if (enter <= 0) continue;
      const pop = host.reducedMotion ? 1 : easeOutBack(enter);
      const bob = host.reducedMotion || over ? 0 : Math.sin(now * 1.7 + i * 1.9) * 2.2;
      const rest = traySize(L, s);
      let cx = slot.cx, cy = slot.cy + bob, size = rest * pop;
      const back = returns[i];
      if (back) {
        const k = clamp((now - back.t0) / 0.2, 0, 1);
        if (k >= 1) returns[i] = null;
        const e = easeOutBack(k);
        cx = lerp(back.x, slot.cx, e); cy = lerp(back.y, slot.cy, e); size = lerp(L.cell * back.scale, rest, easeOutCubic(k));
      }
      const playable = fits[i] && !over;
      if (playable) drawGlow(ctx, cx, cy, rest * Math.max(s.w, s.h) * 1.25, colorCss(s.color, 0), 0.16 + 0.05 * Math.sin(now * 2 + i));
      drawPiece(ctx, s, cx, cy, size, playable ? Math.min(1, enter * 2) : 0.34, !playable);
    }
  }

  function drawHud(ctx: CanvasRenderingContext2D, L: Layout) {
    const { hud } = L;
    const midY = hud.y + hud.h / 2;
    ctx.textBaseline = 'middle';
    const small = clamp(hud.h * 0.27, 10, 13), big = clamp(hud.h * 0.56, 20, 30);

    if (streak > 0) {
      const pop = clamp((now - streakPopAt) / 0.4, 0, 1);
      const scale = host.reducedMotion ? 1 : 1 + (1 - easeOutCubic(pop)) * 0.5;
      const hot = Math.min(1, streak / 6);
      const color = hsl(lerp(44, 8, hot), 100, lerp(66, 62, hot));
      ctx.textAlign = 'left';
      ctx.font = `700 ${small}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('STREAK', hud.x + 2, midY - big * 0.34);
      // Grace pips: placements left before the streak cools.
      for (let i = 0; i < grace(); i++) {
        const on = i < grace() - since;
        ctx.beginPath(); ctx.arc(hud.x + 6 + i * 11, midY + big * 0.3, 3.2, 0, TAU);
        ctx.fillStyle = on ? color : 'rgba(255,255,255,0.14)'; ctx.fill();
      }
      const labelW = Math.max(54, small * 4.6);
      ctx.font = `900 ${Math.round(big * scale)}px ${FONT}`; ctx.fillStyle = color;
      drawGlow(ctx, hud.x + labelW + big * 0.8, midY, big * (1.3 + hot), color, 0.22 + hot * 0.25);
      ctx.fillText(`×${Math.min(streak, STREAK_CAP)}`, hud.x + labelW, midY + 1);
    } else {
      const fade = clamp((now - streakLostAt) / 0.8, 0, 1);
      ctx.textAlign = 'left'; ctx.font = `600 ${small + 1}px ${FONT}`;
      ctx.fillStyle = `rgba(190,200,225,${0.32 + 0.2 * fade})`;
      ctx.fillText(lines === 0 ? 'Fill a row or column to clear it' : 'Clear again to start a streak', hud.x + 2, midY);
    }

    ctx.textAlign = 'right';
    ctx.font = `700 ${small}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('LINES', hud.x + hud.w - 2, midY - big * 0.34);
    ctx.font = `800 ${Math.round(big * 0.72)}px ${FONT}`; ctx.fillStyle = 'rgba(235,240,255,0.9)';
    ctx.fillText(String(lines), hud.x + hud.w - 2, midY + big * 0.22);
  }

  // ---- Boot -----------------------------------------------------------------
  if (isSaved(saved)) {
    for (let i = 0; i < N * N; i++) board[i] = saved.board[i];
    tray = saved.tray.slice();
    score = saved.score; streak = saved.streak; since = saved.since ?? 0; lines = saved.lines ?? 0; bestStreak = saved.bestStreak ?? streak;
    for (let i = 0; i < 3; i++) enterAt[i] = i * 0.07;
    if (tray.every((v) => v === null)) deal();
    host.setScore(score); status();
    refreshFits();
    if (!fits.some((fit, i) => fit && tray[i] !== null)) pendingOverCheck = 0.6;
  } else {
    deal();
    refreshFits();
  }

  return { update, render, pointer: pointerEvent, key };
}

const tessel: GameModule = { create, realtime: false, bloom: 0.42, hintAt: 'top' };
export default tessel;
