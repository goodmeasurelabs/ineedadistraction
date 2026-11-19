'use client';

import { useId, type CSSProperties } from 'react';
import { GAME_CATEGORIES, getEligibleGames, type DistractionPreferences, type GameCategoryId } from '../lib/distractionPreferences';
import './distraction-preferences.css';

type Props = {
  value: DistractionPreferences;
  onChange: (next: DistractionPreferences) => void;
  compact?: boolean;
  disabled?: boolean;
};

export default function DistractionPreferencesPicker({ value, onChange, compact = false, disabled = false }: Props) {
  const id = useId();
  const available = GAME_CATEGORIES.filter(category => category.available);
  const allSelected = available.every(category => value.categories.includes(category.id));
  const count = getEligibleGames(value).length;

  function toggle(category: GameCategoryId) {
    const categories = value.categories.includes(category) ? value.categories.filter(item => item !== category) : [...value.categories, category];
    onChange({ ...value, categories });
  }

  return (
    <div className={`distraction-picker${compact ? ' distraction-picker-compact' : ''}`}>
      <div className="dp-toolbar"><span id={`${id}-label`}>Your game styles</span><button type="button" aria-pressed={allSelected} disabled={disabled} onClick={() => onChange({ ...value, categories: available.map(category => category.id) })}>Surprise me</button></div>
      <div className="dp-categories" role="group" aria-labelledby={`${id}-label`}>
        {GAME_CATEGORIES.map(category => {
          const selected = value.categories.includes(category.id);
          return (
            <button key={category.id} type="button" className={`dp-category${category.available ? '' : ' dp-coming'}`} aria-pressed={category.available ? selected : undefined} disabled={disabled || !category.available} onClick={() => toggle(category.id)} style={{ '--category-accent': category.accent } as CSSProperties}>
              <span className="dp-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={category.image} alt="" loading={compact ? 'lazy' : 'eager'} onError={event => { event.currentTarget.style.opacity = '0'; }} />
                <span className="dp-art-glow" />
                {category.available ? <span className="dp-check" aria-hidden="true">{selected ? '✓' : '+'}</span> : <span className="dp-soon">Coming later</span>}
              </span>
              <span className="dp-category-body"><span className="dp-category-title">{category.title}</span><span className="dp-category-description">{category.description}</span>{!compact && <span className="dp-examples">{category.available ? category.examples.join(' · ') : 'More ways to play are on the way'}</span>}</span>
            </button>
          );
        })}
      </div>
      <div className="dp-options">
        <label className="dp-option"><input type="checkbox" aria-label="No timer" aria-describedby={`${id}-pace-help`} checked={value.pace === 'untimed'} disabled={disabled} onChange={event => onChange({ ...value, pace: event.target.checked ? 'untimed' : 'any' })} /><span><strong>No timer</strong><small id={`${id}-pace-help`}>Play at your own pace</small></span></label>
        <label className="dp-option"><input type="checkbox" aria-label="Game sound" aria-describedby={`${id}-sound-help`} checked={value.sound} disabled={disabled} onChange={event => onChange({ ...value, sound: event.target.checked })} /><span><strong>Game sound</strong><small id={`${id}-sound-help`}>{value.sound ? 'Sound is on' : 'Keep it quiet'}</small></span></label>
      </div>
      <p className={`dp-match-count${count === 0 ? ' dp-no-matches' : ''}`} role="status">{count ? `${count} ${count === 1 ? 'game fits' : 'games fit'} your mix. Change it whenever you like.` : 'No games match yet. Choose an available style or turn off “No timer”.'}</p>
    </div>
  );
}
