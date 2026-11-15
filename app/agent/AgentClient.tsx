'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import GameShelf from '../games/GameShelf';
import { AGENT_TOKEN_KEY, readAgentToken, useAgentSync } from '../games/engine/useAgentSync';
import { getGame } from '../games/registry';
import { trackEvent } from '../lib/analytics';

const INSTALL = {
  codex: ['codex plugin marketplace add goodmeasurelabs/ineedadistraction', 'codex plugin add distraction@ineedadistraction', '# then open Codex and run /hooks once to review and trust the plugin hooks'],
  claude: ['/plugin marketplace add goodmeasurelabs/ineedadistraction', '/plugin install distraction@ineedadistraction'],
};

function Status() {
  const agent = useAgentSync();
  const label = agent.state === 'working' ? 'Your agent is working. Go play.'
    : agent.state === 'waiting' ? 'Your agent is waiting on you.'
    : agent.state === 'idle' ? 'Your agent is idle.'
    : 'Paired. Waiting for your agent’s first signal: send it a prompt.';
  return <p className={`pair-status pair-${agent.state}`} role="status"><i aria-hidden="true" />{label}</p>;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="pair-copy" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* select and copy by hand */ } }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function AgentClient() {
  // null = still checking (avoids flashing the install steps at paired visitors)
  const [paired, setPaired] = useState<boolean | null>(null);
  const [justPaired, setJustPaired] = useState(false);
  const [tab, setTab] = useState<'codex' | 'claude'>('codex');

  useEffect(() => {
    // The plugin opens /agent#t=<token>. The fragment never reaches the server.
    const match = window.location.hash.match(/^#t=([A-Za-z0-9_-]{20,64})(&popup)?$/);
    if (match) {
      // The plugin opens a chromeless window; browsers ignore its size flags
      // when already running, so shape it here to sit beside a terminal.
      if (match[2]) {
        try {
          const width = 460, height = Math.min(800, window.screen.availHeight);
          window.resizeTo(width, height);
          window.moveTo(window.screen.availWidth - width - 24, Math.max(0, (window.screen.availHeight - height) / 2));
        } catch { /* a normal tab ignores this */ }
      }
      try { localStorage.setItem(AGENT_TOKEN_KEY, match[1]); } catch { /* handled below */ }
      window.history.replaceState(null, '', window.location.pathname);
      trackEvent('agent_paired', {});
      let last: string | null = null;
      try { last = localStorage.getItem('inad:last-game'); } catch { /* optional */ }
      if (readAgentToken() && last && getGame(last)) { window.location.replace(`/games/${last}`); return; }
      setJustPaired(true);
    }
    setPaired(!!readAgentToken());
  }, []);

  function unpair() {
    try { localStorage.removeItem(AGENT_TOKEN_KEY); } catch { /* nothing stored */ }
    setPaired(false); setJustPaired(false);
  }

  return (
    <div className="pair-page">
      <header className="pair-nav">
        <Link href="/" className="pair-brand"><span aria-hidden="true">✳</span> i need a <strong>distraction.</strong></Link>
        <Link href="/" className="pair-link">All games</Link>
      </header>

      <main className="pair-main">
        <section className="pair-hero">
          <p className="pair-eyebrow">FOR CODEX AND CLAUDE CODE</p>
          <h1>Your agent works.<br /><em>You play.</em></h1>
          <p className="pair-lede">Send a prompt and a game opens beside your terminal. The moment your agent finishes, asks a question or needs a permission, the game pauses and tells you. Answer, and it picks up where you left off.</p>
          {paired && <Status />}
        </section>

        {paired ? (
          <section>
            <h2 className="pair-h2">{justPaired ? 'Paired. Pick your game.' : 'Pick your game.'}</h2>
            <GameShelf location="agent" />
            <p className="pair-foot">This browser is paired with your agent. <button onClick={unpair}>Unpair</button></p>
          </section>
        ) : paired === false ? (
          <>
            <section className="pair-steps">
              <div className="pair-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'codex'} onClick={() => setTab('codex')}>Codex</button>
                <button role="tab" aria-selected={tab === 'claude'} onClick={() => setTab('claude')}>Claude Code</button>
              </div>
              <ol>
                <li>
                  <strong>Install the plugin</strong>
                  <div className="pair-code"><pre>{INSTALL[tab].join('\n')}</pre><Copy text={INSTALL[tab].filter((line) => !line.startsWith('#')).join('\n')} /></div>
                </li>
                <li><strong>Send your agent any prompt.</strong> The arcade opens in your browser, already paired. Or ask it: <q>open my distraction</q>.</li>
                <li><strong>Play.</strong> When the agent needs you, the game pauses, the tab title flashes and a chime plays.</li>
              </ol>
            </section>

            <section className="pair-facts">
              <div><h3>Pauses on a dime</h3><p>Turn finished, question asked, permission needed: each one freezes the game with your run saved.</p></div>
              <div><h3>Private by design</h3><p>The plugin sends four things: working or waiting, a one-word reason, which agent, and a random pairing code. Never prompts, paths or code.</p></div>
              <div><h3>Easy to switch off</h3><p>Ask your agent to turn the distraction off, or stop it opening by itself. One file, no account.</p></div>
            </section>

            <section>
              <h2 className="pair-h2">Or just play now.</h2>
              <GameShelf location="agent" />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
