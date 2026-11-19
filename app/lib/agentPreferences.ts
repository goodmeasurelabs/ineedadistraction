import { parseDistractionPreferences, type DistractionPreferences } from './distractionPreferences';

export type AgentPreferencesSnapshot = {
  settings: DistractionPreferences | null;
  revision: number;
  appliedRevision: number;
  pluginSeenAt: number;
  pluginVersion: string | null;
};

export type AgentPreferencesRow = {
  settings: unknown;
  revision: number;
  appliedRevision: number;
  pluginSeenAt: Date | null;
  pluginVersion: string | null;
  lastMutationId: string | null;
};

export type AgentPreferencesAction =
  | { action: 'initialize'; settings: DistractionPreferences; pluginVersion: string }
  | { action: 'update'; settings: DistractionPreferences; expectedRevision: number; mutationId: string }
  | { action: 'ack'; revision: number; pluginVersion: string };

const MAX_REVISION = 2_147_483_646;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_REVISION;
const version = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value);

export function readAgentPreferencesAction(input: unknown): AgentPreferencesAction | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.action === 'ack') {
    return revision(value.revision) && version(value.pluginVersion)
      ? { action: 'ack', revision: value.revision, pluginVersion: value.pluginVersion }
      : null;
  }
  const settings = parseDistractionPreferences(value.settings);
  if (!settings) return null;
  if (value.action === 'initialize' && version(value.pluginVersion)) {
    return { action: 'initialize', settings, pluginVersion: value.pluginVersion };
  }
  if (value.action === 'update' && revision(value.expectedRevision) &&
      typeof value.mutationId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value.mutationId)) {
    return { action: 'update', settings, expectedRevision: value.expectedRevision, mutationId: value.mutationId };
  }
  return null;
}

export function sameDistractionPreferences(a: DistractionPreferences, b: DistractionPreferences): boolean {
  return a.version === b.version && a.enabled === b.enabled && a.pace === b.pace && a.sound === b.sound &&
    a.categories.length === b.categories.length && a.categories.every((category) => b.categories.includes(category));
}

export function agentPreferencesSnapshot(row: AgentPreferencesRow | null): AgentPreferencesSnapshot {
  return {
    settings: row ? parseDistractionPreferences(row.settings) : null,
    revision: row?.revision ?? 0,
    appliedRevision: row?.appliedRevision ?? 0,
    pluginSeenAt: row?.pluginSeenAt?.getTime() ?? 0,
    pluginVersion: row?.pluginVersion ?? null,
  };
}
