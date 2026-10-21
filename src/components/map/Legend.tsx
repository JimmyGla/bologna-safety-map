"use client";

import { DANGER_LEVELS } from "@/lib/danger-levels";
import { useLang } from "../i18n";
import { PLANNED_COLOR } from "./UpcomingPanel";

export function Legend() {
  const { t } = useLang();
  return (
    <section
      aria-label={t.legend.title}
      className="absolute bottom-10 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-xl bg-white/95 p-2.5 text-gray-900 shadow-lg sm:bottom-3 sm:w-64 sm:p-3"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.legend.title}</h2>
      <ul className="space-y-1 sm:space-y-1.5">
        {DANGER_LEVELS.map((d) => (
          <li key={d.level} className="flex items-start gap-2 text-xs leading-snug">
            <span
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border"
              style={{ backgroundColor: d.hex, borderColor: d.outline }}
              aria-hidden
            />
            <span>
              <span className="font-semibold">{t.levels[d.level].label}</span>
              <span className="hidden text-gray-600 sm:inline"> · {t.levels[d.level].meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-2 text-xs leading-snug">
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm border-2 border-dashed" style={{ borderColor: PLANNED_COLOR }} aria-hidden />
        <span>{t.upcoming.legend}</span>
      </p>
      <p className="mt-2 border-t border-gray-200 pt-2 text-xs font-semibold text-gray-800">{t.legend.grey}</p>
    </section>
  );
}
