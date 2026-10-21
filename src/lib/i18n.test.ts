import { describe, expect, it } from "vitest";
import { DANGER_LEVELS } from "./danger-levels";
import { EVENT_TYPES } from "./event-types";
import { DEFAULT_LANG, isLang, LANGS, STRINGS } from "./i18n";
import { formatAgo } from "./time";

describe("i18n", () => {
  it("defaults to Italian", () => {
    expect(DEFAULT_LANG).toBe("it");
    expect(STRINGS.it.legend.grey).toBe("Grigio non significa sicuro.");
  });

  it.each(LANGS)("%s covers every danger level and event type", (lang) => {
    const t = STRINGS[lang];
    for (const d of DANGER_LEVELS) {
      expect(t.levels[d.level]?.label, `${lang} level ${d.level}`).toBeTruthy();
      expect(t.levels[d.level]?.meaning, `${lang} level ${d.level}`).toBeTruthy();
    }
    for (const e of EVENT_TYPES) expect(t.events[e], `${lang} ${e}`).toBeTruthy();
  });

  it("keeps English level labels identical to the rule-2 table", () => {
    for (const d of DANGER_LEVELS) expect(STRINGS.en.levels[d.level].label).toBe(d.label);
  });

  it("recognises supported languages only", () => {
    expect(isLang("it")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});

describe("formatAgo in Italian", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it.each([
    ["2026-10-21T11:59:30Z", "adesso"],
    ["2026-10-21T11:55:00Z", "5 min fa"],
    ["2026-10-21T10:30:00Z", "1 h 30 min fa"],
  ])("%s → %s", (iso, expected) => {
    expect(formatAgo(iso, now, "it")).toBe(expected);
  });
});
