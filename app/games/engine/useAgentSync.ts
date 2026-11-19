'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunSnapshot, AgentSnapshot } from '../../lib/agentSession';
import { readAgentToken } from '../../arcade/popupSession';

// Agent Mode on the page side: once this browser is paired with a coding agent
// (Codex / Claude Code plugin), long-poll the agent's state so the stage can
// pause the moment the agent needs its human.

export { AGENT_TOKEN_KEY, readAgentToken } from '../../arcade/popupSession';

export type AgentSync = {
  paired: boolean;
  /** The plugin has reported an agent session and its queue is reachable. */
  connected: boolean;
  /** 'unpaired' until the plugin has reported at least once. */
  state: 'working' | 'waiting' | 'idle' | 'unpaired';
  reason: string | null;
  agent: string | null;
  /** Local time (ms) when the current state was first seen by this tab. */
  since: number;
  /** How many agent sessions are busy, and how many are blocked on the user. */
  working: number;
  waiting: number;
  /** Server time an agent last started waiting; rises for each new one. */
  waitedAt: number;
  /** Bumps on every state report, so effects can react to repeats. */
  seq: number;
  runs: AgentRunSnapshot[];
  foregroundRun: string | null;
  notice: AgentRunSnapshot | null;
};

const INITIAL: AgentSync = { paired: false, connected: false, state: 'unpaired', reason: null, agent: null, working: 0, waiting: 0, waitedAt: 0, since: 0, seq: 0, runs: [], foregroundRun: null, notice: null };

const QUEUE_UPDATED = 'inad:agent-queue-updated';
type QueueTarget = Pick<AgentRunSnapshot, 'run' | 'revision'>;
type AgentPollSnapshot = Omit<AgentSnapshot, 'state'> & { state: AgentSnapshot['state'] | 'unpaired' };

export async function updateAgentQueue(
  action: 'ack' | 'dismiss' | 'focus' | 'clear',
  target?: QueueTarget,
  items?: QueueTarget[],
): Promise<void> {
  const token = readAgentToken();
  if (!token) throw new Error('This browser needs to be paired again.');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/agent/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...target, ...(items ? { items } : {}) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 409) throw new Error('That chat changed. Try its updated entry.');
      throw new Error('Could not reach your agent. Please try again.');
    }
    // Receiving headers does not guarantee the body will finish. Keep the
    // deadline active until the snapshot is ready to release the queue UI.
    const snapshot: AgentSnapshot = await response.json();
    window.dispatchEvent(new CustomEvent(QUEUE_UPDATED, { detail: snapshot }));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Could not confirm that request in time. It may still have reached your agent. Try again or open your agent directly.');
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

export function useReturnToAgent() {
  const [note, setNote] = useState('');
  const timer = useRef(0);
  const clear = useCallback(() => { window.clearTimeout(timer.current); setNote(''); }, []);
  useEffect(() => {
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('blur', clear); window.clearTimeout(timer.current); };
  }, [clear]);
  const back = useCallback(async (target: QueueTarget) => {
    window.clearTimeout(timer.current);
    setNote('Opening your agent…');
    try {
      await updateAgentQueue('focus', target);
      timer.current = window.setTimeout(() => {
        setNote(document.hasFocus() ? 'Still here? Open your agent manually. Its return connection may have ended.' : '');
      }, 5000);
      return true;
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not open your agent.');
      return false;
    }
  }, []);
  return { note, back, clear };
}

export async function readAgentSnapshot(token: string, sequence: number, lifetime: AbortSignal): Promise<AgentPollSnapshot> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime.aborted) abort();
  else lifetime.addEventListener('abort', abort, { once: true });
  // The server normally holds a poll for 20 seconds. Allow that interval while bounding
  // stalled connections and response bodies so polling can always recover.
  const deadline = setTimeout(abort, 30_000);
  try {
    const query = sequence >= 0 ? `?seq=${sequence}` : '';
    const response = await fetch(`/api/agent/${token}${query}`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } finally {
    clearTimeout(deadline);
    lifetime.removeEventListener('abort', abort);
  }
}

export function useAgentSync(enabled = true): AgentSync {
  const [sync, setSync] = useState<AgentSync>(INITIAL);
  const seqRef = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    const token = readAgentToken();
    if (!token) return;
    let alive = true;
    const controller = new AbortController();
    setSync((s) => ({ ...s, paired: true }));

    const accept = (data: AgentPollSnapshot) => {
      if (!alive || (data.state !== 'unpaired' && data.seq < seqRef.current)) return;
      seqRef.current = data.state === 'unpaired' ? -1 : data.seq;
      setSync((prev) => ({
        paired: true, connected: data.state !== 'unpaired', state: data.state, reason: data.reason ?? null, agent: data.agent ?? null,
        working: Number(data.working) || 0, waiting: Number(data.waiting) || 0,
        waitedAt: Number(data.waitedAt) || 0, seq: data.seq,
        since: prev.state === data.state ? prev.since : Date.now(),
        runs: data.runs ?? [], foregroundRun: data.foregroundRun ?? null, notice: data.notice ?? null,
      }));
    };
    const onUpdate = (event: Event) => accept((event as CustomEvent<AgentSnapshot>).detail);
    window.addEventListener(QUEUE_UPDATED, onUpdate);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      while (alive) {
        try {
          const sequence = seqRef.current;
          const data = await readAgentSnapshot(token, sequence, controller.signal);
          if (!alive) return;
          // An action may have delivered a newer, live queue while this poll was in flight.
          if (data.state === 'unpaired' && seqRef.current !== sequence) continue;
          accept(data);
          // Nothing reported yet: the first poll returns straight away, so wait before asking again.
          if (data.state === 'unpaired') await sleep(2500);
        } catch {
          if (!alive) return;
          setSync((previous) => previous.connected ? { ...previous, connected: false } : previous);
          await sleep(3000);
        }
      }
    })();

    return () => { alive = false; controller.abort(); window.removeEventListener(QUEUE_UPDATED, onUpdate); };
  }, [enabled]);

  return sync;
}
