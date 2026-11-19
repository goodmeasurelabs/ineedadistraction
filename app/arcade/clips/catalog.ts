import clips from './familyGuy.json';

export type Clip = { id: string; title: string; channel: string };

// Only these reviewed publisher uploads may be embedded in the popup.
export const FAMILY_GUY_CLIPS: readonly Clip[] = clips;
