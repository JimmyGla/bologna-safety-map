export type Position = [lng: number, lat: number];

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

/** point: a spot; line: a street/road; polygon: a square or site; area: a neighbourhood. */
export type PlaceType = "point" | "line" | "polygon" | "area";

export type Place = {
  id: string;
  name: string;
  type: PlaceType;
  /**
   * Alias forms as people write them. An alias starting with a prefix ("via", "piazza",
   * "zona", ...) only matches when the text has a prefix of the same kind there.
   */
  aliases: string[];
  geometry: Geometry;
  source: "osm" | "comune" | "derived";
};

export type GazetteerData = {
  generatedAt: string;
  attribution: string[];
  places: Place[];
};
