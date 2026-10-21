"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { DANGER_LEVELS } from "@/lib/danger-levels";
import { BOLOGNA_CENTER } from "@/lib/geo";

// Shared by the public map and the admin override tool.

// Copied there by scripts/copy-maplibre-worker.mjs (predev/prebuild).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// OpenFreeMap: free vector tiles from OpenStreetMap data, no API key, meant for production
// traffic (unlike tile.openstreetmap.org, which may throttle busy sites). Positron is a light
// style designed for data overlays. Attribution comes with the tile source.
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function colorByLevel(key: "hex" | "outline"): ExpressionSpecification {
  const pairs = DANGER_LEVELS.flatMap((d) => [d.level, d[key]]);
  return ["match", ["get", "level"], ...pairs, DANGER_LEVELS[0][key]] as unknown as ExpressionSpecification;
}

/** OpenFreeMap vector map centred on Bologna, zoom 13. */
export function createBaseMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    center: [BOLOGNA_CENTER[0], BOLOGNA_CENTER[1]],
    zoom: 13,
    attributionControl: { compact: true },
    style: BASEMAP_STYLE_URL,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  return map;
}

/** First label layer of the base style: cells go below it so street names stay readable. */
export function firstLabelLayer(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

/** Adds the "cells" source with level-coloured fill + outline layers, under the labels. */
export function addCellLayers(map: maplibregl.Map) {
  const before = firstLabelLayer(map);
  map.addSource("cells", { type: "geojson", data: EMPTY_FC, promoteId: "h3" });
  map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": colorByLevel("hex"), "fill-opacity": 0.45 } }, before);
  map.addLayer({ id: "cells-outline", type: "line", source: "cells", paint: { "line-color": colorByLevel("outline"), "line-width": 1.2 } }, before);
}
