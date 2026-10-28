/**
 * Screen-space picking for bodies that are often only a few pixels wide at true scale.
 * Pure functions: interaction tolerance lives here and never touches physical radii.
 */
export interface PickCandidate {
  id: string;
  /** Projected centre, CSS pixels. */
  x: number;
  y: number;
  /** Projected radius of the rendered sphere, CSS pixels. */
  screenRadius: number;
  /** Distance from the camera, any consistent unit. */
  depth: number;
}

export const PICK_TOLERANCE_PX = { mouse: 18, touch: 30 } as const;

/**
 * Returns candidate ids, best first.
 * 1. Markers: bodies whose centre lies within the tolerance (small bodies win over a large disc
 *    they sit in front of or beside), nearest centre first.
 * 2. Disc hits: the pointer is on the rendered sphere, nearest to the camera first.
 * 3. Near misses: within tolerance of the sphere's edge, nearest edge first.
 * A marker hidden behind a nearer disc that it is smaller than is excluded (occluded).
 */
export function rankPicks(cands: readonly PickCandidate[], px: number, py: number, tolerance: number): string[] {
  const scored = cands.map((c) => {
    const d = Math.hypot(c.x - px, c.y - py);
    return { c, d, edge: Math.max(0, d - c.screenRadius) };
  });
  const discHits = scored.filter((s) => s.d <= s.c.screenRadius);
  const occluded = (s: (typeof scored)[number]) =>
    discHits.some((h) => h.c.id !== s.c.id && h.c.depth < s.c.depth && h.c.screenRadius > s.c.screenRadius);

  const markers = scored.filter((s) => s.d <= tolerance && !occluded(s)).sort((a, b) => a.d - b.d || a.c.depth - b.c.depth);
  const discs = discHits.filter((s) => !markers.includes(s)).sort((a, b) => a.c.depth - b.c.depth);
  const near = scored
    .filter((s) => s.edge > 0 && s.edge <= tolerance && !markers.includes(s) && !occluded(s))
    .sort((a, b) => a.edge - b.edge || a.c.depth - b.c.depth);
  return [...markers, ...discs, ...near].map((s) => s.c.id);
}

/** Picks from a ranking; repeated clicks on the same spot cycle through overlapping bodies. */
export function choosePick(ranked: readonly string[], selected: string | null, sameSpot: boolean): string | null {
  if (!ranked.length) return null;
  if (sameSpot && selected && ranked.length > 1) {
    const i = ranked.indexOf(selected);
    if (i >= 0) return ranked[(i + 1) % ranked.length];
  }
  return ranked[0];
}
