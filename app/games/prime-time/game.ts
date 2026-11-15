import type { Game, GameHost, GameModule, PointerEventLite } from '../engine/types';
import { FONT, Floaters, Particles, TAU, clamp, damp, drawGlow, easeInOutCubic, easeOutBack, easeOutCubic, hsl, lerp, roundRect } from '../engine/fx';
import {
  CHARMS, DISCARDS_PER_ROUND, HAND_SIZE, MAX_CHARMS, MAX_SELECT, PATTERNS, PATTERN_ORDER, PLAYS_PER_ROUND, PRIME_BONUS, SPECTRUM_BONUS,
  charmDef, detectFlags, isPrime, newCharm, offerCharms, onDiscard, onRoundCleared, scoreHand, shuffledBag, sortHand, targetFor,
  type Charm, type CharmId, type ScoreEvent, type ScoreResult, type Tile,
} from './rules';

// Prime Time: build a hand of number tiles, score chips x mult, pick charms
// between rounds. All rules live in rules.ts; this file is the table, the
// tiles and the scoring show.

type Saved = {
  bonusPick?: boolean;
  v: 1;
  round: number;
  roundScore: number;
  total: number;
  plays: number;
  discards: number;
  bag: Tile[];
  hand: Tile[];
  charms: Charm[];
  phase: 'play' | 'shop';
  offer: CharmId[];
  nextId: number;
};

type Mode = 'play' | 'scoring' | 'won' | 'lost' | 'shop' | 'replace';
type Rect = { x: number; y: number; w: number; h: number };
type Vis = { tile: Tile; x: number; y: number; alpha: number; scale: number; lift: number; pop: number; delay: number; placed: boolean };

const SUITS = [
  { name: 'Coral', hi: '#f07a66', mid: '#d24534', lo: '#7d1f14', glow: '#ff6a55' },
  { name: 'Amber', hi: '#efb840', mid: '#cf8510', lo: '#7a4d05', glow: '#ffbf3a' },
  { name: 'Teal', hi: '#45cdb4', mid: '#0f927d', lo: '#065247', glow: '#35e0c3' },
  { name: 'Violet', hi: '#9b87f5', mid: '#6349d6', lo: '#33228a', glow: '#9580ff' },
];
const CHIP = '#58b4ff';
const MULT = '#ff5d73';
const GOLD = '#ffd35c';
const ACCENT = '#b7f36b';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtMult = (m: number) => (Number.isInteger(m) ? fmt(m) : m >= 100 ? fmt(m) : m.toFixed(1));
const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function isSaved(value: unknown): value is Saved {
  const s = value as Saved | null;
  return !!s && s.v === 1 && Array.isArray(s.hand) && Array.isArray(s.bag) && Array.isArray(s.charms) && Array.isArray(s.offer)
    && typeof s.round === 'number' && typeof s.total === 'number' && (s.phase === 'play' || s.phase === 'shop')
    && s.charms.every((c) => CHARMS.some((d) => d.id === c.id)) && s.offer.every((id) => CHARMS.some((d) => d.id === id));
}

class PrimeTime implements Game {
  private s: Saved;
  private mode: Mode = 'play';
  private sel = new Set<number>();
  private vis = new Map<number, Vis>();
  private ghosts: Vis[] = []; // discarded or spent tiles flying away
  private particles: Particles;
  private floaters = new Floaters();
  private t = 0;
  private hover: { kind: 'tile' | 'charm' | 'offer' | 'play' | 'discard' | 'help' | 'skip' | 'none'; i: number } = { kind: 'none', i: -1 };
  private pinned = -1;
  private help = false;
  private dispRound = 0;
  private chipPulse = 0;
  private multPulse = 0;
  private charmFlash: number[] = [0, 0, 0, 0, 0];
  private modeT = 0;
  private pending = -1; // offer index waiting for a slot to replace
  private previewKey = '';
  private preview: ScoreResult | null = null;
  private anim: null | {
    played: Tile[]; result: ScoreResult; before: number; after: number; totalBefore: number; won: boolean; lost: boolean;
    stage: 'fly' | 'events' | 'slam' | 'count' | 'out'; st: number; ei: number; interval: number; chips: number; mult: number; fresh: number[];
  } = null;
  private L!: ReturnType<PrimeTime['layout']>;

  constructor(private host: GameHost, saved: unknown) {
    this.particles = new Particles(900);
    if (isSaved(saved)) {
      this.s = saved;
      this.dispRound = saved.roundScore;
      host.setScore(saved.total);
    } else {
      this.s = { v: 1, round: 1, roundScore: 0, total: 0, plays: PLAYS_PER_ROUND, discards: DISCARDS_PER_ROUND, bag: [], hand: [], charms: [], phase: 'play', offer: [], nextId: 1 };
      this.dealRound();
      host.save(this.s);
    }
    this.L = this.layout();
    if (this.s.phase === 'shop') { this.mode = 'shop'; this.modeT = 0; }
    else {
      this.dealVisuals(this.s.hand.map((tile) => tile.id));
      // A run saved after its last play missed the target: finish it.
      if (this.s.plays <= 0 && this.s.roundScore < this.target) { this.mode = 'lost'; this.modeT = 0; }
    }
    this.status();
  }

  private get target() { return targetFor(this.s.round); }

  private status() {
    const s = this.s;
    this.host.setStatus(this.mode === 'shop' || this.mode === 'replace' || this.mode === 'won'
      ? this.host.w < 440 ? `R${s.round} cleared` : `Round ${s.round} cleared`
      : this.host.w < 440 ? `R${s.round} · ${s.plays} ${s.plays === 1 ? 'play' : 'plays'}`
      : `Round ${s.round} · ${s.plays} ${s.plays === 1 ? 'play' : 'plays'} left`);
  }

  private dealRound() {
    const s = this.s;
    s.bag = shuffledBag(this.host.rng, s.nextId);
    s.nextId += s.bag.length;
    s.hand = sortHand(s.bag.splice(0, HAND_SIZE));
    s.plays = PLAYS_PER_ROUND; s.discards = DISCARDS_PER_ROUND; s.roundScore = 0; s.phase = 'play'; s.offer = [];
  }

  /** Bring the given tiles in from below with a stagger. */
  private dealVisuals(ids: number[], startDelay = 0.1) {
    const { host } = this;
    ids.forEach((id, i) => {
      const tile = this.s.hand.find((h) => h.id === id);
      if (!tile) return;
      this.vis.set(id, {
        tile, x: host.w / 2 + (i - ids.length / 2) * 14, y: host.h + 90, alpha: 1, scale: 0.8, lift: 0, pop: 0,
        delay: host.reducedMotion ? 0 : startDelay + i * 0.055, placed: false,
      });
    });
  }

  // ---- Layout -----------------------------------------------------------------

  private layout() {
    const W = this.host.w, H = this.host.h;
    const pad = clamp(W * 0.03, 10, 22);
    const cw = Math.min(W - pad * 2, 860);
    const x0 = (W - cw) / 2;
    const gap = clamp(H * 0.018, 6, 14);
    let y = gap;
    const barH = clamp(H * 0.1, 44, 68);
    const bar: Rect = { x: x0, y, w: cw, h: barH }; y += barH + gap;
    const panelH = clamp(H * 0.2, 90, 158);
    const panel: Rect = { x: x0, y, w: cw, h: panelH }; y += panelH + gap;
    const charmH = clamp(H * 0.12, 52, 92);
    const charmGap = clamp(cw * 0.015, 5, 12);
    const slotW = (cw - charmGap * (MAX_CHARMS - 1)) / MAX_CHARMS;
    const slots: Rect[] = Array.from({ length: MAX_CHARMS }, (_, i) => ({ x: x0 + i * (slotW + charmGap), y, w: slotW, h: charmH }));
    y += charmH + gap;
    const btnH = clamp(H * 0.09, 42, 60);
    const btnY = H - gap - btnH;
    const lower: Rect = { x: x0, y, w: cw, h: H - y - gap }; // hand + buttons; the shop takes this over
    const handH = btnY - gap - y;

    const cols = cw >= 600 ? HAND_SIZE : 4;
    const rows = HAND_SIZE / cols;
    const tGap = clamp(cw * 0.016, 5, 12);
    const liftRoom = 0.2;
    const tw = Math.min((cw - tGap * (cols - 1)) / cols, (handH - tGap * (rows - 1)) / (rows + liftRoom) / 1.28, 124);
    const th = tw * 1.28;
    const gridW = cols * tw + (cols - 1) * tGap;
    const gridH = rows * th + (rows - 1) * tGap;
    const gx = x0 + (cw - gridW) / 2;
    const gy = y + th * liftRoom + Math.max(0, (handH - th * liftRoom - gridH) / 2);
    const slot = (i: number) => ({ x: gx + (i % cols) * (tw + tGap) + tw / 2, y: gy + Math.floor(i / cols) * (th + tGap) + th / 2 });
    const playRow = (i: number, n: number) => ({ x: W / 2 + (i - (n - 1) / 2) * (tw + tGap), y: gy + th / 2 - th * 0.12 });

    const helpBtn: Rect = { x: x0, y: btnY, w: btnH, h: btnH };
    const rest = cw - btnH - gap * 2;
    const discardBtn: Rect = { x: x0 + btnH + gap, y: btnY, w: rest * 0.42, h: btnH };
    const playBtn: Rect = { x: discardBtn.x + discardBtn.w + gap, y: btnY, w: rest * 0.58, h: btnH };

    // Shop: three offers side by side when there is room, stacked otherwise.
    const skipH = clamp(lower.h * 0.13, 26, 44);
    const offersArea: Rect = { x: lower.x, y: lower.y, w: lower.w, h: lower.h - skipH - gap };
    const wide = cw >= 600;
    const offers: Rect[] = [0, 1, 2].map((i) => wide
      ? { x: offersArea.x + i * ((cw - gap * 2) / 3 + gap), y: offersArea.y + Math.max(0, (offersArea.h - Math.min(offersArea.h, 250)) / 2), w: (cw - gap * 2) / 3, h: Math.min(offersArea.h, 250) }
      : { x: offersArea.x, y: offersArea.y + i * ((offersArea.h - gap * 2) / 3 + gap), w: cw, h: (offersArea.h - gap * 2) / 3 });
    const skipBtn: Rect = { x: x0 + cw / 2 - Math.min(cw, 240) / 2, y: lower.y + lower.h - skipH, w: Math.min(cw, 240), h: skipH };

    return { W, H, pad, cw, x0, gap, bar, panel, slots, lower, tw, th, slot, playRow, helpBtn, discardBtn, playBtn, offers, skipBtn, wide };
  }

  // ---- Actions ----------------------------------------------------------------

  private selected(): Tile[] { return this.s.hand.filter((tile) => this.sel.has(tile.id)); }

  private context() {
    const s = this.s;
    return { discardsLeft: s.discards, handsPlayed: PLAYS_PER_ROUND - s.plays, playsLeft: s.plays };
  }

  private currentPreview(): ScoreResult | null {
    const s = this.s;
    const key = `${[...this.sel].sort((a, b) => a - b).join(',')}|${s.plays}|${s.discards}|${s.charms.map((c) => c.id + c.v).join(',')}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      this.preview = this.sel.size ? scoreHand(this.selected(), s.charms, this.context()) : null;
    }
    return this.preview;
  }

  private toggle(index: number) {
    const tile = this.s.hand[index];
    if (!tile || this.mode !== 'play') return;
    const { sfx } = this.host;
    if (this.sel.has(tile.id)) { this.sel.delete(tile.id); sfx.click(); }
    else if (this.sel.size >= MAX_SELECT) { sfx.deny(); const v = this.vis.get(tile.id); if (v) v.pop = 0.6; }
    else {
      this.sel.add(tile.id);
      sfx.note(this.sel.size + 2, { gain: 0.11, dur: 0.12, echo: 0.15 });
      const v = this.vis.get(tile.id); if (v) v.pop = 1;
    }
  }

  private play() {
    const s = this.s, { host } = this;
    if (this.mode !== 'play') return;
    if (this.sel.size === 0 || s.plays <= 0) { host.sfx.deny(); return; }
    const played = this.selected();
    const result = scoreHand(played, s.charms, this.context());
    if (!result) return;

    // Commit the outcome first; everything after this is presentation.
    const before = s.roundScore, totalBefore = s.total;
    s.hand = s.hand.filter((tile) => !this.sel.has(tile.id));
    const drawn = s.bag.splice(0, played.length);
    s.hand.push(...drawn); sortHand(s.hand);
    s.plays -= 1; s.roundScore += result.total; s.total += result.total;
    const won = s.roundScore >= this.target;
    const lost = !won && s.plays === 0;
    if (won) { onRoundCleared(s.charms); s.phase = 'shop'; s.offer = offerCharms(host.rng, s.charms); }
    host.save(s);

    this.sel.clear(); this.pinned = -1;
    for (const tile of drawn) this.vis.set(tile.id, { tile, x: host.w / 2, y: host.h + 90, alpha: 1, scale: 0.8, lift: 0, pop: 0, delay: Infinity, placed: false });
    const n = Math.max(1, result.events.length);
    this.anim = {
      played, result, before, after: s.roundScore, totalBefore, won, lost, stage: 'fly', st: 0, ei: 0,
      interval: clamp(1.2 / n, 0.06, 0.17), chips: result.baseChips, mult: result.baseMult, fresh: drawn.map((tile) => tile.id),
    };
    this.mode = 'scoring';
    this.status();
    host.sfx.whoosh();
    if (host.reducedMotion) this.skipScoring();
  }

  private discard() {
    const s = this.s, { host } = this;
    if (this.mode !== 'play') return;
    if (this.sel.size === 0 || s.discards <= 0) { host.sfx.deny(); return; }
    const tossed = this.selected();
    s.hand = s.hand.filter((tile) => !this.sel.has(tile.id));
    const drawn = s.bag.splice(0, tossed.length);
    s.hand.push(...drawn); sortHand(s.hand);
    s.discards -= 1;
    const hadCompost = s.charms.findIndex((c) => c.id === 'compost');
    onDiscard(s.charms, tossed.length);
    host.save(s);

    tossed.forEach((tile, i) => {
      const v = this.vis.get(tile.id);
      if (v) { this.vis.delete(tile.id); v.delay = i * 0.03; this.ghosts.push(v); }
    });
    this.sel.clear();
    this.dealVisuals(drawn.map((tile) => tile.id), 0.16);
    if (hadCompost >= 0) {
      this.charmFlash[hadCompost] = 1;
      const r = this.L.slots[hadCompost];
      this.floaters.add(r.x + r.w / 2, r.y + r.h * 0.2, `+${6 * tossed.length}`, { color: CHIP, size: 16 });
    }
    host.sfx.whoosh(); host.sfx.place();
    this.status();
  }

  private fire(e: ScoreEvent, index: number, quiet = false) {
    const a = this.anim!;
    a.chips = e.chips; a.mult = e.mult;
    if (e.dChips) this.chipPulse = 1;
    if (e.dMult || e.xMult !== 1) this.multPulse = 1;
    if (quiet) return;
    const { sfx } = this.host, L = this.L;
    const label = e.xMult !== 1 ? `×${e.xMult}` : e.dMult ? `+${e.dMult} mult` : `+${e.dChips}`;
    const color = e.xMult !== 1 ? GOLD : e.dMult ? MULT : CHIP;
    let fx = L.W / 2, fy = L.panel.y + L.panel.h;
    if (e.tile !== undefined) {
      const v = this.vis.get(a.played[e.tile].id);
      if (v) { v.pop = 1; fx = v.x; fy = v.y - L.th * 0.62; }
    }
    if (e.src === 'charm' && e.charm !== undefined) {
      this.charmFlash[e.charm] = 1;
      const r = L.slots[e.charm];
      if (e.tile === undefined) { fx = r.x + r.w / 2; fy = r.y + r.h * 0.15; }
      else { fx += L.tw * 0.28 * (index % 2 ? 1 : -1); fy -= L.th * 0.2 * (1 + (index % 3)); } // keep stacked tile bonuses legible
      this.particles.emit(r.x + r.w / 2, r.y + r.h / 2, { count: 10, color: hsl(charmDef(this.s.charms[e.charm].id).hue, 90, 68), speed: 150, life: 0.45, size: 3 });
      if (e.xMult !== 1) { sfx.note(index + 4, { type: 'square', gain: 0.1, dur: 0.2 }); this.host.shake(3); }
      else sfx.note(index + 1, { type: 'sine', gain: 0.16, dur: 0.16 });
    } else {
      sfx.note(index, { gain: 0.19 });
      this.particles.emit(fx, fy + L.th * 0.62, { count: 7, color: SUITS[a.played[e.tile!].c].hi, speed: 170, life: 0.4, size: 3, kind: 'spark' });
    }
    this.floaters.add(fx, fy, label, { color, size: clamp(L.th * 0.24, 14, 26), life: 0.75, rise: L.th * 0.35 });
  }

  private skipScoring() {
    const a = this.anim;
    if (!a) return;
    while (a.ei < a.result.events.length) { this.fire(a.result.events[a.ei], a.ei, true); a.ei++; }
    this.dispRound = a.after;
    this.host.setScore(this.s.total);
    this.finishScoring();
  }

  private finishScoring() {
    const a = this.anim!, { host } = this, L = this.L;
    for (const tile of a.played) {
      const v = this.vis.get(tile.id);
      if (v) { this.vis.delete(tile.id); v.delay = 0; this.ghosts.push(v); }
    }
    this.anim = null;
    this.dispRound = a.after;
    host.setScore(this.s.total);
    if (a.won) {
      this.mode = 'won'; this.modeT = 0;
      host.sfx.win(); host.shake(10);
      const colors = ['#ffb347', '#ff7a3d', GOLD, '#fff1b8'];
      for (let i = 0; i < 9; i++) {
        this.particles.emit(L.bar.x + (L.bar.w * (i + 0.5)) / 9, L.bar.y + L.bar.h, { count: 16, color: colors, speed: 380, minSpeed: 120, angle: -Math.PI / 2, spread: 1.5, gravity: 520, life: 1.1, size: 5 });
      }
      this.particles.emit(L.W / 2, L.panel.y + L.panel.h / 2, { count: 60, color: colors, speed: 520, life: 0.9, size: 4, kind: 'spark' });
    } else if (a.lost) {
      this.mode = 'lost'; this.modeT = 0;
      host.sfx.lose();
    } else {
      this.mode = 'play';
      this.releaseFresh(a.fresh);
    }
    this.status();
  }

  private releaseFresh(ids: number[]) {
    ids.forEach((id, i) => { const v = this.vis.get(id); if (v) v.delay = this.host.reducedMotion ? 0 : i * 0.055; });
    if (ids.length) this.host.sfx.place();
  }

  private openShop() {
    this.mode = 'shop'; this.modeT = 0; this.pending = -1; this.pinned = -1;
    for (const v of this.vis.values()) { v.delay = 0; this.ghosts.push(v); }
    this.vis.clear();
    this.status();
  }

  /** Take an offered charm (or none), then deal the next round. */
  private nextRound(offerIndex: number, replaceSlot = -1) {
    const s = this.s, { host } = this;
    if (offerIndex >= 0 && s.offer[offerIndex]) {
      const charm = newCharm(s.offer[offerIndex]);
      if (replaceSlot >= 0) s.charms[replaceSlot] = charm; else s.charms.push(charm);
      const slotIndex = replaceSlot >= 0 ? replaceSlot : s.charms.length - 1;
      this.charmFlash[slotIndex] = 1;
      const r = this.L.slots[slotIndex];
      this.particles.emit(r.x + r.w / 2, r.y + r.h / 2, { count: 36, color: [hsl(charmDef(charm.id).hue, 90, 70), '#fff'], speed: 300, life: 0.7, size: 4 });
      host.sfx.sparkle();
    } else host.sfx.click();
    // Rounds 3 and 6 grant a second pick, so a build comes together before the targets steepen.
    if (offerIndex >= 0 && (s.round === 3 || s.round === 6) && !s.bonusPick) {
      s.bonusPick = true;
      s.offer = offerCharms(host.rng, s.charms);
      host.save(s);
      this.mode = 'shop'; this.modeT = 0; this.pending = -1;
      this.status();
      return;
    }
    s.bonusPick = false;
    // Plays you did not need come back as extra discards (up to 2): finishing early is rewarded.
    const spare = Math.min(2, Math.max(0, s.plays));
    s.round += 1;
    this.dealRound();
    s.discards += spare;
    host.save(s);
    this.dispRound = 0;
    this.mode = 'play'; this.modeT = 0; this.pending = -1; this.sel.clear();
    this.dealVisuals(s.hand.map((tile) => tile.id), 0.2);
    this.status();
  }

  private pickOffer(i: number) {
    if (!this.s.offer[i]) return;
    if (this.s.charms.length < MAX_CHARMS) this.nextRound(i);
    else { this.mode = 'replace'; this.pending = i; this.host.sfx.click(); }
  }

  // ---- Input ------------------------------------------------------------------

  private hit(x: number, y: number): PrimeTime['hover'] {
    const L = this.L, s = this.s;
    for (let i = 0; i < s.charms.length; i++) if (inside(L.slots[i], x, y)) return { kind: 'charm', i };
    if (this.mode === 'shop' || this.mode === 'replace') {
      if (this.mode === 'shop') for (let i = 0; i < s.offer.length; i++) if (inside(L.offers[i], x, y)) return { kind: 'offer', i };
      if (inside(L.skipBtn, x, y)) return { kind: 'skip', i: 0 };
      return { kind: 'none', i: -1 };
    }
    if (inside(L.helpBtn, x, y)) return { kind: 'help', i: 0 };
    if (inside(L.playBtn, x, y)) return { kind: 'play', i: 0 };
    if (inside(L.discardBtn, x, y)) return { kind: 'discard', i: 0 };
    // Selected tiles sit higher, so test their lifted rectangles first.
    for (const pass of [true, false]) {
      for (let i = s.hand.length - 1; i >= 0; i--) {
        const isSel = this.sel.has(s.hand[i].id);
        if (isSel !== pass) continue;
        const p = L.slot(i), lift = isSel ? L.th * 0.16 : 0;
        if (x >= p.x - L.tw / 2 - 2 && x <= p.x + L.tw / 2 + 2 && y >= p.y - L.th / 2 - lift && y <= p.y + L.th / 2 + 2) return { kind: 'tile', i };
      }
    }
    return { kind: 'none', i: -1 };
  }

  pointer(e: PointerEventLite) {
    if (e.type === 'leave') { this.hover = { kind: 'none', i: -1 }; return; }
    if (e.type === 'move') { this.hover = this.hit(e.x, e.y); return; }
    if (e.type !== 'down') return;
    if (this.locked()) return;
    if (this.help) { this.help = false; this.host.sfx.click(); return; }
    if (this.mode === 'scoring') { this.skipScoring(); return; }
    if (this.mode === 'won') { this.openShop(); return; }
    if (this.mode === 'lost') return;
    const h = this.hit(e.x, e.y);
    this.hover = h;
    if (h.kind === 'charm') {
      if (this.mode === 'replace') { this.nextRound(this.pending, h.i); return; }
      this.pinned = this.pinned === h.i ? -1 : h.i; this.host.sfx.click(); return;
    }
    this.pinned = -1;
    if (this.mode === 'replace') { if (h.kind === 'skip') this.nextRound(-1); else { this.mode = 'shop'; this.pending = -1; } return; }
    if (h.kind === 'offer') this.pickOffer(h.i);
    else if (h.kind === 'skip') this.nextRound(-1);
    else if (h.kind === 'tile') this.toggle(h.i);
    else if (h.kind === 'play') this.play();
    else if (h.kind === 'discard') this.discard();
    else if (h.kind === 'help') { this.help = true; this.host.sfx.click(); }
  }

  /** Brief input lock after a screen changes, so clicks meant for the last screen cannot pick a charm or skip the shop. */
  private locked() { return (this.mode === 'won' || this.mode === 'shop' || this.mode === 'replace') && this.modeT < 0.5; }

  key(code: string, down: boolean) {
    if (!down) return;
    if (this.locked()) return;
    if (this.help) { this.help = false; return; }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    const n = digit ? Number(digit[1]) - 1 : -1;
    if (this.mode === 'scoring') { if (code === 'Enter' || code === 'Space') this.skipScoring(); return; }
    if (this.mode === 'won') { if (code === 'Enter' || code === 'Space') this.openShop(); return; }
    if (this.mode === 'shop') { if (n >= 0 && n < 3) this.pickOffer(n); else if (code === 'KeyS') this.nextRound(-1); return; }
    if (this.mode === 'replace') { if (n >= 0 && n < this.s.charms.length) this.nextRound(this.pending, n); else if (code === 'KeyS') this.nextRound(-1); return; }
    if (this.mode !== 'play') return;
    if (n >= 0 && n < HAND_SIZE) this.toggle(n);
    else if (code === 'Enter' || code === 'Space') this.play();
    else if (code === 'KeyD' || code === 'Backspace') this.discard();
    else if (code === 'Slash' || code === 'KeyH') this.help = true;
    else if (code === 'KeyC') { this.sel.clear(); this.host.sfx.click(); }
  }

  // ---- Simulation -------------------------------------------------------------

  update(dt: number) {
    this.t += dt; this.modeT += dt;
    const L = (this.L = this.layout());
    const { host } = this, s = this.s;
    this.particles.update(dt); this.floaters.update(dt);
    this.chipPulse = Math.max(0, this.chipPulse - dt * 5);
    this.multPulse = Math.max(0, this.multPulse - dt * 5);
    for (let i = 0; i < this.charmFlash.length; i++) this.charmFlash[i] = Math.max(0, this.charmFlash[i] - dt * 3.2);

    const a = this.anim;
    if (a) {
      a.st += dt;
      if (a.stage === 'fly' && a.st >= 0.22) { a.stage = 'events'; a.st = 0; }
      if (a.stage === 'events') {
        while (a.ei < a.result.events.length && a.st >= a.ei * a.interval) { this.fire(a.result.events[a.ei], a.ei); a.ei++; }
        if (a.ei >= a.result.events.length && a.st >= a.result.events.length * a.interval + 0.1) {
          a.stage = 'slam'; a.st = 0;
          const big = a.result.total >= this.target * 0.5;
          host.sfx.thud(big ? 1 : 0.7); if (big) host.sfx.boom(0.5);
          host.shake(big ? 9 : 5); host.hitStop(big ? 70 : 40);
          this.particles.emit(L.W / 2, L.panel.y + L.panel.h * 0.62, { count: big ? 70 : 34, color: [GOLD, '#fff', CHIP, MULT], speed: big ? 520 : 360, life: 0.7, size: 4, kind: 'spark' });
        }
      } else if (a.stage === 'slam' && a.st >= 0.36) { a.stage = 'count'; a.st = 0; }
      else if (a.stage === 'count') {
        const k = easeOutCubic(clamp(a.st / 0.42, 0, 1));
        this.dispRound = lerp(a.before, a.after, k);
        host.setScore(lerp(a.totalBefore, s.total, k));
        if (Math.floor(a.st / 0.05) !== Math.floor((a.st - dt) / 0.05)) host.sfx.click();
        if (a.st >= 0.42) { a.stage = 'out'; a.st = 0; }
      } else if (a.stage === 'out' && a.st >= 0.18) this.finishScoring();
    } else if (this.mode !== 'won' && this.mode !== 'lost') this.dispRound = damp(this.dispRound, s.roundScore, 14, dt);

    if (this.mode === 'won') {
      if (Math.floor(this.modeT / 0.12) !== Math.floor((this.modeT - dt) / 0.12) && this.modeT < 0.9) {
        this.particles.emit(L.bar.x + Math.random() * L.bar.w, L.bar.y + L.bar.h * 0.7, { count: 8, color: ['#ffb347', '#ff7a3d', GOLD], speed: 260, angle: -Math.PI / 2, spread: 1.2, gravity: 380, life: 0.9, size: 5 });
      }
      if (this.modeT >= 1.35) this.openShop();
    } else if (this.mode === 'lost' && this.modeT >= 1.15) {
      this.mode = 'lost'; this.modeT = -1e9; // only once
      host.endRun({ score: s.total, headline: 'TARGET MISSED', detail: `Reached round ${s.round}${s.charms.length ? ` with ${s.charms.length} ${s.charms.length === 1 ? 'charm' : 'charms'}` : ''}` });
    }

    // Tiles ease toward their places.
    const snap = host.reducedMotion;
    const playedIds = a ? a.played.map((tile) => tile.id) : [];
    for (const [id, v] of this.vis) {
      if (v.delay > 0) { v.delay -= dt; if (v.delay > 0) continue; if (!snap) host.sfx.pop(2 + (id % 5)); }
      let tx: number, ty: number, lift = 0, alpha = 1;
      const playedIndex = playedIds.indexOf(id);
      if (playedIndex >= 0) {
        const p = L.playRow(playedIndex, playedIds.length); tx = p.x; ty = p.y;
        if (a && !a.result.detected.scoring.includes(playedIndex)) { alpha = 0.4; ty += L.th * 0.1; }
        else if (a && (a.stage === 'count' || a.stage === 'out')) alpha = 0.6;
      } else {
        const index = s.hand.findIndex((tile) => tile.id === id);
        const p = L.slot(Math.max(0, index)); tx = p.x; ty = p.y;
        if (this.sel.has(id)) lift = L.th * 0.16;
        else if (this.hover.kind === 'tile' && this.hover.i === index && this.mode === 'play') lift = L.th * 0.05;
        if (a) alpha = Math.abs(ty - L.playRow(0, 1).y) < L.th * 0.7 ? 0 : 0.1;
        else if (this.mode === 'lost') alpha = 0.35;
      }
      if (snap || !v.placed && v.delay === Infinity) { v.x = tx; v.y = ty; }
      const rate = 16;
      v.x = snap ? tx : damp(v.x, tx, rate, dt);
      v.y = snap ? ty : damp(v.y, ty, rate, dt);
      v.lift = snap ? lift : damp(v.lift, lift, 22, dt);
      v.alpha = damp(v.alpha, alpha, 12, dt);
      v.scale = damp(v.scale, 1, 14, dt);
      v.pop = Math.max(0, v.pop - dt * 4.5);
      v.placed = true;
    }
    for (const g of this.ghosts) {
      if (g.delay > 0) { g.delay -= dt; continue; }
      g.y -= dt * (L.H * 1.1); g.alpha -= dt * 4.5; g.scale = damp(g.scale, 0.7, 8, dt);
    }
    this.ghosts = this.ghosts.filter((g) => g.alpha > 0.02);
  }

  // ---- Drawing ----------------------------------------------------------------

  private fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800) {
    let s = size;
    for (;;) { ctx.font = `${weight} ${Math.round(s)}px ${FONT}`; if (s <= 8 || ctx.measureText(text).width <= maxW) break; s -= 1; }
    return s;
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(' '), lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  private drawMarker(ctx: CanvasRenderingContext2D, suit: number, x: number, y: number, r: number) {
    ctx.beginPath();
    if (suit === 0) ctx.arc(x, y, r, 0, TAU);
    else if (suit === 1) { ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r * 1.1, y + r * 0.9); ctx.lineTo(x - r * 1.1, y + r * 0.9); ctx.closePath(); }
    else if (suit === 2) ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
    else { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.05, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.05, y); ctx.closePath(); }
    ctx.fill();
  }

  private drawTile(ctx: CanvasRenderingContext2D, v: Vis, selected: boolean, oneIsPrime: boolean, idle = false) {
    const L = this.L, w = L.tw, h = L.th, suit = SUITS[v.tile.c];
    const pop = v.pop > 0 ? Math.sin(v.pop * Math.PI) * 0.16 : 0;
    const scale = v.scale + pop;
    const x = v.x, y = v.y - v.lift - pop * h * 0.25;
    if ((selected && !idle) || v.pop > 0) drawGlow(ctx, x, y, w * (1.05 + v.pop * 0.5), suit.glow, (selected && !idle ? 0.5 : 0) + v.pop * 0.6);
    ctx.save();
    ctx.globalAlpha = clamp(v.alpha, 0, 1);
    ctx.translate(x, y); ctx.scale(scale, scale);
    const r = w * 0.17, depth = h * 0.075;
    // Drop shadow, darker when lifted.
    ctx.fillStyle = `rgba(0,0,0,${0.35 + Math.min(0.25, v.lift / h)})`;
    roundRect(ctx, -w / 2 + 2, -h / 2 + depth + 3 + v.lift * 0.5, w - 4, h - depth, r); ctx.fill();
    // Body edge gives the tile thickness.
    ctx.fillStyle = suit.lo; roundRect(ctx, -w / 2, -h / 2 + depth, w, h - depth, r); ctx.fill();
    // Face.
    const face = ctx.createLinearGradient(0, -h / 2, 0, h / 2 - depth);
    face.addColorStop(0, suit.hi); face.addColorStop(0.55, suit.mid); face.addColorStop(1, suit.mid);
    ctx.fillStyle = face; roundRect(ctx, -w / 2, -h / 2, w, h - depth, r); ctx.fill();
    // Gloss sweep across the top half.
    ctx.save();
    roundRect(ctx, -w / 2, -h / 2, w, h - depth, r); ctx.clip();
    const gloss = ctx.createLinearGradient(0, -h / 2, 0, 0);
    gloss.addColorStop(0, 'rgba(255,255,255,0.26)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath(); ctx.ellipse(0, -h / 2, w * 0.78, h * 0.42, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, w * 0.018); ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    roundRect(ctx, -w / 2 + 0.75, -h / 2 + 0.75, w - 1.5, h - depth - 1.5, r); ctx.stroke();

    // Numeral.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.52)}px ${FONT}`;
    const ny = -depth / 2 + h * 0.05;
    ctx.fillStyle = 'rgba(40,10,10,0.35)'; ctx.fillText(String(v.tile.n), 0, ny + Math.max(1.5, h * 0.025));
    ctx.fillStyle = '#fffdf6'; ctx.fillText(String(v.tile.n), 0, ny);
    // Suit marker (shape, not only colour) and a gold pip on primes.
    const mx = -w / 2 + w * 0.2, my = -h / 2 + w * 0.2;
    ctx.fillStyle = 'rgba(20,8,24,0.42)'; ctx.beginPath(); ctx.arc(mx, my, w * 0.11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    this.drawMarker(ctx, v.tile.c, mx, my, w * 0.06);
    if (isPrime(v.tile.n, oneIsPrime)) {
      const px = w / 2 - w * 0.19, py = -h / 2 + w * 0.2, pr = w * 0.085;
      ctx.fillStyle = '#3a2a00'; ctx.beginPath(); ctx.arc(px, py, w * 0.11, 0, TAU); ctx.fill();
      ctx.fillStyle = GOLD; ctx.font = `900 ${Math.round(pr * 1.9)}px ${FONT}`; ctx.fillText('P', px, py + pr * 0.08);
    }
    if (selected) {
      ctx.lineWidth = Math.max(2, w * 0.035); ctx.strokeStyle = idle ? 'rgba(255,255,255,0.45)' : '#ffffff';
      if (idle) ctx.setLineDash([w * 0.09, w * 0.07]);
      roundRect(ctx, -w / 2 - 1, -h / 2 - 1, w + 2, h - depth + 2, r + 1); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (v.pop > 0) { ctx.globalAlpha = v.pop * 0.55; ctx.fillStyle = '#fff'; roundRect(ctx, -w / 2, -h / 2, w, h - depth, r); ctx.fill(); }
    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    const { W, H } = this.L, t = this.host.reducedMotion ? 0 : this.t;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d1524'); bg.addColorStop(0.55, '#0a0f1a'); bg.addColorStop(1, '#07090f');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Two slow lights drifting over the felt.
    drawGlow(ctx, W * (0.5 + Math.sin(t * 0.21) * 0.34), H * (0.34 + Math.cos(t * 0.17) * 0.16), Math.max(W, H) * 0.62, '#2b6a4a', 0.2);
    drawGlow(ctx, W * (0.5 + Math.cos(t * 0.15) * 0.38), H * (0.72 + Math.sin(t * 0.19) * 0.14), Math.max(W, H) * 0.58, '#4a2a86', 0.2);
    // Woven diamond pattern, sliding very slowly.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.028)'; ctx.lineWidth = 1;
    const step = 30, shift = (t * 4) % step;
    ctx.beginPath();
    for (let x = -H - step; x < W + step; x += step) { ctx.moveTo(x + shift, 0); ctx.lineTo(x + shift + H, H); ctx.moveTo(x - shift + H, 0); ctx.lineTo(x - shift, H); }
    ctx.stroke();
    ctx.restore();
    // Vignette.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  private drawBar(ctx: CanvasRenderingContext2D) {
    const L = this.L, s = this.s, b = L.bar, target = this.target;
    const labelSize = clamp(b.h * 0.26, 10, 15);
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${labelSize}px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillStyle = '#93a0b8'; ctx.fillText(`ROUND ${s.round}`, b.x + 2, b.y + labelSize * 0.6);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#93a0b8'; ctx.fillText('TARGET', b.x + b.w - 2 - ctx.measureText(` ${fmt(target)}`).width - 4, b.y + labelSize * 0.6);
    ctx.fillStyle = '#fff'; ctx.fillText(fmt(target), b.x + b.w - 2, b.y + labelSize * 0.6);

    const ty = b.y + labelSize * 1.5, th = b.h - labelSize * 1.5;
    const frac = clamp(this.dispRound / target, 0, 1);
    ctx.fillStyle = '#060911'; roundRect(ctx, b.x, ty, b.w, th, th / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; roundRect(ctx, b.x + 0.5, ty + 0.5, b.w - 1, th - 1, th / 2); ctx.stroke();
    if (frac > 0) {
      const fw = Math.max(th, b.w * frac);
      const done = frac >= 1;
      const fill = ctx.createLinearGradient(b.x, 0, b.x + fw, 0);
      fill.addColorStop(0, done ? '#ff9a3d' : '#3f8f4f'); fill.addColorStop(1, done ? GOLD : ACCENT);
      ctx.save(); roundRect(ctx, b.x + 2, ty + 2, b.w - 4, th - 4, th / 2); ctx.clip();
      ctx.fillStyle = fill; roundRect(ctx, b.x + 2, ty + 2, fw - 4, th - 4, th / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(b.x, ty + 2, fw, (th - 4) * 0.42);
      ctx.restore();
      drawGlow(ctx, b.x + fw - 4, ty + th / 2, th * 1.5, done ? GOLD : ACCENT, 0.6);
    }
    ctx.textAlign = 'center';
    const text = `${fmt(this.dispRound)} / ${fmt(target)}`;
    this.fit(ctx, text, b.w - 20, clamp(th * 0.52, 11, 18), 800);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,14,0.75)'; ctx.lineJoin = 'round';
    ctx.strokeText(text, b.x + b.w / 2, ty + th / 2 + 1); ctx.fillStyle = '#fff'; ctx.fillText(text, b.x + b.w / 2, ty + th / 2 + 1);
  }

  private drawBlock(ctx: CanvasRenderingContext2D, r: Rect, label: string, value: string, hi: string, lo: string, glow: string, pulse: number) {
    const s = 1 + Math.sin(pulse * Math.PI) * 0.12;
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(s, s);
    drawGlow(ctx, 0, 0, r.w * 0.8, glow, 0.18 + pulse * 0.5);
    const g = ctx.createLinearGradient(0, -r.h / 2, 0, r.h / 2);
    g.addColorStop(0, hi); g.addColorStop(1, lo);
    ctx.fillStyle = g; roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, r.h * 0.24); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; roundRect(ctx, -r.w / 2 + 2, -r.h / 2 + 2, r.w - 4, r.h * 0.42, r.h * 0.2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; roundRect(ctx, -r.w / 2 + 0.5, -r.h / 2 + 0.5, r.w - 1, r.h - 1, r.h * 0.24); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labelSize = clamp(r.h * 0.17, 8, 12);
    ctx.font = `800 ${labelSize}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(label, 0, -r.h / 2 + labelSize * 1.05);
    this.fit(ctx, value, r.w - 14, r.h * 0.56, 900);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillText(value, 0, r.h * 0.13 + 2);
    ctx.fillStyle = '#fff'; ctx.fillText(value, 0, r.h * 0.13);
    ctx.restore();
  }

  private drawPanel(ctx: CanvasRenderingContext2D) {
    const L = this.L, p = L.panel, s = this.s, a = this.anim;
    ctx.fillStyle = 'rgba(12,18,30,0.78)'; roundRect(ctx, p.x, p.y, p.w, p.h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; roundRect(ctx, p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, 16); ctx.stroke();

    const nameH = p.h * 0.3, inset = clamp(p.w * 0.03, 10, 18);
    const nameY = p.y + nameH * 0.6;
    ctx.textBaseline = 'middle';

    if (this.mode === 'shop' || this.mode === 'replace' || this.mode === 'won') {
      const full = this.mode === 'replace';
      ctx.textAlign = 'center';
      const title = this.mode === 'won' ? 'TARGET BROKEN' : full ? 'CHARMS FULL' : s.bonusPick ? 'BONUS PICK' : `ROUND ${s.round} CLEARED`;
      const k = this.mode === 'won' ? easeOutBack(clamp(this.modeT / 0.35, 0, 1)) : 1;
      const size = this.fit(ctx, title, p.w - inset * 2, clamp(p.h * 0.3, 20, 44) * k, 900);
      drawGlow(ctx, p.x + p.w / 2, p.y + p.h * 0.42, p.w * 0.5, this.mode === 'won' ? '#ff9a3d' : ACCENT, 0.22);
      ctx.fillStyle = this.mode === 'won' ? GOLD : ACCENT; ctx.fillText(title, p.x + p.w / 2, p.y + p.h * 0.4);
      const sub = this.mode === 'won' ? `${fmt(s.roundScore)} of ${fmt(this.target)}`
        : full ? 'Tap a charm above to swap it out, or tap elsewhere to go back' : `${s.plays > 0 ? `+${Math.min(2, s.plays)} discard${Math.min(2, s.plays) > 1 ? 's' : ''} for finishing early. ` : ''}Next target ${fmt(targetFor(s.round + 1))}`;
      this.fit(ctx, sub, p.w - inset * 2, clamp(size * 0.42, 11, 17), 600);
      ctx.fillStyle = '#c6cfdf'; ctx.fillText(sub, p.x + p.w / 2, p.y + p.h * 0.74);
      return;
    }

    const preview = a ? a.result : this.currentPreview();
    const name = this.mode === 'lost' ? 'Out of plays' : preview ? preview.detected.name : 'Pick up to 5 tiles';
    const chips = a ? a.chips : preview ? preview.chips : 0;
    const mult = a ? a.mult : preview ? preview.mult : 0;
    const dim = !preview;

    // Name on the left, worth on the right.
    ctx.textAlign = 'left';
    const totalText = preview && !a ? `= ${fmt(preview.total)}` : '';
    ctx.font = `800 ${clamp(nameH * 0.5, 12, 20)}px ${FONT}`;
    const totalW = totalText ? ctx.measureText(totalText).width + 10 : 0;
    this.fit(ctx, name, p.w - inset * 2 - totalW, clamp(nameH * 0.56, 13, 24), 800);
    ctx.fillStyle = dim ? '#8591a8' : this.mode === 'lost' ? '#ff9d9d' : '#fff';
    ctx.fillText(name, p.x + inset, nameY);
    if (totalText) {
      ctx.textAlign = 'right'; ctx.font = `800 ${clamp(nameH * 0.5, 12, 20)}px ${FONT}`;
      ctx.fillStyle = GOLD; ctx.fillText(totalText, p.x + p.w - inset, nameY);
    }

    // Chips x Mult.
    const by = p.y + nameH + 2, bh = p.h - nameH - inset * 0.7;
    const xW = clamp(bh * 0.5, 18, 40);
    const bw = Math.min((p.w - inset * 2 - xW) / 2, 250);
    const mid = p.x + p.w / 2;
    let merge = 0, totalAlpha = 0, totalScale = 1, flyUp = 0;
    if (a && a.stage === 'slam') { merge = easeInOutCubic(clamp(a.st / 0.16, 0, 1)); totalAlpha = clamp((a.st - 0.1) / 0.08, 0, 1); totalScale = 0.6 + 0.4 * easeOutBack(clamp((a.st - 0.1) / 0.24, 0, 1)); }
    else if (a && (a.stage === 'count' || a.stage === 'out')) { merge = 1; const k = a.stage === 'out' ? 1 : easeInOutCubic(clamp(a.st / 0.42, 0, 1)); totalAlpha = 1 - k * 0.9; totalScale = 1 - k * 0.45; flyUp = k; }
    const off = (bw / 2 + xW / 2) * (1 - merge);
    ctx.save();
    ctx.globalAlpha = (dim ? 0.45 : 1) * (1 - merge);
    this.drawBlock(ctx, { x: mid - xW / 2 - bw + (bw / 2 + xW / 2 - off), y: by, w: bw, h: bh }, 'CHIPS', fmt(chips), '#2f8fea', '#0f3d86', CHIP, this.chipPulse);
    this.drawBlock(ctx, { x: mid + xW / 2 - (bw / 2 + xW / 2 - off), y: by, w: bw, h: bh }, 'MULT', fmtMult(mult), '#f04a62', '#8a1029', MULT, this.multPulse);
    ctx.globalAlpha = (dim ? 0.45 : 1) * (1 - merge);
    ctx.textAlign = 'center'; ctx.font = `900 ${xW * 0.9}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText('×', mid, by + bh / 2 + 1);
    ctx.restore();

    if (a && totalAlpha > 0) {
      const ty = lerp(by + bh / 2, L.bar.y + L.bar.h * 0.7, flyUp);
      ctx.save();
      ctx.globalAlpha = totalAlpha;
      drawGlow(ctx, mid, ty, bw * 1.3, GOLD, 0.5 * totalAlpha);
      ctx.translate(mid, ty); ctx.scale(totalScale, totalScale);
      ctx.textAlign = 'center';
      const text = fmt(a.result.total);
      this.fit(ctx, text, p.w - inset * 2, bh * 0.95, 900);
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,20,0,0.6)'; ctx.lineJoin = 'round'; ctx.strokeText(text, 0, 2);
      ctx.fillStyle = GOLD; ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  private drawCharmFace(ctx: CanvasRenderingContext2D, r: Rect, charm: Charm, flash: number, highlight: boolean) {
    const def = charmDef(charm.id);
    const s = 1 + Math.sin(flash * Math.PI) * 0.14;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (flash > 0 || highlight) drawGlow(ctx, cx, cy, Math.max(r.w, r.h) * 0.95, hsl(def.hue, 90, 62), 0.3 + flash * 0.6);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, hsl(def.hue, 46, 22)); g.addColorStop(1, hsl(def.hue, 52, 10));
    ctx.fillStyle = g; roundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill();
    ctx.strokeStyle = hsl(def.hue, 85, 64, highlight ? 1 : 0.7); ctx.lineWidth = highlight ? 2.5 : 1.5;
    roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 11); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; roundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h * 0.4, 9); ctx.fill();

    const showName = r.w >= 84 && r.h >= 60;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyphY = showName ? r.y + r.h * 0.4 : cy;
    this.fit(ctx, def.glyph, r.w - 12, r.h * (showName ? 0.38 : 0.44), 900);
    ctx.fillStyle = hsl(def.hue, 95, 76); ctx.fillText(def.glyph, cx, glyphY);
    if (showName) {
      this.fit(ctx, def.name.toUpperCase(), r.w - 10, clamp(r.h * 0.15, 9, 12), 800);
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText(def.name.toUpperCase(), cx, r.y + r.h * 0.8);
    }
    if (charm.id === 'snowball' || charm.id === 'compost') {
      const badge = `+${charm.v}`;
      ctx.font = `800 ${clamp(r.h * 0.2, 9, 13)}px ${FONT}`;
      const bw = ctx.measureText(badge).width + 10, bh = clamp(r.h * 0.26, 13, 18);
      ctx.fillStyle = hsl(def.hue, 90, 62); roundRect(ctx, r.x + r.w - bw - 3, r.y + 3, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = '#06110c'; ctx.fillText(badge, r.x + r.w - bw / 2 - 3, r.y + 3 + bh / 2 + 0.5);
    }
    if (flash > 0) { ctx.globalAlpha = flash * 0.5; ctx.fillStyle = '#fff'; roundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill(); }
    ctx.restore();
  }

  private drawCharms(ctx: CanvasRenderingContext2D) {
    const L = this.L, s = this.s;
    for (let i = 0; i < MAX_CHARMS; i++) {
      const r = L.slots[i], charm = s.charms[i];
      if (!charm) {
        ctx.save();
        ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1.2;
        roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 11); ctx.stroke();
        ctx.restore();
        if (i === s.charms.length && s.charms.length === 0) {
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.28)';
          this.fit(ctx, 'CHARMS', r.w - 8, clamp(r.h * 0.18, 8, 11), 800); ctx.fillText('CHARMS', r.x + r.w / 2, r.y + r.h / 2);
        }
        continue;
      }
      const replace = this.mode === 'replace';
      const wobble = replace && !this.host.reducedMotion ? Math.sin(this.t * 7 + i) * 2 : 0;
      const hot = (this.hover.kind === 'charm' && this.hover.i === i) || this.pinned === i || replace;
      this.drawCharmFace(ctx, { x: r.x, y: r.y + wobble, w: r.w, h: r.h }, charm, this.charmFlash[i], hot);
    }
  }

  private drawButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, sub: string, kind: 'primary' | 'ghost', enabled: boolean, hot: boolean) {
    const rad = Math.min(16, r.h / 2);
    ctx.save();
    if (!enabled) ctx.globalAlpha = 0.42;
    if (kind === 'primary') {
      if (enabled) drawGlow(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.6, ACCENT, hot ? 0.38 : 0.2);
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, hot && enabled ? '#d5ff94' : '#c2f57a'); g.addColorStop(1, '#7fc23a');
      ctx.fillStyle = '#3f6a17'; roundRect(ctx, r.x, r.y + 3, r.w, r.h - 3, rad); ctx.fill();
      ctx.fillStyle = g; roundRect(ctx, r.x, r.y, r.w, r.h - 4, rad); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; roundRect(ctx, r.x + 3, r.y + 2, r.w - 6, (r.h - 4) * 0.4, rad - 2); ctx.fill();
    } else {
      ctx.fillStyle = hot && enabled ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.06)'; roundRect(ctx, r.x, r.y, r.w, r.h - 2, rad); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5; roundRect(ctx, r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 3.5, rad); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cy = r.y + (r.h - 3) / 2;
    const ink = kind === 'primary' ? '#0c1a06' : '#eef1ea';
    if (sub) {
      this.fit(ctx, label, r.w - 14, clamp(r.h * 0.36, 12, 20), 900); ctx.fillStyle = ink; ctx.fillText(label, r.x + r.w / 2, cy - r.h * 0.13);
      this.fit(ctx, sub, r.w - 14, clamp(r.h * 0.22, 9, 12), 700); ctx.globalAlpha *= 0.72; ctx.fillText(sub, r.x + r.w / 2, cy + r.h * 0.22);
    } else { this.fit(ctx, label, r.w - 12, clamp(r.h * 0.4, 12, 22), 900); ctx.fillStyle = ink; ctx.fillText(label, r.x + r.w / 2, cy + 1); }
    ctx.restore();
  }

  private drawShop(ctx: CanvasRenderingContext2D) {
    const L = this.L, s = this.s;
    const replace = this.mode === 'replace';
    s.offer.forEach((id, i) => {
      const def = charmDef(id), r = L.offers[i];
      const k = this.host.reducedMotion ? 1 : easeOutBack(clamp((this.modeT - i * 0.09) / 0.38, 0, 1));
      if (k <= 0) return;
      const hot = this.hover.kind === 'offer' && this.hover.i === i;
      const chosen = replace && this.pending === i;
      ctx.save();
      ctx.globalAlpha = clamp(k, 0, 1) * (replace && !chosen ? 0.35 : 1);
      const y = r.y + (1 - k) * 60 - (hot ? 3 : 0);
      if (hot || chosen) drawGlow(ctx, r.x + r.w / 2, y + r.h / 2, Math.max(r.w, r.h) * 0.75, hsl(def.hue, 90, 60), 0.3);
      const g = ctx.createLinearGradient(0, y, 0, y + r.h);
      g.addColorStop(0, hsl(def.hue, 42, 20)); g.addColorStop(1, hsl(def.hue, 48, 9));
      ctx.fillStyle = g; roundRect(ctx, r.x, y, r.w, r.h, 16); ctx.fill();
      ctx.strokeStyle = hsl(def.hue, 85, 64, hot || chosen ? 1 : 0.6); ctx.lineWidth = hot || chosen ? 2.5 : 1.5;
      roundRect(ctx, r.x + 1, y + 1, r.w - 2, r.h - 2, 15); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(ctx, r.x + 3, y + 3, r.w - 6, r.h * 0.34, 13); ctx.fill();
      ctx.textBaseline = 'middle';
      if (L.wide) {
        // Tall card: glyph medallion on top, text below.
        const m = Math.min(r.w * 0.34, r.h * 0.28), mx = r.x + r.w / 2, my = y + r.h * 0.26;
        drawGlow(ctx, mx, my, m * 1.5, hsl(def.hue, 90, 60), 0.35);
        ctx.fillStyle = hsl(def.hue, 60, 14); ctx.beginPath(); ctx.arc(mx, my, m * 0.72, 0, TAU); ctx.fill();
        ctx.strokeStyle = hsl(def.hue, 90, 70); ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = 'center';
        this.fit(ctx, def.glyph, m * 1.1, m * 0.62, 900); ctx.fillStyle = hsl(def.hue, 95, 78); ctx.fillText(def.glyph, mx, my + 1);
        this.fit(ctx, def.name, r.w - 24, clamp(r.h * 0.1, 15, 22), 900); ctx.fillStyle = '#fff'; ctx.fillText(def.name, mx, y + r.h * 0.52);
        const size = clamp(r.h * 0.062, 11.5, 15); ctx.font = `600 ${size}px ${FONT}`; ctx.fillStyle = '#c9d2e2';
        this.wrap(ctx, def.desc(def.initial), r.w - 30).slice(0, 4).forEach((line, li) => ctx.fillText(line, mx, y + r.h * 0.65 + li * size * 1.3));
        ctx.font = `800 ${clamp(r.h * 0.05, 9, 11)}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText(`PRESS ${i + 1}`, mx, y + r.h - 14);
      } else {
        // Wide row: glyph on the left, text on the right.
        const m = Math.min(r.h * 0.74, 64), mx = r.x + 12 + m / 2, my = y + r.h / 2;
        drawGlow(ctx, mx, my, m * 0.95, hsl(def.hue, 90, 60), 0.3);
        ctx.fillStyle = hsl(def.hue, 60, 14); ctx.beginPath(); ctx.arc(mx, my, m / 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = hsl(def.hue, 90, 70); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.textAlign = 'center';
        this.fit(ctx, def.glyph, m * 0.76, m * 0.42, 900); ctx.fillStyle = hsl(def.hue, 95, 78); ctx.fillText(def.glyph, mx, my + 1);
        ctx.textAlign = 'left';
        const tx = r.x + 12 + m + 12, tw = r.x + r.w - 12 - tx;
        const nameSize = clamp(r.h * 0.24, 12, 18), descSize = clamp(r.h * 0.17, 10, 13.5);
        ctx.font = `600 ${descSize}px ${FONT}`;
        const lines = this.wrap(ctx, def.desc(def.initial), tw).slice(0, r.h > 76 ? 3 : 2);
        const blockH = nameSize * 1.25 + lines.length * descSize * 1.25;
        let ly = y + (r.h - blockH) / 2 + nameSize * 0.6;
        ctx.font = `900 ${nameSize}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(def.name, tx, ly);
        ly += nameSize * 0.65 + descSize * 0.7;
        ctx.font = `600 ${descSize}px ${FONT}`; ctx.fillStyle = '#c9d2e2';
        for (const line of lines) { ctx.fillText(line, tx, ly); ly += descSize * 1.25; }
      }
      ctx.restore();
    });
    const r = L.skipBtn, hot = this.hover.kind === 'skip';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = hot ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'; roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, r.h / 2); ctx.stroke();
    ctx.font = `700 ${clamp(r.h * 0.42, 10, 14)}px ${FONT}`; ctx.fillStyle = '#c9d2e2';
    ctx.fillText(replace ? 'Keep my charms, skip' : 'Skip, take nothing', r.x + r.w / 2, r.y + r.h / 2 + 0.5);
  }

  private drawTooltip(ctx: CanvasRenderingContext2D) {
    const L = this.L, s = this.s;
    const i = this.pinned >= 0 ? this.pinned : this.hover.kind === 'charm' ? this.hover.i : -1;
    const charm = s.charms[i];
    if (!charm || this.anim) return;
    const def = charmDef(charm.id), slot = L.slots[i];
    const w = Math.min(L.cw, 300), size = 13;
    ctx.font = `600 ${size}px ${FONT}`;
    const lines = this.wrap(ctx, def.desc(charm.v), w - 28);
    const h = 40 + lines.length * size * 1.35;
    const x = clamp(slot.x + slot.w / 2 - w / 2, L.x0, L.x0 + L.cw - w);
    const y = slot.y + slot.h + 8 + h > L.H - 4 ? slot.y - h - 8 : slot.y + slot.h + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, x + 2, y + 5, w, h, 13); ctx.fill();
    ctx.fillStyle = hsl(def.hue, 40, 11); roundRect(ctx, x, y, w, h, 13); ctx.fill();
    ctx.strokeStyle = hsl(def.hue, 85, 64); ctx.lineWidth = 1.5; roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 13); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `900 15px ${FONT}`; ctx.fillStyle = hsl(def.hue, 95, 78); ctx.fillText(def.name, x + 14, y + 19);
    ctx.font = `600 ${size}px ${FONT}`; ctx.fillStyle = '#e4e9f2';
    lines.forEach((line, li) => ctx.fillText(line, x + 14, y + 40 + li * size * 1.35));
  }

  private drawHelp(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    ctx.fillStyle = 'rgba(4,7,12,0.88)'; ctx.fillRect(0, 0, L.W, L.H);
    const w = Math.min(L.W - 20, 460), h = Math.min(L.H - 20, 560);
    const x = (L.W - w) / 2, y = (L.H - h) / 2;
    ctx.fillStyle = '#0f1728'; roundRect(ctx, x, y, w, h, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(183,243,107,0.5)'; ctx.lineWidth = 1.5; roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 18); ctx.stroke();
    const rows = PATTERN_ORDER.length;
    const headH = clamp(h * 0.1, 34, 48);
    const fs = clamp(h * 0.026, 10, 12.5);
    const notes = [
      'Score = (hand chips + scoring tiles) × mult. Only tiles in the pattern score.',
      `PRIME: 3+ tiles, all 2 3 5 7 (gold P). +${PRIME_BONUS.chips} chips, +${PRIME_BONUS.mult} mult, every tile scores.`,
      `SPECTRUM: ${SPECTRUM_BONUS.min}+ tiles of one colour. +${SPECTRUM_BONUS.chips} chips, +${SPECTRUM_BONUS.mult} mult, every tile scores.`,
      'Keys: 1-8 pick, Enter play, D discard, C clear.',
    ];
    ctx.font = `600 ${fs}px ${FONT}`;
    const wrapped = notes.map((note) => this.wrap(ctx, note, w - 32));
    const footH = wrapped.reduce((sum, lines) => sum + lines.length * fs * 1.32 + fs * 0.3, 0) + fs * 1.6;
    const rowH = (h - headH - footH - 8) / rows;
    const size = clamp(rowH * 0.56, 10, 15);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.font = `900 ${clamp(headH * 0.42, 14, 19)}px ${FONT}`; ctx.fillStyle = ACCENT; ctx.fillText('HANDS', x + 16, y + headH / 2 + 2);
    ctx.textAlign = 'right'; ctx.font = `700 ${clamp(headH * 0.26, 9, 11)}px ${FONT}`; ctx.fillStyle = '#93a0b8'; ctx.fillText('CHIPS × MULT', x + w - 16, y + headH / 2 + 3);
    PATTERN_ORDER.slice().reverse().forEach((id, i) => {
      const p = PATTERNS[id], ry = y + headH + i * rowH + rowH / 2;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(x + 8, ry - rowH / 2, w - 16, rowH); }
      ctx.textAlign = 'left'; ctx.font = `800 ${size}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(p.name, x + 16, ry);
      ctx.font = `600 ${size * 0.9}px ${FONT}`; ctx.fillStyle = '#8f9bb3'; ctx.fillText(p.example, x + w * 0.4, ry);
      ctx.textAlign = 'right'; ctx.font = `800 ${size}px ${FONT}`;
      const multText = ` × ${p.mult}`;
      ctx.fillStyle = MULT; ctx.fillText(multText, x + w - 16, ry);
      ctx.fillStyle = CHIP; ctx.fillText(String(p.chips), x + w - 16 - ctx.measureText(multText).width, ry);
    });
    ctx.textAlign = 'left'; ctx.font = `600 ${fs}px ${FONT}`;
    let ly = y + h - footH + fs * 1.1;
    wrapped.forEach((lines, ni) => {
      ctx.fillStyle = ni === 1 || ni === 2 ? '#e9edf5' : '#aab4c8';
      for (const line of lines) { ctx.fillText(line, x + 16, ly); ly += fs * 1.32; }
      ly += fs * 0.3;
    });
  }

  render(ctx: CanvasRenderingContext2D) {
    const L = (this.L = this.layout());
    const s = this.s, flags = detectFlags(s.charms);
    this.drawBackground(ctx);
    this.drawBar(ctx);
    this.drawPanel(ctx);
    this.drawCharms(ctx);

    const shop = this.mode === 'shop' || this.mode === 'replace';
    if (shop) this.drawShop(ctx);

    // Tiles: hand first, then lifted and played ones on top.
    const order = [...this.vis.values()].filter((v) => v.delay <= 0).sort((a, b) => (this.sel.has(a.tile.id) ? 1 : 0) - (this.sel.has(b.tile.id) ? 1 : 0) || a.y - b.y || a.x - b.x);
    for (const g of this.ghosts) if (g.delay <= 0) this.drawTile(ctx, g, false, !!flags.oneIsPrime);
    // Selected tiles that are not part of the pattern get a dashed outline: they will not score.
    const preview = this.mode === 'play' ? this.currentPreview() : null;
    const scoringIds = new Set(preview ? preview.detected.scoring.map((i) => this.selected()[i]?.id) : []);
    for (const v of order) {
      const selected = this.sel.has(v.tile.id);
      this.drawTile(ctx, v, selected, !!flags.oneIsPrime, selected && !!preview && !scoringIds.has(v.tile.id));
    }

    if (!shop) {
      const can = this.mode === 'play';
      const n = this.sel.size;
      // Number hints under tiles when there is room help keyboard players.
      this.drawButton(ctx, L.helpBtn, '?', '', 'ghost', true, this.hover.kind === 'help');
      this.drawButton(ctx, L.discardBtn, 'DISCARD', `${s.discards} left`, 'ghost', can && n > 0 && s.discards > 0, this.hover.kind === 'discard');
      this.drawButton(ctx, L.playBtn, n > 0 ? `PLAY ${n}` : 'PLAY', `${s.plays} ${s.plays === 1 ? 'play' : 'plays'} left`, 'primary', can && n > 0 && s.plays > 0, this.hover.kind === 'play');
    }

    this.particles.render(ctx);
    this.floaters.render(ctx, FONT);
    this.drawTooltip(ctx);

    if (this.mode === 'lost' && this.modeT >= 0) {
      const k = easeOutCubic(clamp(this.modeT / 0.4, 0, 1));
      ctx.fillStyle = `rgba(20,4,8,${0.5 * k})`; ctx.fillRect(0, 0, L.W, L.H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const text = `${fmt(this.target - s.roundScore)} short`;
      this.fit(ctx, text, L.cw - 30, clamp(L.H * 0.08, 24, 54) * (0.8 + 0.2 * k), 900);
      ctx.globalAlpha = k; ctx.fillStyle = '#ff9d9d'; ctx.fillText(text, L.W / 2, L.lower.y + L.lower.h * 0.42); ctx.globalAlpha = 1;
    }
    if (this.help) this.drawHelp(ctx);
  }
}

const module: GameModule = {
  hintAt: 'top',
  realtime: false,
  bloom: 0.3,
  create: (host, saved) => new PrimeTime(host, saved),
};

export default module;
