import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentReport, buildAgentQueue, cleanRunId, readAgentEventKey, readAgentReport, RUN_HISTORY_MS, RUN_STALE_MS } from '../app/lib/agentSession';

type Run = Parameters<typeof buildAgentQueue>[0][number];
const now = Date.UTC(2026, 10, 18, 20, 0);

function run(name: string, state: string, reason: string, revision: number, details: Partial<Run> = {}): Run {
  return {
    run: name, state, reason, revision, agent: 'codex', updatedAt: new Date(now - 200 + revision),
    promptAt: null, eventId: null, eventAt: null, acknowledged: false, dismissed: false, returnTarget: 'chat',
    ...details,
  };
}

test('new work preserves genuine earlier blockers and legacy completions do not count', () => {
  const rows = [
    run('codex', 'working', 'prompt', 5, { promptAt: new Date(now - 100) }),
    run('claude', 'waiting', 'permission', 2, { agent: 'claude-code' }),
    run('finished', 'waiting', 'done', 4),
  ];
  const queue = buildAgentQueue(rows, now);
  assert.equal(queue.waiting, 1);
  assert.equal(queue.working, 1);
  assert.equal(queue.foregroundRun, 'codex');
  assert.equal(queue.notice?.run, 'claude');
  assert.equal(queue.runs.find((item) => item.run === 'finished')?.state, 'idle');
});

test('only completion of the followed turn gets a notice, even with an older blocker', () => {
  const rows = [
    run('older-turn', 'idle', 'done', 5, { promptAt: new Date(now - 200) }),
    run('newer-turn', 'idle', 'done', 4, { promptAt: new Date(now - 100) }),
    run('waiting', 'waiting', 'question', 3),
  ];
  const queue = buildAgentQueue(rows, now);
  assert.equal(queue.notice?.run, 'newer-turn');
  assert.equal(queue.notice?.reason, 'done');
  assert.equal(queue.waiting, 1);
  assert.equal(queue.working, 0);
  assert.equal(queue.state, 'waiting');
  assert.equal(buildAgentQueue([rows[0], rows[1]], now).state, 'idle');
});

test('already acknowledged questions remain in the queue without asking to interrupt again', () => {
  const rows = [
    run('acknowledged', 'waiting', 'question', 1, { acknowledged: true }),
    run('dismissed', 'waiting', 'permission', 2, { acknowledged: true, dismissed: true }),
    run('finished', 'idle', 'done', 3, { promptAt: new Date(now - 100), acknowledged: true, dismissed: true }),
  ];
  const queue = buildAgentQueue(rows, now);
  assert.equal(queue.notice, null);
  assert.equal(queue.waiting, 1);
  assert.equal(queue.runs.find((item) => item.run === 'finished')?.returnTarget, 'chat');
});

test('working runs expire independently and old requests remain clearable without a return target', () => {
  const rows = [
    run('old-request', 'waiting', 'permission', 1, { updatedAt: new Date(now - RUN_HISTORY_MS) }),
    run('stale-finished', 'idle', 'done', 2, { updatedAt: new Date(now - RUN_HISTORY_MS) }),
    run('recent-finished', 'idle', 'done', 3, { updatedAt: new Date(now - RUN_STALE_MS) }),
    run('legacy-finished', 'idle', 'done', 4, { updatedAt: new Date(now - RUN_STALE_MS), returnTarget: null }),
    run('active', 'working', 'prompt', 5),
    run('stale-active', 'working', 'prompt', 6, { updatedAt: new Date(now - RUN_STALE_MS) }),
    run('dismissed-request', 'waiting', 'question', 7, { updatedAt: new Date(now - RUN_HISTORY_MS), dismissed: true }),
  ];
  const queue = buildAgentQueue(rows, now);
  assert.equal(queue.waiting, 1);
  assert.equal(queue.working, 1);
  assert.equal(queue.notice, null);
  assert.deepEqual(queue.runs.map((item) => [item.run, item.returnTarget]), [
    ['active', 'chat'], ['legacy-finished', 'unavailable'], ['recent-finished', 'chat'], ['old-request', 'unavailable'],
  ]);
});

test('completion with prompt metadata can be followed before its working update is observed', () => {
  const report = readAgentReport({
    state: 'waiting', reason: 'done', eventId: 'end-xyz', eventAt: now - 5, promptAt: now - 10, agent: 'codex', returnTarget: 'chat',
  }, now);
  assert.ok(report);
  const next = applyAgentReport(null, report, new Date(now), 3);
  assert.ok(next);
  const queue = buildAgentQueue([{ run: 'foreground', ...next }], now);
  assert.equal(queue.foregroundRun, 'foreground');
  assert.equal(queue.notice?.revision, 3);
  assert.equal(queue.notice?.state, 'idle');
});

test('event retries and out-of-order reports cannot undo a dismissal', () => {
  const last = run('chat', 'waiting', 'question', 9, {
    eventId: 'question-1', eventAt: new Date(now - 5), acknowledged: true, dismissed: true,
  });
  const incoming = (eventId: string, eventAt: number) =>
    readAgentReport({ state: 'waiting', reason: 'question', eventId, eventAt, agent: 'codex' }, now)!;
  assert.equal(applyAgentReport(last, incoming('question-1', now - 5), new Date(now), 10), null);
  assert.equal(applyAgentReport(last, incoming('older', now - 10), new Date(now), 10), null);
  const next = applyAgentReport(last, incoming('question-2', now), new Date(now), 10);
  assert.equal(next?.dismissed, false);
  assert.equal(next?.acknowledged, false);
  assert.equal(next?.revision, 10);
});

test('session end preserves completion history and leaves a tombstone for a closed blocker', () => {
  const last = run('chat', 'idle', 'done', 7, {
    eventId: 'done', eventAt: new Date(now - 5), acknowledged: true, dismissed: true,
  });
  const report = readAgentReport({ state: 'idle', reason: 'end', eventId: 'end', eventAt: now }, now)!;
  const finished = applyAgentReport(last, report, new Date(now), 8);
  assert.equal(finished?.reason, 'done');
  assert.equal(finished?.revision, 7);
  assert.equal(finished?.dismissed, true);
  assert.equal(finished?.eventId, 'end');
  const closed = applyAgentReport({ ...last, state: 'waiting', reason: 'question' }, report, new Date(now), 8);
  assert.ok(closed);
  assert.equal(closed.reason, 'end');
  assert.equal(buildAgentQueue([{ run: 'chat', ...closed }], now).runs.length, 0);
  const delayed = readAgentReport({ state: 'working', reason: 'prompt', eventId: 'old', eventAt: now - 1 }, now)!;
  assert.equal(applyAgentReport({ run: 'chat', ...closed }, delayed, new Date(now), 9), null);
});

test('run ids are sanitized for old reports and event actions require exact keys', () => {
  assert.equal(cleanRunId(undefined), 'default');
  assert.equal(cleanRunId(''), 'default');
  assert.equal(cleanRunId(3128765), '3128765');
  assert.equal(cleanRunId('a b/../c'), 'abc');
  assert.equal(cleanRunId('x'.repeat(80)).length, 40);
  assert.deepEqual(readAgentEventKey({ run: 'chat-1', revision: 0 }), { run: 'chat-1', revision: 0 });
  assert.equal(readAgentEventKey({ run: '../../chat-1', revision: 0 }), null);
  assert.equal(readAgentEventKey({ run: 'chat-1', revision: -1 }), null);
});
