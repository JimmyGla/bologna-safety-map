import { DANGER_LEVELS } from "@/lib/danger-levels";

export function Legend() {
  return (
    <section
      aria-label="Legend"
      className="absolute bottom-10 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-xl bg-white/95 p-2.5 text-gray-900 shadow-lg sm:bottom-3 sm:w-64 sm:p-3"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Protest impact
      </h2>
      <ul className="space-y-1 sm:space-y-1.5">
        {DANGER_LEVELS.map((d) => (
          <li key={d.level} className="flex items-start gap-2 text-xs leading-snug">
            <span
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border"
              style={{ backgroundColor: d.hex, borderColor: d.outline }}
              aria-hidden
            />
            <span>
              <span className="font-semibold">{d.label}</span>
              <span className="hidden text-gray-600 sm:inline"> · {d.meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-gray-200 pt-2 text-xs font-semibold text-gray-800">
        Grey does not mean safe.
      </p>
    </section>
  );
}
