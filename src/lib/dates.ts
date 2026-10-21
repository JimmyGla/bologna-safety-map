// Finds the start date/time of an announced event in Italian text ("sabato 24 ottobre alle
// 15", "domani dalle 18:30", "il 25/10 ore 17"), in Europe/Rome time. Client-safe, no deps.

export const ROME_TZ = "Europe/Rome";

export type PlannedTime = {
  start: Date;
  /** false when only the day is known ("domani corteo"). */
  timeKnown: boolean;
  /** explicit = a calendar date; relative = oggi/domani/…; weekday = "sabato". */
  kind: "explicit" | "relative" | "weekday";
};

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const WEEKDAYS = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const MAX_DAYS_AHEAD = 30;

type Parts = { y: number; m: number; d: number; h: number; mi: number; wd: number };

/** Wall-clock parts of an instant in Rome. */
export function romeParts(date: Date): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), h: Number(p.hour), mi: Number(p.minute),
    wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** The instant at which Rome's clock shows y-m-d h:mi (DST-aware). */
export function romeTime(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, m, d, h, mi);
  const offset = (t: number) => {
    const p = romeParts(new Date(t));
    return Date.UTC(p.y, p.m, p.d, p.h, p.mi) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // second pass settles DST edges
  return new Date(t);
}

const addDays = (p: Parts, n: number) => {
  const t = new Date(Date.UTC(p.y, p.m, p.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};

function clean(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function findTime(t: string): { h: number; mi: number } | null {
  // "alle 15", "ore 17:30", "dalle 18.30", "h 21", "alle ore 15"
  const m = /\b(?:alle|dalle|ore|h)\s*(?:ore\s*)?(\d{1,2})(?:[:.](\d{2}))?\b/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}

function findDay(t: string, ref: Parts): { y: number; m: number; d: number; kind: PlannedTime["kind"] } | null {
  // 1. Calendar dates: "24 ottobre (2026)", "24/10(/2026)".
  const named = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`).exec(t);
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  const cal = named
    ? { d: Number(named[1]), m: MONTHS.indexOf(named[2]), y: named[3] ? Number(named[3]) : null }
    : slash
      ? { d: Number(slash[1]), m: Number(slash[2]) - 1, y: slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null }
      : null;
  if (cal && cal.m >= 0 && cal.m <= 11 && cal.d >= 1 && cal.d <= 31) {
    let y = cal.y ?? ref.y;
    // "15 gennaio" written in December means next year.
    if (cal.y === null && Date.UTC(y, cal.m, cal.d) < Date.UTC(ref.y, ref.m, ref.d) - 86_400_000) y += 1;
    return { y, m: cal.m, d: cal.d, kind: "explicit" };
  }
  // 2. Relative days. "dopodomani" before "domani" (it contains it).
  if (/\bdopodomani\b/.test(t)) return { ...addDays(ref, 2), kind: "relative" };
  if (/\bdomani\b/.test(t)) return { ...addDays(ref, 1), kind: "relative" };
  if (/\b(oggi|stasera|stamattina|stanotte|questa sera|questo pomeriggio|oggi pomeriggio)\b/.test(t)) return { ...addDays(ref, 0), kind: "relative" };
  // 3. Weekdays: next occurrence; "prossimo"/"prossima" means not today.
  const wd = new RegExp(`\\b(${WEEKDAYS.join("|")})(\\s+prossim[oa])?\\b`).exec(t);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    let delta = (target - ref.wd + 7) % 7;
    if (delta === 0 && wd[2]) delta = 7;
    return { ...addDays(ref, delta), kind: "weekday" };
  }
  return null;
}

/**
 * Start of the event the text announces, or null. Relative words ("domani") are read
 * against `ref` (usually the publication time); the result must lie between `now` and
 * 30 days ahead (an event earlier today still counts if its time hasn't passed by >1h).
 */
export function parsePlannedStart(text: string, ref: Date, now: Date = ref): PlannedTime | null {
  const t = clean(text);
  const refParts = romeParts(ref);
  const day = findDay(t, refParts);
  if (!day) return null;
  const time = findTime(t);
  const start = romeTime(day.y, day.m, day.d, time?.h ?? 0, time?.mi ?? 0);

  const nowParts = romeParts(now);
  const todayStart = romeTime(nowParts.y, nowParts.m, nowParts.d);
  const earliest = time ? now.getTime() - 3_600_000 : todayStart.getTime();
  if (start.getTime() < earliest) return null;
  if (start.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return null;
  return { start, timeKnown: !!time, kind: day.kind };
}

/** Rome calendar day "YYYY-MM-DD" of an instant (for grouping). */
export function romeDay(date: Date): string {
  const p = romeParts(date);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
