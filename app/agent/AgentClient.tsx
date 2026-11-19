'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import DistractionPreferencesPicker from '../components/DistractionPreferencesPicker';
import FamilyGuyPromo from '../components/FamilyGuyPromo';
import { readAgentToken } from '../games/engine/useAgentSync';
import {
  DEFAULT_DISTRACTION_PREFERENCES, buildSetupPrompt, getEligibleGames,
  parseDistractionPreferences, type DistractionPreferences,
} from '../lib/distractionPreferences';
import { useDistractionSettings } from '../lib/useDistractionSettings';
import { trackEvent } from '../lib/analytics';

const DRAFT_KEY = 'inad:setup-preferences:v1';

export default function AgentClient({ clips, clipCount }: { clips: boolean; clipCount: number }) {
  const [preferences, setPreferences] = useState<DistractionPreferences>(DEFAULT_DISTRACTION_PREFERENCES);
  const [hasToken, setHasToken] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const dirty = useRef(false);
  const sync = useDistractionSettings(!clips);

  useEffect(() => {
    // Older plugins opened setup. Keep the secret in the fragment and let the
    // dedicated player consume it rather than turning the website into a popup.
    if (/^#t=[A-Za-z0-9_-]{20,64}(&popup)?$/.test(window.location.hash)) {
      window.location.replace(`/arcade${window.location.search}${window.location.hash}`);
      return;
    }
    setHasToken(!!readAgentToken());
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      const parsed = saved ? parseDistractionPreferences(JSON.parse(saved)) : null;
      if (parsed) setPreferences(parsed);
    } catch { /* The copied prompt works without browser storage. */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && sync.settings && !dirty.current) setPreferences(sync.settings);
  }, [ready, sync.settings]);

  function changePreferences(next: DistractionPreferences) {
    dirty.current = true;
    setPreferences(next);
    setSaveNote('');
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { /* optional */ }
  }

  const games = getEligibleGames(preferences);
  async function savePreferences() {
    setSaveNote('');
    const saved = await sync.save({ ...preferences, enabled: sync.settings?.enabled ?? preferences.enabled });
    if (saved) { dirty.current = false; setSaveNote('Your game mix is saved on this computer.'); }
  }

  async function toggleDistractions() {
    if (!sync.settings) return;
    setSaveNote('');
    await sync.save({ ...sync.settings, enabled: !sync.settings.enabled });
  }

  return (
    <div className="pair-page">
      <header className="pair-nav">
        <Link href="/" className="pair-brand"><span aria-hidden="true">✳</span><span>i need a <strong>distraction.</strong></span></Link>
        <nav aria-label="Agent setup navigation">
          <Link href={clips ? '/agent' : '/games'}>{clips ? 'Game setup' : 'Just play'}</Link>
          {!clips && <Link href="/arcade">Open player</Link>}
        </nav>
      </header>

      <main className="pair-main">
        {clips ? (
          <section className="pair-hero pair-clips-hero" aria-labelledby="pair-title">
            <div>
              <h1 id="pair-title">Family Guy<br /><em>clips.</em></h1>
              <p className="pair-lede">Watch a scene while Codex or Claude Code works. Your popup rotates through {clipCount} clips and pauses when your agent needs you.</p>
              <p className="pair-clips-returning">Already paired? Choose <strong>Family Guy clips</strong> in your agent popup. It remembers that choice.</p>
            </div>
            <SetupPrompt selection="family-guy" ready={ready} />
          </section>
        ) : <>
        <section className="pair-hero" aria-labelledby="pair-title">
          <div className="pair-hero-copy">
            <p className="pair-eyebrow">A LITTLE PLAY WHILE THE WORK GETS DONE</p>
            <h1 id="pair-title">Your agent works.<br /><em>You play.</em></h1>
            <p className="pair-lede">Good games for the in-between. Pick your favorites, pair your agent, and play until it needs you.</p>
            <div className="pair-promises"><span>Free to play</span><span>No account needed</span><span>Always an off switch</span></div>
            <FamilyGuyPromo clipCount={clipCount} location="agent_hero" />
          </div>
          <div className="pair-hero-art" aria-hidden="true">
            <div className="pair-art-orbit pair-art-orbit-one" />
            <div className="pair-art-orbit pair-art-orbit-two" />
            <div className="pair-art-tile pair-art-tile-merge"><span>2</span><span>4</span><span>8</span></div>
            <div className="pair-art-tile pair-art-tile-shapes"><i /><i /><i /><i /><i /></div>
            <div className="pair-art-tile pair-art-tile-sparks">✺</div>
            <div className="pair-art-caption">Small breaks. Your kind of fun.</div>
          </div>
        </section>

        {hasToken && (
          <section className="pair-connected" aria-label="Paired computer controls">
            <div>
              <p className="pair-connected-label">THIS PAIRED COMPUTER</p>
              <h2>{sync.loading ? 'Checking your plugin…' : sync.pending ? 'Applying your change…' : sync.settings ? `Distractions ${sync.settings.enabled ? 'on' : 'off'}` : sync.error ? 'Could not check your plugin' : 'Plugin update available'}</h2>
              <p>{sync.connected ? 'Your plugin is connected. You can update this computer here.' : !sync.loading && !sync.settings && !sync.error ? 'Your games still work. Copy the setup prompt below to update your plugin and get the new controls.' : 'Open the player through your agent to reconnect. You can still prepare a setup prompt below.'}</p>
            </div>
            <div className="pair-connected-actions">
              <button type="button" className="pair-secondary" disabled={!sync.settings || sync.saving || (sync.settings.enabled === false && (!sync.connected || sync.pending))} onClick={toggleDistractions}>{sync.settings?.enabled === false ? 'Keep distracting' : 'Stop distracting'}</button>
              <Link href="/arcade">Open my player</Link>
            </div>
            {sync.error && <p className="pair-error" role="alert">{sync.error}</p>}
          </section>
        )}

        <div className="pair-workspace">
          <section className="pair-preferences" aria-labelledby="pair-mix-title">
            <div className="pair-section-heading"><p className="pair-eyebrow">MAKE IT YOURS</p><h2 id="pair-mix-title">What feels like a break?</h2><p>Choose a few favorites, or let us surprise you.</p></div>
            <DistractionPreferencesPicker value={preferences} onChange={changePreferences} disabled={!ready || sync.saving} />
            {hasToken && sync.settings && (
              <div className="pair-save-row">
                <button type="button" className="pair-secondary" onClick={savePreferences} disabled={!sync.connected || sync.pending || games.length === 0}>{sync.pending ? 'Saving…' : 'Save my game mix'}</button>
                <p role="status">{saveNote || 'Changes apply to your next game. Your current run stays saved.'}</p>
              </div>
            )}
          </section>

          <SetupPrompt selection={preferences} ready={ready} />
        </div>

        <section className="pair-game-preview" aria-labelledby="pair-games-title">
          <div className="pair-section-heading pair-games-heading"><div><p className="pair-eyebrow">YOUR MIX, RIGHT NOW</p><h2 id="pair-games-title">A little preview of the fun.</h2></div><p>{games.length ? `${games.length} ${games.length === 1 ? 'game matches' : 'games match'} your choices. Try one in your browser.` : 'Make a new mix to see what you can play.'}</p></div>
          {games.length ? <div className="pair-game-grid">{games.map(game => <Link key={game.slug} href={`/games/${game.slug}`} className="pair-game-card" style={{ '--game-accent': game.accent } as CSSProperties}><div className="pair-game-art">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/shelf/${game.slug}.jpg`} alt="" loading="lazy" /><span className="pair-game-play">Play</span></div><div><h3>{game.title}</h3><p>{game.tagline}</p><small>{game.pace}</small></div></Link>)}</div> : <div className="pair-empty"><h3>No games in this mix yet.</h3><p>Select another category or turn off “No timer” to find your next game.</p></div>}
        </section>

        <section className="pair-control-note" aria-label="Easy distraction controls"><span aria-hidden="true">✳</span><div><h2>Fun, on your terms.</h2><p>Press <strong>Stop distracting</strong> in the player, or say it to your agent. It stays off until you say <strong>Keep distracting</strong>. Your games and preferences will be waiting.</p></div><Link href="/arcade">Open the player</Link></section>
        </>}
      </main>
      <footer className="pair-footer"><Link href="/">i need a distraction.</Link><div><Link href="/privacy">Privacy</Link><a href="https://github.com/goodmeasurelabs/ineedadistraction">Plugin source</a></div></footer>
    </div>
  );
}

function SetupPrompt({ selection, ready }: { selection: DistractionPreferences | 'family-guy'; ready: boolean }) {
  const [platform, setPlatform] = useState<'codex' | 'claude'>('codex');
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [failedPrompt, setFailedPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const platformName = platform === 'codex' ? 'Codex' : 'Claude Code';
  const clips = selection === 'family-guy';
  const eligible = clips || getEligibleGames(selection).length > 0;
  const prompt = clips ? buildSetupPrompt(platform, 'family-guy')
    : selection.categories.length ? buildSetupPrompt(platform, { ...selection, enabled: true }) : '';
  const copied = !!prompt && copiedPrompt === prompt;
  const copyError = !!prompt && failedPrompt === prompt;

  async function copyPrompt() {
    setFailedPrompt('');
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      trackEvent('agent_setup_prompt_copied', clips
        ? { platform, mode: 'family-guy' }
        : { platform, categories: selection.categories.join(','), pace: selection.pace });
    } catch {
      setShowPrompt(true);
      setFailedPrompt(prompt);
    }
  }

  return (
    <aside className="pair-setup" aria-labelledby="pair-setup-title">
      {!clips && <p className="pair-eyebrow">READY WHEN YOU ARE</p>}
      <h2 id="pair-setup-title">{clips ? 'Pair your agent' : <>Meet your new <br />waiting routine.</>}</h2>
      <p className="pair-setup-lede">{clips ? 'Copy a prompt and paste it into your local coding agent.' : 'One prompt brings your game mix to your agent.'}</p>
      <fieldset className="pair-platform"><legend>Which agent do you use?</legend><div>
        <button type="button" aria-pressed={platform === 'codex'} onClick={() => setPlatform('codex')}>Codex</button>
        <button type="button" aria-pressed={platform === 'claude'} onClick={() => setPlatform('claude')}>Claude Code</button>
      </div></fieldset>
      <button type="button" className="pair-primary" disabled={!ready || !eligible} onClick={copyPrompt}>{copied ? 'Copied! Paste into your agent' : 'Copy my setup prompt'}</button>
      <div className="pair-copy-feedback" role="status">{copied ? `Paste into ${platformName}. Your paired player opens in its own window.` : !eligible ? 'Choose at least one available game style to continue.' : clips ? 'In the popup, choose “Family Guy clips” to start watching.' : 'Your choices are included. Change them any time.'}</div>
      {copyError && <p className="pair-error" role="alert">Copy is unavailable in this browser. Select the prompt below and copy it manually.</p>}
      <button type="button" className="pair-prompt-toggle" aria-expanded={showPrompt} aria-controls="pair-prompt-preview" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? 'Hide setup prompt' : 'Read the prompt first'}</button>
      {showPrompt && <div id="pair-prompt-preview" className="pair-prompt-preview"><label htmlFor="pair-setup-prompt">Your setup prompt for {platformName}</label><textarea id="pair-setup-prompt" ref={promptRef} readOnly value={prompt} rows={9} /><button type="button" className="pair-text-button" onClick={() => { promptRef.current?.focus(); promptRef.current?.select(); }}>Select prompt text</button></div>}
      {!clips && <>
        <ol className="pair-how"><li><strong>Paste it into your agent.</strong><span>It sets up the plugin and your chosen games.</span></li><li><strong>Complete the setup.</strong><span>{platform === 'codex' ? 'Review and trust the plugin hooks in Codex when prompted.' : 'Review the plugin installation in Claude Code and reload if requested.'}</span></li><li><strong>Play while it works.</strong><span>Your game pauses when that turn finishes or your agent needs you.</span></li></ol>
        <p className="pair-setup-note">For local Codex and Claude Code sessions. Copying a prompt starts setup; the player confirms the connection.</p>
      </>}
    </aside>
  );
}
