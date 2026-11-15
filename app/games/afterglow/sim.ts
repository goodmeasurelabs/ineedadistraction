// Afterglow's simulation, kept free of canvas and DOM so balance can be tested
// headlessly. One wave = a field of drifting sparks and a handful of pulses.

export type UpgradeId =
  | 'reach' | 'linger' | 'swarm' | 'gilded' | 'extra' | 'echo'
  | 'splinters' | 'tailwind' | 'undertow' | 'nova' | 'compound' | 'mercy';

export type UpgradeDef = { id: UpgradeId; name: string; text: string; glyph: string; max: number };

export const UPGRADES: UpgradeDef[] = [
  { id: 'reach', name: 'Long Reach', text: 'Every bloom grows 10% wider.', glyph: '◎', max: 5 },
  { id: 'linger', name: 'Slow Burn', text: 'Blooms hang in the air 20% longer.', glyph: '◷', max: 4 },
  { id: 'swarm', name: 'Swarm', text: '10 more sparks in every wave.', glyph: '⁂', max: 5 },
  { id: 'gilded', name: 'Gilded', text: 'More gold sparks. Gold scores five times and blooms 1.5x wider.', glyph: '✦', max: 3 },
  { id: 'extra', name: 'Second Wind', text: 'One more pulse per wave.', glyph: '＋', max: 2 },
  { id: 'echo', name: 'Echo', text: 'Your pulse blooms a second time.', glyph: '◉', max: 1 },
  { id: 'splinters', name: 'Splinters', text: 'Some sparks burst into three flying embers.', glyph: '✳', max: 3 },
  { id: 'tailwind', name: 'Tailwind', text: 'Sparks drift 30% faster, so more wander into blooms.', glyph: '➤', max: 3 },
  { id: 'undertow', name: 'Undertow', text: 'Blooms pull nearby sparks toward them.', glyph: '◌', max: 2 },
  { id: 'nova', name: 'Supernova', text: 'Every 10th spark blooms double size.', glyph: '✹', max: 2 },
  { id: 'compound', name: 'Compound', text: 'All points worth 60% more.', glyph: '×', max: 5 },
  { id: 'mercy', name: 'Afterimage', text: 'Each wave needs 8% fewer sparks.', glyph: '☾', max: 2 },
];

export type Levels = Partial<Record<UpgradeId, number>>;
const lv = (levels: Levels, id: UpgradeId) => levels[id] ?? 0;

export type WaveParams = {
  count: number; quota: number; radius: number; playerRadius: number; hold: number; speed: number;
  goldFrac: number; splitFrac: number; shieldFrac: number; cluster: boolean; pulses: number; echo: boolean; novaEvery: number; pull: number; scoreMul: number;
};

/** Base feel of a bloom. Tuned by simulation (see the balance notes in game.ts). */
export const TUNE = { radius: 66, hold: 1.6, speed: 58, quotaBase: 0.3, quotaStep: 0.055, decay: 0.96, holdDecay: 0.93, reach: 0.1, linger: 0.2, quotaCap: 0.92, shieldStart: 4, shieldStep: 0.06, shieldCap: 0.8, holdFloor: 0.3 };

/** unit = sqrt(fieldArea) / 600, so the same wave plays the same on any window size. */
export function waveParams(wave: number, levels: Levels, unit: number): WaveParams {
  const count = Math.min(170, 36 + 2 * (wave - 1) + 10 * lv(levels, 'swarm'));
  const quotaFrac = Math.min(TUNE.quotaCap, Math.max(0.12, TUNE.quotaBase + TUNE.quotaStep * (wave - 1) - 0.08 * lv(levels, 'mercy')));
  // Blooms shrink only slightly per wave (a deep run should still look big).
  // Most of the difficulty comes from a rising quota, blooms that fade sooner,
  // and shielded sparks that need a second touch.
  const radius = TUNE.radius * unit * Math.pow(TUNE.decay, wave - 1) * (1 + TUNE.reach * lv(levels, 'reach'));
  return {
    count,
    quota: Math.max(3, Math.ceil(count * quotaFrac)),
    radius,
    playerRadius: radius * 1.3,
    hold: Math.max(TUNE.holdFloor, TUNE.hold * Math.pow(TUNE.holdDecay, wave - 1)) * (1 + TUNE.linger * lv(levels, 'linger')),
    speed: TUNE.speed * unit * (1 + 0.3 * lv(levels, 'tailwind')),
    goldFrac: 0.05 + 0.1 * lv(levels, 'gilded'),
    splitFrac: 0.14 * lv(levels, 'splinters'),
    shieldFrac: wave < TUNE.shieldStart ? 0 : Math.min(TUNE.shieldCap, TUNE.shieldStep * (wave - TUNE.shieldStart + 1)),
    cluster: wave === 1,
    pulses: 1 + lv(levels, 'extra'),
    echo: lv(levels, 'echo') > 0,
    novaEvery: lv(levels, 'nova') === 0 ? 0 : lv(levels, 'nova') === 1 ? 10 : 6,
    pull: 70 * unit * lv(levels, 'undertow'),
    scoreMul: 1 + 0.6 * lv(levels, 'compound'),
  };
}

/** kind: 0 plain, 1 gold, 2 splinter. shield: a shell that soaks up the first bloom that touches it. */
export type Spark = { x: number; y: number; vx: number; vy: number; kind: 0 | 1 | 2; seed: number; alive: boolean; shield: boolean; immune: number };
export type Bloom = { x: number; y: number; maxR: number; r: number; age: number; hold: number; depth: number; player: boolean; echo: boolean; fade: number };
export type Ember = { x: number; y: number; vx: number; vy: number; life: number; depth: number };

export const GROW = 0.32;
export const SHRINK = 0.34;

export type IgniteEvent = { spark: Spark; from: Bloom; index: number; points: number; nova: boolean };

export class Field {
  sparks: Spark[] = [];
  blooms: Bloom[] = [];
  embers: Ember[] = [];
  ignited = 0;
  score = 0;
  pulsesLeft: number;
  private pendingEcho: { x: number; y: number; at: number }[] = [];
  private clock = 0;
  onIgnite: (event: IgniteEvent) => void = () => {};
  onBloom: (bloom: Bloom) => void = () => {};
  onShield: (spark: Spark) => void = () => {};

  constructor(public w: number, public h: number, public p: WaveParams, private rng: () => number) {
    this.pulsesLeft = p.pulses;
    const margin = 14;
    for (let i = 0; i < p.count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = p.speed * (0.55 + rng() * 0.9);
      const roll = rng();
      this.sparks.push({
        x: margin + rng() * (w - margin * 2), y: margin + rng() * (h - margin * 2),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        kind: roll < p.goldFrac ? 1 : roll < p.goldFrac + p.splitFrac ? 2 : 0,
        seed: rng(), alive: true, shield: rng() < p.shieldFrac, immune: 0,
      });
    }
    if (p.cluster) {
      // The very first wave always has a knot of slow sparks near the middle, so
      // a first click anywhere central sets off a real chain.
      const cx = w * (0.4 + rng() * 0.2), cy = h * (0.4 + rng() * 0.2);
      for (let i = 0; i < Math.min(9, this.sparks.length); i++) {
        const spark = this.sparks[i], a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * p.radius * 1.5;
        spark.x = Math.min(w - margin, Math.max(margin, cx + Math.cos(a) * d));
        spark.y = Math.min(h - margin, Math.max(margin, cy + Math.sin(a) * d));
        spark.vx *= 0.35; spark.vy *= 0.35; spark.shield = false;
      }
    }
  }

  get total() { return this.sparks.length; }
  get remaining() { return this.sparks.length - this.ignited; }
  /** True while anything is still glowing or about to. */
  get active() { return this.blooms.length > 0 || this.embers.length > 0 || this.pendingEcho.length > 0; }

  pulse(x: number, y: number): boolean {
    if (this.pulsesLeft <= 0) return false;
    this.pulsesLeft--;
    this.addBloom(x, y, this.p.playerRadius, 0, true);
    if (this.p.echo) this.pendingEcho.push({ x, y, at: this.clock + GROW + this.p.hold + SHRINK * 0.5 });
    return true;
  }

  private addBloom(x: number, y: number, maxR: number, depth: number, player: boolean, echo = false) {
    const bloom: Bloom = { x, y, maxR, r: 0, age: 0, hold: this.p.hold, depth, player, echo, fade: 1 };
    this.blooms.push(bloom);
    this.onBloom(bloom);
    return bloom;
  }

  step(dt: number) {
    this.clock += dt;
    const { w, h, p } = this;

    for (let i = this.pendingEcho.length - 1; i >= 0; i--) {
      const echo = this.pendingEcho[i];
      if (this.clock >= echo.at) { this.pendingEcho.splice(i, 1); this.addBloom(echo.x, echo.y, p.playerRadius * 1.15, 0, true, true); }
    }

    // Blooms grow, hold, then shrink away.
    let write = 0;
    for (const bloom of this.blooms) {
      bloom.age += dt;
      const end = GROW + bloom.hold;
      if (bloom.age < GROW) { const t = bloom.age / GROW; bloom.r = bloom.maxR * (1 - Math.pow(1 - t, 3)); bloom.fade = 1; }
      else if (bloom.age < end) { bloom.r = bloom.maxR; bloom.fade = 1; }
      else { const t = Math.min(1, (bloom.age - end) / SHRINK); bloom.r = bloom.maxR * (1 - t * t); bloom.fade = 1 - t; }
      if (bloom.age < end + SHRINK) this.blooms[write++] = bloom;
    }
    this.blooms.length = write;

    // Embers fly, then bloom where they stop.
    write = 0;
    for (const ember of this.embers) {
      ember.life -= dt;
      ember.x += ember.vx * dt; ember.y += ember.vy * dt;
      const out = ember.x < 4 || ember.x > w - 4 || ember.y < 4 || ember.y > h - 4;
      if (ember.life <= 0 || out) {
        this.addBloom(Math.min(w - 4, Math.max(4, ember.x)), Math.min(h - 4, Math.max(4, ember.y)), p.radius * 0.7, ember.depth, false);
      } else this.embers[write++] = ember;
    }
    this.embers.length = write;

    for (const spark of this.sparks) {
      if (!spark.alive) continue;
      if (spark.immune > 0) spark.immune -= dt;
      if (p.pull > 0) {
        for (const bloom of this.blooms) {
          const dx = bloom.x - spark.x, dy = bloom.y - spark.y;
          const d2 = dx * dx + dy * dy, reach = bloom.maxR * 3.2;
          if (d2 < reach * reach && d2 > 1) { const d = Math.sqrt(d2); spark.vx += (dx / d) * p.pull * dt; spark.vy += (dy / d) * p.pull * dt; }
        }
      }
      spark.x += spark.vx * dt; spark.y += spark.vy * dt;
      if (spark.x < 6) { spark.x = 6; spark.vx = Math.abs(spark.vx); } else if (spark.x > w - 6) { spark.x = w - 6; spark.vx = -Math.abs(spark.vx); }
      if (spark.y < 6) { spark.y = 6; spark.vy = Math.abs(spark.vy); } else if (spark.y > h - 6) { spark.y = h - 6; spark.vy = -Math.abs(spark.vy); }

      // Index-based loop: igniting adds blooms, which must not be tested this step.
      const bloomCount = this.blooms.length;
      for (let b = 0; b < bloomCount; b++) {
        const bloom = this.blooms[b];
        const dx = bloom.x - spark.x, dy = bloom.y - spark.y, reach = bloom.r + 4;
        if (dx * dx + dy * dy <= reach * reach) {
          if (spark.immune > 0) break;
          if (spark.shield) { spark.shield = false; spark.immune = 0.45; this.onShield(spark); break; }
          this.ignite(spark, bloom); break;
        }
      }
    }
  }

  private ignite(spark: Spark, from: Bloom) {
    spark.alive = false;
    this.ignited++;
    const index = this.ignited;
    const nova = this.p.novaEvery > 0 && index % this.p.novaEvery === 0;
    const points = Math.round(10 * index * (spark.kind === 1 ? 5 : 1) * this.p.scoreMul);
    this.score += points;
    this.addBloom(spark.x, spark.y, this.p.radius * (nova ? 2 : spark.kind === 1 ? 1.5 : 1), from.depth + 1, false);
    if (spark.kind === 2) {
      const base = spark.seed * Math.PI * 2;
      for (let i = 0; i < 3; i++) {
        const angle = base + (i * Math.PI * 2) / 3;
        const speed = this.p.radius * 6.2;
        this.embers.push({ x: spark.x, y: spark.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.42, depth: from.depth + 1 });
      }
    }
    this.onIgnite({ spark, from, index, points, nova });
  }
}
