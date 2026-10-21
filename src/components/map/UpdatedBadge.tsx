"use client";

import { formatAgo } from "@/lib/time";
import { useLang } from "../i18n";
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
  const { lang, t } = useLang();
  const text = generatedAt ? t.badge.updated(formatAgo(generatedAt, now, lang)) : loaded ? t.badge.noDataYet : t.badge.loading;

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
      {error && <span className="text-red-600">· {t.badge.failed}</span>}
    </div>
  );
}
