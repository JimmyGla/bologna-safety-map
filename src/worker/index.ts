import "./load-env";
import cron from "node-cron";
import { getEnv, quotaOverrides } from "@/lib/env";
import { geocodePlace } from "@/lib/gazetteer";
import { MemoryGeocodeCache, type GeocodeCache } from "@/lib/gazetteer/nominatim";
import { createProvider, createRulesProvider } from "@/lib/llm";
import { QuotaGuard } from "@/lib/quota";
import { AdaptivePoller } from "./ingest/adaptive";
import { runAdapter } from "./ingest/runner";
import { MemoryIngestStore, type IngestStore } from "./ingest/store";
import { ARCHIVE_SCHEDULE, MemoryArchiveStore, runArchive, type ArchiveStore } from "./jobs/archive";
import { EXTRACT_SCHEDULE, runExtraction } from "./jobs/extract";
import { MemoryScoreStore, runScoring, SCORE_SCHEDULE, type ScoreStore } from "./jobs/score";
import { WORKER_STATUS_ADAPTER } from "@/lib/worker-config";
import { workerConfig } from "./config-report";
import { ADAPTERS } from "./sources";
import type { AdapterContext, SourceAdapter } from "./sources/types";
import { errInfo, logger } from "@/lib/log";

const wlog = logger("worker");

// Ingestion worker.
//   npm run worker            cron: news/tper every 5 min, reddit every 10, extraction every 2,
//                             scoring every minute, purge every 15
//   npm run worker:once       one pass of every enabled adapter + extraction + scoring + purge, then exit
//   npm run worker:dry        same as once, without a database (in-memory), prints counts only

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const env = getEnv();

type Setup = {
  store: IngestStore;
  scoreStore: ScoreStore;
  ctx: AdapterContext;
  geocodeCache: GeocodeCache;
  archive: ArchiveStore;
  purge: () => Promise<void>;
};

async function setup(): Promise<Setup> {
  if (dryRun) {
    const guard = new QuotaGuard({ overrides: quotaOverrides(env) });
    const store = new MemoryIngestStore();
    const scoreStore = new MemoryScoreStore(
      () => store.events.map((e) => ({ ...e, h3Cells: e.h3Cells ?? [] })),
      [],
      () => store.planned.map((p) => ({ ...p, timeKnown: p.timeKnown ?? false, locationNames: p.locationNames ?? [], h3Cells: p.h3Cells ?? [] })),
    );
    return { store, scoreStore, ctx: makeCtx(guard), geocodeCache: new MemoryGeocodeCache(), archive: new MemoryArchiveStore(), purge: async () => {} };
  }
  // DB modules load only outside dry runs, so --dry-run works without Postgres.
  const [{ DbIngestStore }, { DbQuotaLedger }, { purgeExpired }, { DbGeocodeCache }, { DbScoreStore }, { DbArchiveStore }] = await Promise.all([
    import("./ingest/db-store"),
    import("./quota-ledger"),
    import("./jobs/purge"),
    import("@/lib/gazetteer/geocode-cache"),
    import("./jobs/score-db"),
    import("./jobs/archive-db"),
  ]);
  const ledger = new DbQuotaLedger();
  const guard = new QuotaGuard({ overrides: quotaOverrides(env), ledger });
  await ledger.seed(guard, new Date().toISOString().slice(0, 10)).catch((err: Error) => {
    wlog.warn(errInfo(err), "could not read quota_ledger; daily counts start at 0");
  });
  return {
    store: new DbIngestStore(),
    scoreStore: new DbScoreStore(),
    ctx: makeCtx(guard),
    geocodeCache: new DbGeocodeCache(),
    archive: new DbArchiveStore(),
    purge: purgeExpired,
  };
}

function makeCtx(guard: QuotaGuard): AdapterContext {
  return { env, guard, userAgent: env.SOURCE_USER_AGENT, now: () => new Date() };
}

/** Skips a run while the previous run of the same job is still going. */
function exclusive(name: string, job: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) {
      wlog.warn({ job: name }, "still running, skipping this tick");
      return;
    }
    running = true;
    try {
      await job();
    } finally {
      running = false;
    }
  };
}

async function main() {
  if (!dryRun && env.MIGRATE_ON_START) {
    // Fail fast: running jobs against an old schema would only produce errors.
    const { runMigrations } = await import("./migrate");
    await runMigrations(env);
  }
  const { store, scoreStore, ctx, geocodeCache, archive, purge } = await setup();
  const provider = createProvider(env, ctx.guard);
  const enabled = ADAPTERS.filter((a) => a.enabled(env)).map((a) => a.id);
  wlog.info({ mode: once ? "once" : "cron", dryRun, sources: enabled, extractor: provider.name }, "started");
  // /admin runs on the website, which has its own env: tell it what this worker really uses.
  const reportedAt = new Date();
  await store
    .saveStatus({
      adapter: WORKER_STATUS_ADAPTER,
      status: "ok",
      lastRunAt: reportedAt,
      lastSuccessAt: reportedAt,
      details: workerConfig(env, provider, ADAPTERS),
    })
    .catch((err: Error) => wlog.warn(errInfo(err), "could not report worker configuration"));

  const run = (a: SourceAdapter) => runAdapter(a, ctx, store);
  const extract = () =>
    runExtraction({
      store,
      provider,
      rules: createRulesProvider(),
      geocode: (phrase) => geocodePlace(phrase, { cache: geocodeCache, userAgent: env.SOURCE_USER_AGENT, guard: ctx.guard }),
      now: () => new Date(),
    });
  const score = () => runScoring(scoreStore, env.SCORE_THRESHOLDS);
  // Before the purge, so nothing is deleted before it is archived.
  const archiveEvents = () => runArchive(archive);

  if (once) {
    for (const a of ADAPTERS) await run(a);
    await extract();
    await score();
    await archiveEvents();
    await purge();
    if (dryRun && store instanceof MemoryIngestStore) {
      wlog.info({ items: store.raw.length, events: store.events.length }, "dry run finished");
    } else {
      // The Postgres pool (and a Telegram connection, if any) would keep the process alive.
      await (await import("@/db")).closeDb();
    }
    wlog.info("pass finished");
    process.exit(0);
  }

  // Fixed schedules, except social adapters: ticked every minute, run when their adaptive
  // interval is due (faster after relevant items, slower after empty polls).
  const pollers = new Map(ADAPTERS.filter((a) => a.adaptive).map((a) => [a.id, new AdaptivePoller(a.adaptive!)]));
  const runAdaptive = async (a: SourceAdapter) => {
    const poller = pollers.get(a.id)!;
    if (!poller.due(new Date())) return;
    const s = await run(a);
    poller.record(s.inserted > 0, new Date());
  };
  const tasks = ADAPTERS.map((a) =>
    a.adaptive
      ? cron.schedule("* * * * *", exclusive(a.id, () => runAdaptive(a)))
      : cron.schedule(a.schedule, exclusive(a.id, () => run(a))),
  );
  tasks.push(cron.schedule(EXTRACT_SCHEDULE, exclusive("extract", extract)));
  tasks.push(cron.schedule(SCORE_SCHEDULE, exclusive("score", score)));
  tasks.push(cron.schedule(ARCHIVE_SCHEDULE, exclusive("archive", archiveEvents)));
  tasks.push(cron.schedule("*/15 * * * *", exclusive("purge", purge)));
  // First pass right away rather than waiting for the first tick.
  for (const a of ADAPTERS) await (a.adaptive ? runAdaptive(a) : run(a));
  await extract();
  await score();
  await archiveEvents();
  await purge();

  const stop = () => {
    wlog.info("stopping");
    for (const t of tasks) t.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  wlog.fatal(errInfo(err), "fatal");
  process.exit(1);
});
