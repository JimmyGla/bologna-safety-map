"use client";

import type * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { isStale, REPORT_WINDOW_MINUTES } from "@/lib/freshness";
import type { UpcomingEvent } from "@/lib/planned";
import { formatAgo } from "@/lib/time";
import { addCellLayers, createBaseMap, EMPTY_FC, firstLabelLayer } from "./base-map";
import { LangSwitch, useLang } from "../i18n";
import { CellPanel } from "./CellPanel";
import { Legend } from "./Legend";
import { PLANNED_COLOR, UpcomingButton, UpcomingPanel } from "./UpcomingPanel";
import { UpdatedBadge } from "./UpdatedBadge";
import { useCells, useNow } from "./useCells";
import { useUpcoming } from "./useUpcoming";

/** Bounds of the outline polygons of one announced event. */
function boundsOf(fc: GeoJSON.FeatureCollection, eventId: string): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of fc.features) {
    if (f.properties?.eventId !== eventId || f.geometry.type !== "Polygon") continue;
    for (const [x, y] of f.geometry.coordinates[0]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

export function SafetyMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [plannedId, setPlannedId] = useState<string | null>(null);
  const { data, error } = useCells();
  const upcoming = useUpcoming();
  const now = useNow();
  const { lang, t } = useLang();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createBaseMap(containerRef.current);

    map.on("load", () => {
      addCellLayers(map);
      const below = firstLabelLayer(map);
      map.addLayer({
        id: "cells-selected",
        type: "line",
        source: "cells",
        filter: ["==", ["get", "h3"], ""],
        paint: { "line-color": "#111827", "line-width": 3 },
      }, below);
      // Announced protests: dashed outline above the danger colours, never a fill colour of
      // its own, so they can't be mistaken for a danger level.
      map.addSource("planned", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "planned-fill", type: "fill", source: "planned", paint: { "fill-color": PLANNED_COLOR, "fill-opacity": 0.06 } }, below);
      map.addLayer({
        id: "planned-outline",
        type: "line",
        source: "planned",
        paint: { "line-color": PLANNED_COLOR, "line-width": 2, "line-dasharray": [2, 1.5] },
      }, below);
      map.addLayer({
        id: "planned-selected",
        type: "line",
        source: "planned",
        filter: ["==", ["get", "eventId"], ""],
        paint: { "line-color": PLANNED_COLOR, "line-width": 4 },
      }, below);
      setLoaded(true);
    });

    map.on("click", (e: MapMouseEvent) => {
      // The remote base style loads asynchronously; before that there is nothing to hit.
      if (!map.getLayer("cells-fill") || !map.getLayer("planned-fill")) return;
      const cell = map.queryRenderedFeatures(e.point, { layers: ["cells-fill"] })[0];
      if (cell) {
        setSelectedId(String(cell.properties.h3));
        return;
      }
      setSelectedId(null);
      const planned = map.queryRenderedFeatures(e.point, { layers: ["planned-fill"] })[0];
      if (planned) {
        setPlannedId(String(planned.properties.eventId));
        setUpcomingOpen(true);
      }
    });
    for (const layer of ["cells-fill", "planned-fill"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

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
    if (!loaded || !upcoming) return;
    (mapRef.current?.getSource("planned") as GeoJSONSource | undefined)?.setData(upcoming.outline as GeoJSON.FeatureCollection);
  }, [loaded, upcoming]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("cells-selected", ["==", ["get", "h3"], selectedId ?? ""]);
  }, [loaded, selectedId]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("planned-selected", ["==", ["get", "eventId"], plannedId ?? ""]);
  }, [loaded, plannedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedId(null);
      setUpcomingOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selected = useMemo(
    () => data?.features.find((f) => f.properties.h3 === selectedId)?.properties ?? null,
    [data, selectedId],
  );

  const focusPlanned = (e: UpcomingEvent) => {
    setPlannedId(e.id);
    const b = upcoming && boundsOf(upcoming.outline as GeoJSON.FeatureCollection, e.id);
    if (b) mapRef.current?.fitBounds(b, { padding: 120, maxZoom: 15, duration: 600 });
  };

  // Only judge freshness once we have an answer (or the fetch failed).
  const stale = (!!data || error) && isStale(data?.generatedAt ?? null, now);
  // A fresh snapshot with nothing above level 0: say so, or an empty map looks broken.
  const quiet = !!data && !stale && !data.features.some((f) => f.properties.level > 0);
  const upcomingEvents = upcoming?.events ?? [];

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
        <UpcomingButton count={upcomingEvents.length} open={upcomingOpen} onToggle={() => setUpcomingOpen((o) => !o)} />
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
      {upcomingOpen && (
        <UpcomingPanel
          events={upcomingEvents}
          selectedId={plannedId}
          onSelect={focusPlanned}
          onClose={() => setUpcomingOpen(false)}
        />
      )}
      <Legend />
      {selected && <CellPanel cell={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
