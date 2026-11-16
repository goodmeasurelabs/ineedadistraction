'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAgentSync, useReturnToAgent } from '../games/engine/useAgentSync';
import { trackEvent } from '../lib/analytics';

// Agent Mode outside the arcade games. A browser paired with the coding-agent
// plugin shows the agent's status on every page, and when the agent needs its
// human, a button that brings the terminal back to the front. The arcade games
// (/games/<slug>) have their own bar and pause overlay, so this stays out of
// their way.

const AGENT_NAMES: Record<string, string> = { codex: 'Codex', 'claude-code': 'Claude Code' };

export default function AgentBanner() {
  const pathname = usePathname();
  if (/^\/games\/[^/]+\/?$/.test(pathname ?? '')) return null;
  return <Banner />;
}

function Banner() {
  const agent = useAgentSync();
  const { note, back: returnToAgent, clear } = useReturnToAgent();
  useEffect(() => { if (agent.state !== 'waiting') clear(); }, [agent.state, clear]);

  if (!agent.paired || (agent.state !== 'waiting' && agent.state !== 'working')) return null;

  const name = AGENT_NAMES[agent.agent ?? ''] ?? 'Your agent';
  const several = agent.working + agent.waiting > 1;
  const line = agent.state === 'working'
    ? (several ? `${agent.working} agents working. Play on.` : `${name} is working. Play on.`)
    : agent.waiting > 1 ? `${agent.waiting} agents need you.`
    : agent.reason === 'permission' ? `${name} is asking for permission.`
    : agent.reason === 'question' ? `${name} has a question for you.`
    : `${name} finished its turn.`;

  function back() {
    trackEvent('agent_return_click', { location: 'banner' });
    void returnToAgent();
  }

  return (
    <div className={`agent-banner agent-banner-${agent.state}`} role="status">
      <i aria-hidden="true" />
      <span>{note || line}</span>
      {agent.state === 'waiting' && <button onClick={back}>Back to {name}</button>}
    </div>
  );
}
