import { parse } from "node-html-parser";
import { plain } from "@/lib/text";

export { plain };

// The keywords asked for, plus their plural/verb forms.
const PROTEST =
  /\b(cort(eo|ei)|manifestazion[ei]|manifestant[ei]|scontr[io]|presidi[oi]?|blocc(o|hi|at[oaie]|ano|ando)|lacrimogen[oi]|cariche|polizia|sgomber(o|i|at[oaie])|occupazion[ei])\b/;

export function isProtestRelated(text: string): boolean {
  return PROTEST.test(plain(text));
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
