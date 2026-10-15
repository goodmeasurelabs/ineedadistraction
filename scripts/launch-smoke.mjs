// HTTP checks only. Creates and removes one private test draft; never publishes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.argv[2] || 'http://localhost:3107';
const request = (path, options) => fetch(base + path, options);
for (const path of ['/', '/make-a-game', '/sitemap.xml', '/robots.txt']) {
  const res = await request(path); assert.equal(res.status, 200, path);
  const text = await res.text();
  if (path === '/') { assert.match(text, /href="\/play\//); assert.match(text, /rel="canonical" href="https:\/\/www.ineedadistraction.com\/?"/); }
  console.log('PASS', path);
}
const list = await (await request('/api/widgets')).json();
assert.ok(Array.isArray(list) && list.length > 0);
const game = await request('/play/' + list[0].id); assert.equal(game.status, 200);
assert.match(await game.text(), /application\/ld\+json/);
assert.equal((await request('/play/launch-smoke-missing-game')).status, 404);
const challenge = await (await request('/?challenge=350&twist=classic')).text();
assert.match(challenge, /350 points in Orbit Pop/);
assert.match(challenge, /api\/challenge-card/);
const card = await request('/api/challenge-card?score=350&twist=classic');
assert.equal(card.status, 200); assert.match(card.headers.get('content-type'), /image\/png/);
const publish = await request('/api/widgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({title:'Do not publish',html:'<html></html>'}) });
assert.equal(publish.status, 401);
assert.equal((await request('/api/auth/request', {method:'POST'})).status, 410);
console.log('PASS public game SSR, 404, challenge preview, and authenticated publishing');
const owner = randomUUID();
const headers = { 'Content-Type': 'application/json', 'x-client-id': owner };
const create = await request('/api/drafts', {method:'POST',headers,body:JSON.stringify({title:'Launch smoke private draft',html:'<!doctype html><html><body>Test</body></html>',templateId:'blank'})});
assert.equal(create.status, 201);
const draft = await create.json();
try {
  assert.equal((await request('/api/drafts/'+draft.id,{headers})).status,200);
  assert.equal((await request('/api/drafts/'+draft.id,{headers:{'x-client-id':randomUUID()}})).status,403);
  const save=await request('/api/drafts/'+draft.id,{method:'PUT',headers,body:JSON.stringify({title:'Saved smoke draft',userId:'forged-owner'})});
  assert.equal(save.status,200); const saved=await save.json(); assert.equal(saved.userId,null); assert.equal(saved.title,'Saved smoke draft');
  const sitemap=await (await request('/sitemap.xml')).text(); assert.ok(!sitemap.includes(draft.id));
  console.log('PASS guest draft create/save/restore, ownership isolation, private draft excluded from sitemap');
} finally { assert.equal((await request('/api/drafts/'+draft.id,{method:'DELETE',headers})).status,200); }
