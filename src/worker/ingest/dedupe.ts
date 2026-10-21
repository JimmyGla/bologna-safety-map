import { plain } from "./text";

export const NEAR_DUPLICATE_JACCARD = 0.85;
export const NEAR_DUPLICATE_WINDOW_MS = 2 * 3_600_000;

/** Word set used for similarity (words of 3+ letters). */
export function shingles(text: string): Set<string> {
  return new Set(plain(text).split(" ").filter((w) => w.length >= 3));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Near-duplicate check against recent texts. Applied across sources on purpose: an almost
 * identical copy is not an independent source for the corroboration gate (rule 3).
 */
export class NearDuplicateIndex {
  private sets: Set<string>[];

  constructor(recentTexts: string[]) {
    this.sets = recentTexts.map(shingles);
  }

  /** True if `text` is a near-duplicate; otherwise remembers it and returns false. */
  checkAndAdd(text: string): boolean {
    const s = shingles(text);
    if (this.sets.some((o) => jaccard(s, o) > NEAR_DUPLICATE_JACCARD)) return true;
    this.sets.push(s);
    return false;
  }
}
