import { parse } from "node-html-parser";
import { plain } from "@/lib/text";

export { plain };

// Ingestion keeps an item only if it matches one of these families (on plain() text:
// lowercase, no accents, punctuation as spaces). Broad on purpose: the extractor decides.
const PROTEST =
  /\b((contro ?)?cort(eo|ei)|(contro ?)?manifestazion[ei]|manifestant[ei]|scontr[io]|(contro ?)?presidi[oi]?|blocc(o|hi|at[oaie]|ano|ando)|lacrimogen[oi]|cariche|polizia|sgomber(o|i|at[oaie])|occupazion[ei])\b/;
// Attacks on people, including brawls and stabbings.
const ASSAULT =
  /\b(aggredit[oaie]|aggression[ei]|aggressor[ei]|pestaggi[oi]?|pestat[oaie]|picchiat[oaie]|accoltellat\w*|accoltellament[oi]|riss[ae])\b/;
// Organised or hate-motivated violence.
const HATE =
  /\b(squadrist\w*|squadracc\w*|spedizion[ei] punitiv[ae]|raid|naziskin|neonazist\w*|neofascist\w*|ronde?|razzist[aei]|omofob[aoi]|transfob[aoi]|antisemit\w*|caccia (all )?(uomo|stranier[oi]|immigrat[oi]))\b/;
const SEXUAL =
  /\b(violenz[ae] sessual[ei]|violentat[aoie]|stupr[oi]|stuprat[aoie]|molestat[aoie]|molesti[ae]|abusat[aoie]|palpeggiat\w*)\b/;
const VANDALISM =
  /\b(vetrin[ae] (spaccat|rott|infrant)\w*|devastat\w*|devastazion[ei]|vandal\w*|danneggiat\w*|incendiat\w*|dat[aeio] alle fiamme|in fiamme|sfasciat\w*|cassonetti (rovesciat|incendiat)\w*)\b/;

const FAMILIES = [PROTEST, ASSAULT, HATE, SEXUAL, VANDALISM];

/** True when the item could report a protest or street violence (assaults, hate/squad attacks, sexual violence, vandalism). */
export function isSafetyRelated(text: string): boolean {
  const t = plain(text);
  return FAMILIES.some((re) => re.test(t));
}

/** HTML fragment -> plain text with entities decoded. */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n");
  return parse(withBreaks)
    .text.replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Removes handles and profile links from item text (CLAUDE.md rule 1): Reddit "u/name",
 * "@name", and links to user profiles. Applied to every item before it is stored.
 */
export function scrubHandles(text: string): string {
  return text
    .replace(/https?:\/\/(www\.|old\.)?reddit\.com\/(user|u)\/[\w-]+\S*/gi, "")
    .replace(/(^|[\s(])\/?u\/[\w-]{3,}/g, "$1")
    .replace(/(^|[\s(])@[\w.]{2,}/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const MAX_TEXT = 2_000;
export const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
