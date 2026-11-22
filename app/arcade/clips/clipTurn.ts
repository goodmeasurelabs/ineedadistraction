import type { AgentRunSnapshot, AgentSnapshot } from '../../lib/agentSession';

export type ClipTurn = Pick<AgentRunSnapshot, 'run' | 'promptAt' | 'revision' | 'state' | 'reason'>;

/** A local Play click applies only to the currently followed agent report. */
export function clipPlaybackForQueue(
  queue: Pick<AgentSnapshot, 'runs' | 'foregroundRun' | 'notice'>,
  manualScope: string | null,
) {
  const foreground = queue.runs.find((run) => run.run === queue.foregroundRun);
  // A closed chat can still be the foreground after its row leaves the queue.
  const scope = `${queue.foregroundRun ?? ''}:${foreground?.revision ?? ''}`;
  const allowed = !queue.notice && (foreground?.state === 'working' || manualScope === scope);
  return { foreground, scope, allowed };
}

/** The foreground prompt selects a clip; answering its question continues that clip. */
export function trackClipTurn(previous: ClipTurn | undefined, foreground?: ClipTurn): { turn: ClipTurn | undefined; rotate: boolean } {
  if (!foreground || foreground.promptAt <= 0) return { turn: previous, rotate: false };
  if (!previous) return { turn: foreground, rotate: false };

  // Queue revisions order reports. Foreground selection orders prompts by time,
  // then by chat ID when two chats submit prompts in the same millisecond.
  if (foreground.revision <= previous.revision || foreground.promptAt < previous.promptAt ||
      (foreground.promptAt === previous.promptAt && foreground.run < previous.run)) {
    return { turn: previous, rotate: false };
  }

  const sameChat = foreground.run === previous.run;
  const newPrompt = !sameChat || foreground.promptAt > previous.promptAt;
  const answering = foreground.state === 'working' && sameChat && previous.state === 'waiting' &&
    (previous.reason === 'question' || previous.reason === 'permission');
  // A quick question can be the first snapshot of a new turn. Select its clip
  // while playback is held, so the answer can resume that selection.
  return { turn: foreground, rotate: foreground.state !== 'idle' && newPrompt && !answering };
}
