import { sameDistractionPreferences, type AgentPreferencesSnapshot } from './agentPreferences';
import type { DistractionPreferences } from './distractionPreferences';

export type SettingsSaveAttempt = {
  settings: DistractionPreferences;
  expectedRevision: number;
  minimumRevision: number;
};

export function settingsSaveAttempt(current: AgentPreferencesSnapshot, settings: DistractionPreferences): SettingsSaveAttempt {
  const unchanged = current.settings !== null && sameDistractionPreferences(current.settings, settings);
  return { settings, expectedRevision: current.revision, minimumRevision: current.revision + (unchanged ? 0 : 1) };
}

// A lost POST response is inconclusive. A later read can prove that the desired
// settings are applied, but an old acknowledgement or a different new mix cannot.
export function settingsSaveOutcome(attempt: SettingsSaveAttempt, snapshot: AgentPreferencesSnapshot): 'pending' | 'confirmed' | 'conflict' {
  if (snapshot.revision < attempt.minimumRevision || snapshot.settings === null) return 'pending';
  if (!sameDistractionPreferences(attempt.settings, snapshot.settings)) return 'conflict';
  return snapshot.appliedRevision === snapshot.revision ? 'confirmed' : 'pending';
}
