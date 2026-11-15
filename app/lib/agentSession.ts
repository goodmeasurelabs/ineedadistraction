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
