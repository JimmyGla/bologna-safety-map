// Realistic Italian inputs (written for tests, not copied from real posts), with the
// answer we expect. Traps are marked; expected values describe the rules extractor.

import type { Extraction } from "./types";

export type Fixture = {
  name: string;
  text: string;
  expect: Partial<Extraction> & { placeIds?: string[] };
};

export const FIXTURES: Fixture[] = [
  {
    name: "clashes with tear gas",
    text: "Scontri in piazza Verdi, la polizia carica il corteo: lanciati lacrimogeni verso via Zamboni",
    expect: { relevant: true, event_type: "clashes", severity: 3, placeIds: ["piazza-verdi", "via-zamboni"] },
  },
  {
    name: "march, happening now",
    text: "Il corteo degli studenti partito da piazza Maggiore adesso è in via Rizzoli",
    expect: { relevant: true, event_type: "march", severity: 1, time_reference: "now", placeIds: ["piazza-maggiore", "via-rizzoli"] },
  },
  {
    name: "tangenziale blocked",
    text: "Tangenziale bloccata dai manifestanti all'altezza della Fiera, code chilometriche",
    expect: { relevant: true, event_type: "blockade", severity: 1, placeIds: ["fiera", "tangenziale"] },
  },
  {
    name: "peaceful sit-in this morning",
    text: "Presidio pacifico davanti alla Prefettura stamattina, una cinquantina di persone",
    expect: { relevant: true, event_type: "peaceful_gathering", severity: 0, time_reference: "earlier_today", placeIds: ["prefettura"] },
  },
  {
    name: "heavy police presence",
    text: "Camionette e blindati schierati in via Zamboni, tensione con gli studenti davanti al rettorato",
    expect: { relevant: true, event_type: "police_presence", severity: 2, placeIds: ["rettorato", "via-zamboni"] },
  },
  {
    name: "first-hand post",
    text: "Sono in via Irnerio, vedo il corteo passare sotto casa mia, tantissima gente",
    expect: { relevant: true, event_type: "march", is_firsthand: true, placeIds: ["via-irnerio"] },
  },
  {
    name: "TPER diversion",
    text: "#Bologna – linee 11, 27 e 28 deviate per corteo in via dell'Indipendenza",
    expect: { relevant: true, event_type: "blockade", severity: 1, placeIds: ["via-indipendenza"] },
  },
  {
    name: "aftermath",
    text: "Vetrine rotte e scritte sui muri in via Mascarella dopo gli scontri di stanotte",
    expect: { relevant: true, event_type: "aftermath", severity: 1, time_reference: "earlier_today", placeIds: ["via-mascarella"] },
  },
  {
    name: "injuries make it clashes",
    text: "Due feriti al presidio in Bolognina, la polizia è intervenuta",
    expect: { relevant: true, event_type: "clashes", severity: 3, placeIds: ["bolognina"] },
  },
  {
    name: "TRAP: old video re-shared",
    text: "Ricordate gli scontri in piazza Verdi? Video di 5 anni fa che sta girando di nuovo",
    expect: { relevant: false },
  },
  {
    name: "TRAP: protest in Milan",
    text: "Cariche della polizia al corteo pro Palestina a Milano, lacrimogeni in piazza Duomo",
    expect: { relevant: false },
  },
  {
    name: "TRAP: Bologna mentioned, event in Rome",
    text: "Da Bologna partiti tre pullman per il corteo nazionale di Roma",
    expect: { relevant: false },
  },
  {
    name: "TRAP: joke",
    text: "Blocco totale in piazza Verdi: la fila per lo spritz è infinita 😂",
    expect: { relevant: false },
  },
  {
    name: "TRAP: event from 2019",
    text: "Nel 2019 il corteo arrivò fino in via Stalingrado, oggi il quartiere è cambiato",
    expect: { relevant: false },
  },
  {
    name: "TRAP: yesterday",
    text: "Ieri sera presidio in piazza dell'Unità contro lo sgombero",
    expect: { relevant: true, time_reference: "old_or_unclear" },
  },
  {
    name: "TRAP: court follow-up about past clashes",
    text: "Obbligo di firma per il 21enne arrestato durante gli scontri in stazione: la giudice convalida l'arresto",
    expect: { relevant: true, time_reference: "old_or_unclear" },
  },
  {
    name: "TRAP: past weekday (fixtures run on a Wednesday)",
    text: "Corteo di sabato sera in via Rizzoli, i commercianti contano i danni",
    expect: { time_reference: "old_or_unclear" },
  },
  {
    name: "announced for tomorrow, no time",
    text: "Domani corteo da piazza XX Settembre, previste deviazioni dei bus",
    // Fixtures run at 2026-10-21 14:00 Rome: tomorrow starts at 22:00 UTC.
    expect: { relevant: true, time_reference: "planned", planned_start: "2026-10-21T22:00:00.000Z", planned_time_known: false, placeIds: ["piazza-xx-settembre"] },
  },
  {
    name: "announced with date and time",
    text: "Sabato 24 ottobre corteo regionale alle 15 da piazza dell'Unità, in programma un presidio finale",
    expect: { relevant: true, event_type: "march", time_reference: "planned", planned_start: "2026-10-24T13:00:00.000Z", planned_time_known: true, placeIds: ["piazza-unita"] },
  },
  {
    name: "TRAP: announcement words but no date",
    text: "Annunciato un nuovo corteo in piazza Verdi, data da definire",
    expect: { relevant: true, time_reference: "old_or_unclear" },
  },
  {
    name: "TRAP: Milan article that also names Bologna",
    text: "Mobilitazione contro il governo, a Milano cariche al corteo. Solidarietà da Bologna e dal Nettuno",
    expect: { relevant: false },
  },
  {
    name: "TRAP: football, no protest",
    text: "Il Bologna vince al Dall'Ara, festa dei tifosi in piazza Maggiore fino a tardi",
    expect: { relevant: false },
  },
];
