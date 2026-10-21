// Source list for the Bologna gazetteer. scripts/build-gazetteer.ts turns this into
// src/lib/gazetteer/data/places.json (geometry from OSM / Comune di Bologna open data).
//
// Aliases: the build adds the canonical name, the name without "via"/"piazza", the `short`
// form, "s." variants of san/santo/santa and hashtags. `strict: true` drops the forms
// without a prefix — use it when the bare name is a common word or person
// ("indipendenza", "verdi", "libia", "gramsci") so it only matches as "via ...", "piazza ...".

import type { PlaceType } from "../../src/lib/gazetteer/types";

export type OsmMatch = "highway" | "area" | "point" | "gate" | "motorway";
export type ComuneDataset = "quartieri-di-bologna" | "zone-del-comune-di-bologna" | "aree-statistiche";

export type SourceSpec =
  /** `where`: extra tags an element must have (to pick one of several same-named ones). */
  | { kind: "osm"; names: string[]; match: OsmMatch; where?: Record<string, string> }
  | { kind: "comune"; dataset: ComuneDataset; value: string }
  | { kind: "hull"; of: string[] }
  | { kind: "union"; of: string[] };

export type PlaceSpec = {
  id: string;
  name: string;
  type: PlaceType;
  strict?: boolean;
  short?: string;
  aliases?: string[];
  source: SourceSpec;
};

type Opts = { name?: string; short?: string; strict?: boolean; aliases?: string[] };
const arr = (x: string | string[]) => (Array.isArray(x) ? x : [x]);

function street(id: string, osm: string | string[], o: Opts = {}): PlaceSpec {
  const names = arr(osm);
  return { id, name: o.name ?? names[0], type: "line", ...o, source: { kind: "osm", names, match: "highway" } };
}

function square(id: string, osm: string | string[], o: Opts = {}): PlaceSpec {
  const names = arr(osm);
  return { id, name: o.name ?? names[0], type: "polygon", ...o, source: { kind: "osm", names, match: "area" } };
}

function landmark(
  id: string,
  name: string,
  type: PlaceType,
  osm: string | string[],
  aliases: string[],
  match: OsmMatch = type === "point" ? "point" : "area",
): PlaceSpec {
  return { id, name, type, aliases, source: { kind: "osm", names: arr(osm), match } };
}

function gate(id: string, name: string, aliases: string[] = []): PlaceSpec {
  const piazza = name.replace(/^Porta /, "Piazza di Porta ");
  return {
    id,
    name,
    type: "point",
    aliases: [piazza, ...aliases],
    // Prefer the historic gate; the square around it is the fallback (see build script).
    source: { kind: "osm", names: [name, ...aliases.filter((a) => /^Porta /.test(a)), piazza], match: "gate" },
  };
}

function comune(
  id: string,
  name: string,
  dataset: ComuneDataset,
  value: string,
  aliases: string[],
): PlaceSpec {
  return { id, name, type: "area", aliases, source: { kind: "comune", dataset, value } };
}

const VIALI = [
  street("viale-pietramellara", "Viale Pietro Pietramellara", { name: "Viale Pietramellara", short: "pietramellara" }),
  street("viale-masini", "Viale Angelo Masini", { name: "Viale Masini", short: "masini" }),
  street("viale-berti-pichat", "Viale Carlo Berti Pichat", { name: "Viale Berti Pichat", short: "berti pichat" }),
  street("viale-filopanti", "Viale Quirico Filopanti", { name: "Viale Filopanti", short: "filopanti" }),
  street("viale-ercolani", "Viale Giambattista Ercolani", { name: "Viale Ercolani", short: "ercolani" }),
  street("viale-gozzadini", "Viale Giovanni Gozzadini", { name: "Viale Gozzadini", short: "gozzadini" }),
  street("viale-carducci", "Viale Giosuè Carducci", { name: "Viale Carducci", short: "carducci", strict: true }),
  street("viale-panzacchi", "Viale Enrico Panzacchi", { name: "Viale Panzacchi", short: "panzacchi" }),
  street("viale-aldini", "Viale Antonio Aldini", { name: "Viale Aldini", short: "aldini" }),
  street("viale-pepoli", ["Viale Carlo Pepoli", "Viale Pepoli"], { name: "Viale Pepoli", short: "pepoli", strict: true }),
  street("viale-vicini", ["Viale Giovanni Vicini", "Viale Vicini"], { name: "Viale Vicini", short: "vicini", strict: true }),
  street("viale-silvani", "Viale Antonio Silvani", { name: "Viale Silvani", short: "silvani" }),
];

export const PLACES: PlaceSpec[] = [
  // --- Piazze -------------------------------------------------------------------------
  square("piazza-maggiore", "Piazza Maggiore", {
    strict: true,
    aliases: ["piazza grande", "crescentone", "san petronio", "basilica di san petronio", "pzza maggiore"],
  }),
  square("piazza-nettuno", "Piazza del Nettuno", {
    name: "Piazza Nettuno",
    aliases: ["piazza nettuno", "fontana del nettuno", "statua del nettuno", "il nettuno"],
  }),
  square("piazza-verdi", "Piazza Giuseppe Verdi", { name: "Piazza Verdi", short: "verdi", strict: true }),
  square("piazza-viii-agosto", "Piazza dell'Otto Agosto", {
    name: "Piazza VIII Agosto",
    strict: true,
    aliases: ["piazza viii agosto", "piazza 8 agosto", "piazza 8 agosto 1848", "piazzola", "mercato della piazzola"],
  }),
  square("piazza-san-francesco", "Piazza San Francesco", { strict: true }),
  square("piazza-santo-stefano", "Piazza Santo Stefano", { aliases: ["sette chiese", "basilica di santo stefano"] }),
  square("piazza-unita", "Piazza dell'Unità", { strict: true }),
  square("piazza-san-domenico", "Piazza San Domenico"),
  square("piazza-galvani", ["Piazza Luigi Galvani", "Piazza Galvani"], { name: "Piazza Galvani", short: "galvani" }),
  square("piazza-re-enzo", "Piazza Re Enzo", { aliases: ["palazzo re enzo"] }),
  square("piazza-minghetti", "Piazza Minghetti"),
  square("piazza-cavour", "Piazza Cavour", { strict: true }),
  square("piazza-malpighi", "Piazza Malpighi", { strict: true }),
  square("piazza-martiri", ["Piazza dei Martiri 1943-1945", "Piazza dei Martiri"], {
    name: "Piazza dei Martiri",
    strict: true,
  }),
  square("piazza-xx-settembre", "Piazza Venti Settembre", {
    name: "Piazza XX Settembre",
    strict: true,
    aliases: ["piazza xx settembre", "piazza 20 settembre"],
  }),
  square("piazza-medaglie-oro", "Piazza delle Medaglie d'Oro", { aliases: ["piazza medaglie d'oro"] }),
  square("piazza-scaravilli", "Piazza Antonino Scaravilli", { name: "Piazza Scaravilli", short: "scaravilli" }),
  square("piazza-puntoni", "Piazza Vittorio Puntoni", { name: "Piazza Puntoni", short: "puntoni" }),
  square("piazza-aldrovandi", ["Piazza Aldrovandi", "Piazza Aldrovandi - Due Torri"], { short: "aldrovandi" }),
  square("piazza-mercanzia", "Piazza della Mercanzia"),
  square("piazza-roosevelt", ["Piazza Roosevelt", "Piazza Franklin Delano Roosvelt"], {
    short: "roosevelt",
    aliases: ["piazza roosvelt"],
  }),
  square("piazza-san-martino", "Piazza San Martino", { strict: true }),
  square("piazza-rossini", "Piazza Rossini"),
  square("piazza-porta-ravegnana", "Piazza di Porta Ravegnana", { aliases: ["porta ravegnana"] }),
  square("piazza-carducci", "Piazza Giosuè Carducci", { name: "Piazza Carducci", short: "carducci", strict: true }),
  square("piazza-lucio-dalla", "Piazza Lucio Dalla", { strict: true }),
  square("piazza-liber-paradisus", "Piazza Liber Paradisus", { aliases: ["uffici comunali di piazza liber paradisus"] }),
  square("piazza-trento-trieste", ["Piazza Trento e Trieste", "Piazza Trento Trieste"], {
    strict: true,
    aliases: ["piazza trento trieste"],
  }),
  square("piazza-pace", "Piazza della Pace", { strict: true }),
  square("piazza-azzarita", "Piazza Manfredi Azzarita", {
    name: "Piazza Azzarita",
    short: "azzarita",
    aliases: ["paladozza", "pala dozza", "palazzo dello sport"],
  }),
  square("piazza-colori", ["Piazza dei Colori", "Piazza Dei Colori"], { strict: true }),
  square("piazza-galilei", "Piazza Galileo Galilei", { name: "Piazza Galilei", short: "galilei", strict: true }),
  square("piazza-costituzione", "Piazza della Costituzione", { strict: true }),
  square("piazza-tribunali", "Piazza dei Tribunali", { strict: true }),
  square("piazza-baraccano", "Piazza del Baraccano"),
  square("piazza-spadolini", ["Piazza Giovanni Spadolini", "Piazza Spadolini"], { name: "Piazza Spadolini", short: "spadolini" }),
  square("piazza-lambrakis", "Piazza Grigoris Lambrakis", { name: "Piazza Lambrakis", short: "lambrakis" }),
  square("piazza-resistenza", "Piazza della Resistenza", { strict: true }),

  // --- Strade -------------------------------------------------------------------------
  street("via-indipendenza", "Via dell'Indipendenza", {
    strict: true,
    aliases: ["via indipendeza", "via indipendenzia", "via indip"],
  }),
  street("via-rizzoli", "Via Francesco Rizzoli", { name: "Via Rizzoli", short: "rizzoli" }),
  street("via-ugo-bassi", "Via Ugo Bassi", { aliases: ["u bassi", "ugobassi"] }),
  street("via-zamboni", "Via Zamboni"),
  street("via-irnerio", "Via Irnerio"),
  street("via-marconi", "Via Guglielmo Marconi", { name: "Via Marconi", short: "marconi" }),
  street("via-saragozza", "Via Saragozza"),
  street("via-san-felice", "Via San Felice"),
  street("via-mascarella", "Via Mascarella"),
  street("via-stalingrado", "Via Stalingrado", { aliases: ["via stalingardo"] }),
  street("via-massarenti", ["Via Giuseppe Massarenti", "Via Massarenti"], {
    name: "Via Massarenti",
    short: "massarenti",
    aliases: ["via massarente"],
  }),
  street("via-pratello", "Via del Pratello", { aliases: ["il pratello"] }),
  street("via-castiglione", "Via Castiglione", { strict: true }),
  street("via-santo-stefano", "Via Santo Stefano", { strict: true }),
  street("via-san-vitale", "Via San Vitale"),
  street("strada-maggiore", "Strada Maggiore", { strict: true }),
  street("via-d-azeglio", "Via Massimo D'Azeglio", { name: "Via D'Azeglio", short: "d'azeglio" }),
  street("via-farini", "Via Luigi Carlo Farini", { name: "Via Farini", short: "farini" }),
  street("via-belle-arti", "Via delle Belle Arti"),
  street("via-guasto", "Via del Guasto", { strict: true }),
  street("via-petroni", "Via Giuseppe Petroni", { name: "Via Petroni", short: "petroni" }),
  street("via-righi", "Via Augusto Righi", { name: "Via Righi", short: "righi", strict: true }),
  street("via-oberdan", "Via Guglielmo Oberdan", { name: "Via Oberdan", short: "oberdan" }),
  street("via-galliera", "Via Galliera"),
  street("via-ferrarese", "Via Ferrarese", { strict: true }),
  street("via-corticella", "Via di Corticella", { strict: true }),
  street("via-matteotti", "Via Giacomo Matteotti", { name: "Via Matteotti", short: "matteotti", strict: true }),
  street("via-arcoveggio", "Via dell'Arcoveggio", { strict: true }),
  street("via-lame", "Via delle Lame", { strict: true }),
  street("via-san-donato", "Via San Donato"),
  street("via-del-lavoro", "Via del Lavoro", { strict: true }),
  street("via-libia", "Via Libia", { strict: true }),
  street("via-mazzini", "Via Giuseppe Mazzini", { name: "Via Mazzini", short: "mazzini", strict: true }),
  street("via-murri", "Via Augusto Murri", { name: "Via Murri", short: "murri" }),
  street("via-toscana", "Via Toscana", { strict: true }),
  street("via-andrea-costa", "Via Andrea Costa"),
  street("via-emilia-levante", "Via Emilia Levante"),
  street("via-emilia-ponente", "Via Emilia Ponente"),
  street("via-riva-di-reno", "Via Riva di Reno"),
  street("via-marsala", "Via Marsala", { strict: true }),
  street("via-sant-isaia", "Via Sant'Isaia"),
  street("via-barberia", "Via Barberia"),
  street("via-carbonesi", "Via de' Carbonesi"),
  street("via-altabella", "Via Altabella"),
  street("via-clavature", "Via Clavature"),
  street("via-orefici", "Via degli Orefici", { strict: true }),
  street("via-borgo-san-pietro", "Via del Borgo di San Pietro"),
  street("via-fioravanti", "Via Aristotile Fioravanti", { name: "Via Fioravanti", short: "fioravanti" }),
  street("via-tiarini", "Via Alessandro Tiarini", { name: "Via Tiarini", short: "tiarini" }),
  street("via-mattei", "Via Enrico Mattei", { name: "Via Mattei", short: "mattei", strict: true }),
  street("via-del-pilastro", "Via del Pilastro", { strict: true }),
  street("via-san-mamolo", "Via San Mamolo"),
  street("via-saffi", "Via Aurelio Saffi", { name: "Via Saffi", short: "saffi" }),
  street("via-dei-mille", "Via dei Mille", { strict: true }),
  street("via-amendola", "Via Giovanni Amendola", { name: "Via Amendola", short: "amendola", strict: true }),
  street("via-gramsci", "Via Antonio Gramsci", { name: "Via Gramsci", short: "gramsci", strict: true }),
  street("via-capo-di-lucca", "Via Capo di Lucca"),
  street("via-del-porto", "Via del Porto", { strict: true }),
  street("via-nazario-sauro", "Via Nazario Sauro"),
  street("via-cesare-battisti", "Via Cesare Battisti", { strict: true }),
  street("via-garibaldi", "Via Giuseppe Garibaldi", { name: "Via Garibaldi", short: "garibaldi", strict: true }),
  street("via-montebello", "Via Montebello", { strict: true }),
  street("via-boldrini", "Via Cesare Boldrini", { name: "Via Boldrini", short: "boldrini" }),
  street("via-larga", "Via Larga", { strict: true }),
  street("via-michelino", "Via Michelino"),
  street("via-due-madonne", "Via Due Madonne"),
  street("viale-repubblica", "Viale della Repubblica", { strict: true }),
  street("viale-aldo-moro", "Viale Aldo Moro", { strict: true }),
  ...VIALI,
  {
    id: "viali",
    name: "Viali di circonvallazione",
    type: "line",
    aliases: ["viali", "i viali", "circonvallazione", "anello dei viali", "viali di circonvallazione"],
    source: { kind: "union", of: VIALI.map((v) => v.id) },
  },
  {
    id: "tangenziale",
    name: "Tangenziale di Bologna",
    type: "line",
    aliases: ["tangenziale", "la tange", "tange", "complanare", "tangenziale di bologna"],
    source: { kind: "osm", names: [], match: "motorway" },
  },

  // --- Landmark -----------------------------------------------------------------------
  landmark("due-torri", "Due Torri", "point", ["Asinelli", "Garisenda"], [
    "due torri", "2 torri", "torre degli asinelli", "asinelli", "garisenda", "torre garisenda",
  ]),
  landmark("stazione-centrale", "Stazione Centrale", "point", ["Bologna Centrale", "Bologna Centrale Alta Velocità"], [
    "stazione centrale", "stazione di bologna", "bologna centrale", "stazione ferroviaria", "stazione fs",
    "stazione av", "stazione alta velocità", "stazione dei treni",
  ]),
  landmark("montagnola", "Parco della Montagnola", "polygon", "Parco della Montagnola", [
    "montagnola", "parco montagnola",
  ]),
  landmark("autostazione", "Autostazione", "point", "Autostazione di Bologna", [
    "autostazione", "autostazione di bologna", "stazione delle corriere", "stazione dei pullman",
  ]),
  landmark("policlinico-sant-orsola", "Policlinico Sant'Orsola", "polygon", "Policlinico Sant'Orsola-Malpighi", [
    "sant'orsola", "santorsola", "policlinico", "policlinico sant'orsola", "ospedale sant'orsola", "sant'orsola-malpighi",
  ]),
  landmark("rettorato", "Rettorato Unibo (Palazzo Poggi)", "point", "Palazzo Poggi", [
    "rettorato", "rettorato unibo", "palazzo poggi", "rettorato dell'università", "sede unibo",
  ]),
  landmark("fiera", "Fiera di Bologna", "polygon", "Fiera di Bologna", [
    "fiera", "fiera di bologna", "bolognafiere", "bologna fiere", "quartiere fieristico", "zona fiera",
  ]),
  landmark("palazzo-accursio", "Palazzo d'Accursio", "point", "Palazzo d'Accursio", [
    "palazzo d'accursio", "palazzo comunale", "palazzo del comune", "municipio",
  ]),
  landmark("prefettura", "Prefettura", "point", ["Prefettura di Bologna", "Prefettura"], ["prefettura"]),
  {
    // Several police offices are named "Questura"; the Questura itself is Piazza Galilei 7.
    id: "questura",
    name: "Questura",
    type: "point",
    aliases: ["questura", "questura di bologna"],
    source: { kind: "osm", names: ["Questura"], match: "point", where: { "addr:street": "Piazza Galileo Galilei" } },
  },
  landmark("regione", "Sede della Regione Emilia-Romagna", "point", ["Regione Emilia-Romagna", "Terza Torre"], [
    "regione emilia-romagna", "sede della regione", "terza torre", "torri della regione",
  ]),
  landmark("stadio-dall-ara", "Stadio Renato Dall'Ara", "polygon", ["Stadio Renato Dall'Ara", "Stadio Dall'Ara"], [
    "stadio", "stadio dall'ara", "dall'ara", "renato dall'ara",
  ]),
  landmark("ospedale-maggiore", "Ospedale Maggiore", "polygon", "Ospedale Maggiore Carlo Alberto Pizzardi", [
    "ospedale maggiore",
  ]),
  landmark("giardini-margherita", "Giardini Margherita", "polygon", ["Giardini Margherita", "Giardini Regina Margherita"], [
    "giardini margherita", "ai giardini margherita",
  ]),
  landmark("aeroporto", "Aeroporto Guglielmo Marconi", "polygon", 'Aeroporto di Bologna "Guglielmo Marconi"', [
    "aeroporto", "aeroporto marconi", "aeroporto di bologna", "aeroporto guglielmo marconi", "blq",
  ]),

  // --- Porte (city gates) -------------------------------------------------------------
  gate("porta-san-felice", "Porta San Felice"),
  gate("porta-saragozza", "Porta Saragozza"),
  gate("porta-galliera", "Porta Galliera"),
  gate("porta-lame", "Porta Lame", ["Porta delle Lame"]),
  gate("porta-mascarella", "Porta Mascarella"),
  gate("porta-san-donato", "Porta San Donato", ["Porta Zamboni"]),
  gate("porta-san-vitale", "Porta San Vitale"),
  gate("porta-maggiore", "Porta Maggiore", ["Porta Mazzini"]),
  gate("porta-santo-stefano", "Porta Santo Stefano"),
  gate("porta-castiglione", "Porta Castiglione"),
  gate("porta-san-mamolo", "Porta San Mamolo"),
  gate("porta-sant-isaia", "Porta Sant'Isaia"),

  // --- Aree: quartieri (Comune) -------------------------------------------------------
  comune("quartiere-navile", "Quartiere Navile", "quartieri-di-bologna", "Navile", ["navile", "quartiere navile"]),
  comune("quartiere-san-donato-san-vitale", "Quartiere San Donato-San Vitale", "quartieri-di-bologna", "San Donato-San Vitale", [
    "san donato", "quartiere san donato", "quartiere san vitale", "san donato-san vitale", "quartiere san donato-san vitale",
  ]),
  comune("quartiere-porto-saragozza", "Quartiere Porto-Saragozza", "quartieri-di-bologna", "Porto-Saragozza", [
    "porto-saragozza", "quartiere porto", "quartiere saragozza", "quartiere porto-saragozza",
  ]),
  comune("quartiere-santo-stefano", "Quartiere Santo Stefano", "quartieri-di-bologna", "Santo Stefano", [
    "quartiere santo stefano",
  ]),
  comune("quartiere-savena", "Quartiere Savena", "quartieri-di-bologna", "Savena", ["savena", "quartiere savena"]),
  comune("quartiere-borgo-panigale-reno", "Quartiere Borgo Panigale-Reno", "quartieri-di-bologna", "Borgo Panigale-Reno", [
    "borgo panigale", "borgo panigale-reno", "quartiere borgo panigale", "quartiere reno", "quartiere borgo panigale-reno",
  ]),

  // --- Aree: zone and statistical areas (Comune) ---------------------------------------
  comune("bolognina", "Bolognina", "zone-del-comune-di-bologna", "Bolognina", ["bolognina", "la bolognina", "zona bolognina"]),
  comune("corticella", "Corticella", "zone-del-comune-di-bologna", "Corticella", ["corticella", "zona corticella"]),
  comune("zona-lame", "Zona Lame", "zone-del-comune-di-bologna", "Lame", ["zona lame", "quartiere lame"]),
  comune("barca", "Barca", "zone-del-comune-di-bologna", "Barca", ["zona barca", "quartiere barca", "villaggio della barca"]),
  comune("santa-viola", "Santa Viola", "zone-del-comune-di-bologna", "S. Viola", ["santa viola", "zona santa viola"]),
  comune("san-ruffillo", "San Ruffillo", "zone-del-comune-di-bologna", "S. Ruffillo", ["san ruffillo", "zona san ruffillo"]),
  comune("zona-murri", "Zona Murri", "zone-del-comune-di-bologna", "Murri", ["zona murri", "quartiere murri"]),
  comune("zona-mazzini", "Zona Mazzini", "zone-del-comune-di-bologna", "Mazzini", ["zona mazzini", "quartiere mazzini"]),
  comune("pilastro", "Pilastro", "aree-statistiche", "PILASTRO", ["pilastro", "rione pilastro", "villaggio pilastro", "il pilastro"]),
  comune("cirenaica", "Cirenaica", "aree-statistiche", "CIRENAICA", ["cirenaica", "zona cirenaica"]),
  comune("croce-del-biacco", "Croce del Biacco", "aree-statistiche", "CROCE DEL BIACCO", ["croce del biacco"]),
  comune("fossolo", "Fossolo", "aree-statistiche", "FOSSOLO", ["fossolo", "zona fossolo"]),
  comune("arcoveggio", "Arcoveggio", "aree-statistiche", "ARCOVEGGIO", ["arcoveggio", "zona arcoveggio"]),
  comune("dozza", "La Dozza", "aree-statistiche", "LA DOZZA", ["dozza", "la dozza", "carcere della dozza"]),
  comune("roveri", "Roveri", "aree-statistiche", "ROVERI", ["roveri", "zona roveri"]),
  comune("san-donnino", "San Donnino", "aree-statistiche", "SAN DONNINO", ["san donnino"]),

  // --- Aree: derived ------------------------------------------------------------------
  {
    id: "zona-universitaria",
    name: "Zona universitaria",
    type: "area",
    aliases: ["zona universitaria", "zona università", "zona univ", "quartiere universitario", "cittadella universitaria"],
    source: {
      kind: "hull",
      of: ["via-zamboni", "via-belle-arti", "via-guasto", "via-petroni", "piazza-verdi", "piazza-scaravilli", "piazza-puntoni"],
    },
  },
  {
    id: "centro-storico",
    name: "Centro storico",
    type: "area",
    aliases: ["centro storico", "zona centro", "centro città", "dentro i viali"],
    source: { kind: "hull", of: ["viali"] },
  },
];
