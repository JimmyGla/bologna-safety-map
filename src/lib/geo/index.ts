// H3 helpers. All spatial aggregation uses this resolution — do not mix resolutions.
export const H3_RESOLUTION = 9;

// Approximate Bologna bounding box [west, south, east, north].
export const BOLOGNA_BBOX = [11.22, 44.42, 11.43, 44.56] as const;
export const BOLOGNA_CENTER = [11.3426, 44.4949] as const;
