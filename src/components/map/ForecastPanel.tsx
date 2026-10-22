"use client";

import { eventWindow, FORECAST_LEVELS, overlapHours, type ForecastCell } from "@/lib/forecast";
import type { UpcomingEvent } from "@/lib/planned";
import { formatBlock, formatEventTime } from "@/lib/time";
import { useLang } from "../i18n";
import { CalendarIcon } from "./UpcomingPanel";

/** Why a cell has its forecast level in one block. Aggregated data only. */
export function ForecastPanel({
  cell,
  block,
  events,
  onClose,
}: {
  cell: ForecastCell;
  block: { start: string; end: string; index: number };
  /** Public upcoming events, to name the announced ones behind this cell. */
  events: UpcomingEvent[];
  onClose: () => void;
}) {
  const { lang, t } = useLang();
  const level = cell.levels[block.index] ?? 0;
  const style = FORECAST_LEVELS.find((l) => l.level === level);
  const range = { start: new Date(block.start), end: new Date(block.end) };
  const inBlock = events.filter((e) => cell.eventIds.includes(e.id) && overlapHours(eventWindow(e), range) > 0);

  return (
    <aside
      aria-label={t.forecast.panelTitle}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[65%] overflow-y-auto rounded-t-2xl bg-white p-4 text-gray-900 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-44 sm:max-h-[calc(100%-12rem)] sm:w-80 sm:rounded-2xl"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 sm:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{t.forecast.panelTitle}</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <span
              className="h-5 w-5 rounded border"
              style={{ backgroundColor: style?.hex ?? "#f3f4f6", borderColor: style?.outline ?? "#d1d5db" }}
              aria-hidden
            />
            {level ? t.forecast.levels[level].label : t.forecast.empty}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label={t.upcoming.close}>
          ✕
        </button>
      </div>
      {level > 0 && <p className="mt-1 text-sm text-gray-600">{t.forecast.levels[level].meaning}</p>}

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t.forecast.when}</dt>
          <dd className="text-right font-medium">{formatBlock(block.start, block.end, lang)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.forecast.announced}</dt>
          <dd className="mt-1 space-y-1">
            {inBlock.length === 0 ? (
              <span className="text-gray-500">{t.forecast.noneAnnounced}</span>
            ) : (
              inBlock.map((e) => (
                <div key={e.id} className="flex items-start gap-1.5">
                  <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <span>
                    {t.events[e.eventType]} · {formatEventTime(e.startsAt, e.timeKnown, lang)}
                    {e.locationNames.length > 0 && <span className="text-gray-500"> · {e.locationNames.join(", ")}</span>}
                  </span>
                </div>
              ))
            )}
          </dd>
        </div>
        {cell.counter && <p className="rounded-lg bg-violet-50 px-2.5 py-2 text-violet-900">{t.forecast.counter}</p>}
        {cell.recentIncidents > 0 && <p className="text-gray-700">{t.forecast.recent(cell.recentIncidents)}</p>}
      </dl>
      <p className="mt-4 text-xs text-gray-500">{t.forecast.disclaimer}</p>
    </aside>
  );
}
