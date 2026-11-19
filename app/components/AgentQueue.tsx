'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentRunSnapshot } from '../lib/agentSession';
import { updateAgentQueue, useReturnToAgent, type AgentSync } from '../games/engine/useAgentSync';
import { trackEvent } from '../lib/analytics';

const NAMES: Record<string, string> = { codex: 'Codex', 'claude-code': 'Claude Code' };
const name = (run: AgentRunSnapshot) => NAMES[run.agent ?? ''] ?? 'Your agent';
const needsInput = (run: AgentRunSnapshot) => run.state === 'waiting' && (run.reason === 'question' || run.reason === 'permission');

function description(run: AgentRunSnapshot): string {
  if (run.statusUnconfirmed) return 'Earlier approval · Status unconfirmed';
  if (run.state === 'working') return 'Working';
  if (run.reason === 'permission') return 'Needs approval';
  if (run.reason === 'question') return 'Has a question';
  return 'Finished';
}

function returnLabel(run: AgentRunSnapshot): string {
  if (run.returnTarget === 'unavailable') return 'Return unavailable';
  if (run.returnTarget === 'app') return `Open ${name(run)} app`;
  return `Back to ${name(run)}`;
}

export default function AgentQueue({ agent, onStopDistractions, clipMode = false }: { agent: AgentSync; onStopDistractions?: () => void; clipMode?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { note, back, clear } = useReturnToAgent();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = agent.notice;
  const noticeKey = notice ? `${notice.run}:${notice.revision}` : '';
  const pending = agent.runs.filter((run) => needsInput(run) && !run.dismissed && !run.statusUnconfirmed);
  const earlier = agent.runs.filter((run) => needsInput(run) && !run.dismissed && run.statusUnconfirmed);
  const working = agent.runs.filter((run) => run.state === 'working');
  const recent = agent.runs.filter((run) => run.state === 'idle' && run.reason === 'done');
  const rows = [...pending, ...working, ...earlier, ...recent];
  const followed = agent.runs.find((run) => run.run === agent.foregroundRun);

  useEffect(() => {
    if (noticeKey) clear();
    setError('');
    if (noticeKey) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [noticeKey, clear]);

  async function action(kind: 'ack' | 'dismiss' | 'clear', run?: AgentRunSnapshot) {
    clear();
    setBusy(true);
    setError('');
    try {
      if (kind === 'clear') {
        const items = pending.map(({ run, revision }) => ({ run, revision }));
        for (let offset = 0; offset < items.length; offset += 100) {
          await updateAgentQueue('clear', undefined, items.slice(offset, offset + 100));
        }
      } else {
        await updateAgentQueue(kind, run);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the queue.');
    } finally { setBusy(false); }
  }

  async function returnTo(run: AgentRunSnapshot) {
    setBusy(true);
    setError('');
    trackEvent('agent_return_click', { location: 'queue', agent: run.agent ?? 'agent' });
    try {
      // Keep clips paused while the user switches to their agent to answer.
      // Its next working report clears the notice and resumes playback.
      if (await back(run) && !clipMode) await updateAgentQueue('ack', run);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the queue.');
    } finally { setBusy(false); }
  }

  if (!agent.paired) return null;

  const workingNames = [...new Set(working.map(name))];
  const workingStatus = clipMode
    ? `${workingNames.join(' and ')} ${workingNames.length === 1 ? 'is' : 'are'} working`
    : `${working.length} ${working.length === 1 ? 'agent is' : 'agents are'} working`;
  const status = pending.length
    ? `${pending.length} ${pending.length === 1 ? 'agent needs' : 'agents need'} your input`
    : working.length
      ? workingStatus
      : earlier.length ? `${earlier.length} earlier ${earlier.length === 1 ? 'request' : 'requests'}` : 'No agents need your input';

  return (
    <section className="agent-queue" aria-label="Your agents">
      <details>
        <summary>
          <span className={pending.length ? 'agent-queue-dot pending' : 'agent-queue-dot'} />
          <span>{status}</span>
          <span className="agent-queue-expand">Chats {rows.length ? `(${rows.length})` : ''}</span>
        </summary>
        <div className="agent-queue-list">
          {pending.length > 0 && <button disabled={busy} className="agent-queue-clear" onClick={() => void action('clear')}>Clear input queue</button>}
          {rows.length === 0 && <p>Send a prompt to start a break.</p>}
          {rows.map((run) => (
            <article key={run.run} className="agent-queue-row">
              <div>
                <strong>{name(run)} <small>· {run.run.slice(-6)}</small></strong>
                <p>{description(run)}{run.run === agent.foregroundRun && run.state === 'working' ? ' · Following this turn' : ''}</p>
                <time dateTime={new Date(run.updatedAt).toISOString()}>{new Date(run.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
              </div>
              <div className="agent-queue-actions">
                {run.returnTarget === 'unavailable'
                  ? <span className="agent-queue-manual">Open {name(run)} manually</span>
                  : <button disabled={busy} onClick={() => void returnTo(run)}>{returnLabel(run)}</button>}
                {needsInput(run) && <button disabled={busy} onClick={() => void action('dismiss', run)}>Clear</button>}
              </div>
            </article>
          ))}
          {pending.length > 0 && <p className="agent-queue-help">Clearing removes the request from Distraction. You can still answer it in your agent.</p>}
          {earlier.length > 0 && <p className="agent-queue-help">These earlier approvals have not been confirmed as active. Check them in your agent, or clear them here.</p>}
        </div>
      </details>
      {followed?.state === 'working' && pending.length > 0 && <p className="agent-queue-following">Following {name(followed)} · {followed.run.slice(-6)}</p>}
      {(error || note) && !notice && <p role="status" className="agent-queue-feedback">{error || note}</p>}
      <dialog ref={dialog} className="agent-notice" aria-labelledby="agent-notice-title" onCancel={(event) => {
        event.preventDefault();
        if (notice && !busy) void action('ack', notice);
      }}>
        {notice && <div className="agent-notice-content">
          <p className="agent-notice-label">{needsInput(notice) ? 'YOUR INPUT IS NEEDED' : 'YOUR AGENT IS DONE'}</p>
          <h2 id="agent-notice-title">{name(notice)} {notice.reason === 'permission' ? 'needs approval.' : notice.reason === 'question' ? 'has a question.' : 'finished.'}</h2>
          <p>Chat {notice.run.slice(-6)}</p>
          {notice.returnTarget === 'unavailable'
            ? <p>Open {name(notice)} manually to review this {needsInput(notice) ? 'request' : 'result'}.</p>
            : <button className="agent-notice-primary" autoFocus disabled={busy} onClick={() => void returnTo(notice)}>{returnLabel(notice)}</button>}
          <button disabled={busy} onClick={() => void action('ack', notice)}>{clipMode ? 'Back to clips' : 'Resume this game'}</button>
          {onStopDistractions && <button onClick={onStopDistractions}>Stop distracting</button>}
          {needsInput(notice) && <button disabled={busy} onClick={() => void action('dismiss', notice)}>Clear this request</button>}
          {(error || note) && <p role="status">{error || note}</p>}
        </div>}
      </dialog>
    </section>
  );
}
