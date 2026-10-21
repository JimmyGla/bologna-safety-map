// Text normalization shared by lookup() and the gazetteer build.
// "In P.zza dell'Unità" -> [{ t: "unita", pre: "square" }]

export type PrefixKind = "street" | "square" | "area";

export type Token = {
  t: string;
  /** Set when a prefix ("via", "piazza", "zona", ...) came right before this token. */
  pre?: PrefixKind;
};

const PREFIXES: Record<string, PrefixKind> = {
  via: "street",
  v: "street",
  viale: "street",
  vle: "street",
  strada: "street",
  vicolo: "street",
  piazza: "square",
  pza: "square",
  pzza: "square",
  piazzale: "square",
  ple: "square",
  largo: "square",
  zona: "area",
  quartiere: "area",
  rione: "area",
};

// Articles and "di" contractions carry no meaning for matching: "via dell'Indipendenza"
// and "via Indipendenza" must match the same alias.
const PARTICLES = new Set([
  "di", "d", "de", "del", "dello", "della", "dell", "dei", "degli", "delle",
  "l", "la", "il", "lo", "gli", "le",
]);

export function normalize(text: string): Token[] {
  const s = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Abbreviations need their dots, so expand them before punctuation is dropped.
    .replace(/\bp\.\s*z?za\b\.?/g, " piazza ")
    .replace(/\bp\.\s*le\b\.?/g, " piazzale ")
    .replace(/\bv\.\s*le\b\.?/g, " viale ")
    .replace(/\bv\.\s*/g, " via ")
    .replace(/[^a-z0-9]+/g, " ");

  const out: Token[] = [];
  let pending: PrefixKind | undefined;
  for (const raw of s.split(" ")) {
    if (!raw) continue;
    const prefix = PREFIXES[raw];
    if (prefix) {
      pending = prefix;
      continue;
    }
    if (PARTICLES.has(raw)) continue;
    out.push(pending ? { t: raw, pre: pending } : { t: raw });
    pending = undefined;
  }
  return out;
}

/** Normalized form as one string, for deduplicating aliases. Keeps the prefix kind. */
export function normalizedKey(text: string): string {
  const tokens = normalize(text);
  const pre = tokens[0]?.pre;
  return (pre ? `${pre}:` : "") + tokens.map((x) => x.t).join(" ");
}
