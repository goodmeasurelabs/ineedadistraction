'use client';

import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import GameClient from '../games/[slug]/GameClient';
import { getGame } from '../games/registry';
import { AGENT_TOKEN_KEY, readAgentToken, useAgentSync } from '../games/engine/useAgentSync';
import { useDistractionSettings } from '../lib/useDistractionSettings';
import { DEFAULT_DISTRACTION_PREFERENCES, getEligibleGames, parseDistractionPreferences, type DistractionPreferences } from '../lib/distractionPreferences';
import DistractionPreferencesPicker from '../components/DistractionPreferencesPicker';
import AgentQueue from '../components/AgentQueue';
import { trackEvent } from '../lib/analytics';
import { INITIAL_DISTRACTION_HOLD, distractionHoldReducer } from '../lib/distractionHold';

const DRAFT_KEY = 'inad:setup-preferences:v1';

export default function ArcadeClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pairingError, setPairingError] = useState('');

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('t');
    if (token) {
      // Strip the credential before any analytics call or subsequent render.
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl);
      // Keep Next's canonical URL in sync so hydration cannot restore the hash.
      router.replace(cleanUrl, { scroll: false });
      if (/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
        try {
          localStorage.setItem(AGENT_TOKEN_KEY, token);
          if (readAgentToken() !== token) throw new Error('Storage unavailable');
          trackEvent('agent_pairing_link_opened', {});
        } catch { setPairingError('This browser could not save the pairing. Allow site storage, then ask your agent to open your distraction again.'); }
      } else setPairingError('That pairing link is incomplete. Ask your agent to open your distraction again.');
    }
    setReady(true);
  }, [router]);

  // Mount polling only after the fragment is consumed: the popup has a separate
  // browser profile, and may have no token at all on its first render.
  if (!ready) return <main className="arcade-loading"><span>✳</span><p>Opening your distraction…</p></main>;
  return <Player pairingError={pairingError} />;
}

function Player({ pairingError }: { pairingError: string }) {
  const agent = useAgentSync();
  const control = useDistractionSettings();
  const [guest, setGuest] = useState(DEFAULT_DISTRACTION_PREFERENCES);
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, dispatchHold] = useReducer(distractionHoldReducer, INITIAL_DISTRACTION_HOLD);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_DISTRACTION_PREFERENCES);
  const [note, setNote] = useState('');
  const restored = useRef(false);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);
  const preferences = control.settings ?? guest;
  const eligible = getEligibleGames(preferences);
  const off = preferences.enabled === false || hold.held;
  const applying = control.revision > control.appliedRevision;
  const settingsUnavailable = control.paired && !control.loading && !control.settings && !!control.error;
  const basicPlayer = control.paired && !control.loading && !control.settings && !control.error;
  const notificationsEnabled = !off && !control.loading && !applying && !settingsUnavailable;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const saved = raw && parseDistractionPreferences(JSON.parse(raw));
      if (saved) setGuest({ ...saved, enabled: true });
    } catch { /* Standalone play still works without browser storage. */ }
  }, []);

  useEffect(() => {
    if (control.loading || restored.current) return;
    restored.current = true;
    try {
      const requested = new URLSearchParams(window.location.search).get('game') || localStorage.getItem('inad:last-game');
      if (requested && getEligibleGames(control.settings ?? guest).some((game) => game.slug === requested)) setSelected(requested);
    } catch { /* Pick a game below instead. */ }
  }, [control.loading, control.settings, guest]);

  useEffect(() => {
    dispatchHold({ type: 'snapshot', enabled: control.settings?.enabled, revision: control.revision, appliedRevision: control.appliedRevision });
  }, [control.settings?.enabled, control.revision, control.appliedRevision]);

  useEffect(() => {
    if (control.connected && !confirmed.current) {
      confirmed.current = true;
      trackEvent('agent_pairing_confirmed', { plugin_version: control.pluginVersion ?? 'unknown' });
    }
  }, [control.connected, control.pluginVersion]);

  function openSettings() {
    setDraft(preferences); setNote(''); setCustomizing(true);
    settingsDialog.current?.showModal();
  }
  function closeSettings() { settingsDialog.current?.close(); setCustomizing(false); }

  async function setEnabled(enabled: boolean) {
    if (!control.settings) return;
    // Off pauses immediately; an explicit On releases that local hold while
    // the saved Off value / pending acknowledgement still suspends the game.
    dispatchHold({ type: enabled ? 'on' : 'stop' });
    setNote('');
    const applied = await control.save({ ...control.settings, enabled });
    if (applied) {
      trackEvent('distraction_enabled_changed', { enabled });
    }
  }

  async function saveMix() {
    if (!parseDistractionPreferences(draft) || !getEligibleGames(draft).length) return;
    if (control.paired) {
      if (!await control.save({ ...draft, enabled: preferences.enabled })) return;
    } else {
      setGuest(draft);
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* optional */ }
    }
    trackEvent('distraction_preferences_saved', { categories: draft.categories.join(','), pace: draft.pace });
    setNote('Game mix saved. Your current game stays right here.');
    closeSettings();
  }

  function chooseGame(slug: string) {
    if (!eligible.some((game) => game.slug === slug)) return;
    setSelected(slug); setNote('');
  }

  function soundChanged(sound: boolean) {
    if (control.settings) void control.save({ ...control.settings, sound });
    else setGuest((previous) => ({ ...previous, sound }));
  }

  const modeLabel = control.loading ? 'Connecting…'
    : !control.paired ? 'Play your way'
    : !control.settings ? (basicPlayer ? 'Basic player · Update available' : 'Settings unavailable')
    : control.pending ? (preferences.enabled ? 'Applying your settings…' : 'Turning distractions off…')
    : preferences.enabled === false ? 'Distractions off'
    : hold.held ? 'Game paused · Off not confirmed' : 'Distractions on';
  const offConfirmed = control.settings?.enabled === false && !applying && !control.saving;

  return (
    <main className="arcade-shell">
      <header className="arcade-controls">
        <div className="arcade-brand-row"><button className="arcade-brand" onClick={() => setSelected(null)} aria-label="Your game mix"><span aria-hidden="true">✳</span> distraction.</button><button className="arcade-customize" onClick={openSettings}>Change games</button></div>
        <div className="arcade-mode-row"><span className={off ? 'arcade-mode is-off' : 'arcade-mode'} role="status">{modeLabel}</span>{basicPlayer
          ? <a href="/agent" target="_blank" rel="noreferrer">Get the new controls</a>
          : control.paired
          ? <button className="arcade-toggle" disabled={!control.settings || control.saving || (off && control.pending)} onClick={() => void setEnabled(off ? true : false)}>{off ? 'Keep distracting' : 'Stop distracting'}</button>
          : <a href="/agent" target="_blank" rel="noreferrer">Pair your agent</a>}</div>
        <p className="arcade-scope">{basicPlayer ? 'Keep playing while you update your plugin.' : control.paired ? (control.connected ? 'Connected on this computer · Codex + Claude Code' : 'Plugin not connected · Open your distraction from your agent') : 'No account needed. Pick a game below.'}</p>
      </header>

      {(pairingError || control.error) && <p className="arcade-message is-error" role="alert">{pairingError || control.error}</p>}
      {note && <p className="arcade-message" role="status">{note}</p>}
      {basicPlayer && <p className="arcade-message">Update your plugin to save on/off and game preferences. <a href="/agent" target="_blank" rel="noreferrer">Copy a setup prompt</a></p>}

      <div className="arcade-game-area">
        {selected && getGame(selected) ? <GameClient key={selected} slug={selected} allowedSlugs={eligible.map((game) => game.slug)} arcade={{
          agent, suspended: off || customizing || control.loading || applying || settingsUnavailable,
          notificationsEnabled: notificationsEnabled && !customizing,
          sound: preferences.sound, onSoundChange: soundChanged,
          onBack: () => setSelected(null), onChooseGame: chooseGame, onStopDistractions: control.settings ? () => void setEnabled(false) : undefined,
        }} /> : <div className="arcade-lobby">
          <div className="arcade-lobby-heading"><p>YOUR LITTLE ESCAPE</p><h1>What are we playing?</h1><span>Your mix. Pick up wherever you left off.</span></div>
          {notificationsEnabled && <AgentQueue agent={agent} onStopDistractions={control.settings ? () => void setEnabled(false) : undefined} />}
          <div className="arcade-game-list">
            {eligible.map((game) => <button key={game.slug} className="arcade-game-card" style={{ '--game-accent': game.accent } as CSSProperties} onClick={() => chooseGame(game.slug)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/shelf/${game.slug}.jpg`} alt="" />
              <span><strong>{game.title}</strong><small>{game.tagline}</small><em>{game.pace}</em></span><b aria-hidden="true">▶</b>
            </button>)}
          </div>
          {!eligible.length && <div className="arcade-empty"><h2>No games fit this mix yet.</h2><p>Choose another style or turn off “No timer”.</p><button onClick={openSettings}>Change games</button></div>}
          <p className="arcade-lobby-foot">{basicPlayer ? 'Your games still work. Update to get the new controls.' : control.paired ? 'Say “Stop distracting” to switch this off any time.' : 'Play here now. Pair with your agent whenever you like.'}</p>
        </div>}

        {off && <section className="arcade-off" aria-label="Distractions off" role="status">
          <span className="arcade-off-mark" aria-hidden="true">Ⅱ</span><h1>{offConfirmed ? 'Distractions are off.' : control.pending ? 'Turning distractions off…' : 'Your game is paused.'}</h1>
          <p>{offConfirmed ? 'No automatic popups until you turn them back on. Your game and your mix are saved.' : 'This game is paused. Automatic popups are off only after your plugin confirms the change.'}</p>
          <button disabled={control.pending} onClick={() => void setEnabled(true)}>Keep distracting</button>
          <p className="arcade-off-hint">Or tell your agent “Keep distracting”.</p>
        </section>}
        {!off && applying && <section className="arcade-applying" role="status"><p>Applying your settings…</p><small>Waiting for your plugin to confirm.</small></section>}
        {!off && settingsUnavailable && <section className="arcade-applying" role="status"><p>Could not load your settings.</p><small>Your game is paused while we reconnect.</small></section>}
      </div>

      <dialog className="arcade-settings" ref={settingsDialog} aria-labelledby="arcade-settings-title" onClose={() => setCustomizing(false)}>
        <div className="arcade-settings-header"><div><p>MAKE IT YOURS</p><h2 id="arcade-settings-title">A different kind of break.</h2></div><button className="arcade-close" onClick={closeSettings} aria-label="Close game preferences">×</button></div>
        <DistractionPreferencesPicker value={draft} onChange={setDraft} compact disabled={control.saving} />
        <p className="arcade-settings-note">Your current game stays open. This mix applies when you choose your next game.</p>
        {basicPlayer && <p className="arcade-settings-note">Update your plugin before saving this mix. <a href="/agent" target="_blank" rel="noreferrer">Get the setup prompt</a></p>}
        {control.error && <p className="arcade-message is-error" role="alert">{control.error}</p>}
        <div className="arcade-settings-actions"><button className="arcade-save" disabled={control.pending || !getEligibleGames(draft).length || (control.paired && !control.settings)} onClick={() => void saveMix()}>{control.pending ? 'Waiting for plugin…' : 'Save my mix'}</button><button onClick={closeSettings}>Cancel</button></div>
      </dialog>
    </main>
  );
}
