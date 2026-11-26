'use client';

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import GameClient from '../games/[slug]/GameClient';
import { getGame } from '../games/registry';
import { useAgentSync } from '../games/engine/useAgentSync';
import { useDistractionSettings } from '../lib/useDistractionSettings';
import { DEFAULT_DISTRACTION_PREFERENCES, getEligibleGames, parseDistractionPreferences, type DistractionPreferences } from '../lib/distractionPreferences';
import DistractionPreferencesPicker from '../components/DistractionPreferencesPicker';
import AgentQueue from '../components/AgentQueue';
import { trackEvent } from '../lib/analytics';
import { INITIAL_DISTRACTION_HOLD, distractionHoldReducer } from '../lib/distractionHold';
import { initializeArcadePairing, prefersPopupClips, rememberPopupClips } from './popupSession';
import { initializePopupWindow, onPopupRefocus, popupHasFocus } from './clipWindow';
import { clipPlaybackForQueue } from './clips/clipTurn';

const DRAFT_KEY = 'inad:setup-preferences:v1';
const FamilyGuyClips = dynamic(() => import('./clips/FamilyGuyClips'), {
  loading: () => <p className="arcade-message" role="status">Opening clips…</p>,
});

export default function ArcadeClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isPluginPopup, setIsPluginPopup] = useState(false);
  const [pairingError, setPairingError] = useState('');

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const hasPairing = fragment.has('t') || fragment.has('popup');
    if (hasPairing) {
      // Strip the credential before any analytics call or subsequent render.
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl);
      // Keep Next's canonical URL in sync so hydration cannot restore the hash.
      router.replace(cleanUrl, { scroll: false });
    }
    const { popup, error } = initializeArcadePairing(fragment);
    initializePopupWindow({ popup, freshLaunch: hasPairing });
    if (error === 'invalid') setPairingError('That pairing link is incomplete. Ask your agent to open your distraction again.');
    else if (error === 'storage') setPairingError('This browser could not save the pairing. Allow site storage, then ask your agent to open your distraction again.');
    else if (hasPairing) trackEvent('agent_pairing_link_opened', {});
    setIsPluginPopup(popup);
    setReady(true);
  }, [router]);

  // Mount polling only after the fragment is consumed: the popup has a separate
  // browser profile, and may have no token at all on its first render.
  if (!ready) return <main className="arcade-loading"><span>✳</span><p>Opening your distraction…</p></main>;
  return <Player pairingError={pairingError} isPluginPopup={isPluginPopup} />;
}

function Player({ pairingError, isPluginPopup }: { pairingError: string; isPluginPopup: boolean }) {
  const agent = useAgentSync(!pairingError);
  const control = useDistractionSettings(!pairingError);
  const [guest, setGuest] = useState(DEFAULT_DISTRACTION_PREFERENCES);
  const [selected, setSelected] = useState<string | null>(null);
  const [watchingClips, setWatchingClips] = useState<'restored' | 'selected' | null>(() =>
    isPluginPopup && !new URLSearchParams(window.location.search).has('game') && prefersPopupClips() ? 'restored' : null
  );
  const [manualClipScope, setManualClipScope] = useState<string | null>(null);
  const [returningToAgent, setReturningToAgent] = useState(false);
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
  const clipsAvailable = isPluginPopup && !!control.settings;
  const clipsActive = clipsAvailable && !!watchingClips;
  const clipConnectionReady = control.connected && agent.connected;
  const clipControlsReady = notificationsEnabled && !control.saving && clipConnectionReady;
  const clipPlayback = clipPlaybackForQueue(agent, manualClipScope, returningToAgent);
  const clearManualClip = manualClipScope !== null &&
    (!clipConnectionReady || off || !!agent.notice || manualClipScope !== clipPlayback.scope);

  useEffect(() => {
    // A new interruption or a disconnect ends manual viewing until this popup
    // explicitly resumes it. Acknowledgements from other windows only update the queue.
    if (clearManualClip) setManualClipScope(null);
  }, [clearManualClip]);

  useLayoutEffect(() => {
    if (returningToAgent) return onPopupRefocus(() => setReturningToAgent(false));
  }, [returningToAgent]);

  function pauseForAgent() {
    setManualClipScope(null);
    setReturningToAgent(true);
  }

  function playClipManually() {
    if (!clipControlsReady || !popupHasFocus()) return;
    setReturningToAgent(false);
    setManualClipScope(clipPlayback.scope);
  }

  function chooseClips(clips: boolean) {
    setReturningToAgent(false);
    if (isPluginPopup) rememberPopupClips(clips);
    setWatchingClips(clips ? 'selected' : null);
    if (clips && !agent.notice) playClipManually();
    else setManualClipScope(null);
    setNote('');
  }

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
    : hold.held ? 'Paused · Off not confirmed' : 'Distractions on';
  const offConfirmed = control.settings?.enabled === false && !applying && !control.saving;

  return (
    <main className={clipsActive ? 'arcade-shell is-watching-clips' : 'arcade-shell'}>
      <header className="arcade-controls">
        <div className="arcade-brand-row">
          <button className="arcade-brand" onClick={() => { chooseClips(false); setSelected(null); }} aria-label="Your game mix"><span aria-hidden="true">✳</span> distraction.</button>
          {!clipsActive && <div className="arcade-choices">
            {clipsAvailable && <button className="arcade-clips-choice" disabled={off || control.pending} onClick={() => chooseClips(true)}><span aria-hidden="true">▶</span> Family Guy clips</button>}
            <button className="arcade-customize" onClick={openSettings}>Change games</button>
          </div>}
        </div>
        {clipsActive && notificationsEnabled && <AgentQueue agent={agent} onReturnToAgent={pauseForAgent} onResumeClips={playClipManually} onStopDistractions={() => void setEnabled(false)} />}
        <div className="arcade-mode-row"><span className={off ? 'arcade-mode is-off' : 'arcade-mode'} role="status">{modeLabel}</span>{basicPlayer
          ? <a href="/agent" target="_blank" rel="noreferrer">Get the new controls</a>
          : control.paired
          ? <button className="arcade-toggle" disabled={!control.settings || control.saving || (off && control.pending)} onClick={() => void setEnabled(off ? true : false)}>{off ? 'Keep distracting' : 'Stop distracting'}</button>
          : <a href="/agent" target="_blank" rel="noreferrer">Pair your agent</a>}</div>
        {!clipsActive && <p className="arcade-scope">{basicPlayer ? 'Keep playing while you update your plugin.' : control.paired ? (control.connected ? 'Connected on this computer · Codex + Claude Code' : 'Plugin not connected · Open your distraction from your agent') : 'No account needed. Pick a game below.'}</p>}
      </header>

      {(pairingError || control.error) && <p className="arcade-message is-error" role="alert">{pairingError || control.error}</p>}
      {note && <p className="arcade-message" role="status">{note}</p>}
      {basicPlayer && <p className="arcade-message">Update your plugin to save on/off and game preferences. <a href="/agent" target="_blank" rel="noreferrer">Copy a setup prompt</a></p>}

      <div className="arcade-game-area">
        {clipsActive ? <div className="arcade-watch">
          {!clipConnectionReady && !off && <p className="arcade-message" role="status">
            {control.connected && agent.state === 'unpaired'
              ? 'Waiting for your first turn. Send a prompt to Codex or Claude Code.'
              : 'Clip paused while your agent reconnects.'}
          </p>}
          <FamilyGuyClips
            foreground={clipPlayback.foreground}
            suspended={!clipControlsReady || !clipPlayback.allowed}
            onPlay={clipControlsReady && !agent.notice && !clipPlayback.allowed ? playClipManually : undefined}
            sound={preferences.sound}
            startWithSound={watchingClips === 'selected' && preferences.sound}
            onBack={() => chooseClips(false)}
          />
        </div> : selected && getGame(selected) ? <GameClient key={selected} slug={selected} allowedSlugs={eligible.map((game) => game.slug)} arcade={{
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
          <span className="arcade-off-mark" aria-hidden="true">Ⅱ</span><h1>{offConfirmed ? 'Distractions are off.' : control.pending ? 'Turning distractions off…' : clipsActive ? 'Your clip is paused.' : 'Your game is paused.'}</h1>
          <p>{offConfirmed ? 'No automatic popups until you turn them back on.' : 'Waiting for your plugin to confirm that automatic popups are off.'}</p>
          {!offConfirmed && !control.pending && control.settings?.enabled && <button onClick={() => void setEnabled(false)}>Retry stop</button>}
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
