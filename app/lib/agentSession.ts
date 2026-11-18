// Shared types and validation for Agent Mode (the Codex / Claude Code plugin).
export const AGENT_STATES = ['working', 'waiting', 'idle'] as const;
export type AgentState = typeof AGENT_STATES[number];

export const AGENT_REASONS = ['prompt', 'done', 'permission', 'question', 'end', 'start'] as const;
export type AgentReason = typeof AGENT_REASONS[number];

export const AGENT_RETURN_TARGETS = ['chat', 'pane', 'app', 'unavailable'] as const;
export type AgentReturnTarget = typeof AGENT_RETURN_TARGETS[number];

export type AgentRunSnapshot = {
  run: string;
  state: AgentState;
  reason: AgentReason | null;
  agent: string | null;
  revision: number;
  updatedAt: number;
  promptAt: number;
  acknowledged: boolean;
  dismissed: boolean;
  returnTarget: AgentReturnTarget;
};

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
  focusAt: number; // epoch ms the game last asked to go back to the terminal (0 if never)
  focusRun: string | null; // the agent session that request was for
  foregroundRun: string | null; // the session with the latest submitted prompt
  notice: AgentRunSnapshot | null;
  runs: AgentRunSnapshot[];
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

export function cleanReturnTarget(value: unknown): AgentReturnTarget | null {
  return typeof value === 'string' && (AGENT_RETURN_TARGETS as readonly string[]).includes(value) ? value as AgentReturnTarget : null;
}

// A tab counts as attached if it polled within this window.
export const ATTACHED_WINDOW_MS = 45_000;

// Several agents can share one pairing token; each reports under its own id.
export function cleanRunId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'default';
  return String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
}

export type AgentEventKey = { run: string; revision: number };

export function readAgentEventKey(value: unknown): AgentEventKey | null {
  if (value === null || typeof value !== 'object') return null;
  const { run, revision } = value as Record<string, unknown>;
  if (typeof run !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(run)) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision > 2_147_483_647) return null;
  return { run, revision };
}

// Abandoned working sessions eventually stop counting. Explicit requests for
// input remain queued until the agent or player clears them.
export const RUN_STALE_MS = 12 * 60 * 60 * 1000;
export const RUN_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_RETURN_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

type RunRow = {
  run: string;
  state: string;
  reason: string | null;
  agent: string | null;
  revision: number;
  updatedAt: Date;
  eventId: string | null;
  eventAt: Date | null;
  promptAt: Date | null;
  acknowledged: boolean;
  dismissed: boolean;
  returnTarget: string | null;
};

export function isAgentBlocker(run: Pick<RunRow, 'state' | 'reason'>): boolean {
  return run.state === 'waiting' && (run.reason === 'permission' || run.reason === 'question');
}

function isAgentCompletion(run: Pick<AgentRunSnapshot, 'state' | 'reason'>): boolean {
  return run.state === 'idle' && run.reason === 'done';
}

export function buildAgentQueue(rows: RunRow[], now: number): Pick<
  AgentSnapshot, 'state' | 'reason' | 'agent' | 'working' | 'waiting' | 'foregroundRun' | 'notice' | 'runs'
> {
  const runs: AgentRunSnapshot[] = [];
  let foreground: AgentRunSnapshot | undefined;
  for (const row of rows) {
    const updatedAt = row.updatedAt.getTime();
    const reason = cleanReason(row.reason);
    // Legacy plugins report a finished turn as waiting/done.
    const state = reason === 'done' ? 'idle' : isAgentState(row.state) ? row.state : 'idle';
    const age = now - updatedAt;
    const persistent = isAgentBlocker({ state, reason }) && !row.dismissed;
    if (!persistent && age >= (state === 'working' ? RUN_STALE_MS : RUN_HISTORY_MS)) continue;
    const reportedTarget = cleanReturnTarget(row.returnTarget) ?? (age < LEGACY_RETURN_MS ? 'app' : 'unavailable');
    const run: AgentRunSnapshot = {
      run: row.run, state, reason, agent: row.agent, updatedAt, revision: row.revision,
      promptAt: row.promptAt?.getTime() ?? 0, acknowledged: row.acknowledged, dismissed: row.dismissed,
      returnTarget: age < RUN_HISTORY_MS ? reportedTarget : 'unavailable',
    };
    // A closed foreground stays selected until a fresh prompt. A background
    // session finishing after it closes must not steal the foreground.
    if (run.promptAt > 0 && (!foreground || run.promptAt > foreground.promptAt ||
        (run.promptAt === foreground.promptAt && run.run > foreground.run))) foreground = run;
    if (state === 'working' || isAgentBlocker(run) || isAgentCompletion(run)) runs.push(run);
  }

  runs.sort((a, b) => b.revision - a.revision || b.updatedAt - a.updatedAt);
  const working = runs.filter((run) => run.state === 'working');
  const blockers = runs.filter((run) => isAgentBlocker(run) && !run.dismissed);
  const notice = runs.find((run) => !run.acknowledged && !run.dismissed && now - run.updatedAt < RUN_HISTORY_MS &&
    (isAgentBlocker(run) || (run === foreground && isAgentCompletion(run)))) ?? null;
  const lead = blockers[0] ?? working[0] ?? (foreground && isAgentCompletion(foreground) ? foreground : undefined);
  return {
    state: lead?.state ?? 'idle', reason: lead?.reason ?? null, agent: lead?.agent ?? null,
    working: working.length, waiting: blockers.length, foregroundRun: foreground?.run ?? null, notice, runs,
  };
}

export type AgentReport = {
  state: AgentState;
  reason: AgentReason | null;
  agent: string | null;
  eventId: string | null;
  eventAt: Date | null;
  promptAt: Date | null;
  returnTarget: AgentReturnTarget | null;
};

export function readAgentReport(input: Record<string, unknown>, now: number): AgentReport | null {
  if (!isAgentState(input.state)) return null;
  const reason = cleanReason(input.reason);
  const eventAt = input.eventAt;
  const eventId = input.eventId;
  const versioned = eventId !== undefined || eventAt !== undefined;
  if (versioned && (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(eventId) ||
      typeof eventAt !== 'number' || !Number.isSafeInteger(eventAt) || eventAt <= 0 || eventAt > now + CLOCK_SKEW_MS)) return null;
  const promptAt = input.promptAt;
  if (promptAt !== undefined && (typeof promptAt !== 'number' || !Number.isSafeInteger(promptAt) ||
      promptAt < 0 || promptAt > (typeof eventAt === 'number' ? eventAt : now + CLOCK_SKEW_MS))) return null;
  const state = reason === 'done' ? 'idle' : input.state;
  return {
    state, reason: state === 'idle' && reason !== 'done' ? 'end' : reason,
    agent: cleanAgentLabel(input.agent), returnTarget: cleanReturnTarget(input.returnTarget),
    eventId: typeof eventId === 'string' ? eventId : null,
    eventAt: typeof eventAt === 'number' ? new Date(eventAt) : null,
    promptAt: typeof promptAt === 'number' && promptAt > 0 ? new Date(promptAt) : null,
  };
}

export function applyAgentReport(
  previous: RunRow | null,
  report: AgentReport,
  updatedAt: Date,
  revision: number,
): Omit<RunRow, 'run'> | null {
  if (report.eventAt && updatedAt.getTime() - report.eventAt.getTime() >=
      (report.state === 'idle' ? RUN_HISTORY_MS : RUN_STALE_MS)) return null;
  if (previous && (
    (report.eventId !== null && report.eventId === previous.eventId) ||
    (previous.eventAt && (!report.eventAt || report.eventAt <= previous.eventAt)) ||
    (!report.eventId && report.state === previous.state && report.reason === previous.reason)
  )) return null;

  if (previous?.state === 'idle' && previous.reason === 'done' && report.reason === 'end') {
    // Closing the app leaves recently completed chats in history. Record the
    // end's ordering metadata so a delayed report can't revive this session.
    const { run: _run, ...retained } = previous;
    return report.eventId ? { ...retained, eventId: report.eventId, eventAt: report.eventAt } : null;
  }

  const priorPrompt = previous?.promptAt ?? null;
  const incomingPrompt = report.promptAt ?? (report.state === 'working' && report.reason === 'prompt' ? updatedAt : null);
  const promptAt = incomingPrompt && (!priorPrompt || incomingPrompt > priorPrompt) ? incomingPrompt : priorPrompt;
  return {
    ...report, agent: report.agent ?? previous?.agent ?? null, updatedAt, revision, promptAt,
    acknowledged: false, dismissed: false, returnTarget: report.returnTarget ?? previous?.returnTarget ?? null,
  };
}
