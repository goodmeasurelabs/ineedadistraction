import type { Sfx } from './sfx';

// The contract every first-party game implements. Games are plain TypeScript
// (no React): the stage owns the canvas, the frame loop, pausing, bloom, shake,
// scoring UI and Agent Mode, so a game only has to simulate and draw.

export type PointerEventLite = { type: 'down' | 'move' | 'up' | 'leave'; x: number; y: number };

export type RunResult = {
  score: number;
  // One short line shown above the score on the result card, e.g. "Board full".
  headline?: string;
  // Optional extra line, e.g. "Longest chain 14".
  detail?: string;
};

export interface GameHost {
  /** Logical size in CSS pixels. Changes on resize; read it every frame. */
  readonly w: number;
  readonly h: number;
  readonly sfx: Sfx;
  /** Seeded random in [0, 1). Use this, not Math.random, for anything that affects play. */
  readonly rng: () => number;
  readonly reducedMotion: boolean;
  /** Best score on this device before this run started. */
  readonly best: number;
  /** True when this run uses the shared daily seed. */
  readonly daily: boolean;
  setScore(score: number): void;
  /** Small status chip next to the score, e.g. "Shot 3 / 10". Pass '' to clear. */
  setStatus(text: string): void;
  /** Persist resumable state (JSON-serializable). Call after every committed move. */
  save(state: unknown): void;
  /** Ends the run and shows the result card. Clears any saved state. */
  endRun(result: RunResult): void;
  /** Screen shake in pixels; decays on its own. Ignored when reduced motion is on. */
  shake(pixels: number): void;
  /** Freeze the simulation for a few milliseconds to sell an impact. */
  hitStop(ms: number): void;
}

export interface Game {
  /** Advance the simulation. dt is seconds, clamped. Not called while paused or in hit-stop. */
  update(dt: number): void;
  /** Draw one frame. The context is already scaled to CSS pixels; clear and fill it yourself. t is game seconds. */
  render(ctx: CanvasRenderingContext2D, t: number): void;
  pointer?(event: PointerEventLite): void;
  key?(code: string, down: boolean): void;
  resize?(w: number, h: number): void;
  destroy?(): void;
}

export interface GameModule {
  create(host: GameHost, saved: unknown | null): Game;
  /** Real-time games pause on window blur and resume with a short countdown. */
  realtime: boolean;
  /** Where the first-run hint pill sits. Use 'top' when controls live at the bottom. Defaults to 'bottom'. */
  hintAt?: 'top' | 'bottom';
  /** Bloom strength, 0 to 1. Defaults to 0.5. */
  bloom?: number;
}
