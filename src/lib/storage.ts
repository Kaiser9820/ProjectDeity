import type { Settings } from '../types';
import { DEFAULT_RATE_INDEX, MAX_RATE_DAYS_PER_S, RATE_PRESETS } from '../simulation/GravitySimulation';
import { BODY_SCALES, DEFAULT_BODY_SCALE } from '../scene/presentation';

const KEYS = {
  creator: 'deity.creatorName',
  settings: 'deity.settings',
  history: 'deity.terminalHistory',
} as const;

export const DEFAULT_SETTINGS: Settings = { reducedMotion: 'system', showOrbits: true, showLabels: true, rate: RATE_PRESETS[DEFAULT_RATE_INDEX].daysPerSecond, bodyScale: DEFAULT_BODY_SCALE };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota); app still works in-memory */
  }
}

export const storage = {
  getCreatorName: () => read(KEYS.creator),
  setCreatorName: (name: string) => write(KEYS.creator, name),

  getSettings(): Settings {
    const raw = read(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<Settings> & { rateIndex?: number };
      const s = { ...DEFAULT_SETTINGS, ...parsed };
      // Phase 2 stored a preset index; carry it over.
      if (parsed.rate === undefined && parsed.rateIndex !== undefined && RATE_PRESETS[parsed.rateIndex]) s.rate = RATE_PRESETS[parsed.rateIndex].daysPerSecond;
      delete (s as { rateIndex?: number }).rateIndex;
      if (!(typeof s.rate === 'number' && s.rate > 0 && s.rate <= MAX_RATE_DAYS_PER_S)) s.rate = DEFAULT_SETTINGS.rate;
      if (!BODY_SCALES.some((b) => b.id === s.bodyScale)) s.bodyScale = DEFAULT_BODY_SCALE;
      return s;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  setSettings: (s: Settings) => write(KEYS.settings, JSON.stringify(s)),

  getHistory(): string[] {
    try {
      const parsed: unknown = JSON.parse(read(KEYS.history) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(-100) : [];
    } catch {
      return [];
    }
  },
  setHistory: (h: string[]) => write(KEYS.history, JSON.stringify(h.slice(-100))),
};
