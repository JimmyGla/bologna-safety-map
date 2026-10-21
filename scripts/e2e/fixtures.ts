// Synthetic end-to-end fixtures (written for testing, not real posts). Each block exercises
// one rule; scripts/e2e/check.ts asserts the resulting levels. Posts are dated 2 minutes ago
// (decay exp(-age/50) still applies, so counts are chosen with some margin).

export const POSTED_MINUTES_AGO = 2;

export const FIXTURE_TAG = "fixture"; // every feed name starts with this, for cleanup

type RawFixture = {
  source: "news" | "tper" | "reddit";
  feed: string;
  text: string;
  authorMeta?: { follower_count: number; account_age_days: number };
};

/** Six independent news reports of clashes in piazza Verdi → level 4 (+ ring ≥ 1). */
const VERDI: RawFixture[] = [
  "Scontri in piazza Verdi tra studenti e polizia, lanciati lacrimogeni",
  "Piazza Verdi: cariche della polizia contro il presidio degli universitari",
  "Lacrimogeni e bombe carta in piazza Verdi, tensione altissima nel pomeriggio",
  "Guerriglia urbana in piazza Verdi, diversi agenti caricano i manifestanti",
  "Piazza Verdi teatro di scontri: idranti e manganellate davanti al Comunale",
  "Molotov e sassaiola in piazza Verdi, la polizia risponde con i lacrimogeni",
].map((text, i) => ({ source: "news", feed: `${FIXTURE_TAG}-news-${i + 1}`, text }));

/** Six strong posts from ONE social feed in via Massarenti: score above level 2, capped at 2 (rule 3). */
const MASSARENTI: RawFixture[] = [
  "Sono in via Massarenti, la polizia carica il corteo, lacrimogeni ovunque",
  "Vedo scontri in via Massarenti davanti alla farmacia, gente che scappa",
  "Via Massarenti bloccata, cariche e lacrimogeni proprio sotto casa mia",
  "Ho visto i blindati caricare in via Massarenti, scontri durissimi",
  "Siamo in via Massarenti: manganellate e idranti contro i manifestanti",
  "Ancora scontri in via Massarenti all'incrocio con via Mazzini, lacrimogeni",
].map((text) => ({
  source: "reddit",
  feed: `${FIXTURE_TAG}-reddit`,
  text,
  authorMeta: { follower_count: 5_000, account_age_days: 800 },
}));

/** A TPER diversion → blockade, level 1, counts as official. */
const TPER: RawFixture[] = [
  { source: "tper", feed: `${FIXTURE_TAG}-tper`, text: "#Bologna – linee 11, 27 e 28 deviate per corteo in via dell'Indipendenza" },
];

/** Traps: must produce no events. */
const TRAPS: RawFixture[] = [
  { source: "news", feed: `${FIXTURE_TAG}-trap-1`, text: "Ricordate gli scontri in piazza Maggiore? Il video di 5 anni fa torna a girare" },
  { source: "news", feed: `${FIXTURE_TAG}-trap-2`, text: "Cariche della polizia al corteo di Milano, lacrimogeni in piazza Duomo" },
];

export const RAW_FIXTURES: RawFixture[] = [...VERDI, ...MASSARENTI, ...TPER, ...TRAPS];

export const PLACES = {
  verdi: "Piazza Verdi",
  massarenti: "via Massarenti",
  indipendenza: "via dell'Indipendenza",
  maggiore: "Piazza Maggiore",
};

export const OVERRIDE = { level: 3, reason: `e2e ${FIXTURE_TAG}: manual override test`, minutes: 60 };
