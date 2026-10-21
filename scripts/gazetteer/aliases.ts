import { normalize, normalizedKey } from "../../src/lib/gazetteer/normalize";
import type { PlaceSpec } from "./places";

const PREFIX_WORDS = /^(via|viale|strada|piazza|piazzale|largo)\s+/i;

/** Expands a spec into the alias list stored in places.json (see places.ts header). */
export function expandAliases(spec: PlaceSpec): string[] {
  const forms: string[] = [spec.name];
  const m = PREFIX_WORDS.exec(spec.name);
  if (m) {
    const prefix = m[1].toLowerCase();
    const bare = spec.name.slice(m[0].length);
    if (!spec.strict) forms.push(bare);
    if (spec.short) {
      forms.push(`${prefix} ${spec.short}`);
      if (!spec.strict) forms.push(spec.short);
    }
  } else if (spec.short) {
    forms.push(spec.short);
  }
  forms.push(...(spec.aliases ?? []));

  // "San Francesco" -> "S. Francesco", "Sant'Orsola" -> "S. Orsola"
  for (const f of [...forms]) {
    const abbreviated = f.replace(/\b(san|santo|santa)\s+|\bsant'/gi, "S. ");
    if (abbreviated !== f) forms.push(abbreviated);
  }

  // Hashtags: "#piazzaverdi", "#duetorri". Single token, so they match without a prefix.
  for (const f of [...forms]) {
    if (f.startsWith("#") || f.split(/\s+/).length > 4) continue;
    const isBare = !normalize(f)[0]?.pre;
    if (spec.strict && isBare) continue;
    forms.push("#" + f.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""));
  }

  const seen = new Set<string>();
  return forms.filter((f) => {
    const key = f.startsWith("#") ? f : normalizedKey(f);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
