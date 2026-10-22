import { redirect } from "next/navigation";
import { OverrideTool } from "@/components/admin/OverrideTool";
import { isAdmin } from "@/lib/admin-session";
import { isStale } from "@/lib/freshness";
import { safeErrorMessage } from "@/lib/log";
import { formatAgo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Bologna Safety Map", robots: { index: false } };

const ago = (d: Date | null | undefined, now: Date) => (d ? formatAgo(d.toISOString(), now) : "never");
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

const th = "px-2 py-1.5 text-left font-medium text-gray-500";
const td = "px-2 py-1.5 align-top";

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  // Loaded here, not at import time, so building the app doesn't need a database.
  const [{ getEnv }, { loadAdminData }] = await Promise.all([import("@/lib/env"), import("@/lib/admin/data")]);
  const env = getEnv();

  let data: Awaited<ReturnType<typeof loadAdminData>>;
  try {
    data = await loadAdminData(env);
  } catch (err) {
    return (
      <main className="p-6 text-gray-900">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-800">Database unavailable: {safeErrorMessage(err)}</p>
      </main>
    );
  }
  const { now } = data;
  const snapshotStale = isStale(data.snapshot?.generatedAt ?? null, now);

  return (
    <main className="min-h-dvh bg-gray-50 p-4 text-gray-900 sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Bologna Safety Map · Admin</h1>
        <form method="post" action="/api/admin/logout">
          <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm">Sign out</button>
        </form>
      </header>

      <div className="grid gap-4">
        <Section title="Map">
          <p className="text-sm">
            Last snapshot: <strong>{ago(data.snapshot?.generatedAt, now)}</strong>
            {snapshotStale && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">stale — is the worker running?</span>}
            {data.snapshot?.reducedAccuracy && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">reduced accuracy shown</span>}
            {" · "}
            {data.snapshot ? `${data.snapshot.cells.filter((c) => c.level > 0).length} cells above level 0` : "no snapshot yet"}
          </p>
        </Section>

        <Section title="Sources">
          {data.config.from === "website" && (
            <p className="mb-2 text-xs text-amber-800">
              &ldquo;Enabled&rdquo; shows the website&apos;s settings: the worker (which has its own) hasn&apos;t reported in the last 30 minutes.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Source</th>
                  <th className={th}>Enabled</th>
                  <th className={th}>Status</th>
                  <th className={th}>Last run</th>
                  <th className={th}>Last success</th>
                  <th className={th}>Fetched</th>
                  <th className={th}>New</th>
                  <th className={th}>Dup</th>
                  <th className={th}>Last error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.sources.map(({ id, enabled, status: s }) => (
                  <tr key={id}>
                    <td className={`${td} font-medium`}>{id}</td>
                    <td className={td}>{enabled ? "yes" : "no"}</td>
                    <td className={td}>
                      <span className={s?.status === "error" ? "text-red-700" : s?.status === "ok" ? "text-emerald-700" : "text-gray-500"}>{s?.status ?? "—"}</span>
                    </td>
                    <td className={td}>{ago(s?.lastRunAt, now)}</td>
                    <td className={td}>{ago(s?.lastSuccessAt, now)}</td>
                    <td className={td}>{s?.fetched ?? 0}</td>
                    <td className={td}>{s?.inserted ?? 0}</td>
                    <td className={td}>{s?.duplicates ?? 0}</td>
                    <td className={`${td} max-w-xs break-words text-xs text-gray-600`}>{s?.lastError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Extractor">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">Settings from</dt>
              <dd>
                {data.config.from === "worker" ? (
                  <>
                    worker, reported {ago(data.config.reportedAt, now)}
                    {data.config.commit && <span className="text-gray-600"> · commit {data.config.commit}</span>}
                  </>
                ) : (
                  <span className="text-amber-800">website (the worker hasn&apos;t reported in the last 30 min)</span>
                )}
              </dd>
              <dt className="text-gray-500">Configured</dt>
              <dd>
                {data.extractor.configured}
                {data.extractor.model && <span className="text-gray-600"> · {data.extractor.model}</span>}
              </dd>
              <dt className="text-gray-500">Active</dt>
              <dd>
                {data.extractor.active}
                {data.extractor.note && <span className="ml-1 text-amber-800">({data.extractor.note})</span>}
              </dd>
              {typeof data.extractRun?.details?.providerIssue === "string" && (
                <>
                  <dt className="text-gray-500">Last problem</dt>
                  <dd className="break-words text-amber-800">{data.extractRun.details.providerIssue}</dd>
                </>
              )}
              <dt className="text-gray-500">Last run</dt>
              <dd>
                {ago(data.extractRun?.lastRunAt, now)}
                {data.extractRun?.details ? (
                  <span className="text-gray-600">
                    {" "}
                    · {String(data.extractRun.details.fallbacks ?? 0)} fallbacks to rules · by extractor {JSON.stringify(data.extractRun.details.byExtractor ?? {})}
                  </span>
                ) : null}
              </dd>
              <dt className="text-gray-500">Events, 24h</dt>
              <dd>
                {Object.entries(data.extractor.last24h).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}
                {data.extractor.active !== "rules" && ` · rules share ${pct(data.extractor.rulesShare24h)}`}
              </dd>
            </dl>
          </Section>

          <Section title="Quota today (UTC)">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Service</th>
                  <th className={th}>Requests / day limit</th>
                  <th className={th}>Per min</th>
                  <th className={th}>429s</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.quota.map((q) => (
                  <tr key={q.service}>
                    <td className={`${td} font-medium`}>{q.service}</td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded bg-gray-100">
                          <div
                            className={`h-full ${q.requests / q.perDay > 0.8 ? "bg-red-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.min(100, (q.requests / q.perDay) * 100)}%` }}
                          />
                        </div>
                        {q.requests} / {q.perDay}
                      </div>
                    </td>
                    <td className={td}>{q.perMinute}</td>
                    <td className={`${td} ${q.errors429 ? "text-red-700" : ""}`}>{q.errors429}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <Section title="Overrides">
          <OverrideTool
            cells={(data.snapshot?.cells ?? []).map((c) => ({ h3: c.h3, level: c.level }))}
            overrides={data.overrides.map((o) => ({ h3: o.h3, level: o.level, reason: o.reason, expiresAt: o.expiresAt.toISOString() }))}
          />
          {data.overrides.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Cell</th>
                  <th className={th}>Level</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.overrides.map((o) => (
                  <tr key={o.h3}>
                    <td className={`${td} font-mono text-xs`}>{o.h3}</td>
                    <td className={td}>{o.level}</td>
                    <td className={td}>{o.reason}</td>
                    <td className={td}>{o.expiresAt.toLocaleString("en-GB", { timeZone: "Europe/Rome" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Last 50 events">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Type</th>
                  <th className={th}>Sev</th>
                  <th className={th}>Places</th>
                  <th className={th}>Cells</th>
                  <th className={th}>Source</th>
                  <th className={th}>Class</th>
                  <th className={th}>Extractor</th>
                  <th className={th}>Conf</th>
                  <th className={th}>Cred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap`}>{ago(e.occurredAt, now)}</td>
                    <td className={td}>{e.eventType}</td>
                    <td className={td}>{e.severity}</td>
                    <td className={`${td} text-xs`}>{e.locationNames.join(", ")}</td>
                    <td className={td} title={e.h3Cells.join(" ")}>
                      {e.h3Cells.length}
                    </td>
                    <td className={td}>{e.source}</td>
                    <td className={td}>{e.sourceClass}</td>
                    <td className={td}>{e.extractor}</td>
                    <td className={td}>{e.confidence.toFixed(2)}</td>
                    <td className={td}>{e.credibility.toFixed(2)}</td>
                  </tr>
                ))}
                {!data.events.length && (
                  <tr>
                    <td className={`${td} text-gray-500`} colSpan={10}>
                      No events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </main>
  );
}
