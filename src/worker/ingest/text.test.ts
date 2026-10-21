import { describe, expect, it } from "vitest";
import { NearDuplicateIndex, jaccard, shingles } from "./dedupe";
import { htmlToText, isProtestRelated, scrubHandles } from "./text";

describe("isProtestRelated", () => {
  it.each([
    "Corteo degli studenti in centro",
    "Due cortei partiti dalla stazione",
    "Manifestazione per la Palestina",
    "Scontri tra manifestanti e polizia",
    "Presidio davanti alla prefettura",
    "Blocco stradale sui viali",
    "Tangenziale bloccata dai lavoratori",
    "Lanciati lacrimogeni",
    "Cariche di alleggerimento",
    "Sgombero dell'edificio occupato",
    "Occupazione dell'aula magna",
  ])("matches %s", (t) => expect(isProtestRelated(t)).toBe(true));

  it.each(["Nuova linea del tram da lunedì", "Concerto in piazza Maggiore", "Il Bologna vince 2-0", "Corteggiamento"])(
    "ignores %s",
    (t) => expect(isProtestRelated(t)).toBe(false),
  );
});

describe("htmlToText", () => {
  it("strips tags, decodes entities and keeps line breaks", () => {
    expect(htmlToText("<p>Via&nbsp;Zamboni <b>chiusa</b></p><p>dalle 18 &amp; oltre</p>")).toBe("Via Zamboni chiusa\ndalle 18 & oltre");
    expect(htmlToText("riga 1<br/>riga 2")).toBe("riga 1\nriga 2");
  });
});

describe("scrubHandles", () => {
  it("removes Reddit users, @handles and profile links", () => {
    expect(scrubHandles("Visto da u/mario_rossi92 in via Irnerio")).toBe("Visto da in via Irnerio");
    expect(scrubHandles("cc /u/qualcuno e @utente.bsky.social")).toBe("cc e");
    expect(scrubHandles("profilo https://www.reddit.com/user/someone/ ok")).toBe("profilo ok");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubHandles("Corteo in via Zamboni, info@comune non toccata")).toBe("Corteo in via Zamboni, info@comune non toccata");
  });
});

describe("near-duplicate detection", () => {
  const a = "Corteo degli studenti partito da piazza Verdi verso via Zamboni, traffico bloccato";
  it("scores rewordings and copies", () => {
    expect(jaccard(shingles(a), shingles(a.toUpperCase() + "!"))).toBe(1);
    expect(jaccard(shingles(a), shingles("Incendio in un appartamento in Bolognina"))).toBeLessThan(0.2);
  });

  it("flags texts above 0.85 Jaccard against recent ones and within the batch", () => {
    const idx = new NearDuplicateIndex([a]);
    expect(idx.checkAndAdd(`${a}.`)).toBe(true);
    const b = "Presidio dei sanitari davanti al Sant'Orsola contro i tagli";
    expect(idx.checkAndAdd(b)).toBe(false);
    expect(idx.checkAndAdd(`${b}!!`)).toBe(true);
    // One extra word out of ~12 is still a duplicate; a different story is not.
    expect(idx.checkAndAdd(`${a} oggi`)).toBe(true);
    expect(idx.checkAndAdd("Corteo degli studenti partito da piazza Maggiore verso via Rizzoli")).toBe(false);
  });
});
