"use client";

import { DANGER_LEVELS } from "@/lib/danger-levels";
import { FORECAST_LEVELS } from "@/lib/forecast";
import { useLang } from "../i18n";
import { PLANNED_COLOR } from "./UpcomingPanel";

export function Legend({ mode = "now" }: { mode?: "now" | "forecast" }) {
  const { t } = useLang();
  const forecast = mode === "forecast";
  const rows = forecast
    ? FORECAST_LEVELS.map((l) => ({ key: l.level, hex: l.hex, outline: l.outline, ...t.forecast.levels[l.level] }))
    : DANGER_LEVELS.map((d) => ({ key: d.level, hex: d.hex, outline: d.outline, ...t.levels[d.level] }));
  return (
    <section
      aria-label={forecast ? t.forecast.legendTitle : t.legend.title}
      className="absolute bottom-10 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-xl bg-white/95 p-2.5 text-gray-900 shadow-lg sm:bottom-3 sm:w-64 sm:p-3"
    >
      <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${forecast ? "text-violet-700" : "text-gray-500"}`}>
        {forecast ? t.forecast.legendTitle : t.legend.title}
      </h2>
      <ul className="space-y-1 sm:space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-xs leading-snug">
            <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border" style={{ backgroundColor: r.hex, borderColor: r.outline }} aria-hidden />
            <span>
              <span className="font-semibold">{r.label}</span>
              <span className="hidden text-gray-600 sm:inline"> · {r.meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-2 text-xs leading-snug">
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm border-2 border-dashed" style={{ borderColor: PLANNED_COLOR }} aria-hidden />
        <span>{t.upcoming.legend}</span>
      </p>
      <p className="mt-2 border-t border-gray-200 pt-2 text-xs font-semibold text-gray-800">
        {forecast ? t.forecast.legendNote : t.legend.grey}
      </p>
    </section>
  );
}
