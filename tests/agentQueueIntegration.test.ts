import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Row = Record<string, unknown>;
type Query = { where?: Row; data?: Row; create?: Row; update?: Row };

// Exercise the HTTP handlers and their transaction boundaries with an isolated
// Prisma substitute. No production pairing, database, or desktop app is used.
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'token_run') return matches(row, value as Row);
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part) => matches(row, part as Row));
    if (key === 'OR') return (value as Row[]).some((part) => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const condition = value as Row;
      const actual = row[key] as number;
      if ('lt' in condition && !(actual < (condition.lt as number))) return false;
      if ('lte' in condition && !(actual <= (condition.lte as number))) return false;
      if ('gt' in condition && !(actual > (condition.gt as number))) return false;
      if ('gte' in condition && !(actual >= (condition.gte as number))) return false;
      if ('in' in condition && !(condition.in as unknown[]).includes(row[key])) return false;
      if ('notIn' in condition && (condition.notIn as unknown[]).includes(row[key])) return false;
      if ('not' in condition && row[key] === condition.not) return false;
      return true;
    }
    return value instanceof Date ? Number(row[key]) === Number(value) : row[key] === value;
  });
}

function change(row: Row, data: Row = {}) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = Number(row[key] ?? 0) + Number(value.increment);
    } else row[key] = value;
  }
  return structuredClone(row);
}

function table(defaults: () => Row) {
  const rows: Row[] = [];
  return {
    rows,
    async findUnique({ where }: Query) { return structuredClone(rows.find((row) => matches(row, where)) ?? null); },
    async findUniqueOrThrow({ where }: Query) {
      const row = rows.find((entry) => matches(entry, where));
      assert.ok(row, 'findUniqueOrThrow requires an existing row');
      return structuredClone(row);
    },
    async findMany({ where }: Query = {}) { return structuredClone(rows.filter((row) => matches(row, where))); },
    async upsert({ where, create, update }: Query) {
      const found = rows.find((row) => matches(row, where));
      if (found) return change(found, update);
      const row = { ...defaults(), ...create };
      rows.push(row);
      return structuredClone(row);
    },
    async update({ where, data }: Query) {
      const row = rows.find((entry) => matches(entry, where));
      assert.ok(row, 'update requires an existing row');
      return change(row, data);
    },
    async updateMany({ where, data }: Query) {
      const matching = rows.filter((row) => matches(row, where));
      matching.forEach((row) => change(row, data));
      return { count: matching.length };
    },
    async deleteMany({ where }: Query) {
      const before = rows.length;
      const retained = rows.filter((row) => !matches(row, where));
      rows.splice(0, rows.length, ...retained);
      return { count: before - rows.length };
    },
  };
}

const sessions = table(() => ({
  seq: 0, state: 'idle', reason: null, agent: null, working: 0, waiting: 0,
  updatedAt: new Date(), seenAt: null, waitedAt: null, focusAt: null, focusRun: null,
}));
const runs = table(() => ({
  revision: 0, eventId: null, eventAt: null, promptAt: null,
  acknowledged: false, dismissed: false, returnTarget: 'unavailable',
  updatedAt: new Date(), state: 'idle', reason: null, agent: null,
}));
let transactionTail: Promise<unknown> = Promise.resolve();
type TransactionTables = { agentSession: typeof sessions; agentRun: typeof runs };
const database = {
  agentSession: sessions,
  agentRun: runs,
  async $queryRaw() { return [{ count: 1, resetAt: new Date(Date.now() + 60_000) }]; },
  $transaction<T>(callback: (tx: TransactionTables) => Promise<T>): Promise<T> {
    const next = transactionTail.then(() => callback(database));
    transactionTail = next.catch(() => undefined);
    return next;
  },
};
(globalThis as unknown as { _prisma: unknown })._prisma = database;
const handlers = import('../app/api/agent/[token]/route');
const token = 'isolated-integration-test-pairing';
const params = { params: Promise.resolve({ token }) };
let eventClock = Date.now();

beforeEach(() => {
  sessions.rows.length = 0;
  runs.rows.length = 0;
  eventClock = Date.now() - 10_000;
});

async function post(body: Row) {
  const { POST } = await handlers;
  const response = await POST(new Request(`https://example.test/api/agent/${token}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), params);
  return { status: response.status, body: await response.json() };
}

async function report(run: string, state: string, reason: string, promptAt?: number) {
  const eventAt = ++eventClock;
  const body = { session: run, state, reason, agent: run === 'claude' ? 'claude-code' : 'codex',
    eventAt, eventId: `event-${eventAt}`, promptAt: promptAt ?? eventAt, returnTarget: 'chat' };
  const result = await post(body);
  assert.equal(result.status, 200);
  return { ...result.body, report: body };
}

test('HTTP queue keeps a question pending while a foreground turn finishes and is acknowledged', async () => {
  const question = await report('claude', 'waiting', 'question');
  const work = await report('codex', 'working', 'prompt');
  assert.equal(work.waiting, 1);
  const finished = await report('codex', 'waiting', 'done', work.report.promptAt);
  assert.equal(finished.waiting, 1);
  assert.equal(finished.notice.run, 'codex');
  const completion = finished.runs.find((run: Row) => run.run === 'codex');
  assert.equal(completion.state, 'idle');
  const ack = await post({ action: 'ack', run: completion.run, revision: completion.revision });
  assert.equal(ack.status, 200);
  assert.equal(ack.body.waiting, 1);
  assert.ok(ack.body.runs.find((run: Row) => run.run === 'codex').dismissed);
  assert.equal(ack.body.runs.find((run: Row) => run.run === 'claude').revision, question.runs[0].revision);
  const replay = await post(finished.report);
  assert.equal(replay.status, 200);
  assert.ok(replay.body.runs.find((run: Row) => run.run === 'codex').dismissed);
  const returnToHistory = await post({ action: 'focus', run: completion.run, revision: completion.revision });
  assert.equal(returnToHistory.status, 200);
  assert.equal(returnToHistory.body.focusRun, 'codex');
});

test('HTTP focus can return to a currently working chat from its queue row', async () => {
  const working = await report('codex', 'working', 'prompt');
  const target = working.runs[0];
  const focused = await post({ action: 'focus', run: target.run, revision: target.revision });
  assert.equal(focused.status, 200);
  assert.equal(focused.body.focusRun, 'codex');
  assert.equal(focused.body.working, 1);
});

test('HTTP focus and clear apply only to the displayed revision and never switch chats', async () => {
  const first = await report('codex', 'waiting', 'question');
  const target = first.runs.find((run: Row) => run.run === 'codex');
  await report('claude', 'waiting', 'permission');
  const ambiguous = await post({ action: 'focus' });
  assert.equal(ambiguous.status, 409);
  const focused = await post({ action: 'focus', run: target.run, revision: target.revision });
  assert.equal(focused.status, 200);
  assert.equal(focused.body.focusRun, 'codex');
  assert.equal(focused.body.waiting, 2);
  const fresh = await report('codex', 'waiting', 'question');
  const staleFocus = await post({ action: 'focus', run: target.run, revision: target.revision });
  assert.equal(staleFocus.status, 409);
  const cleared = await post({ action: 'clear', items: [{ run: target.run, revision: target.revision }] });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.waiting, 2);
  assert.equal(cleared.body.runs.find((run: Row) => run.run === 'codex').revision,
    fresh.runs.find((run: Row) => run.run === 'codex').revision);
});

test('HTTP end events reject delayed work without resurrecting a closed session', async () => {
  const working = await report('codex', 'working', 'prompt');
  await report('codex', 'idle', 'end', working.report.promptAt);
  const delayed = await post(working.report);
  assert.equal(delayed.status, 200);
  assert.equal(delayed.body.working, 0);
  assert.equal(delayed.body.waiting, 0);
  assert.equal(delayed.body.notice, null);
});

test('HTTP clearing suppresses only that request and the next real question reappears', async () => {
  const first = await report('claude', 'waiting', 'permission');
  const target = first.runs[0];
  const acknowledged = await post({ action: 'ack', run: target.run, revision: target.revision });
  assert.equal(acknowledged.body.waiting, 1);
  assert.equal(acknowledged.body.notice, null);
  const dismissed = await post({ action: 'dismiss', run: target.run, revision: target.revision });
  assert.equal(dismissed.body.waiting, 0);
  const replay = await post(first.report);
  assert.equal(replay.body.waiting, 0);
  const fresh = await report('claude', 'waiting', 'question');
  assert.equal(fresh.waiting, 1);
  assert.equal(fresh.notice.run, 'claude');
  const resumed = await report('claude', 'working', 'prompt');
  assert.equal(resumed.waiting, 0);
  assert.equal(resumed.notice, null);
});

test('HTTP GET keeps an old request clearable while expiring stale work', async () => {
  await report('claude', 'waiting', 'question');
  await report('stale-worker', 'working', 'prompt');
  await report('codex', 'working', 'prompt');
  const request = runs.rows.find((run) => run.run === 'claude')!;
  request.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  runs.rows.find((run) => run.run === 'stale-worker')!.updatedAt = new Date(Date.now() - 13 * 60 * 60 * 1000);
  await report('codex', 'working', 'prompt');
  const { GET } = await handlers;
  const response = await GET(new Request(`https://example.test/api/agent/${token}?peek=1`), params);
  assert.equal(response.status, 200);
  const current = await response.json();
  assert.equal(current.waiting, 1);
  assert.equal(current.working, 1);
  assert.equal(current.notice, null);
  assert.equal(current.runs.find((run: Row) => run.run === 'claude').returnTarget, 'unavailable');
  assert.equal(current.runs.some((run: Row) => run.run === 'stale-worker'), false);
  const cleared = await post({ action: 'clear', items: [{ run: 'claude', revision: request.revision }] });
  assert.equal(cleared.body.waiting, 0);
});

test('HTTP legacy orphan approval does not resurface on a new prompt and can still be cleared', async () => {
  const legacy = await post({ session: 'legacy', state: 'waiting', reason: 'permission', agent: 'codex' });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.notice.run, 'legacy');
  const old = runs.rows.find((run) => run.run === 'legacy')!;
  // Match a row migrated from the original protocol: yesterday's approval,
  // revision zero and no event, prompt or return-target metadata.
  old.updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  old.revision = 0;
  const working = await report('codex', 'working', 'prompt');
  assert.equal(working.waiting, 0);
  assert.equal(working.notice, null);
  assert.equal(working.runs.find((run: Row) => run.run === 'legacy').statusUnconfirmed, true);
  const { GET } = await handlers;
  const response = await GET(new Request(`https://example.test/api/agent/${token}?peek=1`), params);
  const snapshot = await response.json();
  assert.equal(snapshot.notice, null);
  assert.equal(snapshot.state, 'working');
  const cleared = await post({ action: 'clear', items: [{ run: 'legacy', revision: old.revision }] });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.runs.find((run: Row) => run.run === 'legacy').dismissed, true);
  const fresh = await report('legacy', 'waiting', 'permission');
  assert.equal(fresh.waiting, 1);
  assert.equal(fresh.notice.run, 'legacy');
  assert.equal(fresh.notice.statusUnconfirmed, undefined);
});
