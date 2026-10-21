import type { EventType } from "@/lib/event-types";

// Visitor-facing text, Italian (default) and English. Client-safe. The admin area is
// English-only (maintainers). The type comes from the Italian dictionary, so English must
// provide every key.

export const LANGS = ["it", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "it";

const it = {
  title: "Bologna Safety Map",
  mapLabel: "Mappa di Bologna",
  langSwitch: "Lingua",
  legend: {
    title: "Impatto delle proteste",
    grey: "Grigio non significa sicuro.",
  },
  levels: {
    0: { label: "Nessun dato", meaning: "Nessuna segnalazione recente per questa zona." },
    1: { label: "Basso", meaning: "Attività ridotta o pacifica segnalata." },
    2: { label: "Moderato", meaning: "Assembramenti che possono rallentare traffico e mezzi pubblici." },
    3: { label: "Alto", meaning: "Grande folla o tensione, confermate. Evita la zona se puoi." },
    4: { label: "Grave", meaning: "Incidenti gravi confermati. Stai lontano." },
  } as Record<number, { label: string; meaning: string }>,
  events: {
    clashes: "Scontri",
    blockade: "Blocco",
    march: "Corteo",
    police_presence: "Forte presenza di polizia",
    aftermath: "Danni dopo gli eventi",
    peaceful_gathering: "Presidio pacifico",
  } as Record<EventType, string>,
  badge: {
    updated: (ago: string) => `Aggiornato ${ago}`,
    noDataYet: "Nessun dato ancora",
    loading: "Caricamento…",
    failed: "aggiornamento non riuscito, nuovo tentativo",
    reducedAccuracy: "Precisione ridotta",
    reducedAccuracyHint:
      "Alcune segnalazioni sono state classificate con regole per parole chiave invece che con il modello di IA: i livelli potrebbero essere meno precisi.",
  },
  stale: {
    title: "Dati non aggiornati.",
    withTime: (ago: string) => `Ultimo aggiornamento ${ago}; la mappa potrebbe non mostrare la situazione attuale.`,
    none: "Nessun dato recente disponibile; la mappa potrebbe non mostrare la situazione attuale.",
  },
  quiet: {
    title: "Nessuna protesta segnalata",
    rest: (hours: number) => `nelle ultime ${hours} ore. Questo non garantisce che una zona sia sicura.`,
  },
  panel: {
    label: "Dettagli della zona",
    level: (n: number) => `livello ${n}`,
    close: "Chiudi dettagli",
    overridden: "Livello impostato manualmente dai gestori della mappa.",
    neighbour: "Vicino a una zona grave; nessuna segnalazione da questa cella.",
    eventTypes: "Tipi di evento",
    none: "Nessuno segnalato",
    sources: "Fonti indipendenti",
    official: "Confermato da fonte ufficiale o giornalistica",
    latest: "Ultima segnalazione",
    yes: "Sì",
    no: "No",
  },
  upcoming: {
    open: (n: number) => (n ? `Prossime manifestazioni: ${n}` : "Prossime manifestazioni"),
    title: "Prossime manifestazioni",
    none: "Nessuna manifestazione annunciata nei prossimi 7 giorni.",
    note: "Annunci di manifestazioni: non indicano un pericolo attuale.",
    dayOnly: "orario non indicato",
    sources: (n: number) => (n === 1 ? "1 fonte" : `${n} fonti`),
    official: "fonte ufficiale o giornalistica",
    close: "Chiudi",
    legend: "Manifestazione annunciata",
  },
  footer: {
    notOfficial: "Non è una fonte ufficiale.",
    emergency: "In caso di emergenza chiama il",
    check: "Consulta i canali del Comune di Bologna e della Questura.",
    privacy: "Privacy",
  },
};

export type Dict = typeof it;

const en: Dict = {
  title: "Bologna Safety Map",
  mapLabel: "Map of Bologna",
  langSwitch: "Language",
  legend: {
    title: "Protest impact",
    grey: "Grey does not mean safe.",
  },
  levels: {
    0: { label: "No data", meaning: "No recent reports for this area." },
    1: { label: "Low", meaning: "Small or peaceful activity reported." },
    2: { label: "Moderate", meaning: "Gatherings that may disrupt traffic or transit." },
    3: { label: "High", meaning: "Large crowds or tension, confirmed. Avoid if possible." },
    4: { label: "Severe", meaning: "Serious incidents confirmed. Stay away." },
  },
  events: {
    clashes: "Clashes",
    blockade: "Blockade",
    march: "March",
    police_presence: "Heavy police presence",
    aftermath: "Aftermath",
    peaceful_gathering: "Peaceful gathering",
  },
  badge: {
    updated: (ago) => `Updated ${ago}`,
    noDataYet: "No data yet",
    loading: "Loading…",
    failed: "update failed, retrying",
    reducedAccuracy: "Reduced accuracy",
    reducedAccuracyHint:
      "Some reports were classified with keyword rules instead of the AI model, so levels may be less precise.",
  },
  stale: {
    title: "Data is out of date.",
    withTime: (ago) => `Last update ${ago}; the map may not show the current situation.`,
    none: "No recent data is available; the map may not show the current situation.",
  },
  quiet: {
    title: "No protest activity reported",
    rest: (hours) => `in the last ${hours} hours. This doesn't guarantee an area is safe.`,
  },
  panel: {
    label: "Area details",
    level: (n) => `level ${n}`,
    close: "Close details",
    overridden: "Level set manually by the map maintainers.",
    neighbour: "Next to a severe area; no reports from this cell itself.",
    eventTypes: "Event types",
    none: "None reported",
    sources: "Independent sources",
    official: "Confirmed by official/news source",
    latest: "Latest report",
    yes: "Yes",
    no: "No",
  },
  upcoming: {
    open: (n) => (n ? `Upcoming protests: ${n}` : "Upcoming protests"),
    title: "Upcoming protests",
    none: "No protests announced for the next 7 days.",
    note: "Announced protests: they don't mean an area is dangerous now.",
    dayOnly: "time not given",
    sources: (n) => (n === 1 ? "1 source" : `${n} sources`),
    official: "official or news source",
    close: "Close",
    legend: "Announced protest",
  },
  footer: {
    notOfficial: "Not an official source.",
    emergency: "In an emergency call",
    check: "Check Comune di Bologna and Questura channels.",
    privacy: "Privacy",
  },
};

export const STRINGS: Record<Lang, Dict> = { it, en };

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);
