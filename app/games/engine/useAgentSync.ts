'use client';

import { useEffect, useRef, useState } from 'react';

// Agent Mode on the page side: once this browser is paired with a coding agent
// (Codex / Claude Code plugin), long-poll the agent's state so the stage can
// pause the moment the agent needs its human.

export const AGENT_TOKEN_KEY = 'inad:agent-token';

export type AgentSync = {
  paired: boolean;
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
};

const INITIAL: AgentSync = { paired: false, state: 'unpaired', reason: null, agent: null, working: 0, waiting: 0, waitedAt: 0, since: 0, seq: 0 };

export function readAgentToken(): string | null {
  try {
    const token = localStorage.getItem(AGENT_TOKEN_KEY);
    return token && /^[A-Za-z0-9_-]{20,64}$/.test(token) ? token : null;
  } catch { return null; }
}

// Ask the plugin to bring the waiting agent's terminal to the front. The page
// cannot switch apps itself: the request goes through the server to the plugin,
// which listens while its agent waits. False if the request could not be sent.
export async function requestTerminalFocus(): Promise<boolean> {
  const token = readAgentToken();
  if (!token) return false;
  try {
    const response = await fetch(`/api/agent/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'focus' }),
    });
    return response.ok;
  } catch { return false; }
}

export function useAgentSync(): AgentSync {
  const [sync, setSync] = useState<AgentSync>(INITIAL);
  const seqRef = useRef(-1);

  useEffect(() => {
    const token = readAgentToken();
    if (!token) return;
    let alive = true;
    const controller = new AbortController();
    setSync((s) => ({ ...s, paired: true }));

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      while (alive) {
        try {
          const query = seqRef.current >= 0 ? `?seq=${seqRef.current}` : '';
          const response = await fetch(`/api/agent/${token}${query}`, { signal: controller.signal, cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          const data = await response.json();
          if (!alive) return;
          if (data.seq !== seqRef.current) {
            seqRef.current = data.seq;
            // Keep the working clock running while other sessions come and go.
            setSync((prev) => ({
              paired: true, state: data.state, reason: data.reason ?? null, agent: data.agent ?? null,
              working: Number(data.working) || 0, waiting: Number(data.waiting) || 0, waitedAt: Number(data.waitedAt) || 0,
              since: prev.state === data.state ? prev.since : Date.now(), seq: data.seq,
            }));
          }
          // Nothing reported yet: the first poll returns straight away, so wait before asking again.
          if (data.state === 'unpaired') await sleep(2500);
        } catch {
          if (!alive) return;
          await sleep(3000);
        }
      }
    })();

    return () => { alive = false; controller.abort(); };
  }, []);

  return sync;
}
