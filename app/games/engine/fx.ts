// Shared drawing helpers. Everything here is cheap enough to run hundreds of
// times a frame: glows are cached sprites drawn additively, never shadowBlur.

export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutElastic = (t: number) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1);
/** Frame-rate independent smoothing: approach target at `rate` per second. */
export const damp = (current: number, target: number, rate: number, dt: number) => lerp(current, target, 1 - Math.exp(-rate * dt));

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

// ---- Glow sprites -----------------------------------------------------------

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft radial sprite in the given colour. Cached per colour. */
export function glowSprite(color: string): HTMLCanvasElement {
  let sprite = glowCache.get(color);
  if (!sprite) {
    const size = 128;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const g = sprite.getContext('2d')!;
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1;
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    // Fade the body so the centre stays hot and the edge falls off smoothly.
    g.globalCompositeOperation = 'destination-in';
    const falloff = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    falloff.addColorStop(0, 'rgba(0,0,0,1)');
    falloff.addColorStop(0.35, 'rgba(0,0,0,0.45)');
    falloff.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = falloff;
    g.fillRect(0, 0, size, size);
    glowCache.set(color, sprite);
  }
  return sprite;
}

/** Draw an additive glow. Radius is the full falloff radius in pixels. */
export function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1) {
  if (alpha <= 0 || radius <= 0) return;
  const previous = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = previousAlpha * Math.min(1, alpha);
  ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = previousAlpha;
  ctx.globalCompositeOperation = previous;
}

// ---- Particles --------------------------------------------------------------

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; gravity: number; drag: number; kind: 0 | 1 | 2; spin: number; angle: number };

export type EmitOptions = {
  count?: number;
  color?: string | string[];
  speed?: number;      // max initial speed, px/s
  minSpeed?: number;
  life?: number;       // seconds
  size?: number;       // px
  gravity?: number;    // px/s^2
  drag?: number;       // per second, 0 = none
  angle?: number;      // radians, centre of the cone
  spread?: number;     // radians, full cone width (default full circle)
  /** 'glow' soft dots, 'spark' velocity-stretched streaks, 'shard' spinning squares. */
  kind?: 'glow' | 'spark' | 'shard';
};

export class Particles {
  private pool: Particle[] = [];
  constructor(private max = 1400, private random: () => number = Math.random) {}

  get count() { return this.pool.length; }

  emit(x: number, y: number, o: EmitOptions = {}) {
    const count = o.count ?? 12;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffffff'];
    const spread = o.spread ?? TAU;
    const centre = o.angle ?? 0;
    const kind = o.kind === 'spark' ? 1 : o.kind === 'shard' ? 2 : 0;
    for (let i = 0; i < count; i++) {
      if (this.pool.length >= this.max) this.pool.shift();
      const angle = centre + (this.random() - 0.5) * spread;
      const speed = lerp(o.minSpeed ?? 0, o.speed ?? 220, this.random());
      const life = (o.life ?? 0.6) * (0.55 + this.random() * 0.45);
      this.pool.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life, max: life, size: (o.size ?? 4) * (0.5 + this.random() * 0.5),
        color: colors[(this.random() * colors.length) | 0], gravity: o.gravity ?? 0, drag: o.drag ?? 2.4,
        kind, spin: (this.random() - 0.5) * 14, angle: this.random() * TAU,
      });
    }
  }

  update(dt: number) {
    const pool = this.pool;
    let write = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.angle += p.spin * dt;
      pool[write++] = p;
    }
    pool.length = write;
  }

  render(ctx: CanvasRenderingContext2D) {
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) {
      const t = p.life / p.max;
      if (p.kind === 0) {
        const r = p.size * (0.6 + t * 0.9) * 2.2;
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.drawImage(glowSprite(p.color), p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.kind === 1) {
        ctx.globalAlpha = Math.min(1, t * 1.8);
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, p.size * t); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke();
      } else {
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        const s = p.size * (0.4 + t * 0.6);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previous;
  }

  clear() { this.pool.length = 0; }
}

// ---- Floating score text ----------------------------------------------------

type Floater = { x: number; y: number; text: string; color: string; size: number; life: number; max: number; rise: number };

export class Floaters {
  private items: Floater[] = [];
  add(x: number, y: number, text: string, opts: { color?: string; size?: number; life?: number; rise?: number } = {}) {
    const life = opts.life ?? 0.9;
    this.items.push({ x, y, text, color: opts.color ?? '#fff', size: opts.size ?? 20, life, max: life, rise: opts.rise ?? 46 });
    if (this.items.length > 60) this.items.shift();
  }
  update(dt: number) { for (const f of this.items) f.life -= dt; this.items = this.items.filter((f) => f.life > 0); }
  render(ctx: CanvasRenderingContext2D, font = 'system-ui, sans-serif') {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.items) {
      const t = 1 - f.life / f.max;
      const scale = t < 0.18 ? easeOutBack(t / 0.18) : 1;
      ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      ctx.font = `800 ${Math.round(f.size * scale)}px ${font}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,10,20,0.55)'; ctx.lineJoin = 'round';
      const y = f.y - easeOutCubic(t) * f.rise;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Rounded rectangle path. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';
