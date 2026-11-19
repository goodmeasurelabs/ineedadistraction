import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsSaveAttempt, settingsSaveOutcome } from '../app/lib/settingsSaveConfirmation';
import { DEFAULT_DISTRACTION_PREFERENCES } from '../app/lib/distractionPreferences';
import type { AgentPreferencesSnapshot } from '../app/lib/agentPreferences';

const initial: AgentPreferencesSnapshot = {
  settings: DEFAULT_DISTRACTION_PREFERENCES,
  revision: 5, appliedRevision: 5, pluginSeenAt: 1000, pluginVersion: '0.5.0',
};
const off = { ...DEFAULT_DISTRACTION_PREFERENCES, enabled: false };

test('a lost Off response can be confirmed by a later plugin acknowledgement', () => {
  const attempt = settingsSaveAttempt(initial, off);
  // The request is sent but its response never reaches this browser. Polling
  // first sees the old snapshot, then the saved Off, then its acknowledgement.
  assert.equal(settingsSaveOutcome(attempt, initial), 'pending');
  const saved = { ...initial, settings: off, revision: 6 };
  assert.equal(settingsSaveOutcome(attempt, saved), 'pending');
  assert.equal(settingsSaveOutcome(attempt, { ...saved, appliedRevision: 6 }), 'confirmed');
});

test('an old acknowledgement and an unrelated newer edit cannot confirm a lost save', () => {
  const attempt = settingsSaveAttempt(initial, off);
  // Even matching values need evidence at the revision this edit could create.
  assert.equal(settingsSaveOutcome(attempt, { ...initial, settings: off }), 'pending');
  const otherWindow = {
    ...initial, settings: { ...DEFAULT_DISTRACTION_PREFERENCES, sound: true },
    revision: 7, appliedRevision: 7,
  };
  assert.equal(settingsSaveOutcome(attempt, otherWindow), 'conflict');
  assert.equal(settingsSaveOutcome(attempt, { ...otherWindow, appliedRevision: 6 }), 'conflict');
});

test('the entire desired mix must be confirmed, including sound and game categories', () => {
  const desired = { ...off, categories: ['logic' as const], sound: true, pace: 'untimed' as const };
  const attempt = settingsSaveAttempt(initial, desired);
  const acknowledged = { ...initial, settings: desired, revision: 6, appliedRevision: 6 };
  assert.equal(settingsSaveOutcome(attempt, acknowledged), 'confirmed');
  assert.equal(settingsSaveOutcome(attempt, { ...acknowledged, settings: { ...desired, sound: false } }), 'conflict');
  assert.equal(settingsSaveOutcome(attempt, { ...acknowledged, settings: off }), 'conflict');
});

test('a no-op save can use the existing acknowledgement without inventing a new revision', () => {
  const settings = { ...DEFAULT_DISTRACTION_PREFERENCES, categories: [...DEFAULT_DISTRACTION_PREFERENCES.categories].reverse() };
  const attempt = settingsSaveAttempt(initial, settings);
  assert.equal(settingsSaveOutcome(attempt, initial), 'confirmed');
  assert.equal(settingsSaveOutcome(attempt, { ...initial, appliedRevision: 4 }), 'pending');
});

test('a newer matching snapshot confirms only after the plugin applies that revision', () => {
  const attempt = settingsSaveAttempt(initial, off);
  const newer = { ...initial, settings: off, revision: 8, appliedRevision: 7 };
  assert.equal(settingsSaveOutcome(attempt, newer), 'pending');
  assert.equal(settingsSaveOutcome(attempt, { ...newer, appliedRevision: 8 }), 'confirmed');
  assert.equal(settingsSaveOutcome(attempt, { ...newer, settings: null }), 'pending');
});
