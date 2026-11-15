import type { Game, GameHost, GameModule, PointerEventLite } from '../engine/types';
import { FONT, Floaters, Particles, TAU, clamp, drawGlow, easeOutCubic, easeOutElastic, hsl, lerp, roundRect } from '../engine/fx';

// Critical Mass: drop numbered plasma cores into a reactor chamber. Equal cores
// fuse into their sum; fusions chain. The run ends when the pile stays above
// the containment line.
//
// Physics runs in fixed world units (chamber is 100 wide, 150 tall) so a saved
// pile restores identically at any window size.

const W = 100;
const H = 150;
const LINE_Y = 30;         // containment line
const DROP_Y = 11;         // where the held core hangs
const GRAVITY = 430;
const STEP = 1 / 120;
const ITERATIONS = 5;
const LOSS_SECONDS = 3.5;
const CHAIN_CAP = 8;
/** Chain multiplier: x1, x1.5, x2 ... capped, so a lucky cascade cannot outscore a whole run. */
const chainMult = (chain: number) => Math.min(CHAIN_CAP, 1 + 0.5 * (chain - 1));

type Core = {
  id: number; tier: number;
  x: number; y: number; vx: number; vy: number;
  r: number; fromR: number; grow: number; // radius eases from fromR to the tier radius
  ang: number;
  landed: boolean; landedFor: number;
  born: number;       // seconds since creation (drives squash and stretch)
  fuseCd: number;     // cannot fuse again until this reaches 0
  fused: boolean;     // true if created by a fusion (gets the pop animation)
  gone: boolean;
};

type Ring = { x: number; y: number; from: number; to: number; life: number; max: number; color: string; width: number };

type SavedCore = { x: number; y: number; t: number };
type SavedState = { cores: SavedCore[]; cur: number; next: number; score: number; biggest: number; drops: number; bestChain?: number };

const tierValue = (tier: number) => Math.pow(2, tier + 1);
const tierRadius = (tier: number) => Math.min(28, 5.5 + tier * 1.05 + tier * tier * 0.085);
const HUES = [188, 158, 96, 46, 22, 350, 318, 276, 226, 172, 48];
const tierHue = (tier: number) => (tier < HUES.length ? HUES[tier] : (48 + (tier - 10) * 47) % 360);
const tierColor = (tier: number, l = 60, a = 1) => hsl(tierHue(tier), 96, l, a);
function label(value: number) { return value >= 100000 ? `${Math.round(value / 1024)}K` : String(value); }

// ---- Cached orb sprites -------------------------------------------------------

const SPRITE = 192;
const bodyCache = new Map<number, HTMLCanvasElement>();
const lightCache = new Map<number, HTMLCanvasElement>();

function bodySprite(tier: number): HTMLCanvasElement {
  let sprite = bodyCache.get(tier);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE;
  const g = sprite.getContext('2d')!;
  const c = SPRITE / 2, hue = tierHue(tier);
  const hot = tier >= 9; // the biggest cores run white-hot
  g.beginPath(); g.arc(c, c, c - 1, 0, TAU); g.closePath(); g.clip();
  const body = g.createRadialGradient(c, c, 0, c, c, c);
  body.addColorStop(0, hsl(hue, 100, hot ? 92 : 80));
  body.addColorStop(0.38, hsl(hue, 98, hot ? 66 : 56));
  body.addColorStop(0.8, hsl(hue + 14, 92, 31));
  body.addColorStop(1, hsl(hue + 24, 88, 15));
  g.fillStyle = body; g.fillRect(0, 0, SPRITE, SPRITE);

  // Plasma: layered arcs that read as swirling currents when the orb rotates.
  let seed = (tier + 3) * 9973;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const radius = c * (0.2 + rnd() * 0.62), start = rnd() * TAU, sweep = 0.8 + rnd() * 1.9;
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = hsl(hue + 34, 85, 10, 0.2); g.lineWidth = SPRITE * (0.05 + rnd() * 0.05);
    g.beginPath(); g.arc(c + (rnd() - 0.5) * 14, c + (rnd() - 0.5) * 14, radius, start + 1.7, start + 1.7 + sweep); g.stroke();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = hsl(hue - 22, 100, 78, 0.17); g.lineWidth = SPRITE * (0.05 + rnd() * 0.06);
    g.beginPath(); g.arc(c + (rnd() - 0.5) * 14, c + (rnd() - 0.5) * 14, radius, start, start + sweep); g.stroke();
    g.strokeStyle = hsl(hue - 30, 100, 90, 0.3); g.lineWidth = SPRITE * 0.014;
    g.beginPath(); g.arc(c, c, radius * 0.96, start + 0.2, start + sweep * 0.7); g.stroke();
  }
  // Bright motes inside the plasma.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, d = rnd() * c * 0.72, size = 2 + rnd() * 5;
    const mote = g.createRadialGradient(c + Math.cos(a) * d, c + Math.sin(a) * d, 0, c + Math.cos(a) * d, c + Math.sin(a) * d, size * 2.4);
    mote.addColorStop(0, hsl(hue - 20, 100, 92, 0.6)); mote.addColorStop(1, hsl(hue, 100, 70, 0));
    g.fillStyle = mote; g.fillRect(0, 0, SPRITE, SPRITE);
  }
  // Hot core.
  const heart = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  heart.addColorStop(0, `rgba(255,255,255,${hot ? 0.75 : 0.42})`); heart.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = heart; g.fillRect(0, 0, SPRITE, SPRITE);
  bodyCache.set(tier, sprite);
  return sprite;
}

function lightSprite(tier: number): HTMLCanvasElement {
  let sprite = lightCache.get(tier);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE;
  const g = sprite.getContext('2d')!;
  const c = SPRITE / 2, hue = tierHue(tier);
  g.save();
  g.beginPath(); g.arc(c, c, c - 1, 0, TAU); g.clip();
  // Shade the underside so the orb reads as a sphere.
  const shade = g.createRadialGradient(c * 0.78, c * 0.66, c * 0.35, c, c, c * 1.04);
  shade.addColorStop(0, 'rgba(0,0,20,0)'); shade.addColorStop(0.75, 'rgba(4,0,26,0.28)'); shade.addColorStop(1, 'rgba(4,0,26,0.72)');
  g.fillStyle = shade; g.fillRect(0, 0, SPRITE, SPRITE);
  // Broad glassy highlight.
  const spec = g.createRadialGradient(c * 0.66, c * 0.5, 0, c * 0.66, c * 0.5, c * 0.78);
  spec.addColorStop(0, 'rgba(255,255,255,0.62)'); spec.addColorStop(0.35, 'rgba(255,255,255,0.2)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec; g.fillRect(0, 0, SPRITE, SPRITE);
  // Bounce light from the chamber floor.
  const bounce = g.createRadialGradient(c * 1.2, c * 1.72, 0, c * 1.2, c * 1.72, c * 0.7);
  bounce.addColorStop(0, hsl(hue - 30, 100, 80, 0.45)); bounce.addColorStop(1, hsl(hue, 100, 70, 0));
  g.fillStyle = bounce; g.fillRect(0, 0, SPRITE, SPRITE);
  g.restore();
  // Sharp glint.
  g.save(); g.translate(c * 0.62, c * 0.44); g.rotate(-0.7); g.scale(1, 0.52);
  const glint = g.createRadialGradient(0, 0, 0, 0, 0, c * 0.24);
  glint.addColorStop(0, 'rgba(255,255,255,0.95)'); glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint; g.beginPath(); g.arc(0, 0, c * 0.24, 0, TAU); g.fill(); g.restore();
  // Rim light.
  const rim = g.createLinearGradient(0, 0, SPRITE * 0.5, SPRITE);
  rim.addColorStop(0, 'rgba(255,255,255,0.9)'); rim.addColorStop(0.45, hsl(hue, 100, 78, 0.35)); rim.addColorStop(1, hsl(hue - 20, 100, 72, 0.75));
  g.strokeStyle = rim; g.lineWidth = 3.2;
  g.beginPath(); g.arc(c, c, c - 2.6, 0, TAU); g.stroke();
  lightCache.set(tier, sprite);
  return sprite;
}

// ---- The game -----------------------------------------------------------------

function create(host: GameHost, saved: unknown | null): Game {
  const sfx = host.sfx;
  const particles = new Particles(host.reducedMotion ? 400 : 1300);
  const floaters = new Floaters();
  let cores: Core[] = [];
  let rings: Ring[] = [];
  let nextId = 1;
  let score = 0, biggest = 0, drops = 0, bestChain = 0, queued = false;
  let cur = 0, next = 0;
  let aimX = W / 2, aimTarget = W / 2, keyDir = 0;
  let dropLock = false, lockTimer = 0, dropped: Core | null = null, sinceDrop = 0;
  let chain = 0, chainTimer = 0;
  let accumulator = 0;
  let quietFor = 0, dirty = false, sinceUnlock = 0;
  let lossTimer = 0, tickAt = 0;
  let flash = 0;          // whole-chamber flash, 0..1
  let swap = 1;           // 0..1 animation of the held core arriving
  let phase: 'play' | 'ending' | 'done' = 'play';
  let endQueue: Core[] = [], endTimer = 0, endIndex = 0;
  let pointerDown = false;
  let thudAt = -1;
  let time = 0;

  // Layout (pixels), refreshed every frame.
  let s = 4, ox = 0, oy = 0, wide = false;
  function layout() {
    const w = host.w, h = host.h;
    const topPad = h < 560 ? 40 : 50, bottomPad = h < 560 ? 18 : 26;
    s = Math.min((w - 28) / W, (h - topPad - bottomPad) / H);
    wide = w - W * s >= 330;
    ox = (w - W * s) / 2;
    oy = topPad + (h - topPad - bottomPad - H * s) / 2;
  }
  layout();

  // The spawn table climbs with your biggest core: once a 256 exists the 2s stop
  // coming, and so on. Late piles are not clogged with pebbles and fill faster.
  function minTier() { return Math.max(0, biggest - 6); }
  function rollTier(): number {
    const roll = host.rng();
    return minTier() + (roll < 0.4 ? 0 : roll < 0.7 ? 1 : roll < 0.9 ? 2 : 3);
  }

  function makeCore(tier: number, x: number, y: number): Core {
    const r = tierRadius(tier);
    return { id: nextId++, tier, x, y, vx: 0, vy: 0, r, fromR: r, grow: 1, ang: host.rng() * TAU, landed: false, landedFor: 0, born: 1, fuseCd: 0, fused: false, gone: false };
  }

  const restored = saved as SavedState | null;
  if (restored && Array.isArray(restored.cores) && restored.cores.length <= 400 && Number.isFinite(restored.cur) && Number.isFinite(restored.next)) {
    for (const item of restored.cores) {
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.t)) continue;
      const tier = clamp(Math.round(item.t), 0, 40);
      const core = makeCore(tier, clamp(item.x, 0, W), clamp(item.y, -20, H));
      if ((item as SavedCore & { f?: number }).f) { core.vy = 30; } else { core.landed = true; core.landedFor = 5; }
      cores.push(core);
    }
    cur = clamp(Math.round(restored.cur), 0, 40); next = clamp(Math.round(restored.next), 0, 40);
    bestChain = Math.max(0, Number(restored.bestChain) || 0);
    score = Math.max(0, Number(restored.score) || 0);
    biggest = cores.reduce((max, core) => Math.max(max, core.tier), Math.max(0, Number(restored.biggest) || 0));
    drops = Math.max(0, Number(restored.drops) || 0);
  } else {
    // A small starting pile, so the very first drop can fuse.
    const slots = [11, 27, 43, 59, 75, 90];
    let previous = -1;
    for (const x of slots) {
      let tier = Math.floor(host.rng() * 3);
      if (tier === previous) tier = (tier + 1) % 3;
      previous = tier;
      const core = makeCore(tier, x + (host.rng() - 0.5) * 3, H - tierRadius(tier));
      core.landed = true; core.landedFor = 5;
      cores.push(core);
    }
    cur = cores[Math.floor(host.rng() * cores.length)].tier;
    // A second layer drifts down as the run opens, up to a 32, so there is
    // something worth aiming at from the first second.
    [[20, 3], [38, 1], [56, 4], [78, 2]].forEach(([x, tier], i) => {
      const core = makeCore(tier, x + (host.rng() - 0.5) * 4, H - 34 - i * 7);
      cores.push(core);
    });
    biggest = 4;
    next = rollTier();
  }
  host.setScore(score);
  showStatus();

  function showStatus() {
    host.setStatus(chain > 1 ? `Chain x${chain}` : '');
  }

  const px = (x: number) => ox + x * s;
  const py = (y: number) => oy + y * s;

  function clampAim(x: number) { const r = tierRadius(cur); return clamp(x, r + 0.4, W - r - 0.4); }

  function drop() {
    // A click during the short lock is remembered and fires the moment it lifts.
    if (phase !== 'play') return;
    if (dropLock) { queued = true; return; }
    queued = false;
    chain = 0; // a chain is the cascade from one drop
    aimX = clampAim(aimTarget);
    const core = makeCore(cur, aimX, DROP_Y);
    core.vy = 30;
    cores.push(core);
    dropped = core; dropLock = true; lockTimer = 0.2; sinceDrop = 0;
    drops++;
    cur = next; next = rollTier(); swap = 0;
    aimTarget = clampAim(aimTarget);
    dirty = true; quietFor = 0;
    saveNow(); // the drop is committed: a reload must not hand the core back
    dirty = true;
    sfx.tone({ freq: 520, slideTo: 240, dur: 0.12, type: 'sine', gain: 0.12 });
  }

  // ---- Physics ----------------------------------------------------------------
  const fusePairs: [Core, Core][] = [];

  function step(dt: number) {
    for (const c of cores) {
      c.vy += GRAVITY * dt;
      c.vx *= 0.996; c.vy *= 0.9995;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.ang += (c.vx / Math.max(4, c.r)) * dt;
      if (c.grow < 1) { c.grow = Math.min(1, c.grow + dt / 0.16); c.r = lerp(c.fromR, tierRadius(c.tier), easeOutCubic(c.grow)); }
      if (c.fuseCd > 0) c.fuseCd -= dt;
    }
    const n = cores.length;
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (let i = 0; i < n; i++) {
        const a = cores[i];
        for (let j = i + 1; j < n; j++) {
          const b = cores[j];
          const dx = b.x - a.x, dy = b.y - a.y, reach = a.r + b.r;
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          const dist = Math.sqrt(d2) || 0.0001;
          const nx = dx / dist, ny = dist > 0.0001 ? dy / dist : -1;
          const invA = 1 / (a.r * a.r), invB = 1 / (b.r * b.r), invSum = invA + invB;
          const overlap = reach - dist;
          const push = Math.min(overlap, 3) * 0.55 / invSum;
          a.x -= nx * push * invA; a.y -= ny * push * invA;
          b.x += nx * push * invB; b.y += ny * push * invB;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const bounce = vn < -45 ? 0.14 : 0;
            const impulse = (-(1 + bounce) * vn) / invSum;
            a.vx -= impulse * invA * nx; a.vy -= impulse * invA * ny;
            b.vx += impulse * invB * nx; b.vy += impulse * invB * ny;
            const tx = -ny, ty = nx;
            const vt = rvx * tx + rvy * ty;
            const friction = clamp(-vt / invSum, -0.22 * impulse, 0.22 * impulse);
            a.vx -= friction * invA * tx; a.vy -= friction * invA * ty;
            b.vx += friction * invB * tx; b.vy += friction * invB * ty;
            if (iteration === 0 && vn < -70) impact(Math.min(1, -vn / 320), (a.x + b.x) / 2, (a.y + b.y) / 2, a.tier);
          }
          if (!a.landed || !b.landed) { a.landed = true; b.landed = true; }
          if (iteration === 0 && a.tier === b.tier && a.fuseCd <= 0 && b.fuseCd <= 0 && !a.gone && !b.gone) {
            a.gone = b.gone = true; fusePairs.push([a, b]);
          }
        }
      }
      for (const c of cores) {
        if (c.x < c.r) { c.x = c.r; if (c.vx < 0) c.vx *= -0.18; }
        else if (c.x > W - c.r) { c.x = W - c.r; if (c.vx > 0) c.vx *= -0.18; }
        if (c.y > H - c.r) {
          c.y = H - c.r;
          if (c.vy > 0) {
            if (iteration === 0 && c.vy > 90) impact(Math.min(1, c.vy / 340), c.x, H, c.tier);
            c.vy = c.vy > 55 ? c.vy * -0.14 : 0;
            c.vx *= 0.94;
          }
          c.landed = true;
        }
      }
    }
    // Equal cores that settle a hair apart used to sit there forever, held off by a
    // pebble. They now pull toward each other when close and fuse when nearly touching.
    for (let i = 0; i < cores.length; i++) {
      const a = cores[i];
      if (a.gone || a.fuseCd > 0) continue;
      for (let j = i + 1; j < cores.length; j++) {
        const b = cores[j];
        if (b.gone || b.tier !== a.tier || b.fuseCd > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), gap = dist - a.r - b.r;
        if (gap > 6 || dist < 0.001) continue;
        if (gap <= 1.5 && a.landed && b.landed) { a.gone = b.gone = true; fusePairs.push([a, b]); break; }
        const pull = 70 * dt * (1 - gap / 6);
        a.vx += (dx / dist) * pull; a.vy += (dy / dist) * pull;
        b.vx -= (dx / dist) * pull; b.vy -= (dy / dist) * pull;
      }
    }
    if (fusePairs.length) {
      for (const [a, b] of fusePairs) fuse(a, b);
      fusePairs.length = 0;
      cores = cores.filter((c) => !c.gone);
    }
  }

  function impact(power: number, x: number, y: number, tier: number) {
    if (time - thudAt < 0.07) return;
    thudAt = time;
    sfx.thud(0.25 + power * 0.55);
    if (!host.reducedMotion) particles.emit(px(x), py(y), { count: 3 + Math.round(power * 6), color: tierColor(tier, 72), speed: 60 + power * 120, life: 0.35, size: 2.2, gravity: 200, kind: 'glow' });
  }

  function fuse(a: Core, b: Core) {
    const tier = a.tier + 1;
    const core = makeCore(tier, (a.x + b.x) / 2, (a.y + b.y) / 2);
    core.vx = (a.vx + b.vx) * 0.3; core.vy = (a.vy + b.vy) * 0.3 - 26;
    core.fromR = Math.max(a.r, b.r); core.r = core.fromR; core.grow = 0;
    core.landed = true; core.landedFor = Math.min(a.landedFor, b.landedFor);
    core.born = 0; core.fused = true; core.fuseCd = 0.13;
    core.ang = a.ang;
    cores.push(core);
    if (dropped === a || dropped === b) dropped = core;

    chain++; chainTimer = 0.95; bestChain = Math.max(bestChain, chain);
    const value = tierValue(tier);
    const gained = Math.round(value * chainMult(chain));
    score += gained; host.setScore(score);
    dirty = true; quietFor = 0;

    // Shove the neighbours so the pile visibly reacts.
    const range = tierRadius(tier) * 2.7;
    for (const other of cores) {
      if (other === core || other.gone) continue;
      const dx = other.x - core.x, dy = other.y - core.y, dist = Math.hypot(dx, dy);
      if (dist > range || dist < 0.001) continue;
      const kick = 34 * (1 - dist / range) * Math.min(1.6, 0.8 + chain * 0.12);
      other.vx += (dx / dist) * kick; other.vy += (dy / dist) * kick - 4;
    }

    const X = px(core.x), Y = py(core.y), R = tierRadius(tier) * s;
    const color = tierColor(tier, 66), power = Math.min(1, 0.25 + chain * 0.13 + tier * 0.035);
    rings.push({ x: X, y: Y, from: R * 0.5, to: R * (2.3 + power * 1.8), life: 0.5, max: 0.5, color, width: 3 + power * 4 });
    if (chain > 2) rings.push({ x: X, y: Y, from: R * 0.3, to: R * (3.4 + power * 2.4), life: 0.7, max: 0.7, color: '#ffffff', width: 1.5 });
    const scale = host.reducedMotion ? 0.3 : 1;
    particles.emit(X, Y, { count: Math.round((10 + power * 26) * scale), color: [color, '#ffffff', tierColor(tier - 1, 70)], speed: 150 + power * 330, minSpeed: 50, life: 0.55 + power * 0.3, size: 3, kind: 'spark', drag: 3 });
    particles.emit(X, Y, { count: Math.round((8 + power * 14) * scale), color: [color, tierColor(tier, 80)], speed: 60 + power * 150, life: 0.7 + power * 0.4, size: 4 + power * 3, kind: 'glow', gravity: -30 });
    floaters.add(X, Y - R - 6, chain > 1 ? `+${label(gained)}  x${chainMult(chain)}` : `+${label(gained)}`, { color: tierColor(tier, 78), size: clamp(15 + chain * 2.2, 15, 34), life: 0.95 });
    flash = Math.max(flash, Math.min(0.85, 0.1 + power * 0.5));
    host.shake(1.5 + power * 9);
    if (chain > 1 || tier >= 5) host.hitStop(24 + power * 80);

    sfx.note(chain + Math.min(tier, 6), { gain: 0.2 + power * 0.08 });
    sfx.pop(chain);
    if (tier >= 6) sfx.boom(0.35 + power * 0.4);
    if (tier > biggest) {
      biggest = tier;
      if (tier >= 4) {
        sfx.sparkle();
        floaters.add(px(W / 2), py(LINE_Y + 16), `NEW CORE  ${label(value)}`, { color: '#ffffff', size: clamp(s * 5.2, 16, 30), life: 1.5, rise: 26 });
        rings.push({ x: X, y: Y, from: R, to: R * 6, life: 0.9, max: 0.9, color: '#ffffff', width: 2 });
      }
    }
    showStatus();
  }

  function saveNow() {
    dirty = false;
    const state: SavedState = {
      cores: cores.filter((c) => !c.gone).map((c) => ({ x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100, t: c.tier, ...(c.landed ? {} : { f: 1 }) })),
      cur, next, score, biggest, drops, bestChain,
    };
    host.save(state);
  }

  function beginEnding() {
    phase = 'ending';
    endQueue = [...cores].sort((a, b) => a.y - b.y);
    endIndex = 0; endTimer = 0.35;
    sfx.lose(); host.shake(10); flash = 0.7;
    host.setStatus('Containment lost');
  }

  // ---- Update -----------------------------------------------------------------
  function update(dt: number) {
    time += dt;
    layout();
    particles.update(dt); floaters.update(dt);
    for (const ring of rings) ring.life -= dt;
    if (rings.length) rings = rings.filter((ring) => ring.life > 0);
    flash = Math.max(0, flash - dt * 2.6);
    swap = Math.min(1, swap + dt * 4.5);
    for (const c of cores) { c.born += dt; if (c.landed) c.landedFor += dt; }

    if (phase === 'done') return;
    if (phase === 'ending') {
      endTimer -= dt;
      while (endTimer <= 0 && endIndex < endQueue.length) {
        const c = endQueue[endIndex++];
        c.gone = true;
        const X = px(c.x), Y = py(c.y);
        particles.emit(X, Y, { count: host.reducedMotion ? 4 : 14, color: [tierColor(c.tier, 66), '#ffffff'], speed: 230, life: 0.6, size: 3, kind: 'spark' });
        particles.emit(X, Y, { count: host.reducedMotion ? 2 : 6, color: tierColor(c.tier, 70), speed: 90, life: 0.7, size: 5 });
        rings.push({ x: X, y: Y, from: c.r * s * 0.4, to: c.r * s * 1.9, life: 0.35, max: 0.35, color: tierColor(c.tier, 66), width: 2.5 });
        floaters.add(X, Y, label(tierValue(c.tier)), { color: tierColor(c.tier, 80), size: 14, life: 0.6, rise: 24 });
        sfx.pop(Math.min(endIndex, 24));
        endTimer += Math.max(0.035, 0.085 - endQueue.length * 0.0008);
      }
      cores = cores.filter((c) => !c.gone);
      // Let the survivors keep falling while the pile pops.
      accumulator = Math.min(accumulator + dt, STEP * 6);
      while (accumulator >= STEP) { step(STEP); accumulator -= STEP; }
      if (endIndex >= endQueue.length && endTimer < -0.75) {
        phase = 'done';
        host.endRun({ score, headline: 'CRITICAL MASS', detail: `Biggest core ${label(tierValue(biggest))} · best chain x${Math.max(1, bestChain)} · ${drops} drops` });
      } else if (endIndex >= endQueue.length) endTimer -= 0; // waiting out the tail
      return;
    }

    // Aim.
    if (keyDir) aimTarget = clampAim(aimTarget + keyDir * 78 * dt);
    aimTarget = clampAim(aimTarget);
    aimX = lerp(aimX, aimTarget, 1 - Math.exp(-26 * dt));

    accumulator = Math.min(accumulator + dt, STEP * 6);
    while (accumulator >= STEP) { step(STEP); accumulator -= STEP; }

    // Unlock the next drop shortly after the dropped core first touches something.
    if (dropLock) {
      sinceDrop += dt;
      if ((dropped && dropped.landed) || !dropped || sinceDrop > 1.6) lockTimer -= dt;
      if (lockTimer <= 0 || sinceDrop > 2.2) { dropLock = false; dropped = null; sinceUnlock = 0; saveNow(); dirty = true; if (queued) drop(); }
    } else sinceUnlock += dt;

    if (chain > 0) { chainTimer -= dt; if (chainTimer <= 0) { chain = 0; showStatus(); } }

    // Save once the pile is quiet.
    let fastest = 0;
    for (const c of cores) fastest = Math.max(fastest, Math.abs(c.vx) + Math.abs(c.vy));
    quietFor = fastest < 9 && !dropLock && chain === 0 ? quietFor + dt : 0;
    if (dirty && !dropLock && (quietFor > 0.25 || sinceUnlock > 3)) saveNow();

    // Containment check: a settled core poking above the line.
    let breach = false;
    for (const c of cores) if (c.landed && c.landedFor > 0.7 && c.y - c.r < LINE_Y) { breach = true; break; }
    if (breach) {
      if (chain === 0) lossTimer += dt; // never lose in the middle of a cascade
      if (time - tickAt > 0.5) { tickAt = time; sfx.tone({ freq: 300 + lossTimer * 160, dur: 0.09, type: 'square', gain: 0.07 }); }
      if (lossTimer >= LOSS_SECONDS) beginEnding();
    } else lossTimer = Math.max(0, lossTimer - dt * 2.5);
  }

  // ---- Render -----------------------------------------------------------------
  function drawCore(ctx: CanvasRenderingContext2D, tier: number, X: number, Y: number, R: number, angle: number, t: number, sx = 1, sy = 1, alpha = 1) {
    drawGlow(ctx, X, Y, R * 2.35, tierColor(tier, 58), 0.42 * alpha);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(X, Y); ctx.scale(sx, sy);
    ctx.save();
    ctx.rotate(angle + (host.reducedMotion ? 0 : t * (0.22 + (tier % 3) * 0.07) * (tier % 2 ? 1 : -1)));
    ctx.drawImage(bodySprite(tier), -R, -R, R * 2, R * 2);
    ctx.restore();
    ctx.drawImage(lightSprite(tier), -R, -R, R * 2, R * 2);
    const text = label(tierValue(tier));
    const size = Math.max(9, R * (text.length <= 1 ? 1.02 : text.length === 2 ? 0.9 : text.length === 3 ? 0.72 : 0.58));
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.2);
    ctx.strokeStyle = hsl(tierHue(tier) + 20, 80, 10, 0.72);
    ctx.strokeText(text, 0, size * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 0, size * 0.04);
    ctx.restore();
  }

  function landingY(x: number, r: number): number {
    let y = H - r;
    for (const c of cores) {
      if (c === dropped && !c.landed) continue;
      const dx = Math.abs(c.x - x), reach = c.r + r;
      if (dx >= reach) continue;
      y = Math.min(y, c.y - Math.sqrt(reach * reach - dx * dx));
    }
    return Math.max(DROP_Y, y);
  }

  function render(ctx: CanvasRenderingContext2D, t: number) {
    layout();
    const w = host.w, h = host.h;
    const cw = W * s, ch = H * s;
    const warn = clamp(lossTimer / LOSS_SECONDS, 0, 1);

    // Room.
    const room = ctx.createRadialGradient(w / 2, oy + ch * 0.55, 20, w / 2, oy + ch * 0.55, Math.max(w, h) * 0.8);
    room.addColorStop(0, '#15102c'); room.addColorStop(0.5, '#0a0b1c'); room.addColorStop(1, '#04050c');
    ctx.fillStyle = room; ctx.fillRect(0, 0, w, h);
    // Faint floor grid receding behind the reactor.
    ctx.save();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = 'rgba(140,120,255,0.07)'; ctx.lineWidth = 1;
    const gap = 44;
    ctx.beginPath();
    for (let x = (w / 2) % gap; x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = (oy % gap); y < h; y += gap) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.restore();
    drawGlow(ctx, w / 2, oy + ch + 10, cw * 0.95, 'rgba(255,90,190,1)', 0.16);
    drawGlow(ctx, w / 2, oy + ch * 0.3, cw * 1.2, 'rgba(90,120,255,1)', 0.1);

    // Chamber interior.
    const wall = Math.max(4, s * 1.5);
    ctx.save();
    roundRect(ctx, ox, oy - 4, cw, ch + 4, s * 2.5); ctx.clip();
    const inside = ctx.createLinearGradient(0, oy, 0, oy + ch);
    inside.addColorStop(0, '#080a1a'); inside.addColorStop(0.6, '#0b0c22'); inside.addColorStop(1, '#170d2c');
    ctx.fillStyle = inside; ctx.fillRect(ox, oy - 4, cw, ch + 4);
    // Energy lattice.
    ctx.strokeStyle = 'rgba(150,170,255,0.055)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const cell = s * 10;
    for (let i = 1; i < 10; i++) { ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + ch); }
    for (let j = 1; j < 15; j++) { ctx.moveTo(ox, oy + j * cell); ctx.lineTo(ox + cw, oy + j * cell); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,190,255,0.16)';
    for (let i = 1; i < 10; i++) for (let j = 1; j < 15; j++) ctx.fillRect(ox + i * cell - 1, oy + j * cell - 1, 2, 2);
    // Scanning light.
    if (!host.reducedMotion) {
      const scanY = oy + ((t * 0.11) % 1.25 - 0.12) * ch;
      const scan = ctx.createLinearGradient(0, scanY - s * 16, 0, scanY + s * 2);
      scan.addColorStop(0, 'rgba(120,200,255,0)'); scan.addColorStop(0.84, 'rgba(120,200,255,0.07)'); scan.addColorStop(0.93, 'rgba(190,235,255,0.18)'); scan.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = scan; ctx.fillRect(ox, scanY - s * 16, cw, s * 18);
    }
    // Floor emitter.
    const floorGlow = ctx.createLinearGradient(0, oy + ch - s * 26, 0, oy + ch);
    floorGlow.addColorStop(0, 'rgba(255,90,200,0)'); floorGlow.addColorStop(1, 'rgba(255,90,200,0.2)');
    ctx.fillStyle = floorGlow; ctx.fillRect(ox, oy + ch - s * 26, cw, s * 26);
    if (warn > 0) { ctx.fillStyle = `rgba(255,40,60,${0.1 * warn * (0.6 + 0.4 * Math.sin(t * 16))})`; ctx.fillRect(ox, oy - 4, cw, ch + 4); }

    // Aim guide.
    const heldR = tierRadius(cur);
    if (phase === 'play') {
      const gx = px(aimX), landing = landingY(aimX, heldR);
      const top = py(DROP_Y) + heldR * s + 4, bottom = py(landing);
      if (bottom > top + 6) {
        ctx.save();
        ctx.globalAlpha = dropLock ? 0.14 : 0.42;
        ctx.strokeStyle = tierColor(cur, 72); ctx.lineWidth = 1.5; ctx.setLineDash([3, 7]);
        ctx.lineDashOffset = host.reducedMotion ? 0 : -t * 26;
        ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bottom - heldR * s); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = dropLock ? 0.1 : 0.3;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(gx, bottom, heldR * s, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    // Cores (small ones last so they are never hidden behind halos of big ones).
    const ordered = cores.length > 1 ? [...cores].sort((a, b) => b.tier - a.tier) : cores;
    for (const c of ordered) {
      let sx = 1, sy = 1;
      if (c.fused && c.born < 0.55 && !host.reducedMotion) {
        const k = easeOutElastic(clamp(c.born / 0.55, 0, 1));
        sx = lerp(1.34, 1, k); sy = lerp(0.72, 1, k);
      } else if (!c.landed && !host.reducedMotion) {
        const stretch = clamp(c.vy / 1400, 0, 0.09); sx = 1 - stretch * 0.6; sy = 1 + stretch;
      }
      const X = px(c.x), Y = py(c.y), R = c.r * s;
      drawCore(ctx, c.tier, X, Y, R, c.ang, t, sx, sy);
      // Show what the held core can fuse with.
      if (phase === 'play' && c.landed && c.tier === cur) {
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 5); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, s * 0.5);
        ctx.beginPath(); ctx.arc(X, Y, R + s * 1.1, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (c.fused && c.born < 0.3) drawGlow(ctx, X, Y, R * 3.2, 'rgba(255,255,255,1)', (1 - c.born / 0.3) * 0.85);
      if (warn > 0 && c.landed && c.landedFor > 0.7 && c.y - c.r < LINE_Y) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,70,80,${0.5 + 0.5 * Math.sin(t * 18)})`; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(X, Y, R + 5, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - warn)); ctx.stroke();
        ctx.restore();
      }
    }

    // Rings, sparks.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const ring of rings) {
      const k = 1 - ring.life / ring.max;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = ring.color; ctx.lineWidth = ring.width * (1 - k * 0.7);
      ctx.beginPath(); ctx.arc(ring.x, ring.y, lerp(ring.from, ring.to, easeOutCubic(k)), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    particles.render(ctx);

    // Containment line.
    const ly = py(LINE_Y);
    const lineColor = warn > 0 ? `rgba(255,${Math.round(150 - warn * 110)},${Math.round(90 - warn * 30)},1)` : 'rgba(255,186,96,1)';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hum = host.reducedMotion ? 0.7 : 0.62 + 0.14 * Math.sin(t * 7) + warn * 0.3;
    const beam = ctx.createLinearGradient(0, ly - 9, 0, ly + 9);
    beam.addColorStop(0, 'rgba(0,0,0,0)'); beam.addColorStop(0.5, lineColor.replace(',1)', `,${0.2 * hum})`)); beam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beam; ctx.fillRect(ox, ly - 9, cw, 18);
    ctx.globalAlpha = hum; ctx.strokeStyle = lineColor; ctx.lineWidth = 1.6;
    ctx.setLineDash([9, 7]); ctx.lineDashOffset = host.reducedMotion ? 0 : -t * (18 + warn * 60);
    ctx.beginPath(); ctx.moveTo(ox, ly); ctx.lineTo(ox + cw, ly); ctx.stroke();
    ctx.restore();
    if (flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${flash * 0.22})`; ctx.fillRect(ox, oy - 4, cw, ch + 4); ctx.restore(); }
    ctx.restore(); // chamber clip

    // Emitter holding the next core to drop.
    if (phase === 'play') {
      const gx = px(aimX), gy = py(DROP_Y);
      const arrive = easeOutCubic(swap);
      const bob = host.reducedMotion ? 0 : Math.sin(t * 3.1) * 1.4;
      const R = heldR * s * lerp(0.4, 1, arrive);
      // Rail and carriage.
      ctx.save();
      ctx.strokeStyle = 'rgba(190,205,255,0.16)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox + 6, oy + 3); ctx.lineTo(ox + cw - 6, oy + 3); ctx.stroke();
      const carriage = ctx.createLinearGradient(0, oy - 4, 0, oy + 10);
      carriage.addColorStop(0, '#cfd8ff'); carriage.addColorStop(1, '#5b6494');
      ctx.fillStyle = carriage; roundRect(ctx, gx - 15, oy - 3, 30, 11, 5); ctx.fill();
      ctx.fillStyle = tierColor(cur, 68); roundRect(ctx, gx - 6, oy + 1, 12, 3, 1.5); ctx.fill();
      ctx.strokeStyle = 'rgba(200,215,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(gx, oy + 8); ctx.lineTo(gx, gy - R + bob); ctx.stroke();
      ctx.restore();
      drawGlow(ctx, gx, oy + 4, 22, tierColor(cur, 66), 0.5);
      drawCore(ctx, cur, gx, gy + bob, R, 0, t, 1, 1, dropLock ? 0.5 : 1);
    }

    // Glass tube.
    ctx.save();
    ctx.lineJoin = 'round';
    const tube = ctx.createLinearGradient(ox - wall, 0, ox + cw + wall, 0);
    tube.addColorStop(0, 'rgba(210,225,255,0.5)'); tube.addColorStop(0.035, 'rgba(120,140,220,0.16)');
    tube.addColorStop(0.965, 'rgba(120,140,220,0.14)'); tube.addColorStop(1, 'rgba(210,225,255,0.36)');
    ctx.strokeStyle = tube; ctx.lineWidth = wall;
    const radius = s * 2.5 + wall / 2;
    ctx.beginPath();
    ctx.moveTo(ox - wall / 2, oy - 8);
    ctx.lineTo(ox - wall / 2, oy + ch - radius + wall / 2);
    ctx.arcTo(ox - wall / 2, oy + ch + wall / 2, ox + radius, oy + ch + wall / 2, radius);
    ctx.lineTo(ox + cw - radius, oy + ch + wall / 2);
    ctx.arcTo(ox + cw + wall / 2, oy + ch + wall / 2, ox + cw + wall / 2, oy + ch - radius, radius);
    ctx.lineTo(ox + cw + wall / 2, oy - 8);
    ctx.stroke();
    // Reflections on the glass.
    const sheen = ctx.createLinearGradient(0, oy, 0, oy + ch);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.18, 'rgba(255,255,255,0.2)'); sheen.addColorStop(0.62, 'rgba(255,255,255,0.05)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(ox + s * 2.2, oy + 6, Math.max(2, s * 0.8), ch - 16);
    ctx.fillRect(ox + s * 4.2, oy + ch * 0.08, Math.max(1, s * 0.3), ch * 0.5);
    ctx.fillRect(ox + cw - s * 3, oy + ch * 0.2, Math.max(1.5, s * 0.5), ch * 0.6);
    // Collars at the mouth.
    for (const side of [-1, 1]) {
      const bx = side < 0 ? ox - wall - 3 : ox + cw - 3;
      const collar = ctx.createLinearGradient(bx, 0, bx + wall + 6, 0);
      collar.addColorStop(0, '#8d97c8'); collar.addColorStop(0.5, '#e6ebff'); collar.addColorStop(1, '#59618f');
      ctx.fillStyle = collar; roundRect(ctx, bx, oy - 12, wall + 6, 12, 3); ctx.fill();
    }
    // Pedestal.
    const baseY = oy + ch + wall;
    const pedestal = ctx.createLinearGradient(0, baseY, 0, baseY + 12);
    pedestal.addColorStop(0, '#39406b'); pedestal.addColorStop(1, '#12142a');
    ctx.fillStyle = pedestal;
    ctx.beginPath(); ctx.moveTo(ox - wall - 4, baseY); ctx.lineTo(ox + cw + wall + 4, baseY); ctx.lineTo(ox + cw + wall + 14, baseY + 12); ctx.lineTo(ox - wall - 14, baseY + 12); ctx.closePath(); ctx.fill();
    ctx.restore();
    const lights = 7;
    for (let i = 0; i < lights; i++) {
      const lx = ox + cw * ((i + 0.5) / lights), on = host.reducedMotion ? 0.6 : 0.45 + 0.55 * Math.max(0, Math.sin(t * 2.4 - i * 0.7));
      drawGlow(ctx, lx, baseY + 5, 9, warn > 0 ? 'rgba(255,80,90,1)' : 'rgba(255,120,210,1)', 0.25 + on * 0.6);
    }

    // HUD: next core and tiers.
    ctx.textBaseline = 'middle';
    if (wide) {
      const leftX = ox - wall - 28 - 104, panelY = oy + 6;
      panel(ctx, leftX, panelY, 104, 132);
      ctx.fillStyle = 'rgba(200,210,255,0.6)'; ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('NEXT', leftX + 52, panelY + 18);
      drawCore(ctx, next, leftX + 52, panelY + 72, Math.min(34, tierRadius(next) * s), 0, t);
      panel(ctx, leftX, panelY + 146, 104, 66);
      ctx.fillStyle = 'rgba(200,210,255,0.6)'; ctx.font = `700 10px ${FONT}`;
      ctx.fillText('BIGGEST', leftX + 52, panelY + 164);
      ctx.fillStyle = tierColor(biggest, 74); ctx.font = `800 24px ${FONT}`;
      ctx.fillText(label(tierValue(biggest)), leftX + 52, panelY + 190);
      // Tier ladder on the right.
      const rightX = ox + cw + wall + 28, rows = 11, rowH = Math.min(34, (ch - 44) / rows);
      panel(ctx, rightX, panelY, 104, rows * rowH + 34);
      ctx.fillStyle = 'rgba(200,210,255,0.6)'; ctx.font = `700 10px ${FONT}`;
      ctx.fillText('CORES', rightX + 52, panelY + 18);
      for (let tier = 0; tier < rows; tier++) {
        const cy = panelY + 34 + rowH * (tier + 0.5), reached = tier <= biggest;
        const orb = Math.min(rowH * 0.4, 12);
        ctx.save();
        ctx.globalAlpha = reached ? 1 : 0.22;
        if (reached) drawGlow(ctx, rightX + 26, cy, orb * 2, tierColor(tier, 58), 0.4);
        ctx.drawImage(bodySprite(tier), rightX + 26 - orb, cy - orb, orb * 2, orb * 2);
        ctx.drawImage(lightSprite(tier), rightX + 26 - orb, cy - orb, orb * 2, orb * 2);
        ctx.fillStyle = reached ? '#f2f4ff' : 'rgba(200,210,255,0.8)'; ctx.font = `${reached ? 800 : 600} ${Math.min(14, rowH * 0.46)}px ${FONT}`; ctx.textAlign = 'left';
        ctx.fillText(label(tierValue(tier)), rightX + 48, cy + 1);
        ctx.restore();
        if (tier === biggest) { ctx.strokeStyle = tierColor(tier, 70, 0.7); ctx.lineWidth = 1.5; roundRect(ctx, rightX + 8, cy - rowH / 2 + 2, 88, rowH - 4, 9); ctx.stroke(); }
      }
    } else {
      const y = Math.max(18, oy - 26);
      ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(200,210,255,0.62)';
      const orb = Math.min(13, tierRadius(next) * s * 0.55 + 5);
      ctx.fillText('NEXT', ox + cw - orb * 2 - 10, y);
      drawCore(ctx, next, ox + cw - orb - 2, y, orb, 0, t);
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(200,210,255,0.62)'; ctx.font = `700 10px ${FONT}`;
      ctx.fillText('BIGGEST', ox + 2, y);
      ctx.fillStyle = tierColor(biggest, 74); ctx.font = `800 15px ${FONT}`;
      ctx.fillText(label(tierValue(biggest)), ox + 56, y);
    }

    // Chain banner.
    if (chain > 1 && phase === 'play') {
      const pulse = clamp(chainTimer / 0.95, 0, 1);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const size = clamp(s * 6 + chain * 1.6, 18, 44) * (1 + (host.reducedMotion ? 0 : 0.12 * easeOutCubic(pulse)));
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.globalAlpha = 0.25 + pulse * 0.75;
      ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8,6,24,0.7)';
      const bx = px(W / 2), by = py(LINE_Y + 9);
      ctx.strokeText(`CHAIN x${chain}`, bx, by);
      ctx.fillStyle = hsl(320 - chain * 22, 100, 72); ctx.fillText(`CHAIN x${chain}`, bx, by);
      ctx.restore();
    }
    if (warn > 0.02 && phase === 'play') {
      // Sits in the strip above the chamber so the pile never hides it.
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const size = clamp(s * 3.2, 11, 16), ty = Math.max(16, oy - 26);
      const text = `CONTAINMENT FAILING  ${Math.max(0, LOSS_SECONDS - lossTimer).toFixed(1)}`;
      ctx.font = `800 ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width + 22;
      ctx.fillStyle = `rgba(70,6,18,${0.86})`; roundRect(ctx, w / 2 - tw / 2, ty - size * 0.95, tw, size * 1.9, size); ctx.fill();
      ctx.fillStyle = `rgba(255,150,150,${0.7 + 0.3 * Math.sin(t * 16)})`;
      ctx.fillText(text, w / 2, ty + 1);
      ctx.restore();
    }

    floaters.render(ctx, FONT);
  }

  function panel(ctx: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number) {
    ctx.save();
    const fill = ctx.createLinearGradient(0, y, 0, y + ph);
    fill.addColorStop(0, 'rgba(34,36,74,0.72)'); fill.addColorStop(1, 'rgba(14,15,36,0.72)');
    ctx.fillStyle = fill; roundRect(ctx, x, y, pw, ph, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(170,185,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // ---- Input ------------------------------------------------------------------
  function pointer(event: PointerEventLite) {
    if (phase !== 'play') return;
    const x = (event.x - ox) / s;
    if (event.type === 'down') { pointerDown = true; aimTarget = clampAim(x); }
    else if (event.type === 'move') aimTarget = clampAim(x);
    else if (event.type === 'up') {
      if (pointerDown) { pointerDown = false; aimTarget = clampAim(x); aimX = dropLock ? aimX : aimTarget; drop(); }
    } else pointerDown = false;
  }

  function key(code: string, down: boolean) {
    if (code === 'ArrowLeft' || code === 'KeyA') keyDir = down ? -1 : keyDir === -1 ? 0 : keyDir;
    else if (code === 'ArrowRight' || code === 'KeyD') keyDir = down ? 1 : keyDir === 1 ? 0 : keyDir;
    else if (down && (code === 'Space' || code === 'ArrowDown' || code === 'Enter')) { aimTarget = aimX; drop(); }
  }

  return { update, render, pointer, key, resize: layout };
}

const criticalMass: GameModule = { realtime: false, bloom: 0.55, hintAt: 'top', create };
export default criticalMass;
