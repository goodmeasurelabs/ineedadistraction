import type { Game, GameHost, GameModule, PointerEventLite } from '../engine/types';
import { Floaters, FONT, Particles, TAU, clamp, drawGlow, easeOutBack, easeOutCubic, mulberry32, roundRect } from '../engine/fx';
import { Field, UPGRADES, waveParams, type Bloom, type Levels, type UpgradeDef, type UpgradeId, type WaveParams } from './sim';

// Afterglow: drop one pulse into a drifting field of sparks and ride the chain
// reaction. Clear each wave's quota to pick an upgrade; miss it and lose a life.
//
// Balance was tuned by simulation (sim.ts is DOM-free for that reason): a random
// clicker typically reaches wave 5, a careful player about 16, with long tails.

const HUD = 60;
const LIVES = 3;
const PALETTE = Array.from({ length: 24 }, (_, i) => `hsl(${(186 + i * 15) % 360}, 96%, 62%)`);
const SPARK_COLORS = ['#a8ecff', '#ffd45e', '#ff7ad1'];
const MILESTONES: [number, string][] = [[10, 'GLOWING'], [20, 'RADIANT'], [35, 'BLAZING'], [50, 'INCANDESCENT'], [75, 'STELLAR'], [100, 'SUPERNOVA'], [140, 'BEYOND']];

type Phase = 'aim' | 'chain' | 'tally' | 'pick' | 'over';
type Saved = { wave: number; levels: Levels; total: number; lives: number; bestChain: number; phase: 'aim' | 'pick'; choices: UpgradeId[]; forfeit?: boolean };
type Link = { x1: number; y1: number; x2: number; y2: number; life: number; color: string };
type Ring = { x: number; y: number; r: number; max: number; life: number; color: string };

function isSaved(value: unknown): value is Saved {
  const s = value as Saved | null;
  return !!s && typeof s.wave === 'number' && typeof s.total === 'number' && typeof s.lives === 'number' && !!s.levels && Array.isArray(s.choices);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

class Afterglow implements Game {
  private phase: Phase = 'aim';
  private wave = 1;
  private levels: Levels = {};
  private total = 0;
  private lives = LIVES;
  private bestChain = 0;
  private field!: Field;
  private params!: WaveParams;
  private choices: UpgradeDef[] = [];
  private fw = 0; private fh = 0;

  private particles: Particles;
  private floaters = new Floaters();
  private links: Link[] = [];
  private rings: Ring[] = [];
  private aim: { x: number; y: number } | null = null;
  private hover = -1;
  private punch = 0;
  private maxDepth = 0;
  private quotaHit = false;
  private quotaFlash = 0;
  private tallyT = 0;
  private tallyOk = false;
  private tallyLine = '';
  private tallySub = '';
  private pickT = 0;
  private picked = -1;
  private waveIntro = 0;
  private displayTotal = 0;
  private deadOnLoad = false;
  private pulseHits = 0;
  private finishRect = { x: 0, y: 0, w: 0, h: 0 };
  private shieldPops: { x: number; y: number; life: number }[] = [];
  private bg: HTMLCanvasElement | null = null;
  private stars: { x: number; y: number; s: number; p: number }[] = [];

  constructor(private host: GameHost, saved: unknown) {
    this.particles = new Particles(host.reducedMotion ? 300 : 1600);
    this.layout();
    if (isSaved(saved)) {
      this.wave = saved.wave; this.levels = { ...saved.levels }; this.total = saved.total; this.lives = saved.lives; this.bestChain = saved.bestChain;
      this.displayTotal = this.total;
      // The page closed with a pulse already in the air: that wave counts as a miss,
      // otherwise reloading would be a free retry.
      if (saved.forfeit) { this.lives--; if (this.lives <= 0) this.deadOnLoad = true; }
      if (saved.phase === 'pick') {
        this.choices = saved.choices.map((id) => UPGRADES.find((u) => u.id === id)).filter((u): u is UpgradeDef => !!u);
        this.buildField(false);
        if (this.choices.length) { this.phase = 'pick'; this.pickT = 0; return; }
      }
    }
    this.beginWave();
  }

  // ---- Flow -----------------------------------------------------------------

  private layout() {
    this.fw = this.host.w; this.fh = Math.max(120, this.host.h - HUD);
  }
  private get unit() { return Math.sqrt(this.fw * this.fh) / 600; }

  private snapshot(phase: 'aim' | 'pick'): Saved {
    return { wave: this.wave, levels: this.levels, total: this.total, lives: this.lives, bestChain: this.bestChain, phase, choices: this.choices.map((c) => c.id) };
  }

  private buildField(fresh: boolean) {
    this.params = waveParams(this.wave, this.levels, this.unit);
    this.field = new Field(this.fw, this.fh, this.params, this.host.rng);
    this.field.onIgnite = (event) => this.onIgnite(event.spark.x, event.spark.y, event.from, event.index, event.points, event.spark.kind, event.nova);
    this.field.onShield = (spark) => {
      this.shieldPops.push({ x: spark.x, y: spark.y, life: 1 });
      this.particles.emit(spark.x, spark.y + HUD, { count: this.host.reducedMotion ? 2 : 7, color: ['#cfd8ff', '#8fa3c2'], speed: 150 * this.unit, life: 0.4, size: 2.5, kind: 'shard' });
      this.host.sfx.tone({ freq: 1400, slideTo: 700, dur: 0.07, type: 'triangle', gain: 0.05 });
    };
    this.links.length = 0; this.rings.length = 0; this.shieldPops.length = 0;
    this.maxDepth = 0; this.quotaHit = false; this.quotaFlash = 0;
    if (fresh) this.waveIntro = 1;
  }

  private beginWave() {
    // Save first: the host records the RNG position, so a reload rebuilds this exact field.
    this.choices = [];
    this.host.save(this.snapshot('aim'));
    this.buildField(true);
    this.phase = 'aim';
    this.host.setScore(this.total);
    this.host.setStatus(`Wave ${this.wave}`);
  }

  private fire(x: number, y: number) {
    if (this.phase !== 'aim') return;
    const fx = clamp(x, 6, this.fw - 6), fy = clamp(y - HUD, 6, this.fh - 6);
    if (!this.field.pulse(fx, fy)) return;
    this.phase = 'chain';
    this.pulseHits = this.field.ignited;
    this.host.save({ ...this.snapshot('aim'), forfeit: true });
    const { sfx } = this.host;
    sfx.thud(0.7); sfx.whoosh();
    this.host.shake(3);
    this.rings.push({ x: fx, y: fy, r: 0, max: this.params.playerRadius * 2.4, life: 1, color: '#ffffff' });
    this.particles.emit(fx, fy + HUD, { count: this.host.reducedMotion ? 8 : 26, color: ['#ffffff', '#a8ecff'], speed: 320 * this.unit, life: 0.7, size: 3, kind: 'spark' });
  }

  private onIgnite(x: number, y: number, from: Bloom, index: number, points: number, kind: number, nova: boolean) {
    const { host } = this;
    const depth = from.depth + 1;
    this.maxDepth = Math.max(this.maxDepth, depth);
    const color = PALETTE[depth % PALETTE.length];
    this.links.push({ x1: from.x, y1: from.y, x2: x, y2: y, life: 1, color });
    this.particles.emit(x, y + HUD, { count: host.reducedMotion ? 3 : kind === 1 ? 16 : 8, color: kind === 1 ? ['#ffd45e', '#fff3c4'] : [color, '#ffffff'], speed: (kind === 1 ? 260 : 190) * this.unit, life: 0.55, size: 3, kind: kind === 1 ? 'spark' : 'glow' });
    if (nova) { this.rings.push({ x, y, r: 0, max: this.params.radius * 3.4, life: 1, color: '#ffffff' }); host.shake(7); host.sfx.boom(0.5); }
    // Climb for the first 15 ignitions, then keep cycling the top five notes with a
    // rising bass under them, so a 100-chain stays musical instead of going ultrasonic.
    const s0 = index - 1;
    host.sfx.note(s0 < 15 ? s0 : 10 + (s0 % 5), { gain: 0.16 });
    if (s0 >= 15 && s0 % 5 === 0) host.sfx.tone({ freq: 55 * Math.pow(2, (Math.floor(s0 / 5) % 8) / 12 + 1), dur: 0.5, type: 'sine', gain: 0.22 });
    if (kind === 1) { host.sfx.sparkle(); this.floaters.add(x, y + HUD - 10, `+${points.toLocaleString()}`, { color: '#ffd45e', size: 18 }); }
    else if (index % 6 === 0) this.floaters.add(x, y + HUD - 10, `+${points.toLocaleString()}`, { color, size: 14, life: 0.7 });
    this.punch = 1;
    host.shake(Math.min(5, 0.8 + index * 0.04));
    host.setScore(this.total + this.field.score);

    for (const [count, label] of MILESTONES) {
      if (index === count) {
        this.floaters.add(this.fw / 2, HUD + this.fh * 0.3, label, { color: '#ffffff', size: Math.min(46, this.fw * 0.09), life: 1.3, rise: 30 });
        const m = MILESTONES.findIndex(([c]) => c === count);
        host.sfx.chord([m, m + 2, m + 4, m + 7], { base: 220, gain: 0.1 });
        host.shake(8); host.hitStop(60);
      }
    }
    if (!this.quotaHit && index >= this.params.quota) {
      this.quotaHit = true; this.quotaFlash = 1;
      host.sfx.win();
      this.floaters.add(this.fw / 2, HUD + 34, 'WAVE CLEARED', { color: '#ffe58a', size: 20, life: 1.4, rise: -14 });
    }
  }

  private finishWave() {
    const field = this.field;
    this.bestChain = Math.max(this.bestChain, field.ignited);
    const perfect = field.ignited === field.total;
    const earned = field.score * (perfect ? 2 : 1);
    this.total += earned;
    this.tallyOk = field.ignited >= this.params.quota;
    this.tallyT = 0;
    this.phase = 'tally';
    this.choices = [];
    if (this.tallyOk) {
      this.tallyLine = perfect ? 'PERFECT ×2' : 'WAVE CLEAR';
      this.tallySub = `+${earned.toLocaleString()}`;
      if (perfect) { this.host.sfx.win(); this.host.shake(10); }
      this.wave++;
      const pool = UPGRADES.filter((u) => (this.levels[u.id] ?? 0) < u.max);
      while (this.choices.length < 3 && pool.length) this.choices.push(pool.splice(Math.floor(this.host.rng() * pool.length), 1)[0]);
    } else {
      this.lives--;
      const short = this.params.quota - field.ignited;
      this.tallyLine = `${short} SHORT`;
      this.tallySub = this.lives > 0 ? `${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left · same wave, new field` : 'The glow fades';
      this.host.sfx.lose(); this.host.shake(6);
    }
    this.host.setScore(this.total);
    // The outcome is final the moment the chain ends, so it is saved now, not after the banner.
    if (this.tallyOk || this.lives > 0) this.host.save(this.snapshot(this.choices.length ? 'pick' : 'aim'));
  }

  private gameOver() {
    this.phase = 'over';
    const build = UPGRADES.filter((u) => (this.levels[u.id] ?? 0) > 0).sort((a, b) => (this.levels[b.id] ?? 0) - (this.levels[a.id] ?? 0)).slice(0, 3)
      .map((u) => `${u.name}${(this.levels[u.id] ?? 0) > 1 ? ` ×${this.levels[u.id]}` : ''}`).join(', ');
    this.host.endRun({ score: this.total, headline: 'THE GLOW FADED', detail: `Wave ${this.wave} · longest chain ${this.bestChain}${build ? ` · ${build}` : ''}` });
  }

  private afterTally() {
    if (!this.tallyOk && this.lives <= 0) { this.gameOver(); return; }
    // A miss costs a life and replays the same wave on a fresh field (no downward spiral).
    if (!this.tallyOk || !this.choices.length) { this.beginWave(); return; }
    this.phase = 'pick'; this.pickT = 0; this.picked = -1; this.hover = -1;
    this.host.setStatus(`Wave ${this.wave} next`);
  }

  private choose(index: number) {
    const choice = this.choices[index];
    if (!choice || this.picked >= 0) return;
    this.picked = index;
    this.levels[choice.id] = (this.levels[choice.id] ?? 0) + 1;
    const rect = this.cardRect(index);
    this.particles.emit(rect.x + rect.w / 2, rect.y + rect.h / 2, { count: this.host.reducedMotion ? 10 : 40, color: ['#ffffff', PALETTE[(index * 7 + 2) % 24]], speed: 420, life: 0.8, size: 4, kind: 'spark' });
    this.host.sfx.sparkle(); this.host.sfx.thud(0.5);
    this.pickT = 0;
  }

  // ---- Engine hooks ---------------------------------------------------------

  resize() {
    const oldW = this.fw, oldH = this.fh;
    this.layout();
    if (!this.field || (oldW === this.fw && oldH === this.fh)) return;
    const sx = this.fw / oldW, sy = this.fh / oldH;
    for (const s of this.field.sparks) { s.x *= sx; s.y *= sy; }
    for (const b of this.field.blooms) { b.x *= sx; b.y *= sy; }
    for (const e of this.field.embers) { e.x *= sx; e.y *= sy; }
    this.field.w = this.fw; this.field.h = this.fh;
    const pulsesLeft = this.field.pulsesLeft;
    this.params = waveParams(this.wave, this.levels, this.unit);
    this.field.p = this.params; this.field.pulsesLeft = pulsesLeft;
    this.bg = null;
  }

  pointer(event: PointerEventLite) {
    if (event.type === 'leave') { this.aim = null; this.hover = -1; return; }
    this.aim = { x: event.x, y: event.y };
    if (this.phase === 'pick') {
      this.hover = this.picked >= 0 ? -1 : this.choices.findIndex((_, i) => { const r = this.cardRect(i); return event.x >= r.x && event.x <= r.x + r.w && event.y >= r.y && event.y <= r.y + r.h; });
      if (event.type === 'down' && this.hover >= 0 && this.pickT > 0.35) this.choose(this.hover);
      return;
    }
    if (event.type !== 'down') return;
    if (this.phase === 'aim' && this.quotaHit && this.inFinish(event.x, event.y)) { this.host.sfx.click(); this.finishWave(); return; }
    if (this.phase === 'aim' && event.y > HUD) this.fire(event.x, event.y);
    else if (this.phase === 'tally' && this.tallyT > 0.35) this.afterTally();
  }

  private inFinish(x: number, y: number) { const r = this.finishRect; return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  key(code: string, down: boolean) {
    if (!down) return;
    if (this.phase === 'pick') {
      const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
      if (index >= 0 && this.pickT > 0.35) this.choose(index);
    } else if (code === 'KeyF' && this.phase === 'aim' && this.quotaHit) { this.finishWave();
    } else if (code === 'Space' || code === 'Enter') {
      if (this.phase === 'aim') this.fire(this.aim?.x ?? this.fw / 2, this.aim?.y ?? HUD + this.fh / 2);
      else if (this.phase === 'tally' && this.tallyT > 0.35) this.afterTally();
    }
  }

  update(dt: number) {
    const field = this.field;
    if (this.phase === 'chain' || this.phase === 'aim' || this.phase === 'tally' || this.phase === 'pick' || this.phase === 'over') {
      // Sparks keep drifting behind every screen; only a live chain can ignite.
      if (this.phase === 'chain') {
        const steps = 2;
        for (let i = 0; i < steps; i++) field.step(dt / steps);
        if (!field.active) {
          if (field.ignited === this.pulseHits) {
            // The pulse touched nothing. Say so, and on the very first wave give it back.
            this.floaters.add(this.fw / 2, HUD + this.fh * 0.45, this.wave === 1 ? 'MISSED. TRY AGAIN' : 'MISSED', { color: '#ff8fb0', size: 22, life: 1.1 });
            this.host.sfx.deny();
            if (this.wave === 1 && field.ignited === 0) { field.pulsesLeft++; this.host.save(this.snapshot('aim')); }
          }
          if (field.remaining === 0) this.finishWave();
          else if (field.pulsesLeft > 0) this.phase = 'aim'; // the spent pulse stays on record until the wave resolves
          else this.finishWave();
        }
      } else field.step(dt * (this.phase === 'aim' ? 1 : 0.35));
    }
    if (this.deadOnLoad) { this.deadOnLoad = false; this.gameOver(); return; }
    for (const pop of this.shieldPops) pop.life -= dt * 2.6;
    this.shieldPops = this.shieldPops.filter((p) => p.life > 0);
    if (this.phase === 'tally') { this.tallyT += dt; if (this.tallyT > 1.15) this.afterTally(); }
    if (this.phase === 'pick') {
      this.pickT += dt;
      if (this.picked >= 0 && this.pickT > 0.55) this.beginWave();
    }

    this.particles.update(dt); this.floaters.update(dt);
    for (const link of this.links) link.life -= dt * 2.2;
    this.links = this.links.filter((l) => l.life > 0);
    for (const ring of this.rings) { ring.life -= dt * 1.6; ring.r = ring.max * easeOutCubic(1 - ring.life); }
    this.rings = this.rings.filter((r) => r.life > 0);
    this.punch = Math.max(0, this.punch - dt * 5);
    this.quotaFlash = Math.max(0, this.quotaFlash - dt * 1.4);
    this.waveIntro = Math.max(0, this.waveIntro - dt * 0.9);
    const target = this.total + (this.phase === 'chain' ? field.score : 0);
    this.displayTotal += (target - this.displayTotal) * Math.min(1, dt * 10);
  }

  // ---- Drawing --------------------------------------------------------------

  private background(ctx: CanvasRenderingContext2D, t: number) {
    const { w, h } = this.host;
    if (!this.bg || this.bg.width !== Math.round(w + 60) || this.bg.height !== Math.round(h + 60)) {
      const bg = document.createElement('canvas'); bg.width = Math.round(w + 60); bg.height = Math.round(h + 60);
      const g = bg.getContext('2d')!;
      const rand = mulberry32(7);
      const base = g.createLinearGradient(0, 0, 0, bg.height);
      base.addColorStop(0, '#03040c'); base.addColorStop(1, '#070616');
      g.fillStyle = base; g.fillRect(0, 0, bg.width, bg.height);
      const clouds = ['#2a1466', '#0a3a52', '#4a1048', '#102a70', '#0c4a44'];
      const size = Math.max(bg.width, bg.height);
      for (let i = 0; i < 9; i++) drawGlow(g, rand() * bg.width, rand() * bg.height, size * (0.3 + rand() * 0.4), clouds[i % clouds.length], 0.34);
      for (let i = 0; i < 170; i++) { g.globalAlpha = 0.15 + rand() * 0.5; g.fillStyle = rand() < 0.2 ? '#ffe9c4' : '#cfe4ff'; const s = rand() < 0.08 ? 1.6 : 0.8; g.fillRect(rand() * bg.width, rand() * bg.height, s, s); }
      g.globalAlpha = 1;
      this.bg = bg;
      this.stars = Array.from({ length: 46 }, () => ({ x: rand() * w, y: rand() * h, s: 0.8 + rand() * 1.4, p: rand() * TAU }));
    }
    const drift = this.host.reducedMotion ? 0 : 1;
    ctx.drawImage(this.bg, -30 + Math.sin(t * 0.07) * 18 * drift, -30 + Math.cos(t * 0.05) * 14 * drift);
    ctx.fillStyle = '#ffffff';
    for (const star of this.stars) {
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.3 + star.p));
      ctx.fillRect(star.x, star.y, star.s, star.s);
    }
    ctx.globalAlpha = 1;
  }

  private cardRect(index: number) {
    const { w, h } = this.host;
    const n = Math.max(1, this.choices.length);
    if (w >= 620) {
      const cw = Math.min(210, (w - 64 - (n - 1) * 16) / n), ch = 230;
      const total = n * cw + (n - 1) * 16;
      return { x: (w - total) / 2 + index * (cw + 16), y: HUD + (this.fh - ch) / 2 + 22, w: cw, h: ch, wide: true };
    }
    const cw = Math.min(420, w - 36), ch = Math.min(96, (this.fh - 130) / n - 12);
    const total = n * ch + (n - 1) * 12;
    return { x: (w - cw) / 2, y: HUD + (this.fh - total) / 2 + 34 + index * (ch + 12), w: cw, h: ch, wide: false };
  }

  private drawField(ctx: CanvasRenderingContext2D, t: number) {
    const field = this.field, unit = this.unit;
    ctx.save();
    ctx.translate(0, HUD);

    // Chain counter, huge and faint behind everything.
    if (field.ignited > 0 && (this.phase === 'chain' || this.phase === 'tally')) {
      const size = Math.min(this.fw, this.fh) * 0.5 * (1 + (this.host.reducedMotion ? 0 : this.punch * 0.07));
      ctx.font = `900 ${Math.round(size)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.07 + this.punch * 0.07;
      ctx.fillStyle = PALETTE[this.maxDepth % PALETTE.length];
      ctx.fillText(String(field.ignited), this.fw / 2, this.fh / 2);
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const link of this.links) {
      ctx.globalAlpha = link.life * 0.7; ctx.strokeStyle = link.color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(link.x1, link.y1); ctx.lineTo(link.x2, link.y2); ctx.stroke();
    }
    for (const ring of this.rings) {
      ctx.globalAlpha = ring.life * 0.6; ctx.strokeStyle = ring.color; ctx.lineWidth = 2 + ring.life * 3;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.r, 0, TAU); ctx.stroke();
    }

    for (const bloom of field.blooms) {
      const color = bloom.player ? '#e8fbff' : PALETTE[bloom.depth % PALETTE.length];
      const young = clamp(1 - bloom.age / 0.3, 0, 1);
      ctx.globalAlpha = (0.13 + young * 0.3) * bloom.fade; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(bloom.x, bloom.y, bloom.r, 0, TAU); ctx.fill();
      drawGlow(ctx, bloom.x, bloom.y, bloom.r * 1.75, color, (0.3 + young * 0.5) * bloom.fade);
      ctx.globalAlpha = 0.95 * bloom.fade; ctx.strokeStyle = color; ctx.lineWidth = bloom.player ? 2.6 : 1.8;
      ctx.beginPath(); ctx.arc(bloom.x, bloom.y, Math.max(0.5, bloom.r), 0, TAU); ctx.stroke();
      // A slow inner shimmer so held blooms never look static.
      ctx.globalAlpha = 0.28 * bloom.fade; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bloom.x, bloom.y, Math.max(0.5, bloom.r * (0.55 + 0.12 * Math.sin(t * 4 + bloom.x))), 0, TAU); ctx.stroke();
    }

    for (const ember of field.embers) {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff9ad9'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ember.x, ember.y); ctx.lineTo(ember.x - ember.vx * 0.05, ember.y - ember.vy * 0.05); ctx.stroke();
      drawGlow(ctx, ember.x, ember.y, 12 * unit, '#ff7ad1', 0.9);
    }

    const intro = 1 - this.waveIntro;
    for (const spark of field.sparks) {
      if (!spark.alive) continue;
      const color = SPARK_COLORS[spark.kind];
      const appear = clamp(intro * 2.2 - spark.seed, 0, 1);
      if (appear <= 0) continue;
      const twinkle = 0.72 + 0.28 * Math.sin(t * 3.2 + spark.seed * 40);
      const size = (spark.kind === 1 ? 30 : 22) * unit * twinkle * (0.4 + 0.6 * easeOutBack(appear));
      ctx.globalAlpha = 0.45 * appear; ctx.strokeStyle = color; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(spark.x, spark.y); ctx.lineTo(spark.x - spark.vx * 0.16, spark.y - spark.vy * 0.16); ctx.stroke();
      drawGlow(ctx, spark.x, spark.y, size, color, appear);
      if (spark.shield) {
        // A shell that soaks up the first bloom that touches it.
        ctx.globalAlpha = 0.85 * appear; ctx.strokeStyle = '#cfd8ff'; ctx.lineWidth = 1.5;
        const a = t * 1.2 + spark.seed * 6, sr = 7.5 * Math.max(0.8, unit);
        ctx.beginPath(); ctx.arc(spark.x, spark.y, sr, a, a + 2.1); ctx.stroke();
        ctx.beginPath(); ctx.arc(spark.x, spark.y, sr, a + Math.PI, a + Math.PI + 2.1); ctx.stroke();
      }
      ctx.globalAlpha = appear; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(spark.x, spark.y, (spark.kind === 1 ? 3 : 2.3) * Math.max(0.8, unit), 0, TAU); ctx.fill();
      if (spark.kind === 1) {
        const a = t * 1.4 + spark.seed * 9, len = 7 * unit * twinkle;
        ctx.globalAlpha = 0.8 * appear; ctx.strokeStyle = '#fff1bd'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) { const b = a + (i * Math.PI) / 2; ctx.moveTo(spark.x - Math.cos(b) * len, spark.y - Math.sin(b) * len); ctx.lineTo(spark.x + Math.cos(b) * len, spark.y + Math.sin(b) * len); }
        ctx.stroke();
      } else if (spark.kind === 2) {
        ctx.fillStyle = '#ffc1ea';
        for (let i = 0; i < 3; i++) { const a = t * 3 + spark.seed * 9 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(spark.x + Math.cos(a) * 5 * unit, spark.y + Math.sin(a) * 5 * unit, 1.2, 0, TAU); ctx.fill(); }
      }
    }
    for (const pop of this.shieldPops) {
      ctx.globalAlpha = pop.life * 0.8; ctx.strokeStyle = '#cfd8ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pop.x, pop.y, (8 + (1 - pop.life) * 16) * Math.max(0.8, unit), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // Aim reticle: shows exactly how far the first pulse will reach.
    if (this.phase === 'aim' && this.aim && this.aim.y > HUD) {
      const r = this.params.playerRadius;
      const px = this.aim.x, py = this.aim.y - HUD;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(t * 0.5);
      ctx.setLineDash([6, 8]); ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(232,251,255,${0.5 + 0.2 * Math.sin(t * 4)})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, py, 2, 0, TAU); ctx.fill();
      drawGlow(ctx, px, py, r * 0.9, '#7cf6ff', 0.14);
      // How many sparks this pulse would touch right now: aiming is a real decision.
      let inRange = 0;
      for (const spark of field.sparks) if (spark.alive && (spark.x - px) ** 2 + (spark.y - py) ** 2 <= (r + 4) ** 2) inRange++;
      ctx.font = `800 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = inRange >= 4 ? '#b7f36b' : inRange > 0 ? '#e8fbff' : '#ff8fb0';
      ctx.fillText(String(inRange), px, py - r - 12);
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, t: number) {
    const { w } = this.host;
    const field = this.field, p = this.params;
    const shade = ctx.createLinearGradient(0, 0, 0, HUD + 14);
    shade.addColorStop(0, 'rgba(3,4,12,0.92)'); shade.addColorStop(0.75, 'rgba(3,4,12,0.55)'); shade.addColorStop(1, 'rgba(3,4,12,0)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, HUD + 14);

    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `800 11px ${FONT}`; ctx.fillStyle = '#7f8ea8';
    ctx.fillText('WAVE', 16, 20);
    ctx.font = `800 22px ${FONT}`; ctx.fillStyle = '#eaf6ff';
    ctx.fillText(String(this.wave), 16, 41);
    // Lives
    for (let i = 0; i < LIVES; i++) {
      const x = 52 + i * 15, on = i < this.lives;
      if (on) drawGlow(ctx, x, 41, 9, '#ff7ad1', 0.9);
      ctx.fillStyle = on ? '#ffd0ee' : '#2a3040'; ctx.beginPath(); ctx.arc(x, 41, 3.2, 0, TAU); ctx.fill();
    }

    // Quota bar
    const bw = Math.min(280, w - 200), bx = (w - bw) / 2, by = 36, bh = 9;
    const done = field.ignited >= p.quota;
    const frac = clamp(field.ignited / p.count, 0, 1), goal = p.quota / p.count;
    ctx.textAlign = 'center'; ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = done ? '#ffe58a' : '#b9c7dd';
    ctx.fillText(done ? `CLEARED · ${field.ignited} of ${p.count}` : `${field.ignited} / ${p.quota} to clear`, w / 2, 19);
    roundRect(ctx, bx, by, bw, bh, 5); ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fill();
    if (frac > 0) {
      const fill = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (done) { fill.addColorStop(0, '#ffb347'); fill.addColorStop(1, '#fff0a8'); } else { fill.addColorStop(0, '#39c6ff'); fill.addColorStop(1, '#c08bff'); }
      roundRect(ctx, bx, by, Math.max(bh, bw * frac), bh, 5); ctx.fillStyle = fill; ctx.fill();
      drawGlow(ctx, bx + bw * frac, by + bh / 2, 16 + this.quotaFlash * 40, done ? '#ffd45e' : '#7cf6ff', 0.8);
    }
    ctx.fillStyle = done ? '#fff0a8' : '#ffffff'; ctx.fillRect(bx + bw * goal - 1, by - 4, 2, bh + 8);

    // Pulses
    ctx.textAlign = 'right'; ctx.font = `800 11px ${FONT}`; ctx.fillStyle = '#7f8ea8';
    ctx.fillText('PULSES', w - 16, 20);
    for (let i = 0; i < p.pulses; i++) {
      const x = w - 22 - i * 17, on = i < field.pulsesLeft;
      if (on) drawGlow(ctx, x, 41, 11, '#7cf6ff', 0.8 + 0.2 * Math.sin(t * 4));
      ctx.lineWidth = 2; ctx.strokeStyle = on ? '#e8fbff' : '#2a3040'; ctx.beginPath(); ctx.arc(x, 41, 5, 0, TAU); ctx.stroke();
    }

    // Quota met with pulses to spare: let the player bank the wave instead of chasing strays.
    if (this.phase === 'aim' && this.quotaHit) {
      const bw2 = 168, bh2 = 38, fx = w - bw2 - 14, fy = this.host.h - bh2 - 12;
      this.finishRect = { x: fx, y: fy, w: bw2, h: bh2 };
      roundRect(ctx, fx, fy, bw2, bh2, 19); ctx.fillStyle = '#ffe58a'; ctx.fill();
      drawGlow(ctx, fx + bw2 / 2, fy + bh2 / 2, 90, '#ffb347', 0.25 + 0.1 * Math.sin(t * 4));
      ctx.font = `800 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#231a05';
      ctx.fillText('Finish wave  ▸  F', fx + bw2 / 2, fy + bh2 / 2 + 1);
    } else this.finishRect = { x: 0, y: 0, w: 0, h: 0 };

    // Owned upgrades along the bottom edge.
    const owned = UPGRADES.filter((u) => (this.levels[u.id] ?? 0) > 0);
    let ox = 14; const oy = this.host.h - 20;
    ctx.textAlign = 'center';
    for (const upgrade of owned) {
      const level = this.levels[upgrade.id] ?? 0;
      ctx.fillStyle = 'rgba(10,14,28,0.7)'; roundRect(ctx, ox, oy - 12, level > 1 ? 40 : 26, 24, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(160,200,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = `700 13px ${FONT}`; ctx.fillStyle = '#cfe6ff'; ctx.fillText(upgrade.glyph, ox + 13, oy + 1);
      if (level > 1) { ctx.font = `700 10px ${FONT}`; ctx.fillStyle = '#8fa3c2'; ctx.fillText(`×${level}`, ox + 29, oy + 1); }
      ox += (level > 1 ? 40 : 26) + 6;
      if (ox > w - 50) break;
    }
  }

  private drawTally(ctx: CanvasRenderingContext2D) {
    const { w } = this.host;
    const t = clamp(this.tallyT / 0.35, 0, 1);
    const cy = HUD + this.fh / 2;
    ctx.fillStyle = `rgba(3,4,12,${0.45 * t})`; ctx.fillRect(0, HUD, w, this.fh);
    const scale = easeOutBack(t);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const color = this.tallyOk ? '#ffe58a' : '#ff8fb0';
    drawGlow(ctx, w / 2, cy, Math.min(w, 420) * 0.6, this.tallyOk ? '#ffb347' : '#ff4f8a', 0.25 * t);
    ctx.font = `900 ${Math.round(Math.min(64, w * 0.13) * scale)}px ${FONT}`; ctx.fillStyle = color;
    ctx.fillText(this.tallyLine, w / 2, cy - 14);
    ctx.font = `700 ${Math.round(Math.min(26, w * 0.06))}px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = t;
    ctx.fillText(this.tallySub, w / 2, cy + 34);
    ctx.globalAlpha = 1;
  }

  private drawPick(ctx: CanvasRenderingContext2D, t: number) {
    const { w } = this.host;
    const fade = clamp(this.pickT / 0.3, 0, 1) * (this.picked >= 0 ? clamp(1 - (this.pickT - 0.25) / 0.3, 0, 1) : 1);
    ctx.fillStyle = `rgba(3,4,12,${0.74 * fade})`; ctx.fillRect(0, HUD, w, this.fh);
    const first = this.cardRect(0);
    ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 11px ${FONT}`; ctx.fillStyle = '#7cf6ff';
    ctx.fillText('WAVE CLEARED · CHOOSE ONE', w / 2, first.y - 62);
    ctx.font = `800 ${Math.min(26, w * 0.06)}px ${FONT}`; ctx.fillStyle = '#ffffff';
    ctx.fillText('Shape the next chain', w / 2, first.y - 36);

    this.choices.forEach((choice, i) => {
      const rect = this.cardRect(i);
      const enter = easeOutBack(clamp((this.pickT - i * 0.07) / 0.35, 0, 1));
      const chosen = this.picked === i, dimmed = this.picked >= 0 && !chosen;
      const hot = this.hover === i && this.picked < 0;
      const accent = PALETTE[(i * 7 + 2) % PALETTE.length];
      const scale = (hot ? 1.04 : 1) * (chosen ? 1.08 : 1);
      ctx.save();
      ctx.globalAlpha = fade * (this.picked < 0 ? clamp(enter, 0, 1) : dimmed ? 0.25 : 1);
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2 + (this.picked < 0 ? (1 - enter) * 40 : 0));
      ctx.scale(scale, scale);
      const x = -rect.w / 2, y = -rect.h / 2;
      if (hot || chosen) drawGlow(ctx, 0, 0, Math.max(rect.w, rect.h) * 0.85, accent, 0.35);
      const body = ctx.createLinearGradient(0, y, 0, y + rect.h);
      body.addColorStop(0, '#161b33'); body.addColorStop(1, '#0a0d1c');
      roundRect(ctx, x, y, rect.w, rect.h, 16); ctx.fillStyle = body; ctx.fill();
      ctx.lineWidth = hot || chosen ? 2 : 1.2; ctx.strokeStyle = hot || chosen ? accent : 'rgba(150,180,255,0.28)'; ctx.stroke();

      const level = this.levels[choice.id] ?? 0;
      ctx.textBaseline = 'middle';
      if (rect.wide) {
        drawGlow(ctx, 0, y + 58, 46, accent, 0.5 + 0.15 * Math.sin(t * 2 + i));
        ctx.textAlign = 'center';
        ctx.font = `700 44px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(choice.glyph, 0, y + 60);
        ctx.font = `800 17px ${FONT}`; ctx.fillText(choice.name, 0, y + 116);
        ctx.font = `500 13px ${FONT}`; ctx.fillStyle = '#b7c4dc';
        wrap(ctx, choice.text, rect.w - 28).slice(0, 3).forEach((line, n) => ctx.fillText(line, 0, y + 144 + n * 17));
        ctx.font = `700 10px ${FONT}`; ctx.fillStyle = accent;
        ctx.fillText(level > 0 ? `LEVEL ${level} → ${level + 1}` : `NEW · PRESS ${i + 1}`, 0, y + rect.h - 18);
      } else {
        const gx = x + 40;
        drawGlow(ctx, gx, 0, 34, accent, 0.5 + 0.15 * Math.sin(t * 2 + i));
        ctx.textAlign = 'center'; ctx.font = `700 30px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(choice.glyph, gx, 1);
        ctx.textAlign = 'left';
        ctx.font = `800 15px ${FONT}`; ctx.fillText(choice.name, x + 76, -14);
        ctx.font = `500 12px ${FONT}`; ctx.fillStyle = '#b7c4dc';
        wrap(ctx, choice.text, rect.w - 150).slice(0, 2).forEach((line, n) => ctx.fillText(line, x + 76, 7 + n * 15));
        ctx.textAlign = 'right'; ctx.font = `700 10px ${FONT}`; ctx.fillStyle = accent;
        ctx.fillText(level > 0 ? `LV ${level + 1}` : 'NEW', x + rect.w - 16, -14);
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D, t: number) {
    this.background(ctx, t);
    this.drawField(ctx, t);
    if (this.phase === 'tally') this.drawTally(ctx);
    if (this.phase === 'pick') this.drawPick(ctx, t);
    this.particles.render(ctx);
    this.floaters.render(ctx, FONT);
    this.drawHud(ctx, t);
  }
}

const afterglow: GameModule = {
  realtime: true,
  bloom: 0.75,
  create: (host, saved) => new Afterglow(host, saved),
};

export default afterglow;
