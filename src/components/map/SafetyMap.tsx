"use client";

import type * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { isStale, REPORT_WINDOW_MINUTES } from "@/lib/freshness";
import { formatAgo } from "@/lib/time";
import { addCellLayers, createBaseMap, firstLabelLayer } from "./base-map";
import { LangSwitch, useLang } from "../i18n";
import { CellPanel } from "./CellPanel";
import { Legend } from "./Legend";
import { UpdatedBadge } from "./UpdatedBadge";
import { useCells, useNow } from "./useCells";

export function SafetyMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, error } = useCells();
  const now = useNow();
  const { lang, t } = useLang();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createBaseMap(containerRef.current);

    map.on("load", () => {
      addCellLayers(map);
      map.addLayer({
        id: "cells-selected",
        type: "line",
        source: "cells",
        filter: ["==", ["get", "h3"], ""],
        paint: { "line-color": "#111827", "line-width": 3 },
      }, firstLabelLayer(map));
      setLoaded(true);
    });

    map.on("click", (e: MapMouseEvent) => {
      // The remote base style loads asynchronously; before that there is nothing to hit.
      if (!map.getLayer("cells-fill")) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["cells-fill"] })[0];
      setSelectedId(hit ? String(hit.properties.h3) : null);
    });
    map.on("mouseenter", "cells-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "cells-fill", () => (map.getCanvas().style.cursor = ""));

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
  }, []);

  useEffect(() => {
    if (!loaded || !data) return;
    (mapRef.current?.getSource("cells") as GeoJSONSource | undefined)?.setData(
      data as unknown as GeoJSON.FeatureCollection,
    );
  }, [loaded, data]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("cells-selected", ["==", ["get", "h3"], selectedId ?? ""]);
  }, [loaded, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selected = useMemo(
    () => data?.features.find((f) => f.properties.h3 === selectedId)?.properties ?? null,
    [data, selectedId],
  );

  // Only judge freshness once we have an answer (or the fetch failed).
  const stale = (!!data || error) && isStale(data?.generatedAt ?? null, now);
  // A fresh snapshot with nothing above level 0: say so, or an empty map looks broken.
  const quiet = !!data && !stale && !data.features.some((f) => f.properties.level > 0);

  return (
    <div className="relative h-full w-full">
      {/* h-full, not absolute: maplibre-gl.css forces position: relative on the container. */}
      <div
        ref={containerRef}
        className={`h-full w-full bg-gray-200 transition-[filter] ${stale ? "grayscale opacity-60" : ""}`}
        aria-label={t.mapLabel}
      />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-gray-900 shadow">
        {t.title}
        <LangSwitch />
      </div>
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
        <UpdatedBadge generatedAt={data?.generatedAt ?? null} loaded={!!data} error={error} />
        {data?.reducedAccuracy && !stale && (
          <div
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-900 shadow"
            title={t.badge.reducedAccuracyHint}
          >
            {t.badge.reducedAccuracy}
          </div>
        )}
      </div>
      {stale && (
        <div
          role="alert"
          className="absolute inset-x-3 top-14 z-10 mx-auto max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 shadow sm:top-3"
        >
          <strong>{t.stale.title}</strong>{" "}
          {data?.generatedAt ? t.stale.withTime(formatAgo(data.generatedAt, now, lang)) : t.stale.none}
        </div>
      )}
      {quiet && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-3 top-14 z-10 mx-auto max-w-md rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-gray-800 shadow sm:top-3"
        >
          <strong>{t.quiet.title}</strong> {t.quiet.rest(REPORT_WINDOW_MINUTES / 60)}
        </div>
      )}
      <Legend />
      {selected && <CellPanel cell={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
