import { toCells } from "./cells";
import { gazetteerData } from "./index";

// Which quartiere a map cell belongs to (official Comune boundaries, via the gazetteer).
// Server-side helper for the statistical archive and reports.

const PREFIX = "Quartiere ";

let byCell: Map<string, string> | undefined;

function index(): Map<string, string> {
  if (byCell) return byCell;
  byCell = new Map();
  for (const p of gazetteerData.places) {
    if (!p.id.startsWith("quartiere-")) continue;
    const name = p.name.startsWith(PREFIX) ? p.name.slice(PREFIX.length) : p.name;
    for (const c of toCells(p.geometry)) if (!byCell.has(c)) byCell.set(c, name);
  }
  return byCell;
}

/** The six quartieri, by name ("Navile", "San Donato-San Vitale", …). */
export function quartiereNames(): string[] {
  return [...new Set(index().values())].sort();
}

/** Quartieri touched by these cells, sorted; cells outside the city are ignored. */
export function quartieriOf(cells: string[]): string[] {
  const idx = index();
  return [...new Set(cells.map((c) => idx.get(c)).filter((q): q is string => !!q))].sort();
}
