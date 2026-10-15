import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateWithAstra, usesAstra } from '../app/lib/astra';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalProvider = process.env.GAME_CODE_PROVIDER;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.GAME_CODE_PROVIDER;
  else process.env.GAME_CODE_PROVIDER = originalProvider;
});

test('Astra requires explicit provider selection; misconfiguration cannot silently change models', () => {
  delete process.env.GAME_CODE_PROVIDER;
  assert.equal(usesAstra(), false);
  process.env.GAME_CODE_PROVIDER = 'openai';
  assert.equal(usesAstra(), true);
  process.env.GAME_CODE_PROVIDER = 'typo';
  assert.throws(usesAstra, /must be/);
});

test('missing credentials fail before sending a request', async () => {
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => { throw new Error('should not send'); };
  await assert.rejects(generateWithAstra('system', 'game'), /OPENAI_API_KEY is required/);
});

test('Responses output can contain reasoning before multiple text segments', async () => {
  process.env.OPENAI_API_KEY = 'test-only-not-a-credential';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'gpt-6-astra');
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(body.store, false);
    assert.equal(body.temperature, undefined);
    assert.equal(body.instructions, 'system');
    assert.equal(body.input, 'game');
    return Response.json({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '<html>' }, { type: 'output_text', text: '</html>' }] },
    ], usage: { input_tokens: 120, output_tokens: 40, input_tokens_details: { cached_tokens: 60 } } });
  };
  const result = await generateWithAstra('system', 'game');
  assert.equal(result.content[0].text, '<html></html>');
  assert.equal(result.stop_reason, 'end_turn');
  assert.equal(result.usage.cache_read_input_tokens, 60);
});

test('truncation reaches the existing route retry instead of being treated as playable', async () => {
  process.env.OPENAI_API_KEY = 'test';
  globalThis.fetch = async () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
  assert.equal((await generateWithAstra('s', 'u')).stop_reason, 'max_tokens');
});

test('refusal, failed and other incomplete responses never become a game', async () => {
  process.env.OPENAI_API_KEY = 'test';
  for (const payload of [
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
    { status: 'failed', output: [] },
    { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(generateWithAstra('s', 'u'), /complete game/);
  }
});

test('provider failures preserve HTTP status without leaking the upstream body', async () => {
  process.env.OPENAI_API_KEY = 'test';
  globalThis.fetch = async () => new Response('sensitive upstream body', { status: 429 });
  await assert.rejects(generateWithAstra('s', 'u'), (error: unknown) => {
    assert.equal((error as { status: number }).status, 429);
    assert.equal((error as Error).message, 'OpenAI generation failed (429)');
    return true;
  });
});

test('caller cancellation reaches fetch', async () => {
  process.env.OPENAI_API_KEY = 'test';
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init!.signal!.aborted, true);
    throw new DOMException('Cancelled', 'AbortError');
  };
  await assert.rejects(generateWithAstra('s', 'u', controller.signal), { name: 'AbortError' });
});
