import { FAMILY_GUY_CLIPS, type Clip } from './catalog';

const HISTORY_KEY = 'inad:popup-family-guy-history:v1';
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createClipRotation(
  catalog: readonly Clip[] = FAMILY_GUY_CLIPS,
  storage: () => HistoryStorage = () => window.localStorage,
) {
  const clipsById = new Map(catalog.map((clip) => [clip.id, clip]));
  let history: string[] = [];
  let unsaved: string[] = [];

  // Keep one entry per current clip, from least to most recently offered.
  function orderedIds(ids: unknown[]) {
    const ordered = new Set<string>();
    for (const id of ids) {
      if (typeof id === 'string' && clipsById.has(id)) {
        ordered.delete(id);
        ordered.add(id);
      }
    }
    return [...ordered];
  }

  function readHistory() {
    try {
      const value = storage().getItem(HISTORY_KEY);
      const saved: unknown = value === null ? [] : JSON.parse(value);
      if (Array.isArray(saved)) history = orderedIds([...saved, ...unsaved]);
    } catch { /* Keep the popup's in-memory history when storage is unavailable. */ }
    return history;
  }

  function selectClip(excluded?: ReadonlySet<string>): Clip | null {
    const offered = readHistory();
    const seen = new Set(offered);
    const unseen = catalog.filter((clip) => !excluded?.has(clip.id) && !seen.has(clip.id));
    if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)];
    for (const id of offered) {
      if (!excluded?.has(id)) return clipsById.get(id)!;
    }
    return null;
  }

  function markClipOffered(id: string) {
    if (!clipsById.has(id)) return;
    history = orderedIds([...readHistory(), id]);
    try {
      storage().setItem(HISTORY_KEY, JSON.stringify(history));
      unsaved = [];
    } catch {
      // A readable but full store may still return the old order on the next draw.
      unsaved = orderedIds([...unsaved, id]);
    }
  }

  return { selectClip, markClipOffered };
}

export const { selectClip, markClipOffered } = createClipRotation();
