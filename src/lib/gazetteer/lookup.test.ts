import { describe, expect, it } from "vitest";
import { gazetteer, lookup } from "./index";
import { osaDistance } from "./lookup";
import { normalize } from "./normalize";

const ids = (text: string) => lookup(text).map((m) => m.id).sort();

describe("lookup — realistic Italian phrasings", () => {
  it.each<[string, string[]]>([
    ["Corteo partito da piazza Verdi, direzione via Zamboni", ["piazza-verdi", "via-zamboni"]],
    ["Presidio in P.zza Maggiore dalle 18", ["piazza-maggiore"]],
    ["Bloccata la tangenziale all'altezza dell'uscita 8, code fino a Borgo Panigale", ["quartiere-borgo-panigale-reno", "tangenziale"]],
    ["Tensione davanti alla stazione centrale, polizia in assetto antisommossa", ["stazione-centrale"]],
    ["Manifestanti sotto le Due Torri", ["due-torri"]],
    ["#bologna #piazzaverdi studenti in piazza", ["piazza-verdi"]],
    ["Traffico in tilt in via Stalingrdo", ["via-stalingrado"]],
    ["Sit-in davanti al rettorato in via Zamboni 33", ["rettorato", "via-zamboni"]],
    ["Cariche della polizia in zona universitaria", ["zona-universitaria"]],
    ["Il corteo ha raggiunto piazza dell'Unità, in Bolognina", ["bolognina", "piazza-unita"]],
    ["Chiusa via dell'Indipendenza da piazza VIII Agosto a via Ugo Bassi", ["piazza-viii-agosto", "via-indipendenza", "via-ugo-bassi"]],
    ["Assemblea al Pilastro, poi corteo verso via Massarenti", ["pilastro", "via-massarenti"]],
    ["Presidio dei sanitari davanti al Policlinico S.Orsola", ["policlinico-sant-orsola"]],
    // "indipendenza" here is not the street: strict aliases need "via".
    ["Corteo per l'indipendenza della Palestina partito dal Nettuno", ["piazza-nettuno"]],
    ["Blocco stradale su viale Berti Pichat, bus deviati", ["viale-berti-pichat"]],
    ["Fumogeni in Montagnola, chiusa l'autostazione", ["autostazione", "montagnola"]],
    ["Presidio dei lavoratori davanti alla Fiera, in via Stalingrado", ["fiera", "via-stalingrado"]],
    ["Piazza S. Francesco occupata dagli studenti", ["piazza-san-francesco"]],
    ["V. Irnerio chiusa al traffico, deviazioni su via Mascarella", ["via-irnerio", "via-mascarella"]],
    ["Corteo nel quartiere Navile, partito da via di Corticella", ["quartiere-navile", "via-corticella"]],
  ])("%s", (text, expected) => {
    expect(ids(text)).toEqual(expected);
  });

  it("finds nothing in text without places", () => {
    expect(ids("Bella giornata a Bologna, nessun problema da segnalare")).toEqual([]);
    expect(ids("Sciopero generale indetto per venerdì")).toEqual([]);
  });

  it("returns geometry and marks fuzzy matches", () => {
    const [m] = lookup("in via Stalingrdo");
    expect(m).toMatchObject({ id: "via-stalingrado", exact: false });
    expect(m.score).toBeLessThan(1);
    expect(["LineString", "MultiLineString"]).toContain(m.geometry.type);
  });

  it("keeps the ambiguity when the same words name different places", () => {
    expect(ids("disagi a San Donato")).toEqual(["quartiere-san-donato-san-vitale", "via-san-donato"]);
    expect(ids("disagi in via San Donato")).toEqual(["via-san-donato"]);
  });
});

describe("gazetteer data", () => {
  it("has ~150 places with unique ids and geometry", () => {
    const places = gazetteer.places;
    expect(places.length).toBeGreaterThanOrEqual(140);
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
    for (const p of places) {
      expect(p.aliases.length, p.id).toBeGreaterThan(0);
      expect(p.geometry.coordinates.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("normalize", () => {
  it("lowercases, strips accents and turns prefixes into markers", () => {
    expect(normalize("In P.zza dell'Unità")).toEqual([{ t: "in" }, { t: "unita", pre: "square" }]);
    expect(normalize("v.le Berti-Pichat")).toEqual([{ t: "berti", pre: "street" }, { t: "pichat" }]);
    expect(normalize("#PiazzaVerdi")).toEqual([{ t: "piazzaverdi" }]);
  });
});

describe("osaDistance", () => {
  it("counts transpositions as one edit and stops past the limit", () => {
    expect(osaDistance("stalingardo", "stalingrado", 2)).toBe(1);
    expect(osaDistance("zamboni", "zamboni", 1)).toBe(0);
    expect(osaDistance("verdi", "maggiore", 2)).toBe(Infinity);
  });
});
