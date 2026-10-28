/** Damerau-free Levenshtein distance (small strings only). */
export function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Close matches for a typo: prefix matches first, then edit distance ≤ max(1, len/3). */
export function suggestions(input: string, candidates: readonly string[], limit = 3): string[] {
  const q = input.toLowerCase();
  const limitD = Math.max(1, Math.floor(q.length / 3));
  return candidates
    .map((c) => ({ c, d: c.toLowerCase().startsWith(q) && q.length >= 2 ? 0 : distance(q, c) }))
    .filter((x) => x.d <= limitD)
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
    .slice(0, limit)
    .map((x) => x.c);
}
