"use client";

import { EVENT_TYPES, type CellProperties } from "@/lib/cells";
import { getDangerLevel } from "@/lib/danger-levels";
import { formatAgo, formatClock } from "@/lib/time";
import { useNow } from "./useCells";

// Aggregated area details only — never post text or author info (CLAUDE.md rule 1).
export function CellPanel({ cell, onClose }: { cell: CellProperties; onClose: () => void }) {
  const now = useNow();
  const level = getDangerLevel(cell.level);

  return (
    <aside
      aria-label="Area details"
      className="absolute inset-x-0 bottom-0 z-20 max-h-[65%] overflow-y-auto rounded-t-2xl bg-white p-4 text-gray-900 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-24 sm:max-h-[calc(100%-7rem)] sm:w-80 sm:rounded-2xl"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 sm:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="h-5 w-5 rounded border"
            style={{ backgroundColor: level.hex, borderColor: level.outline }}
            aria-hidden
          />
          <h2 className="text-lg font-semibold">
            {level.label}
            <span className="ml-1 text-sm font-normal text-gray-500">level {level.level}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label="Close details"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">{level.meaning}</p>
      {cell.overridden && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Level set manually by the map maintainers.
        </p>
      )}
      {!cell.overridden && cell.sourceCount === 0 && (
        <p className="mt-2 text-xs text-gray-500">Next to a severe area; no reports from this cell itself.</p>
      )}

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Event types
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {cell.eventTypes.length === 0 ? (
              <span className="text-gray-500">None reported</span>
            ) : (
              cell.eventTypes.map((t) => (
                <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  {EVENT_TYPES[t]}
                </span>
              ))
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Independent sources</dt>
          <dd className="font-medium">{cell.sourceCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Confirmed by official/news source</dt>
          <dd className="font-medium">{cell.officialSource ? "Yes" : "No"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">Latest report</dt>
          <dd className="text-right font-medium">
            {cell.lastReportAt
              ? `${formatClock(cell.lastReportAt)} (${formatAgo(cell.lastReportAt, now)})`
              : "—"}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
