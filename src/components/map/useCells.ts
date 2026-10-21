"use client";

import { useCallback, useEffect, useState } from "react";
import { cellsResponseSchema, type CellsResponse } from "@/lib/cells";

const REFRESH_MS = 60_000;

export function useCells() {
  const [data, setData] = useState<CellsResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cells", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(cellsResponseSchema.parse(await res.json()));
      setError(false);
    } catch (err) {
      console.error("[cells] fetch failed", err);
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return { data, error };
}

// Re-renders periodically so relative times stay fresh.
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
