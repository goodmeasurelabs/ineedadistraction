import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGame } from '../app/lib/publishValidation';

test('publishing requires a title and executable document, with bounded metadata', () => {
  assert.equal(validateGame({ title: 'My game', html: '<!doctype html><html></html>' }), null);
  for (const body of [{ title: ' ', html: '<html>' }, { title: 'ok', html: 123 }, { title: 'ok', html: 'a'.repeat(500001) }, { title: 'ok', html: '<html>', tags: [42] }, { title: 'ok', html: '<html>', remixable: 'true' }]) assert.ok(validateGame(body));
});
test('partial edits accept visibility changes but reject malformed values', () => {
  assert.equal(validateGame({ published: false }, true), null);
  assert.ok(validateGame({ published: 'false' }, true));
  assert.ok(validateGame({ title: '' }, true));
  assert.ok(validateGame({ tags: Array(11).fill('tag') }, true));
});
