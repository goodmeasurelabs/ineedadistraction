import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DISTRACTION_PREFERENCES } from '../app/lib/distractionPreferences';

type Row = Record<string, unknown>;
type Query = { where: Row; data?: Row; create?: Row; update?: Row };

// Keep tests at the HTTP boundary with an isolated database substitute, like
// the queue integration suite. Never connect to a user's paired computer.
const rows: Row[] = [];
const find = (where: Row) => rows.find((row) => row.token === where.token);
function update(row: Row, data: Row = {}) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = Number(row[key]) + Number(value.increment);
    else row[key] = value;
  }
  return structuredClone(row);
}
const agentPreferences = {
  async findUnique({ where }: Query) { return structuredClone(find(where) ?? null); },
  async findUniqueOrThrow({ where }: Query) { const row = find(where); assert.ok(row); return structuredClone(row); },
  async upsert({ where, create, update: data }: Query) {
    const row = find(where);
    if (row) return update(row, data);
    const created = { lastMutationId: null, pluginSeenAt: null, pluginVersion: null, ...create };
    rows.push(created);
    return structuredClone(created);
  },
  async updateMany({ where, data }: Query) {
    const row = find(where);
    if (!row) return { count: 0 };
    update(row, data); return { count: 1 };
  },
  async update({ where, data }: Query) { const row = find(where); assert.ok(row); return update(row, data); },
};
let transactionTail: Promise<unknown> = Promise.resolve();
const database = {
  agentPreferences,
  async $queryRaw() { return [{ count: 1, resetAt: new Date(Date.now() + 60_000) }]; },
  $transaction<T>(callback: (tx: { agentPreferences: typeof agentPreferences }) => Promise<T>): Promise<T> {
    const next = transactionTail.then(() => callback(database));
    transactionTail = next.catch(() => undefined);
    return next;
  },
};
(globalThis as unknown as { _prisma: unknown })._prisma = database;
const handlers = import('../app/api/agent/[token]/settings/route');
const token = 'settings-integration-isolated-token';
const initial = { ...DEFAULT_DISTRACTION_PREFERENCES, categories: ['merge', 'logic'] };
const off = { ...initial, enabled: false };
const pluginVersion = '0.5.0';
beforeEach(() => { rows.length = 0; });

async function post(body: unknown, requestToken = token) {
  const { POST } = await handlers;
  const response = await POST(new Request(`https://example.test/api/agent/${requestToken}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ token: requestToken }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: await response.json() };
}
async function get(requestToken = token) {
  const { GET } = await handlers;
  const response = await GET(new Request(`https://example.test/api/agent/${requestToken}/settings`), { params: Promise.resolve({ token: requestToken }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: await response.json() };
}
const initialize = () => post({ action: 'initialize', settings: initial, pluginVersion });

test('an unpaired browser gets an empty snapshot and cannot claim settings were applied', async () => {
  const before = await get();
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, { settings: null, revision: 0, appliedRevision: 0, pluginSeenAt: 0, pluginVersion: null });
  const attempt = await post({ action: 'update', settings: off, expectedRevision: 1, mutationId: 'turn-off-first' });
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.settings, null);
  assert.equal(rows.length, 0);
});

test('Off waits for the plugin acknowledgement and survives plugin reinitialization', async () => {
  const started = await initialize();
  assert.equal(started.status, 200);
  assert.equal(started.body.revision, 1);
  assert.equal(started.body.appliedRevision, 1);
  assert.ok(started.body.pluginSeenAt > 0);
  const stopped = await post({ action: 'update', settings: off, expectedRevision: 1, mutationId: 'turn-off-0001' });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.settings.enabled, false);
  assert.equal(stopped.body.revision, 2);
  assert.equal(stopped.body.appliedRevision, 1);
  const restart = await initialize();
  assert.equal(restart.body.settings.enabled, false);
  assert.equal(restart.body.appliedRevision, 1);
  const applied = await post({ action: 'ack', revision: 2, pluginVersion });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.appliedRevision, 2);
  assert.equal((await get()).body.settings.enabled, false);
});

test('a delayed plugin acknowledgement cannot acknowledge a newer settings change', async () => {
  await initialize();
  await post({ action: 'update', settings: off, expectedRevision: 1, mutationId: 'turn-off-0002' });
  const staleAck = await post({ action: 'ack', revision: 1, pluginVersion });
  assert.equal(staleAck.status, 409);
  assert.equal(staleAck.body.revision, 2);
  assert.equal(staleAck.body.appliedRevision, 1);
  assert.equal(staleAck.body.settings.enabled, false);
  const futureAck = await post({ action: 'ack', revision: 100, pluginVersion });
  assert.equal(futureAck.status, 409);
  assert.equal(futureAck.body.appliedRevision, 1);
});

test('two simultaneous edits cannot silently replace one another', async () => {
  await initialize();
  const alternatives = await Promise.all([
    post({ action: 'update', settings: off, expectedRevision: 1, mutationId: 'parallel-off' }),
    post({ action: 'update', settings: { ...initial, categories: ['math'] }, expectedRevision: 1, mutationId: 'parallel-math' }),
  ]);
  assert.deepEqual(alternatives.map((result) => result.status).sort(), [200, 409]);
  const winner = alternatives.find((result) => result.status === 200)!;
  const conflict = alternatives.find((result) => result.status === 409)!;
  assert.deepEqual(conflict.body.settings, winner.body.settings);
  assert.deepEqual((await get()).body.settings, winner.body.settings);
});

test('a lost response can be retried without a new revision or overwriting newer intent', async () => {
  await initialize();
  const command = { action: 'update', settings: off, expectedRevision: 1, mutationId: 'replayed-off' };
  const first = await post(command);
  const retry = await post(command);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.revision, first.body.revision);
  const reused = await post({ ...command, settings: initial });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.settings.enabled, false);
  await post({ action: 'update', settings: initial, expectedRevision: 2, mutationId: 'explicit-on' });
  const lateRetry = await post(command);
  assert.equal(lateRetry.status, 409);
  assert.equal(lateRetry.body.settings.enabled, true);
  assert.equal(lateRetry.body.revision, 3);
});

test('saving the current mix or reordering its categories is an acknowledged no-op', async () => {
  await initialize();
  const same = await post({ action: 'update', settings: { ...initial, categories: ['logic', 'merge'] }, expectedRevision: 1, mutationId: 'same-mix-0001' });
  assert.equal(same.status, 200);
  assert.equal(same.body.revision, 1);
  assert.equal(same.body.appliedRevision, 1);
});

test('settings and plugin heartbeats remain isolated by pairing token', async () => {
  await initialize();
  const otherToken = 'another-settings-integration-token';
  await post({ action: 'initialize', settings: off, pluginVersion: '0.5.1' }, otherToken);
  assert.equal((await get()).body.settings.enabled, true);
  const other = await get(otherToken);
  assert.equal(other.body.settings.enabled, false);
  assert.equal(other.body.pluginVersion, '0.5.1');
  assert.equal((await get()).body.pluginVersion, pluginVersion);
});

test('invalid settings, revisions and command payloads are rejected before mutation', async () => {
  await initialize();
  const invalid = [
    { action: 'update', settings: { ...initial, enabled: 'false' }, expectedRevision: 1, mutationId: 'invalid-value' },
    { action: 'update', settings: { ...initial, categories: ['untrusted-command'] }, expectedRevision: 1, mutationId: 'bad-category' },
    { action: 'update', settings: { ...initial, categories: [] }, expectedRevision: 1, mutationId: 'empty-category' },
    { action: 'update', settings: { ...initial, categories: ['merge', 'merge'] }, expectedRevision: 1, mutationId: 'duplicate-category' },
    { action: 'update', settings: initial, expectedRevision: 1.5, mutationId: 'bad-revision' },
    { action: 'update', settings: initial, expectedRevision: 1, mutationId: '../../path' },
    { action: 'ack', revision: -1, pluginVersion },
    { action: 'initialize', settings: initial, pluginVersion: 'too long '.repeat(20) },
    { action: 'execute', command: 'open arbitrary app' },
  ];
  for (const input of invalid) assert.equal((await post(input)).status, 400);
  assert.equal((await get()).body.revision, 1);
  assert.equal((await post({ action: 'ack', revision: 1, pluginVersion }, 'bad')).status, 400);
  assert.equal((await post({ data: 'x'.repeat(8193) })).status, 413);
});
