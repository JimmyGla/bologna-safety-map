"use client";

import { useEffect, useState } from "react";
import { upcomingResponseSchema, type UpcomingResponse } from "@/lib/planned";

const REFRESH_MS = 5 * 60_000; // announcements change slowly

/** Upcoming announced protests from /api/planned. Null until the first answer. */
export function useUpcoming() {
  const [data, setData] = useState<UpcomingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/planned", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = upcomingResponseSchema.parse(await res.json());
        if (!cancelled) setData(body);
      } catch (err) {
        // Non-essential: the map works without it; keep the last good answer.
        console.error("[planned] fetch failed", err);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return data;
}
