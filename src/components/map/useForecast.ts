"use client";

import { useEffect, useState } from "react";
import { forecastResponseSchema, type ForecastResponse } from "@/lib/forecast";

const REFRESH_MS = 5 * 60_000; // the forecast moves slowly

/** The 72h forecast from /api/forecast. Null until the first answer; `error` if it never came. */
export function useForecast() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/forecast", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = forecastResponseSchema.parse(await res.json());
        if (!cancelled) {
          setData(body);
          setError(false);
        }
      } catch (err) {
        // Non-essential: keep the last good answer.
        console.error("[forecast] fetch failed", err);
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { data, error };
}
