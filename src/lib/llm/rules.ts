import type { EventType } from "@/db/schema";
import { lookup } from "@/lib/gazetteer";
import { parsePlannedStart } from "@/lib/dates";
import { plain } from "@/lib/text";
import { IRRELEVANT, type Extraction, type ExtractInput, type LlmProvider } from "./types";

// "rules" extractor: Italian keyword/regex tables, no network. Always available, and the
// fallback for every other provider. Patterns run on plain() text (lowercase, no accents).

type Rule = { type: EventType; severity: number; re: RegExp };

// Order matters on equal severity: the first matching rule wins.
const RULES: Rule[] = [
  { type: "clashes", severity: 3, re: /\b(scontr[io]|cariche|caricat[oiae]|carica (della|dalla) polizia|lacrimogen[oi]|manganell\w*|bombe? carta|sassaiol\w*|molotov|guerriglia|idranti)\b/ },
  { type: "police_presence", severity: 2, re: /\b(tension[ei]|camionett[ae]|blindat[oi]|celere|reparto mobile|antisommossa|cordone di polizia|schierat[ie])\b/ },
  { type: "blockade", severity: 1, re: /\b(blocc(o|hi|at[oaie]|ano|ando)|deviat[aeoi]|deviazion[ei]|chius[ao] al traffico|traffico in tilt|paralizzat[oa]|binari occupati)\b/ },
  { type: "march", severity: 1, re: /\b(cort(eo|ei)|manifestazion[ei]|manifestant[ei]|sfilano|in marcia)\b/ },
  { type: "peaceful_gathering", severity: 0, re: /\b(presidi[oi]?|sit in|flash mob|fiaccolata|catena umana)\b/ },
];
// Injuries raise an existing event to clashes; on their own they are usually accidents.
const INJURIES = /\bferit[oiae]\b/;
const AFTERMATH = /\b(vetrine (rotte|infrante|spaccate)|danneggiat\w*|imbrattat\w*|scritte sui muri|dopo gli scontri|bilancio degli scontri)\b/;

const NOW = /\b(adesso|in questo momento|in corso|in diretta|proprio ora|sta succedendo|stanno \w+ndo)\b/;
const EARLIER = /\b(stamattina|stamani|stamane|questa mattina|oggi pomeriggio|nel pomeriggio|in mattinata|poco fa|stanotte|questa notte|oggi)\b/;
const OLD = /\b(anni fa|mesi fa|l anno scorso|lo scorso anno|archivio|repertorio|anniversario|ieri|settimana scorsa|(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica) scors[oa])\b/;
const YEAR = /\bnel (19|20)(\d\d)\b/g;
// Follow-ups about an event that is over (court, arrests, measures) — not a current event.
const FOLLOW_UP = /\b(obbligo di firma|convalid\w*|giudice|gip|udienza|processo|condann\w*|sentenza|fogli? di via|dacur|daspo|liberat[oi]|scarcerat\w*|indagat[oi]|denunciat[oi])\b/;
// Planned events: not on the map until they happen.
// Words that announce a future event. Without a date they make an item "not now".
const PLANNED = /\b(domani|dopodomani|prossim[oa]|in programma|previst[oaie]|annunciat[oaie]|si terra|partira|convocat[oaie]|appuntamento|indett[oaie])\b/;
const WEEKDAYS = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const WEEKDAY = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "g");

function romeWeekday(d: Date): string {
  const name = d.toLocaleDateString("it-IT", { weekday: "long", timeZone: "Europe/Rome" });
  return plain(name);
}

/** "sabato sera" on a Tuesday is a past (or future) day, not now. */
function mentionsOtherDay(t: string, now: Date): boolean {
  const today = romeWeekday(now);
  return [...t.matchAll(WEEKDAY)].some((m) => m[1] !== today);
}

const JOKE = /(ahah|haha|\blol\b|\bxd\b|😂|🤣|😆|😹|\bscherz\w*|\/s\b)/i;
const FIGURATIVE = /\b(manifestazion[ei] d[ie] (affetto|stima|interesse|gioia|amore)|blocco dello scrittore)\b/;

const FIRSTHAND = /\b((sono|siamo) (in|a|qui|qua|davanti|sotto|vicino)|vedo|ho visto|abbiamo visto|davanti a me|dalla (mia )?finestra|sotto casa( mia)?)\b/;

// Other cities (Italy + the metro area): mentioning one is a red flag unless the text is
// clearly about a Bologna place. "via Roma", "piazza Milano" are street names, not cities.
const CITIES =
  "milano|roma|torino|napoli|firenze|genova|venezia|padova|verona|trieste|trento|modena|reggio emilia|parma|piacenza|ferrara|ravenna|rimini|cesena|forli|pisa|livorno|perugia|ancona|bari|palermo|catania|cagliari|imola|casalecchio|san lazzaro|castel maggiore|zola predosa|budrio|molinella|medicina|castenaso|pianoro|sasso marconi|calderara|anzola|persiceto|castel san pietro|parigi|londra|berlino|madrid";
const OTHER_CITY = new RegExp(`(^|\\s)(?<!(via|viale|piazza|piazzale|corso|largo|porta|strada) )(${CITIES})\\b`);

const CONFIDENCE_CAP = 0.5;

export function extractWithRules(item: ExtractInput, now: Date = new Date()): Extraction {
  const t = plain(item.text);
  const matched = RULES.filter((r) => r.re.test(t));
  if (!matched.length) return IRRELEVANT;
  if (JOKE.test(item.text) || FIGURATIVE.test(t)) return IRRELEVANT;
  const thisYear = now.getUTCFullYear();
  if (OLD.test(t) && !/\bieri\b/.test(t)) return IRRELEVANT; // "ieri" is handled as time below
  for (const m of t.matchAll(YEAR)) if (Number(m[1] + m[2]) !== thisYear) return IRRELEVANT;

  const places = lookup(item.text);
  // Another city is only outweighed by an explicit Bologna street/square ("via Zamboni"):
  // those match with a prefix and score above 1. Bare names ("Nettuno") are not enough.
  if (OTHER_CITY.test(t) && !places.some((p) => p.score > 1)) return IRRELEVANT;

  let eventType = matched[0].type;
  let severity = Math.max(...matched.map((r) => r.severity));
  if (INJURIES.test(t)) {
    eventType = "clashes";
    severity = 3;
  }
  const live = NOW.test(t);
  if (AFTERMATH.test(t) && !live) {
    eventType = "aftermath";
    severity = 1;
  }

  // Announced future events: a date/time that lies ahead. A bare weekday ("sabato") is
  // ambiguous (last Saturday's report or next Saturday's march), so it also needs an
  // announcement word ("appuntamento", "in programma", "partirà"…).
  const when = parsePlannedStart(item.text, item.publishedAt ?? now, now);
  const ahead =
    !!when && (when.timeKnown ? when.start.getTime() > now.getTime() + 15 * 60_000 : when.start.getTime() > now.getTime());
  const planned =
    !!when && ahead && !FOLLOW_UP.test(t) && !/\bieri\b/.test(t) && (when.kind !== "weekday" || PLANNED.test(t));

  const recent = item.publishedAt && now.getTime() - item.publishedAt.getTime() < 2 * 3_600_000;
  const notNow = /\bieri\b/.test(t) || FOLLOW_UP.test(t) || PLANNED.test(t) || mentionsOtherDay(t, now);
  const time_reference: Extraction["time_reference"] = planned
    ? "planned"
    : notNow
    ? "old_or_unclear"
    : live
      ? "now"
      : EARLIER.test(t)
        ? "earlier_today"
        : recent
          ? "now"
          : "earlier_today";

  const confidence = Math.min(
    CONFIDENCE_CAP,
    0.25 + 0.05 * Math.min(matched.length, 3) + (places.length ? 0.1 : 0) + (time_reference !== "old_or_unclear" ? 0.05 : 0),
  );

  return {
    relevant: true,
    event_type: eventType,
    severity,
    // Canonical gazetteer names; the pipeline resolves them back to the same places.
    locations: places.map((p) => p.name),
    is_firsthand: FIRSTHAND.test(t),
    time_reference,
    confidence: Math.round(confidence * 100) / 100,
    planned_start: planned ? when!.start.toISOString() : null,
    planned_time_known: planned ? when!.timeKnown : false,
  };
}

export function createRulesProvider(now: () => Date = () => new Date()): LlmProvider {
  return {
    name: "rules",
    maxBatch: Number.POSITIVE_INFINITY,
    async extract(items) {
      return new Map(items.map((i) => [i.id, extractWithRules(i, now())]));
    },
  };
}
