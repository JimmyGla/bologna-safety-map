"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { DANGER_LEVELS } from "@/lib/danger-levels";
import { BOLOGNA_CENTER } from "@/lib/geo";

// Shared by the public map and the admin override tool.

// Copied there by scripts/copy-maplibre-worker.mjs (predev/prebuild).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function colorByLevel(key: "hex" | "outline"): ExpressionSpecification {
  const pairs = DANGER_LEVELS.flatMap((d) => [d.level, d[key]]);
  return ["match", ["get", "level"], ...pairs, DANGER_LEVELS[0][key]] as unknown as ExpressionSpecification;
}

/** OSM raster map centred on Bologna, zoom 13. */
export function createBaseMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    center: [BOLOGNA_CENTER[0], BOLOGNA_CENTER[1]],
    zoom: 13,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
          attribution: OSM_ATTRIBUTION,
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  return map;
}

/** Adds the "cells" source with level-coloured fill + outline layers. */
export function addCellLayers(map: maplibregl.Map) {
  map.addSource("cells", { type: "geojson", data: EMPTY_FC, promoteId: "h3" });
  map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": colorByLevel("hex"), "fill-opacity": 0.45 } });
  map.addLayer({ id: "cells-outline", type: "line", source: "cells", paint: { "line-color": colorByLevel("outline"), "line-width": 1.2 } });
}
