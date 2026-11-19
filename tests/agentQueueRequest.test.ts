import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readAgentSnapshot, updateAgentQueue } from '../app/games/engine/useAgentSync';

const token = 'isolated-queue-request-token';
const target = { run: 'test-chat', revision: 3 };

function environment(t: TestContext) {
  const events: Event[] = [];
  for (const [key, value] of Object.entries({
    localStorage: { getItem: () => token },
    window: { dispatchEvent: (event: Event) => { events.push(event); return true; } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return events;
}

test('a stalled queue request times out with an honest recovery message', async (t) => {
  const events = environment(t);
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });

  const rejected = assert.rejects(updateAgentQueue('focus', target), /Could not confirm.*may still have reached.*open your agent directly/);
  t.mock.timers.tick(8000);
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(events.length, 0);
});

test('the queue deadline remains active when headers arrive but the response body stalls', async (t) => {
  const events = environment(t);
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"seq":'));
        signal!.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  });

  const rejected = assert.rejects(updateAgentQueue('ack', target), /Could not confirm that request in time/);
  await Promise.resolve();
  t.mock.timers.tick(8000);
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(events.length, 0);
});

test('a completed queue action publishes the snapshot and removes its deadline', async (t) => {
  const events = environment(t);
  const snapshot = { seq: 4, notice: null, runs: [] };
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    assert.deepEqual(JSON.parse(init.body as string), { action: 'dismiss', ...target });
    return Response.json(snapshot);
  });

  await updateAgentQueue('dismiss', target);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'inad:agent-queue-updated');
  assert.deepEqual((events[0] as CustomEvent).detail, snapshot);
  t.mock.timers.tick(8000);
  assert.equal(signal?.aborted, false);
});

test('a queue revision conflict preserves the retry guidance and removes its deadline', async (t) => {
  const events = environment(t);
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    return Response.json({ error: 'Changed' }, { status: 409 });
  });

  await assert.rejects(updateAgentQueue('ack', target), /That chat changed\. Try its updated entry\./);
  t.mock.timers.tick(8000);
  assert.equal(signal?.aborted, false);
  assert.equal(events.length, 0);
});

test('a long poll allows the normal server wait but recovers from a stalled request', async (t) => {
  environment(t);
  const lifetime = new AbortController();
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    assert.equal(url, `/api/agent/${token}?seq=12`);
    signal = init.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });

  const rejected = assert.rejects(readAgentSnapshot(token, 12, lifetime.signal), { name: 'AbortError' });
  t.mock.timers.tick(20_000);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test('the long-poll deadline also covers a stalled response body', async (t) => {
  environment(t);
  const lifetime = new AbortController();
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"seq":'));
        signal!.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
      },
    }));
  });

  const rejected = assert.rejects(readAgentSnapshot(token, 12, lifetime.signal), { name: 'AbortError' });
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test('unmounting cancels an in-flight long poll and removes its abort listener', async (t) => {
  environment(t);
  const lifetime = new AbortController();
  const remove = t.mock.method(lifetime.signal, 'removeEventListener');
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });

  const rejected = assert.rejects(readAgentSnapshot(token, 12, lifetime.signal), { name: 'AbortError' });
  lifetime.abort();
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(remove.mock.callCount(), 1);
});

test('a completed long poll removes both its deadline and lifetime listener', async (t) => {
  environment(t);
  const lifetime = new AbortController();
  let signal: AbortSignal | undefined;
  const snapshot = { seq: 13, notice: null, runs: [] };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, `/api/agent/${token}`);
    signal = init.signal!;
    return Response.json(snapshot);
  });

  assert.deepEqual(await readAgentSnapshot(token, -1, lifetime.signal), snapshot);
  t.mock.timers.tick(30_000);
  lifetime.abort();
  assert.equal(signal?.aborted, false);
});
