import { AU_KM, DAY_S } from '../physics/units';

/**
 * Unit tables for console input. Every quantity must carry an explicit unit; bare numbers are
 * rejected so nothing ambiguous is ever guessed. Values convert to SI-ish canonical units:
 * mass → kg, length → km, speed → km/s, duration → days.
 */
export const MASS_UNITS: Record<string, number> = {
  kg: 1,
  t: 1e3,
  mearth: 5.97219e24,
  mjup: 1.89819e27,
  msun: 1.98841e30,
};

export const LENGTH_UNITS: Record<string, number> = {
  m: 1e-3,
  km: 1,
  rearth: 6371.01,
  rjup: 69911,
  rsun: 695700,
  au: AU_KM,
};

export const SPEED_UNITS: Record<string, number> = {
  'm/s': 1e-3,
  'km/s': 1,
  'km/h': 1 / 3600,
  'au/d': AU_KM / DAY_S,
};

export const DURATION_UNITS: Record<string, number> = {
  s: 1 / DAY_S,
  min: 60 / DAY_S,
  h: 1 / 24,
  d: 1,
  wk: 7,
  mo: 30.436875, // mean Gregorian month
  yr: 365.25, // Julian year
};

const ALIASES: Record<string, string> = {
  sec: 's', secs: 's', second: 's', seconds: 's',
  mins: 'min', minute: 'min', minutes: 'min',
  hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  day: 'd', days: 'd',
  w: 'wk', week: 'wk', weeks: 'wk',
  month: 'mo', months: 'mo',
  y: 'yr', year: 'yr', years: 'yr',
  'm⊕': 'mearth', 'me': 'mearth', 'm☉': 'msun', 'ms': 'msun', 'mj': 'mjup',
  'r⊕': 'rearth', 're': 'rearth', 'r☉': 'rsun', 'rj': 'rjup',
  kms: 'km/s', 'km/sec': 'km/s', 'au/day': 'au/d',
};

export type Quantity = 'mass' | 'length' | 'speed' | 'duration';
const TABLES: Record<Quantity, Record<string, number>> = { mass: MASS_UNITS, length: LENGTH_UNITS, speed: SPEED_UNITS, duration: DURATION_UNITS };
export const CANONICAL: Record<Quantity, string> = { mass: 'kg', length: 'km', speed: 'km/s', duration: 'd' };

export function unitNames(q: Quantity): string[] {
  const display: Record<string, string> = { mearth: 'Mearth', mjup: 'Mjup', msun: 'Msun', rearth: 'Rearth', rjup: 'Rjup', rsun: 'Rsun' };
  return Object.keys(TABLES[q]).map((u) => display[u] ?? u);
}

export class UnitError extends Error {}

/** Looks a unit up (case-insensitive, with aliases). Returns the factor to the canonical unit. */
export function unitFactor(unit: string, q: Quantity): number {
  const key = unit.toLowerCase();
  const name = ALIASES[key] ?? key;
  const f = TABLES[q][name];
  if (f === undefined) throw new UnitError(`Unknown ${q} unit "${unit}". Use one of: ${unitNames(q).join(', ')}.`);
  return f;
}

export function parseNumber(text: string, what = 'value'): number {
  // Plain decimal or scientific notation only; no hex, no "Infinity".
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) throw new UnitError(`"${text}" is not a number (${what}).`);
  const v = Number(text);
  if (!Number.isFinite(v)) throw new UnitError(`${what} is out of range.`);
  return v;
}

/**
 * Parses "<number> <unit>" from tokens[i], tokens[i+1], also accepting the glued form "1.5d".
 * Returns the value in canonical units and the number of tokens consumed.
 */
export function parseQuantity(tokens: readonly string[], i: number, q: Quantity, what: string): { value: number; used: number } {
  const t = tokens[i];
  if (t === undefined) throw new UnitError(`Missing ${what} (e.g. ${example(q)}).`);
  const glued = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z/⊕☉]+.*)$/i.exec(t);
  if (glued) return { value: parseNumber(glued[1], what) * unitFactor(glued[2], q), used: 1 };
  const v = parseNumber(t, what);
  const u = tokens[i + 1];
  if (u === undefined) throw new UnitError(`${what} needs a unit: ${unitNames(q).join(', ')} (e.g. ${example(q)}).`);
  return { value: v * unitFactor(u, q), used: 2 };
}

function example(q: Quantity) {
  return { mass: '2 Mearth', length: '80000 km', speed: '24 km/s', duration: '1 d' }[q];
}
