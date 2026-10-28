const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** 1.98841e30 → "1.988 × 10³⁰" */
export function sci(value: number, digits = 4): string {
  if (value === 0) return '0';
  const [m, e] = value.toExponential(digits - 1).split('e');
  const exp = Number(e);
  if (exp >= -2 && exp < 5) return fixed(value, Math.max(0, digits - 1 - exp));
  return `${m} × 10${String(exp).split('').map((c) => SUP[c] ?? c).join('')}`;
}

export function fixed(value: number, digits: number): string {
  // avoid "-0.000" for tiny negative values
  if (Math.abs(value) < 0.5 * 10 ** -digits) value = 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function duration(hours: number): string {
  if (!hours) return '—';
  const h = Math.abs(hours);
  const s = h >= 48 ? `${fixed(h / 24, 2)} d` : `${fixed(h, 2)} h`;
  return hours < 0 ? `${s} retro.` : s;
}

/** Julian date (TDB) → "YYYY-MM-DD HH:MM". TDB differs from UTC by ≈69 s; we label it TDB. */
export function jdToCalendar(jd: number): string {
  const d = new Date((jd - 2440587.5) * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function elapsed(days: number): string {
  if (days < 365.25) return `${fixed(days, 1)} d`;
  return `${fixed(days / 365.25, 2)} yr`;
}

/** Simulated days per real second → "1 wk/s", "2.50 d/s", … */
export function rateLabel(daysPerS: number, presets: readonly { label: string; daysPerSecond: number }[] = []): string {
  const preset = presets.find((p) => Math.abs(p.daysPerSecond - daysPerS) < 1e-9);
  if (preset) return preset.label;
  if (daysPerS >= 365.25) return `${fixed(daysPerS / 365.25, 2)} yr/s`;
  if (daysPerS >= 1) return `${fixed(daysPerS, 2)} d/s`;
  return `${fixed(daysPerS * 24, 2)} h/s`;
}
