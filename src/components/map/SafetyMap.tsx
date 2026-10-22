"use client";

import type * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { blockKey, FORECAST_LEVELS } from "@/lib/forecast";
import { isStale, REPORT_WINDOW_MINUTES } from "@/lib/freshness";
import type { UpcomingEvent } from "@/lib/planned";
import { formatAgo, formatBlock } from "@/lib/time";
import { addCellLayers, createBaseMap, EMPTY_FC, firstLabelLayer } from "./base-map";
import { LangSwitch, useLang } from "../i18n";
import { CellPanel } from "./CellPanel";
import { ForecastPanel } from "./ForecastPanel";
import { Legend } from "./Legend";
import { PLANNED_COLOR, UpcomingButton, UpcomingPanel } from "./UpcomingPanel";
import { UpdatedBadge } from "./UpdatedBadge";
import { useCells, useNow } from "./useCells";
import { useForecast } from "./useForecast";
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

type Mode = "now" | "forecast";
const NOW_LAYERS = ["cells-fill", "cells-outline", "cells-selected"];
const FORECAST_LAYERS = ["forecast-fill", "forecast-outline", "forecast-selected"];

/** Forecast colour for block i (cells with level 0 in that block are filtered out). */
function forecastColor(i: number, key: "hex" | "outline"): ExpressionSpecification {
  return ["match", ["get", blockKey(i)], ...FORECAST_LEVELS.flatMap((l) => [l.level, l[key]]), "rgba(0,0,0,0)"] as unknown as ExpressionSpecification;
}

export function SafetyMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [plannedId, setPlannedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("now");
  const modeRef = useRef<Mode>("now");
  const [blockIndex, setBlockIndex] = useState(0);
  const [forecastId, setForecastId] = useState<string | null>(null);
  const { data, error } = useCells();
  const upcoming = useUpcoming();
  const forecast = useForecast();
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
      // Forecast: its own violet palette, shown only in forecast mode (never with the danger colours).
      map.addSource("forecast", { type: "geojson", data: EMPTY_FC });
      const hidden = { visibility: "none" as const };
      const inBlock0: ExpressionSpecification = [">", ["get", blockKey(0)], 0];
      map.addLayer({ id: "forecast-fill", type: "fill", source: "forecast", layout: hidden, filter: inBlock0, paint: { "fill-color": forecastColor(0, "hex"), "fill-opacity": 0.55 } }, below);
      map.addLayer({ id: "forecast-outline", type: "line", source: "forecast", layout: hidden, filter: inBlock0, paint: { "line-color": forecastColor(0, "outline"), "line-width": 1.2 } }, below);
      map.addLayer({ id: "forecast-selected", type: "line", source: "forecast", layout: hidden, filter: ["==", ["get", "h3"], ""], paint: { "line-color": "#2e1065", "line-width": 3 } }, below);
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
      if (!map.getLayer("cells-fill") || !map.getLayer("planned-fill") || !map.getLayer("forecast-fill")) return;
      const forecastMode = modeRef.current === "forecast";
      const cell = map.queryRenderedFeatures(e.point, { layers: [forecastMode ? "forecast-fill" : "cells-fill"] })[0];
      const select = forecastMode ? setForecastId : setSelectedId;
      if (cell) {
        select(String(cell.properties.h3));
        return;
      }
      select(null);
      const planned = map.queryRenderedFeatures(e.point, { layers: ["planned-fill"] })[0];
      if (planned) {
        setPlannedId(String(planned.properties.eventId));
        setUpcomingOpen(true);
      }
    });
    for (const layer of ["cells-fill", "planned-fill", "forecast-fill"]) {
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
    if (!loaded || !forecast.data) return;
    (mapRef.current?.getSource("forecast") as GeoJSONSource | undefined)?.setData(forecast.data.geojson as GeoJSON.FeatureCollection);
  }, [loaded, forecast.data]);

  // Exactly one of the two layer sets is visible: a forecast is never drawn over current levels.
  useEffect(() => {
    modeRef.current = mode;
    const map = mapRef.current;
    if (!loaded || !map) return;
    for (const id of NOW_LAYERS) map.setLayoutProperty(id, "visibility", mode === "now" ? "visible" : "none");
    for (const id of FORECAST_LAYERS) map.setLayoutProperty(id, "visibility", mode === "forecast" ? "visible" : "none");
  }, [loaded, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const inBlock: ExpressionSpecification = [">", ["get", blockKey(blockIndex)], 0];
    map.setFilter("forecast-fill", inBlock);
    map.setFilter("forecast-outline", inBlock);
    map.setPaintProperty("forecast-fill", "fill-color", forecastColor(blockIndex, "hex"));
    map.setPaintProperty("forecast-outline", "line-color", forecastColor(blockIndex, "outline"));
  }, [loaded, blockIndex]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("forecast-selected", ["==", ["get", "h3"], forecastId ?? ""]);
  }, [loaded, forecastId]);

  useEffect(() => {
    if (!loaded) return;
    mapRef.current?.setFilter("planned-selected", ["==", ["get", "eventId"], plannedId ?? ""]);
  }, [loaded, plannedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedId(null);
      setForecastId(null);
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
  const blocks = forecast.data?.forecast?.blocks ?? [];
  const block = Math.min(blockIndex, Math.max(0, blocks.length - 1));
  const forecastCells = forecast.data?.forecast?.cells ?? [];
  const blockMax = blocks.map((_, i) => Math.max(0, ...forecastCells.map((c) => c.levels[i] ?? 0)));
  const forecastCell = forecastCells.find((c) => c.h3 === forecastId) ?? null;
  const switchMode = (m: Mode) => {
    setMode(m);
    setSelectedId(null);
    setForecastId(null);
  };

  return (
    <div className="relative h-full w-full">
      {/* h-full, not absolute: maplibre-gl.css forces position: relative on the container. */}
      <div
        ref={containerRef}
        className={`h-full w-full bg-gray-200 transition-[filter] ${stale ? "grayscale opacity-60" : ""}`}
        aria-label={t.mapLabel}
      />
      {/* One stack for everything at the top, so nothing overlaps on narrow screens (the
          status badges used to sit on top of the calendar button). The stack lets map taps
          through; only its children take clicks. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-gray-900 shadow">
            {t.title}
            <LangSwitch />
            <UpcomingButton count={upcomingEvents.length} open={upcomingOpen} onToggle={() => setUpcomingOpen((o) => !o)} />
          </div>
          <div className="pointer-events-auto ml-auto flex flex-col items-end gap-1.5">
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
        </div>
        <div className="pointer-events-auto flex w-fit rounded-lg bg-white/95 p-0.5 text-xs font-medium shadow" role="group" aria-label={t.forecast.modeLabel}>
          {(["now", "forecast"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md px-2.5 py-1 ${mode === m ? (m === "forecast" ? "bg-violet-700 text-white" : "bg-gray-900 text-white") : "text-gray-700 hover:bg-gray-100"}`}
            >
              {m === "now" ? t.forecast.modeNow : t.forecast.modeForecast}
            </button>
          ))}
        </div>
        {mode === "forecast" && (
          <>
            <div className="pointer-events-auto -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1" role="group" aria-label={t.forecast.blocksLabel}>
              {blocks.map((b, i) => {
                const max = FORECAST_LEVELS.find((l) => l.level === blockMax[i]);
                return (
                  <button
                    key={b.start}
                    type="button"
                    aria-pressed={i === block}
                    onClick={() => {
                      setBlockIndex(i);
                      setForecastId(null);
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-sm ${i === block ? "border-violet-700 bg-violet-700 text-white" : "border-gray-200 bg-white text-gray-800 hover:bg-violet-50"}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full border border-white/60" style={{ backgroundColor: max?.hex ?? "#e5e7eb" }} aria-hidden />
                    {formatBlock(b.start, b.end, lang)}
                  </button>
                );
              })}
            </div>
            <div role="status" className="mx-auto w-full max-w-md rounded-lg bg-violet-50/95 px-3 py-2 text-center text-sm text-violet-950 shadow">
              <strong>{t.forecast.banner}</strong>{" "}
              {!forecast.data?.forecast ? t.forecast.unavailable : blockMax[block] === 0 ? t.forecast.empty : null}
            </div>
          </>
        )}
        {mode === "now" && stale && (
          <div
            role="alert"
            className="pointer-events-auto mx-auto w-full max-w-md rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 shadow"
          >
            <strong>{t.stale.title}</strong>{" "}
            {data?.generatedAt ? t.stale.withTime(formatAgo(data.generatedAt, now, lang)) : t.stale.none}
          </div>
        )}
        {mode === "now" && quiet && (
          <div role="status" className="mx-auto w-full max-w-md rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-gray-800 shadow">
            <strong>{t.quiet.title}</strong> {t.quiet.rest(REPORT_WINDOW_MINUTES / 60)}
          </div>
        )}
      </div>
      {upcomingOpen && (
        <UpcomingPanel
          events={upcomingEvents}
          selectedId={plannedId}
          onSelect={focusPlanned}
          onClose={() => setUpcomingOpen(false)}
        />
      )}
      <Legend mode={mode} />
      {mode === "now" && selected && <CellPanel cell={selected} onClose={() => setSelectedId(null)} />}
      {mode === "forecast" && forecastCell && blocks[block] && (
        <ForecastPanel cell={forecastCell} block={{ ...blocks[block], index: block }} events={upcomingEvents} onClose={() => setForecastId(null)} />
      )}
    </div>
  );
}
