import assert from 'node:assert/strict';
import test from 'node:test';
import { FAMILY_GUY_CLIPS } from '../app/arcade/clips/catalog';
import { createClipRotation } from '../app/arcade/clips/rotation';

function savedHistory() {
  return {
    value: null as string | null,
    getItem() { return this.value; },
    setItem(_key: string, value: string) { this.value = value; },
  };
}

function offer(rotation: ReturnType<typeof createClipRotation>, excluded?: Set<string>) {
  const clip = rotation.selectClip(excluded);
  assert.ok(clip);
  rotation.markClipOffered(clip.id);
  return clip.id;
}

test('the popup library contains hundreds of distinct, labeled publisher uploads', () => {
  assert.ok(FAMILY_GUY_CLIPS.length >= 200);
  const publishers = new Set(['Family Guy', 'FOX', 'FOX TV UK', 'Hulu', 'TBS']);
  const ids = new Set<string>();
  for (const clip of FAMILY_GUY_CLIPS) {
    assert.match(clip.id, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(clip.title.trim());
    assert.ok(publishers.has(clip.channel), clip.channel);
    assert.ok(!ids.has(clip.id), clip.id);
    ids.add(clip.id);
  }
});

test('a viewer of the three pilot clips receives the new library before another pilot clip', () => {
  const pilot = ['JCNMNcUp9Os', '1K4tfKqJ1eM', 'BjX1ITzuJ_k'];
  const saved = savedHistory();
  saved.value = JSON.stringify(pilot);
  const rotation = createClipRotation(FAMILY_GUY_CLIPS, () => saved);
  const additions = FAMILY_GUY_CLIPS.filter((clip) => !pilot.includes(clip.id));
  const offered = additions.map(() => offer(rotation));
  assert.deepEqual(new Set(offered), new Set(additions.map((clip) => clip.id)));
  assert.equal(offer(rotation), pilot[0]);
});

test('distinct popup launches exhaust the catalog before repeating, across cycle boundaries', () => {
  const saved = savedHistory();
  const picks = Array.from({ length: FAMILY_GUY_CLIPS.length * 4 }, () => {
    const popup = createClipRotation(FAMILY_GUY_CLIPS, () => saved);
    return offer(popup);
  });
  for (let start = 0; start <= picks.length - FAMILY_GUY_CLIPS.length; start++) {
    assert.equal(new Set(picks.slice(start, start + FAMILY_GUY_CLIPS.length)).size, FAMILY_GUY_CLIPS.length);
  }
});

test('unseen picks are randomized and merely selecting or offering an unknown ID never writes', (t) => {
  const saved = savedHistory();
  const rotation = createClipRotation(FAMILY_GUY_CLIPS, () => saved);
  const random = t.mock.method(Math, 'random', () => 0);
  assert.equal(rotation.selectClip()?.id, FAMILY_GUY_CLIPS[0].id);
  random.mock.mockImplementation(() => 1 - Number.EPSILON);
  assert.equal(rotation.selectClip()?.id, FAMILY_GUY_CLIPS.at(-1)?.id);
  rotation.markClipOffered('removed-id');
  assert.equal(saved.value, null);
});

test('a missing embed is skipped locally and returns to rotation when eligible again', () => {
  const saved = savedHistory();
  const catalog = FAMILY_GUY_CLIPS.slice(0, 3);
  const rotation = createClipRotation(catalog, () => saved);
  const blocked = catalog[0].id;
  const excluded = new Set([blocked]);
  const picks = Array.from({ length: 4 }, () => offer(rotation, excluded));
  assert.ok(!picks.includes(blocked));
  assert.notEqual(picks[0], picks[1]);
  assert.deepEqual(picks.slice(2), picks.slice(0, 2));
  excluded.add(picks[0]);
  assert.equal(offer(rotation, excluded), picks[1]);
  assert.equal(offer(rotation, excluded), picks[1]);
  assert.equal(rotation.selectClip(new Set(catalog.map((clip) => clip.id))), null);
  assert.equal(rotation.selectClip()?.id, blocked);
});

test('a catalog change prioritizes additions and drops retired or duplicate entries', () => {
  const saved = savedHistory();
  const [retired, retained, added] = FAMILY_GUY_CLIPS;
  saved.value = JSON.stringify([retained.id, retired.id, 123, retained.id]);
  const next = createClipRotation([retained, added], () => saved);
  assert.equal(offer(next), added.id);
  assert.deepEqual(JSON.parse(saved.value), [retained.id, added.id]);
  assert.equal(offer(next), retained.id);
});

test('corrupt history recovers on the next offer and an empty catalog produces no clip', () => {
  const saved = savedHistory();
  for (const invalid of ['{broken', '{}', 'null']) {
    saved.value = invalid;
    const rotation = createClipRotation(FAMILY_GUY_CLIPS, () => saved);
    const first = offer(rotation);
    assert.deepEqual(JSON.parse(saved.value), [first]);
    assert.notEqual(offer(rotation), first);
  }
  assert.equal(createClipRotation([], () => saved).selectClip(), null);
});

test('a popup tracks offers in memory if the browser denies access to local storage', () => {
  const popup = createClipRotation(FAMILY_GUY_CLIPS, () => { throw new Error('Storage denied'); });
  const picks = FAMILY_GUY_CLIPS.map(() => offer(popup));
  assert.equal(new Set(picks).size, FAMILY_GUY_CLIPS.length);
  assert.equal(offer(popup), picks[0]);
});

test('failed writes keep newer offers in memory until the storage quota recovers', () => {
  const saved = savedHistory();
  let full = true;
  const unstable = {
    getItem: () => saved.value,
    setItem: (key: string, value: string) => {
      if (full) throw new Error('Storage full');
      saved.setItem(key, value);
    },
  };
  const popup = createClipRotation(FAMILY_GUY_CLIPS, () => unstable);
  const picks = FAMILY_GUY_CLIPS.map(() => offer(popup));
  assert.equal(saved.value, null);
  assert.equal(new Set(picks).size, FAMILY_GUY_CLIPS.length);
  full = false;
  assert.equal(offer(popup), picks[0]);
  const reopened = createClipRotation(FAMILY_GUY_CLIPS, () => saved);
  assert.equal(reopened.selectClip()?.id, picks[1]);
});

test('open windows see offers saved by another window and refresh a replay’s recency', () => {
  const saved = savedHistory();
  const catalog = FAMILY_GUY_CLIPS.slice(0, 3);
  const first = createClipRotation(catalog, () => saved);
  const second = createClipRotation(catalog, () => saved);
  const picks = [offer(first), offer(second), offer(first)];
  assert.equal(new Set(picks).size, catalog.length);
  const onlyFirst = new Set(catalog.filter((clip) => clip.id !== picks[0]).map((clip) => clip.id));
  assert.equal(offer(second, onlyFirst), picks[0]);
  assert.equal(offer(first), picks[1]);
});
