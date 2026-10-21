import { normalize, type PrefixKind, type Token } from "./normalize";
import type { Geometry, Place, PlaceType } from "./types";

export type LookupMatch = {
  id: string;
  name: string;
  type: PlaceType;
  geometry: Geometry;
  /** Normalized text that matched. */
  matched: string;
  /** 1 = exact alias; fuzzy matches score lower; +0.05 when a "via"/"piazza"/"zona" prefix matched too. */
  score: number;
  exact: boolean;
};

type Alias = { place: Place; tokens: string[]; joined: string; pre?: PrefixKind };
type Candidate = { alias: Alias; start: number; end: number; score: number; exact: boolean; matched: string };

const PREFIX_BONUS = 0.05;
const FUZZY_MIN_LENGTH = 6;
const TYPE_RANK: Record<PlaceType, number> = { point: 0, polygon: 1, line: 2, area: 3 };

/** Optimal string alignment distance, or Infinity once it must exceed `max`. */
export function osaDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  const rows = [new Array<number>(b.length + 1).fill(0).map((_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return Infinity;
    rows.push(row);
  }
  const d = rows[a.length][b.length];
  return d > max ? Infinity : d;
}

const maxEdits = (len: number) => (len < FUZZY_MIN_LENGTH ? 0 : len < 10 ? 1 : 2);

export class Gazetteer {
  private aliases: Alias[] = [];
  private byId = new Map<string, Place>();

  constructor(places: Place[]) {
    for (const place of places) {
      this.byId.set(place.id, place);
      for (const a of place.aliases) {
        const tokens = normalize(a);
        if (!tokens.length) continue;
        const words = tokens.map((t) => t.t);
        this.aliases.push({ place, tokens: words, joined: words.join(" "), pre: tokens[0].pre });
      }
    }
  }

  get(id: string): Place | undefined {
    return this.byId.get(id);
  }

  get places(): Place[] {
    return [...this.byId.values()];
  }

  lookup(text: string, { fuzzy = true }: { fuzzy?: boolean } = {}): LookupMatch[] {
    const tokens = normalize(text);
    const candidates: Candidate[] = [];
    for (const alias of this.aliases) {
      const n = alias.tokens.length;
      for (let i = 0; i + n <= tokens.length; i++) {
        const c = this.match(alias, tokens, i, fuzzy);
        if (c) candidates.push(c);
      }
    }
    return resolve(candidates).map((c) => ({
      id: c.alias.place.id,
      name: c.alias.place.name,
      type: c.alias.place.type,
      geometry: c.alias.place.geometry,
      matched: c.matched,
      score: Math.round(c.score * 100) / 100,
      exact: c.exact,
    }));
  }

  private match(alias: Alias, tokens: Token[], i: number, fuzzy: boolean): Candidate | null {
    // A prefixed alias ("via indipendenza") needs the same kind of prefix in the text.
    if (alias.pre && tokens[i].pre !== alias.pre) return null;
    const window = tokens.slice(i, i + alias.tokens.length);
    const matched = window.map((t) => t.t).join(" ");
    const bonus = alias.pre ? PREFIX_BONUS : 0;
    const end = i + alias.tokens.length;

    if (matched === alias.joined) return { alias, start: i, end, score: 1 + bonus, exact: true, matched };
    if (!fuzzy) return null;
    const max = maxEdits(alias.joined.length);
    // Same first letter and no numbers: keeps fuzzy matching from inventing places.
    if (!max || matched[0] !== alias.joined[0] || /\d/.test(matched)) return null;
    const d = osaDistance(matched, alias.joined, max);
    if (d === Infinity) return null;
    return { alias, start: i, end, score: 0.95 - 0.1 * d + bonus, exact: false, matched };
  }
}

/**
 * Keeps the best non-overlapping matches. Candidates covering the same words with the same
 * score are all kept ("San Donato" is both a street and a quartiere).
 */
function resolve(candidates: Candidate[]): Candidate[] {
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.end - b.start - (a.end - a.start) ||
      TYPE_RANK[a.alias.place.type] - TYPE_RANK[b.alias.place.type],
  );
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.alias.place.id)) continue;
    const clash = kept.find((k) => c.start < k.end && k.start < c.end);
    if (clash && !(clash.start === c.start && clash.end === c.end && Math.abs(clash.score - c.score) < 1e-9)) continue;
    kept.push(c);
    seen.add(c.alias.place.id);
  }
  return kept.sort((a, b) => a.start - b.start || b.score - a.score);
}
