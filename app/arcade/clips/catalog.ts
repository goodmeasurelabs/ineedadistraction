export type Clip = { id: string; title: string; channel: string };

// Official uploads. Only these fixed IDs may be embedded in the popup.
export const FAMILY_GUY_CLIPS: readonly Clip[] = [
  { id: 'JCNMNcUp9Os', title: 'Peter Delivers a Baby', channel: 'Family Guy' },
  { id: '1K4tfKqJ1eM', title: 'Meg Finally Stands Up to Lois', channel: 'Hulu' },
  { id: 'BjX1ITzuJ_k', title: 'Stewie and Brian: Where’s My Money!?', channel: 'Hulu' },
];

export function shuffledClips(previous?: string, unavailable?: ReadonlySet<string>): Clip[] {
  const clips = FAMILY_GUY_CLIPS.filter((clip) => !unavailable?.has(clip.id));
  for (let i = clips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  if (clips.length > 1 && clips[0].id === previous) [clips[0], clips[1]] = [clips[1], clips[0]];
  return clips;
}
