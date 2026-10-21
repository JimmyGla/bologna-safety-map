"use client";

import type { UpcomingEvent } from "@/lib/planned";
import { formatEventTime } from "@/lib/time";
import { useLang } from "../i18n";

export const PLANNED_COLOR = "#4f46e5";

export function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Button that opens the list; lives in the title chip. */
export function UpcomingButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const { t } = useLang();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t.upcoming.open(count)}
      title={t.upcoming.open(count)}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${
        open ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white text-indigo-700 hover:bg-indigo-50"
      }`}
    >
      <CalendarIcon className="h-3.5 w-3.5" />
      {count}
    </button>
  );
}

/** Upcoming announced protests, soonest first. No text, links or names: type, place, time. */
export function UpcomingPanel({
  events,
  selectedId,
  onSelect,
  onClose,
}: {
  events: UpcomingEvent[];
  selectedId: string | null;
  onSelect: (e: UpcomingEvent) => void;
  onClose: () => void;
}) {
  const { lang, t } = useLang();
  return (
    <section
      aria-label={t.upcoming.title}
      className="absolute left-3 top-14 z-20 max-h-[50%] w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl bg-white p-3 text-gray-900 shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarIcon className="h-4 w-4 text-indigo-600" />
          {t.upcoming.title}
        </h2>
        <button type="button" onClick={onClose} className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-100" aria-label={t.upcoming.close}>
          ✕
        </button>
      </div>
      <p className="mb-2 text-xs text-gray-500">{t.upcoming.note}</p>
      {events.length === 0 ? (
        <p className="text-sm text-gray-600">{t.upcoming.none}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect(e)}
                className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-indigo-50 ${
                  selectedId === e.id ? "border-indigo-500 bg-indigo-50" : "border-gray-200"
                }`}
              >
                <div className="font-semibold">
                  {formatEventTime(e.startsAt, e.timeKnown, lang)}
                  {!e.timeKnown && <span className="ml-1 font-normal text-gray-500">· {t.upcoming.dayOnly}</span>}
                </div>
                <div className="text-gray-700">
                  {t.events[e.eventType]} · {e.locationNames.join(", ")}
                </div>
                <div className="text-xs text-gray-500">
                  {t.upcoming.sources(e.sourceCount)}
                  {e.officialSource && ` · ${t.upcoming.official}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
