"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GROUPS, REPORT_RANGES, type Report, type ReportRange } from "@/lib/report/aggregate";
import { LangSwitch, useLang } from "../i18n";

// /report. Plain SVG/HTML charts, one colour per chart (no categorical palette needed):
// blue for counts, the map's orange for orange/red area-hours. Each bar has a hover tooltip
// (<title>); the quartiere table and the CSV exports give the exact numbers.

const COUNT_COLOR = "#2a78d6";
const HIGH_COLOR = "#f97316";

function dayLabel(day: string, lang: "it" | "en") {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Rome",
  });
}

/** Rounds a maximum up to a readable axis top (1, 2, 5, 10, 20, 50, …). */
function niceMax(v: number) {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Width of an element in CSS px, kept up to date (640 before the first measurement). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure now (ResizeObserver only reports on the next rendered frame), then follow resizes.
    setWidth(Math.round(el.getBoundingClientRect().width) || 640);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function DayBars({ data, color, label, empty }: { data: { day: string; value: number }[]; color: string; label: string; empty: string }) {
  const { lang, t } = useLang();
  // The chart is drawn at its real width, so 11px text stays 11px on a phone.
  const [wrap, W] = useWidth<HTMLDivElement>();
  if (!data.some((d) => d.value > 0)) {
    return <p className="px-2 py-8 text-center text-sm text-gray-500">{empty}</p>;
  }
  const H = 170;
  const left = 30;
  const bottom = 22;
  const top = 8;
  const innerW = W - left - 4;
  const innerH = H - top - bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const slot = innerW / data.length;
  const barW = Math.max(2, Math.min(18, slot * 0.7));
  const y = (v: number) => top + innerH - (v / max) * innerH;
  // Whole numbers only: no "0.5 incidents".
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  // About one date label per 70px.
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));

  return (
    <div ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - 4} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b7280">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + (slot - barW) / 2;
          const h = (d.value / max) * innerH;
          const r = Math.min(4, barW / 2, h);
          const by = top + innerH - h;
          return (
            <g key={d.day} className="group">
              {/* Wide invisible hit target, so thin bars are easy to hover. */}
              <rect x={left + i * slot} y={top} width={slot} height={innerH} fill="transparent" />
              {d.value > 0 && (
                <path
                  d={`M${x},${by + h} V${by + r} Q${x},${by} ${x + r},${by} H${x + barW - r} Q${x + barW},${by} ${x + barW},${by + r} V${by + h} Z`}
                  fill={color}
                  className="opacity-90 group-hover:opacity-100"
                />
              )}
              <title>{t.report.day(dayLabel(d.day, lang), d.value)}</title>
              {(i % labelEvery === 0 || i === data.length - 1) && (
                <text x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#6b7280">
                  {dayLabel(d.day, lang)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Tile({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" title={hint}>
      <div className="text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-600">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

export function ReportView({ report, range }: { report: Report | null; range: ReportRange }) {
  const { t } = useLang();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const maxType = Math.max(1, ...(report?.byType.map((b) => b.count) ?? []));

  return (
    <div className="min-h-dvh bg-gray-50">
      <main className="mx-auto max-w-4xl px-4 py-8 text-gray-800 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm text-gray-600 underline">
            {t.report.back}
          </Link>
          <LangSwitch />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-gray-900">{t.report.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">{t.report.intro}</p>

        <nav aria-label={t.report.rangeLabel} className="mt-5 flex w-fit rounded-lg bg-white p-0.5 text-sm shadow-sm ring-1 ring-gray-200">
          {REPORT_RANGES.map((d) => (
            <Link
              key={d}
              href={`/report?days=${d}`}
              aria-current={d === range ? "page" : undefined}
              className={`rounded-md px-3 py-1 ${d === range ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"}`}
            >
              <span className="sm:hidden">{t.report.rangeShort(d)}</span>
              <span className="hidden sm:inline">{t.report.range(d)}</span>
            </Link>
          ))}
        </nav>

        {!report ? (
          <p className="mt-8 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{t.report.unavailable}</p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile value={String(report.totals.events)} label={t.report.events} />
              <Tile value={String(report.totals.daysWithEvents)} label={t.report.daysWithEvents} />
              <Tile value={String(report.totals.highAreaHours)} label={t.report.highAreaHours} hint={t.report.highAreaHoursHint} />
              <Tile value={report.totals.events ? pct(report.totals.authoritativeShare) : "—"} label={t.report.authoritative} />
            </div>

            <Section title={t.report.perDay}>
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <DayBars data={report.byDay.map((d) => ({ day: d.day, value: d.total }))} color={COUNT_COLOR} label={t.report.perDay} empty={t.report.none} />
              </div>
            </Section>

            <Section title={t.report.perDayHigh}>
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <DayBars
                  data={report.byDay.map((d) => ({ day: d.day, value: d.highAreaHours }))}
                  color={HIGH_COLOR}
                  label={t.report.perDayHigh}
                  empty={t.report.noneHigh}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">{t.report.highAreaHoursHint}</p>
            </Section>

            <Section title={t.report.byType}>
              {report.byType.length === 0 ? (
                <p className="text-sm text-gray-600">{t.report.none}</p>
              ) : (
                <ul className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-4">
                  {report.byType.map((b) => (
                    <li key={b.type} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate text-gray-700">{t.events[b.type]}</span>
                      <span className="h-3 rounded-r" style={{ width: `${(b.count / maxType) * 100}%`, background: COUNT_COLOR, minWidth: 4 }} aria-hidden />
                      <span className="tabular-nums text-gray-900">{b.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t.report.byQuartiere}>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 font-medium">{t.report.quartiere}</th>
                      {GROUPS.map((g) => (
                        <th key={g} className="px-3 py-2 text-right font-medium">
                          {t.report.groups[g]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">{t.report.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byQuartiere.map((q) => (
                      <tr key={q.quartiere} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-2 text-gray-900">{q.quartiere}</td>
                        {GROUPS.map((g) => (
                          <td key={g} className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {q[g]}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">{q.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <p className="mt-6 max-w-2xl text-xs text-gray-500">{t.report.method}</p>

            <Section title={t.report.downloads}>
              <ul className="flex flex-wrap gap-3 text-sm">
                <li>
                  <a href="/api/report/events?days=365" className="text-blue-700 underline">
                    {t.report.downloadEvents}
                  </a>
                </li>
                <li>
                  <a href="/api/report/levels?days=90" className="text-blue-700 underline">
                    {t.report.downloadLevels}
                  </a>
                </li>
              </ul>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
