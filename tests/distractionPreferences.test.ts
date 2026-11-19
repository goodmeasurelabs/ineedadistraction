import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupPrompt, DEFAULT_DISTRACTION_PREFERENCES, getEligibleGames,
  parseDistractionPreferences, type DistractionPreferences,
} from '../app/lib/distractionPreferences';

const preferences = (patch: Partial<DistractionPreferences> = {}): DistractionPreferences => ({
  ...DEFAULT_DISTRACTION_PREFERENCES,
  categories: [...DEFAULT_DISTRACTION_PREFERENCES.categories],
  ...patch,
});

test('preferences reject incomplete, unknown, duplicate and incorrectly typed input', () => {
  const valid = preferences();
  const invalid: unknown[] = [
    null, undefined, true, [], 'all', {},
    { ...valid, version: '1' }, { ...valid, version: 2 },
    { ...valid, enabled: 'false' }, { ...valid, enabled: 0 },
    { ...valid, sound: 'true' }, { ...valid, pace: 'fast' },
    { ...valid, categories: [] }, { ...valid, categories: 'merge' },
    { ...valid, categories: ['merge', 'merge'] },
    { ...valid, categories: ['merge', 'unknown'] },
    { ...valid, categories: [null] },
    { ...valid, categories: ['MERGE'] },
    { ...valid, command: 'run something else' },
  ];
  for (const key of Object.keys(valid)) {
    const partial = { ...valid } as Record<string, unknown>;
    delete partial[key]; invalid.push(partial);
  }
  for (const value of invalid) assert.equal(parseDistractionPreferences(value), null, JSON.stringify(value));
});

test('equivalent category selections have a stable canonical order without mutating the caller', () => {
  const input = preferences({ categories: ['memory', 'arcade', 'logic', 'words', 'merge', 'math'], enabled: false, sound: true, pace: 'untimed' });
  const original = structuredClone(input);
  const parsed = parseDistractionPreferences(input)!;
  assert.deepEqual(parsed.categories, ['merge', 'logic', 'math', 'arcade', 'words', 'memory']);
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.sound, true);
  assert.equal(parsed.pace, 'untimed');
  assert.deepEqual(input, original);
  parsed.categories.pop();
  assert.deepEqual(input, original, 'parsed preferences must not share the input categories array');
});

test('selecting a game family only returns games from that family', () => {
  const cases = [
    ['merge', 'critical-mass'], ['logic', 'tessel'], ['math', 'prime-time'], ['arcade', 'afterglow'],
  ] as const;
  for (const [category, game] of cases) {
    assert.deepEqual(getEligibleGames(preferences({ categories: [category] })).map((item) => item.slug), [game]);
  }
  assert.deepEqual(getEligibleGames(preferences({ categories: ['logic', 'math'] })).map((game) => game.slug).sort(), ['prime-time', 'tessel']);
});

test('No timer excludes Afterglow quick shots and preserves the three untimed games', () => {
  const eligible = getEligibleGames(preferences({ pace: 'untimed' }));
  assert.deepEqual(eligible.map((game) => game.slug).sort(), ['critical-mass', 'prime-time', 'tessel']);
  assert.ok(eligible.every((game) => game.pace === 'Take your time'));
});

test('unavailable categories and incompatible pace return no games without broadening the mix', () => {
  assert.deepEqual(getEligibleGames(preferences({ categories: ['words'] })), []);
  assert.deepEqual(getEligibleGames(preferences({ categories: ['memory', 'words'] })), []);
  assert.deepEqual(getEligibleGames(preferences({ categories: ['arcade'], pace: 'untimed' })), []);
  assert.deepEqual(getEligibleGames(preferences({ categories: ['merge', 'words'] })).map((game) => game.slug), ['critical-mass']);
});

test('turning automatic distractions off preserves the chosen playable mix', () => {
  const on = preferences({ categories: ['logic', 'math'], pace: 'untimed' });
  assert.deepEqual(getEligibleGames({ ...on, enabled: false }), getEligibleGames(on));
});

test('Codex and Claude setup prompts carry exact public preferences and platform installation steps', () => {
  const settings = preferences({ categories: ['math', 'logic'], enabled: false, pace: 'untimed', sound: true });
  for (const platform of ['codex', 'claude'] as const) {
    const prompt = buildSetupPrompt(platform, settings);
    assert.match(prompt, /https:\/\/www\.ineedadistraction\.com\/skill\.md/);
    assert.match(prompt, /scripts\/settings\.py/);
    assert.match(prompt, /set --enabled false --categories logic,math --pace untimed --sound true/);
    assert.match(prompt, /scripts\/open\.sh/);
    assert.match(prompt, /Only games without time pressure/);
    assert.match(prompt, /Sound on/);
    assert.match(prompt, /Stop distracting/);
    assert.match(prompt, /Keep distracting/);
    assert.match(prompt, /Do not bypass trust or permissions/);
    assert.match(prompt, /No account is needed/);
    assert.doesNotMatch(prompt, /#t=|\/api\/agent\/|--dangerously-skip-permissions|--yolo|sign\s?up|email address/i);
    if (platform === 'codex') {
      assert.match(prompt, /codex plugin marketplace add goodmeasurelabs\/ineedadistraction/);
      assert.match(prompt, /codex plugin add distraction@ineedadistraction/);
      assert.match(prompt, /Settings > Hooks/);
      assert.match(prompt, /\/hooks/);
      assert.doesNotMatch(prompt, /claude plugin install/);
    } else {
      assert.match(prompt, /claude plugin marketplace add goodmeasurelabs\/ineedadistraction/);
      assert.match(prompt, /claude plugin install distraction@ineedadistraction/);
      assert.match(prompt, /native plugin or hook review/);
      assert.doesNotMatch(prompt, /codex plugin add/);
    }
  }
});

test('a malformed preference cannot become a usable setup prompt', () => {
  assert.throws(() => buildSetupPrompt('codex', preferences({ categories: [] })));
  assert.throws(() => buildSetupPrompt('claude', { ...preferences(), sound: 'false' } as unknown as DistractionPreferences));
});

test('Family Guy setup opens the paired popup for either platform and preserves existing settings', () => {
  for (const platform of ['codex', 'claude'] as const) {
    const prompt = buildSetupPrompt(platform, 'family-guy');
    assert.match(prompt, platform === 'codex' ? /codex plugin add distraction@ineedadistraction/ : /claude plugin install distraction@ineedadistraction/);
    assert.match(prompt, /scripts\/open\.sh/);
    assert.match(prompt, /Tell me to choose “Family Guy clips” in that popup/);
    assert.doesNotMatch(prompt, /--enabled|--categories|--pace|--sound|#t=/);
  }
});
