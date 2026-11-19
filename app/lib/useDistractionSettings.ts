'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readAgentToken } from '../games/engine/useAgentSync';
import type { AgentPreferencesSnapshot } from './agentPreferences';
import { parseDistractionPreferences, type DistractionPreferences } from './distractionPreferences';
import { settingsSaveAttempt, settingsSaveOutcome, type SettingsSaveAttempt } from './settingsSaveConfirmation';

const EMPTY: AgentPreferencesSnapshot = { settings: null, revision: 0, appliedRevision: 0, pluginSeenAt: 0, pluginVersion: null };
const FRESH_MS = 45_000;

async function request(url: string, init: RequestInit, lifetime?: AbortSignal): Promise<Response> {
  const deadline = new AbortController();
  const cancel = () => deadline.abort();
  if (lifetime?.aborted) cancel(); else lifetime?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 8000);
  try {
    const response = await fetch(url, { ...init, signal: deadline.signal });
    // Keep the deadline active while reading the response body as well.
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  finally { clearTimeout(timer); lifetime?.removeEventListener('abort', cancel); }
}

export function useDistractionSettings(enabled = true) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [paired, setPaired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [checkedAt, setCheckedAt] = useState(0);
  const current = useRef(EMPTY);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const pendingSave = useRef<SettingsSaveAttempt | null>(null);
  const controller = useRef<AbortController | null>(null);

  const accept = useCallback((data: AgentPreferencesSnapshot) => {
    if (!mounted.current || !Number.isSafeInteger(data.revision) || data.revision < current.current.revision) return;
    if (data.settings !== null && !parseDistractionPreferences(data.settings)) throw new Error('Your plugin returned unsupported settings. Update it and try again.');
    // Overlapping polls can return out of order even at the same revision.
    const next = data.revision === current.current.revision ? {
      ...data, appliedRevision: Math.max(data.appliedRevision, current.current.appliedRevision),
      pluginSeenAt: Math.max(data.pluginSeenAt, current.current.pluginSeenAt),
    } : data;
    current.current = next;
    setSnapshot(next);
    if (pendingSave.current) {
      const outcome = settingsSaveOutcome(pendingSave.current, next);
      if (outcome === 'confirmed') {
        setSaveError('');
        // The POST can still time out after this proof arrives. Keep the attempt
        // until its caller has settled so the catch path can recognize success.
        if (!saveInFlight.current) pendingSave.current = null;
      } else if (outcome === 'conflict') {
        pendingSave.current = null;
        setSaveError('Settings changed in another window. Review the latest mix.');
      }
    }
  }, []);

  const refresh = useCallback(async (): Promise<AgentPreferencesSnapshot | null> => {
    const token = readAgentToken();
    if (!token || !mounted.current) return null;
    setCheckedAt(Date.now());
    try {
      const response = await request(`/api/agent/${token}/settings`, { cache: 'no-store' }, controller.current?.signal);
      if (!response.ok) throw new Error('Could not reach your distraction. Check your connection and try again.');
      const data: AgentPreferencesSnapshot = await response.json();
      accept(data);
      if (mounted.current) { setRequestError(''); setCheckedAt(Date.now()); setLoading(false); }
      return data;
    } catch (error) {
      if (mounted.current) { setLoading(false); setRequestError(error instanceof Error ? error.message : 'Could not load settings.'); }
      return null;
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    if (!enabled) { setLoading(false); return () => { mounted.current = false; controller.current?.abort(); }; }
    const token = readAgentToken();
    setPaired(!!token);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    if (token) void poll(); else setLoading(false);
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); controller.current?.abort(); };
  }, [refresh, enabled]);

  const save = useCallback(async (next: DistractionPreferences): Promise<boolean> => {
    const token = readAgentToken();
    if (saveInFlight.current) return false;
    const settings = parseDistractionPreferences(next);
    if (!token || !settings || !current.current.settings) {
      setSaveError('Open your distraction through the updated plugin first.');
      return false;
    }
    saveInFlight.current = true;
    const attempt = settingsSaveAttempt(current.current, settings);
    pendingSave.current = attempt;
    setSaving(true); setSaveError('');
    try {
      const response = await request(`/api/agent/${token}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', settings, expectedRevision: attempt.expectedRevision, mutationId: crypto.randomUUID() }),
      }, controller.current?.signal);
      // A rejected mutation is a real failure, even if a separate change later
      // happens to produce the same settings. Only uncertain requests reconcile.
      if (!response.ok) pendingSave.current = null;
      const data: AgentPreferencesSnapshot & { error?: string } = await response.json();
      if (typeof data.revision === 'number') accept(data);
      if (!response.ok) throw new Error(data.error || 'Could not save settings. Try again.');
      const deadline = Date.now() + 12_000;
      while (mounted.current && Date.now() < deadline) {
        const latest = current.current;
        const outcome = settingsSaveOutcome(attempt, latest);
        if (pendingSave.current !== attempt || outcome === 'conflict') {
          pendingSave.current = null;
          throw new Error('Settings changed in another window. Review the latest mix.');
        }
        if (outcome === 'confirmed') { pendingSave.current = null; setSaveError(''); return true; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (mounted.current) setSaveError('Waiting for your plugin to apply this change. Open your distraction through your agent, or tell it “Stop distracting” / “Keep distracting.”');
      return false;
    } catch (error) {
      if (mounted.current && pendingSave.current === attempt && settingsSaveOutcome(attempt, current.current) === 'confirmed') {
        pendingSave.current = null; setSaveError('');
        return true;
      }
      if (mounted.current) setSaveError(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Could not confirm the change. Check your connection or tell your agent to change your distractions.');
      return false;
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [accept]);

  return {
    ...snapshot, paired, loading, saving, refresh, save,
    pending: saving || snapshot.revision > snapshot.appliedRevision,
    connected: paired && !requestError && checkedAt > 0 && snapshot.pluginSeenAt > 0 && checkedAt - snapshot.pluginSeenAt < FRESH_MS,
    error: saveError || requestError,
  };
}
