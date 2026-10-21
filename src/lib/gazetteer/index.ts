import data from "./data/places.json";
import { Gazetteer, type LookupMatch } from "./lookup";
import { nominatimGeocode, type GeocodeResult, type NominatimOptions } from "./nominatim";
import type { GazetteerData } from "./types";

export { toCells } from "./cells";
export type { LookupMatch } from "./lookup";
export type { Geometry, Place, PlaceType } from "./types";

export const gazetteerData = data as unknown as GazetteerData;
export const gazetteer = new Gazetteer(gazetteerData.places);

/** Finds known Bologna places mentioned in a text. Pure and offline. */
export function lookup(text: string): LookupMatch[] {
  return gazetteer.lookup(text);
}

export type GeocodeOutcome =
  | { source: "gazetteer"; matches: LookupMatch[] }
  | { source: "nominatim"; result: GeocodeResult }
  | { source: "none" };

/**
 * Geocodes a place phrase (e.g. the location an extractor pulled from a post — never the
 * post itself): gazetteer first, Nominatim only when nothing matched.
 */
export async function geocodePlace(phrase: string, nominatim: NominatimOptions): Promise<GeocodeOutcome> {
  const matches = lookup(phrase);
  if (matches.length) return { source: "gazetteer", matches };
  const result = await nominatimGeocode(phrase, nominatim);
  return result ? { source: "nominatim", result } : { source: "none" };
}
