// Webpack rewrites MapLibre's import.meta.url-based worker lookup, so the worker never
// gets served. Copy it into public/ and point MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre/maplibre-gl-worker.mjs",
);
