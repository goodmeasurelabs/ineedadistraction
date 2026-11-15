// Shared types and validation for Agent Mode (the Codex / Claude Code plugin).
export const AGENT_STATES = ['working', 'waiting', 'idle'] as const;
export type AgentState = typeof AGENT_STATES[number];

export const AGENT_REASONS = ['prompt', 'done', 'permission', 'question', 'end', 'start'] as const;
export type AgentReason = typeof AGENT_REASONS[number];

export type AgentSnapshot = {
  state: AgentState;
  reason: AgentReason | null;
  agent: string | null;
  seq: number;
  updatedAt: number; // epoch ms
  attached: boolean; // an arcade tab polled recently
  working: number; // agent sessions busy right now
  waiting: number; // agent sessions blocked on the user
  waitedAt: number; // epoch ms an agent last started waiting (0 if never)
};

// Tokens are generated on the user's machine. Long enough to be unguessable,
// restricted to URL-safe characters so they can sit in a path segment.
export function isAgentToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

export function cleanReason(value: unknown): AgentReason | null {
  return typeof value === 'string' && (AGENT_REASONS as readonly string[]).includes(value) ? (value as AgentReason) : null;
}

export function cleanAgentLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return label || null;
}

// A tab counts as attached if it polled within this window.
export const ATTACHED_WINDOW_MS = 45_000;

// Several agents can share one pairing token; each reports under its own id.
export function cleanRunId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'default';
  return String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
}

// A session that never said goodbye (crash, closed laptop) stops counting.
export const RUN_STALE_MS = 12 * 60 * 60 * 1000;

type RunLike = { state: string; reason: string | null; agent: string | null; updatedAt: Date };

// What the game should react to: anyone blocked on the user wins (newest
// first), otherwise anyone still working, otherwise idle.
export function rollUp(runs: RunLike[]): { state: AgentState; reason: string | null; agent: string | null; working: number; waiting: number } {
  const newest = (state: string) => runs.filter((r) => r.state === state).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const waiting = newest('waiting'), working = newest('working');
  const lead = waiting[0] ?? working[0];
  return { state: waiting.length ? 'waiting' : working.length ? 'working' : 'idle', reason: lead?.reason ?? null, agent: lead?.agent ?? null, working: working.length, waiting: waiting.length };
}
