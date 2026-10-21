"use client";

import { formatAgo } from "@/lib/time";
import { useNow } from "./useCells";

export function UpdatedBadge({
  generatedAt,
  loaded,
  error,
}: {
  generatedAt: string | null;
  loaded: boolean;
  error: boolean;
}) {
  const now = useNow();
  const text = generatedAt ? `Updated ${formatAgo(generatedAt, now)}` : loaded ? "No data yet" : "Loading…";

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-800 shadow"
    >
      <span
        className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`}
        aria-hidden
      />
      {text}
      {error && <span className="text-red-600">· update failed, retrying</span>}
    </div>
  );
}
