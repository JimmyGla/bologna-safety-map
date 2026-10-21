"use client";

import { cellToBoundary, latLngToCell } from "h3-js";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type * as maplibregl from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DANGER_LEVELS } from "@/lib/danger-levels";
import { H3_RESOLUTION } from "@/lib/geo";
import { addCellLayers, createBaseMap, firstLabelLayer } from "../map/base-map";

type CellLevel = { h3: string; level: number };
type Override = { h3: string; level: number; reason: string; expiresAt: string };

const polygon = (h3: string): GeoJSON.Polygon => ({ type: "Polygon", coordinates: [cellToBoundary(h3, true)] });

const toFc = (cells: CellLevel[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: cells.map((c) => ({ type: "Feature", id: c.h3, geometry: polygon(c.h3), properties: { h3: c.h3, level: c.level } })),
});

/** Click a cell on the map, set a level, reason and expiry. */
export function OverrideTool({ cells, overrides }: { cells: CellLevel[]; overrides: Override[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState(3);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const current = useMemo(() => new Map(cells.map((c) => [c.h3, c.level])), [cells]);
  const overridden = useMemo(() => new Map(overrides.map((o) => [o.h3, o])), [overrides]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createBaseMap(containerRef.current);
    map.on("load", () => {
      addCellLayers(map);
      map.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": "#111827", "line-width": 3 } }, firstLabelLayer(map));
      setReady(true);
    });
    map.on("click", (e: MapMouseEvent) => setSelected(latLngToCell(e.lngLat.lat, e.lngLat.lng, H3_RESOLUTION)));
    map.getCanvas().style.cursor = "crosshair";
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource("cells") as GeoJSONSource | undefined)?.setData(toFc(cells));
  }, [ready, cells]);

  useEffect(() => {
    if (!ready) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: selected ? [{ type: "Feature", geometry: polygon(selected), properties: {} }] : [],
    };
    (mapRef.current?.getSource("selected") as GeoJSONSource | undefined)?.setData(fc);
    if (selected) {
      const o = overridden.get(selected);
      if (o) {
        setLevel(o.level);
        setReason(o.reason);
      }
    }
  }, [ready, selected, overridden]);

  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/overrides", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(json.error) ? json.error.join("; ") : json.error ?? `HTTP ${res.status}`);
      setMessage(method === "POST" ? "Saved. The public map picks it up within a minute." : "Override removed.");
      router.refresh();
    } catch (err) {
      setMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div ref={containerRef} className="h-[420px] w-full overflow-hidden rounded-lg bg-gray-200" aria-label="Override map" />
      <div className="space-y-3 text-sm">
        {!selected ? (
          <p className="text-gray-600">Click a cell on the map to select it.</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send("POST", { h3: selected, level, reason, expiresInMinutes: minutes });
            }}
          >
            <div>
              <div className="font-mono text-xs text-gray-500">{selected}</div>
              <div className="text-gray-700">
                Current level: {current.get(selected) ?? 0}
                {overridden.has(selected) && " (overridden)"}
              </div>
            </div>
            <label className="block">
              <span className="text-gray-600">Level</span>
              <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5">
                {DANGER_LEVELS.map((d) => (
                  <option key={d.level} value={d.level}>
                    {d.level} · {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-600">Reason (internal, not public)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-gray-600">Expires in</span>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5">
                {[30, 60, 120, 240, 480, 1440, 4320].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} day${m > 1440 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                Set override
              </button>
              {overridden.has(selected) && (
                <button type="button" disabled={busy} onClick={() => void send("DELETE", { h3: selected })} className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50">
                  Remove
                </button>
              )}
            </div>
          </form>
        )}
        {message && <p className="rounded-md bg-gray-100 px-2 py-1.5 text-gray-800">{message}</p>}
      </div>
    </div>
  );
}
