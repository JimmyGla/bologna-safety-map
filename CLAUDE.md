# CLAUDE.md — bologna-safety-map

This brief is binding for all work in this repository. If a request conflicts with a
HARD RULE, stop and raise it instead of implementing it.

## Purpose

A web app showing which areas of Bologna, Italy are affected by ongoing protests and street
violence (assaults, squad/hate attacks, sexual violence, vandalism), as a
color-coded hexagon map with a legend. **It maps AREAS, never people.**

## Hard rules

1. **No personal data in the product.** Never display, store long-term, or expose
   usernames, handles, profile links or post text in the UI or the public API.
   - Raw posts may exist only in the ingestion tables and **must be deleted after 24h**
     (a scheduled purge job in the worker enforces this).
   - Public API responses and UI contain only aggregated, per-cell data (H3 index,
     level, counts, timestamps, source *categories*).
   - Do not log raw post text or author identifiers either.
2. **Danger levels** (single source of truth: `src/lib/danger-levels.ts`):

   | Level | Color  | Label      |
   |-------|--------|------------|
   | 0     | grey   | No data    |
   | 1     | green  | Low        |
   | 2     | yellow | Moderate   |
   | 3     | orange | High       |
   | 4     | red    | Severe     |

3. **Corroboration gate.** A cell can only reach level 3+ if corroborated by
   **≥2 independent sources**, or **≥1 official/news source**. Otherwise it is capped at 2.
   This rule must be enforced in the scoring logic and covered by tests.
4. **Zero cost.** The project runs entirely on free tiers or local resources.
   - **No paid APIs, no paid plans, no X/Twitter API** (nor scraping X).
   - Never add a dependency or service that requires a credit card or billing to work.
5. **Quota guard.** Every external call (sources, LLM providers) goes through the quota
   guard in `src/lib/quota.ts`. Never call an external endpoint or SDK directly. The guard:
   - tracks requests **per service, per minute and per day** against configurable
     free-tier limits (defaults in code, overrides via `QUOTA_LIMITS` in env);
   - refuses a call that would exceed a limit;
   - **backs off on HTTP 429** (honour `Retry-After`, otherwise exponential backoff)
     and pauses that service until the backoff expires;
   - **degrades gracefully**: a refused or failing service is skipped for that run and
     logged as a warning. One source or provider failing must never crash the worker or
     the web app.
6. **Secrets** come only from `.env.local` (locally) or the hosting platform's env
   settings (Vercel, GitHub Actions secrets). Keep `.env.example` up to date with every
   variable (no real values). Never commit secrets or hardcode keys.

## Sources

Sources are pluggable. Each implements the `SourceAdapter` interface in
`src/worker/sources/types.ts`, lives in its own file under `src/worker/sources/`, and is
listed in `src/worker/sources/index.ts`. Adapters only fetch and filter; the runner
(`src/worker/ingest/runner.ts`) handles the enable flag, the 24h freshness cut, handle
scrubbing, dedupe (external id + Jaccard > 0.85 within 2h, across sources), storage and
`source_status`, and never lets an error escape.

| id         | Source                                      | Category | Access                         |
|------------|---------------------------------------------|----------|--------------------------------|
| `news`     | Carlino, Repubblica, BolognaToday RSS (`NEWS_RSS_URLS` overrides) | news | RSS, no key |
| `tper`     | TPER diversions: Telegram "Tper info viabilità" preview + Bologna RSS | transit (counts as official) | `t.me/s/` preview + RSS, no key |
| `bluesky`  | `searchPosts`, lang it, each `BLUESKY_KEYWORDS` × `BLUESKY_PLACES` pair | social | `@atproto/api`, free account + app password (`BSKY_*`) |
| `mastodon` | Hashtag timelines (#bologna, #corteobologna, #manifestazionebologna + `MASTODON_HASHTAGS`) on `MASTODON_INSTANCES` | social | public API, no key |
| `reddit`   | r/bologna (`REDDIT_SUBREDDITS`)             | social   | public RSS, no key             |
| `telegram` | Public channels in `TELEGRAM_CHANNELS` (off by default) | social; channels in `OFFICIAL_TELEGRAM_CHANNELS` (`src/lib/scoring/credibility.ts`, e.g. `comunebologna`) are official | GramJS user session (`TG_*`), read-only |

- Social adapters poll adaptively (`adaptive` in the adapter): the interval halves after a
  poll with new relevant items and grows ×1.5 after an empty one, within min/max.
- Where they left off (last-seen time, since_id, last message id) is in `source_cursors`,
  saved only after the items are stored.
- Social items keep only text, time and coarse author signals (`follower_count`,
  `account_age_days`). Never a handle, DID, display name or post URL; Bluesky and Mastodon
  ids embed the author, so `external_id` is a hash of them.
- Telegram is read-only: `connect()` + `getMessages()` on public channel usernames. Never
  join, post, or read groups/private chats, and never read the sender/signature field.
- No X/Twitter adapter, not even a disabled stub (rule 4).

- Each adapter is enabled/disabled with `SOURCE_<ID>_ENABLED=true|false`.
- An adapter declares its **category** (`news`, `official`, `transit`, `social`); only
  `news`, `official` and `transit` count as an "official/news source" for rule 3.
  Independent sources = distinct feeds (`events.source_feed`), not distinct posts.
- Only items matching the keyword families in `src/worker/ingest/text.ts` (protest, assault,
  hate/squad attack, sexual violence, vandalism) are stored.
- Event types live in `src/lib/event-types.ts` (a Postgres enum: new values need
  `npm run db:generate`), weights in `TYPE_WEIGHTS` (`src/lib/scoring.ts`).
- Disinformation guards (prompt + rules extractor): chain messages, debunked reports,
  generalisations about a group or area with no specific event, statistics and fiction are
  dropped; rumours ("gira voce", "mi hanno detto") keep only minimal confidence. The
  nationality, ethnicity or religion of people involved never changes any field, and no data
  about victims or perpetrators is derived or kept.
- Adapters return raw items to ingestion only; author identifiers and text never leave
  the raw tables (rule 1).
- Respect each source's terms and rate limits, send an identifying `User-Agent`, and
  prefer RSS/official APIs over scraping.

## LLM

Provider-agnostic interface in `src/lib/llm/` (`types.ts` defines `LlmProvider`), with:

- `gemini` — Google AI Studio free tier via `@google/genai` (`GEMINI_API_KEY`,
  `GEMINI_MODEL`). Free-tier key only; never enable billing on that project.
- `ollama` — local model via Ollama's HTTP API (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`).
- `rules` — no-LLM keyword/regex extractor. Always available, no network.

`LLM_PROVIDER` picks one. **Automatic fallback to `rules`** when the chosen provider's
quota is exhausted, it returns an error or invalid output (zod), or it is not configured.
Every provider returns the same zod-validated extraction shape (`src/lib/llm/types.ts`);
gemini and ollama share the prompt in `src/lib/llm/prompt.ts`. Batches: gemini 20 items
per request, ollama 5. Gemini limits: `GEMINI_RPM` / `GEMINI_RPD`.

- Gemini's free tier may use inputs to improve Google's products: send only scrubbed item
  text, never author data.
- `rules` confidence is capped at 0.5 and multiplied by 0.8 when stored.
- Pipeline: `src/worker/jobs/extract.ts`, every 2 min. Irrelevant or `old_or_unclear`
  items are dropped, and so are items no place resolves for. Credibility rules live in
  `src/lib/scoring/credibility.ts`.
- Test fixtures (`src/lib/llm/fixtures.ts`) include traps: old footage, other cities,
  jokes. Add a fixture for every new false positive you find.

## Geocoding

- `src/lib/gazetteer/`: `lookup(text)` finds known places (piazze, streets, landmarks,
  gates, quartieri/zone) offline; `toCells(geometry)` turns a geometry into res-9 cells
  (points +100 m, lines +75 m, polygons polyfilled); `geocodePlace(phrase)` falls back to
  Nominatim (1 req/s, bounded to Bologna, cached in `geocode_cache`).
- The data in `src/lib/gazetteer/data/` is **generated and committed**. Edit
  `scripts/gazetteer/places.ts`, then run `npm run gazetteer:build` (add `-- --refresh` to
  re-download from Overpass / the Comune portal). Never call Overpass at runtime.
- Keep OSM (ODbL) and Comune di Bologna (CC BY 4.0) attribution, which is stored in
  `places.json`.
- Common words and person names ("indipendenza", "verdi", "gramsci") must be `strict` in
  `places.ts` so they only match with "via"/"piazza" in front.
- Send Nominatim a short place phrase only, never post text (rule 1).

## Scoring

- `src/lib/scoring.ts` (pure): score = Σ weight[type] × credibility × confidence ×
  exp(-age_min/50) over the last 4h. Then:
  1. thresholds (`SCORE_THRESHOLDS`);
  2. the corroboration cap (rule 3: fewer than 2 distinct `source_feed`s and no
     news/official/transit source → max level 2);
  3. smoothing (ring around level-4 cells ≥ 1);
  4. active `cell_overrides` last.
- The worker writes `cells_snapshot` every minute (keeps 1h). `/api/cells` only serves the
  latest snapshot, through `toCellsResponse` (whitelisted fields + strict zod), with
  `Cache-Control: max-age=30`.

## Announced (future) protests

- Extraction marks announcements as `time_reference: "planned"` with `planned_start`
  (rules: `src/lib/dates.ts` parses Italian dates/times in Europe/Rome; LLMs follow the
  prompt). A bare weekday needs an announcement word; no date → dropped.
- Stored in `planned_events` (never in `events`): an announcement **never** changes a
  cell's danger level. Grouped + corroboration-gated (≥1 news/official/transit source or
  ≥2 feeds) by `groupUpcoming` in `src/lib/planned.ts` into `cells_snapshot.planned`;
  served by `/api/planned` (type, places, date/time, source counts — nothing else).
- Shown for the next 7 days; deleted 12h after start (purge job).

## Operations

- `/admin` needs `ADMIN_PASSWORD` (≥ 12 chars). The session is an HMAC-signed httpOnly,
  SameSite=Strict cookie (`src/lib/admin-auth.ts`), and failed logins are throttled.
  The page shows aggregates only (status, quota, events without text) plus the override
  tool. Every `/api/admin/*` handler checks `isAdmin()` itself.
- Public map: a "reduced accuracy" badge when the snapshot relies on the rules fallback
  (`cells_snapshot.reduced_accuracy`); a banner and greyed-out map when the newest
  snapshot is older than 10 min (`src/lib/freshness.ts`).
- `/api/health`: `ok` / `degraded` (stale or reduced accuracy) / `down` (DB unreachable, 503).
- Retention (`src/worker/jobs/purge.ts`, every 15 min): raw_items 24h, events 7 days,
  quota_ledger 30 days, expired overrides; snapshots are kept 1h by the scoring job.
- Logging: pino JSON (`src/lib/log.ts`), `logger("<module>")`. No `console.*` in
  server/worker code. Never pass item text, URLs or author data; they are redacted anyway.
- End to end (local DB only): `npm run e2e:seed`, then `npm run worker:once` with the
  `SOURCE_*_ENABLED=false` variables set, then `npm run dev`, then `npm run e2e:check`.

## Hosting (all free)

- **Web:** Vercel Hobby (non-commercial use only). Uses Neon's HTTP driver
  (`src/db/index.ts`, `DB_DRIVER`); the worker uses a postgres-js TCP pool.
- **Database:** Neon free tier in production (`DATABASE_URL`, pooled connection string,
  `sslmode=require`); local Postgres 16 via `docker-compose.yml` for development.
- **Worker:** runs locally (`npm run worker`, systemd unit and pm2 file in `deploy/`) or
  as the GitHub Actions workflow `.github/workflows/worker.yml` calling
  `npm run worker:once` (single pass, then exit; opt-in via the `WORKER_ENABLED` variable). Scheduled runs are at best every
  5 minutes and may be delayed; keep each run short to stay within free Actions minutes.

## Stack

- **Web:** Next.js 15 App Router, TypeScript, Tailwind. API = route handlers in
  `src/app/api/**/route.ts`.
- **DB:** Postgres 16, Drizzle ORM. Schema changes: edit `src/db/schema.ts`, then
  `npm run db:generate` and commit `drizzle/`; the worker applies migrations at start
  (advisory-locked). Don't use `db:push` against shared databases. Schema in `src/db/schema.ts`,
  client in `src/db/index.ts`, config `drizzle.config.ts`.
- **Spatial:** `h3-js`, **resolution 9** for all aggregation (`H3_RESOLUTION` in
  `src/lib/geo/`). Don't mix resolutions.
- **Map:** MapLibre GL JS with OpenFreeMap vector tiles (Positron style, OpenStreetMap
  data; free, no key, meant for production traffic) — client component only; keep the
  attribution visible. Don't switch back to tile.openstreetmap.org: it may throttle busy
  sites. The base map URL lives in `src/components/map/base-map.ts`; if it changes, update
  the privacy notice. Its web worker is copied to
  `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` (predev/prebuild) and set via
  `setWorkerUrl`, because webpack breaks MapLibre's own worker lookup.
- **Worker:** separate Node process, `src/worker/index.ts`, run with `tsx` + `node-cron`.
  All ingestion, extraction and purge jobs live here — never in the Next.js process.
- **LLM:** `src/lib/llm/` (see above), always via the quota guard.
- **Validation:** `zod` for env, external payloads, LLM output and API inputs/outputs.
- **Tests:** `vitest` (`*.test.ts` next to the code).

## Layout

```
src/
  app/              Next.js routes, pages, API route handlers
  components/map/   MapLibre map + legend (client components)
  db/               Drizzle schema + client
  lib/
    env.ts          zod-validated environment
    danger-levels.ts level definitions (rule 2)
    quota.ts        quota guard: per-service limits, 429 backoff (rule 5)
    geo/            H3 helpers (res 9), Bologna bounds
    gazetteer/      Bologna place names → geometry → H3 cells (see "Geocoding")
    scoring/        per-cell level computation + corroboration gate (rule 3)
    llm/            LlmProvider interface + gemini / ollama / rules
  worker/           cron entrypoint (index.ts), quota ledger
    sources/        SourceAdapter interface + one adapter per source
    ingest/         runner, dedupe, keyword filter, storage (DB / in-memory)
    jobs/           purge (raw items >24h, expired overrides, old quota rows)
```

## Commands

- `npm run dev` — Next.js dev server
- `npm run worker` — ingestion worker on a cron schedule (`tsx src/worker/index.ts`)
- `npm run worker:once` — one ingestion pass, then exit (for GitHub Actions)
- `npm run db:push` — push Drizzle schema to the database
- `npm run gazetteer:build` — regenerate the gazetteer data (one-off, network)
- `npm test` — vitest

## Conventions

- Server-only modules (db, env, quota, sources, llm) must not be imported from
  client components.
- New env vars: add to `src/lib/env.ts` **and** `.env.example`.
- The public privacy notice (`src/app/privacy/page.tsx`) must match reality: update it whenever
  sources, stored fields, retention, providers or the LLM in use change.
- Anything touching rules 1, 3 or 5 needs tests (including quota refusal, 429 backoff
  and the fallback to `rules`).
