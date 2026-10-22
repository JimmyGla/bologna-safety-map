# Bologna Safety Map

A web app that shows which **areas** of Bologna, Italy are affected by ongoing protests and
street violence (assaults, squad or hate attacks, sexual violence, vandalism),
as a color-coded H3 hexagon map with a legend. It maps areas, never people.

It costs nothing to run: everything uses free tiers or local resources, with no paid APIs.

Read [CLAUDE.md](CLAUDE.md) before contributing: it contains the project's hard rules
(privacy, danger levels, corroboration, zero cost, quota guard, secrets).

## Danger levels

| Level | Color  | Meaning  |
|-------|--------|----------|
| 0     | grey   | No data  |
| 1     | green  | Low      |
| 2     | yellow | Moderate |
| 3     | orange | High     |
| 4     | red    | Severe   |

Levels 3+ require ≥2 independent sources or ≥1 official/news source.

## Stack

Next.js 15 (App Router, TypeScript, Tailwind) · Postgres 16 + Drizzle ORM · h3-js (res 9)
· MapLibre GL JS + OpenFreeMap vector tiles · Node worker (tsx + node-cron) · zod · vitest

**Sources** (each switchable with `SOURCE_<ID>_ENABLED`): local news RSS, TPER alerts,
Bluesky search, Mastodon hashtag timelines, Reddit r/bologna RSS, public Telegram channels.
Social sources poll more often while they are finding relevant posts and back off when
quiet. There is no X/Twitter source: the project uses no X API (see CLAUDE.md).

### Setting up the optional social sources

- **Bluesky:** create a free account, add an app password (Settings → Privacy and
  security → App passwords), set `BSKY_HANDLE` and `BSKY_APP_PASSWORD`, then
  `SOURCE_BLUESKY_ENABLED=true`.
- **Mastodon:** works without an account. Set `MASTODON_INSTANCES` /
  `MASTODON_HASHTAGS` if you want more than the defaults.
- **Telegram:** create an app at [my.telegram.org](https://my.telegram.org) and put
  `TG_API_ID` / `TG_API_HASH` in `.env.local`. Then run `npm run telegram:login` and paste
  the printed `TG_SESSION=…` line into `.env.local`; keep it secret, it works like a
  password. List the public channels in `TELEGRAM_CHANNELS` and set
  `SOURCE_TELEGRAM_ENABLED=true`. The worker only reads those channels.

**LLM** (`LLM_PROVIDER`): `gemini` (Google AI Studio free tier), `ollama` (local) or
`rules` (keyword/regex, no LLM). It falls back to `rules` automatically when a provider
is out of quota or fails.

All external calls go through a quota guard (`src/lib/quota.ts`) that keeps each
service within its free-tier limits and backs off on HTTP 429. If a source is
unavailable it is skipped; the app keeps running.

## Getting started

Requirements: Node 20+ (24 recommended), Docker. Optional: [Ollama](https://ollama.com)
or a free [Google AI Studio](https://aistudio.google.com) key.

```bash
npm install
cp .env.example .env.local   # works as-is with LLM_PROVIDER=rules
npm run db:up                # start Postgres 16 in Docker
npm run db:migrate           # create the tables (the worker also does this on start)
npm run dev                  # web app on http://localhost:3000
npm run worker               # ingestion worker (separate terminal)
```

## Scripts

| Script                | What it does                                    |
|-----------------------|-------------------------------------------------|
| `npm run dev`         | Next.js dev server                              |
| `npm run build`       | Production build                                |
| `npm run worker`      | Ingestion worker on a cron schedule             |
| `npm run worker:once` | One ingestion pass, then exit (GitHub Actions)  |
| `npm run db:up/down`  | Start/stop local Postgres (docker compose)      |
| `npm run db:generate` | Create a migration in `drizzle/` after schema changes |
| `npm run db:migrate`  | Apply migrations (the worker also does this on start) |
| `npm run db:studio`   | Drizzle Studio                                  |
| `npm run gazetteer:build` | Regenerate place data from OSM + Comune (one-off) |
| `npm run worker:dry`  | One pass against live sources without a database |
| `npm run telegram:login` | One-off: create the Telegram session string    |
| `npm run e2e:seed` / `e2e:check` | Seed fixtures into the local DB / verify the running app |

## Upcoming protests

Announcements like *"sabato corteo alle 15 da piazza XX Settembre"* are recognised and
listed under the calendar button next to the title, with date, time and place, for the
next 7 days. They appear on the map as dashed outlines, separate from the danger colours:
an announced protest does not make an area dangerous now. An announcement is shown only
if it comes from a news, official or TPER source, or from two independent sources.

## 72-hour forecast

The **"Prossime 72 ore"** switch shows an estimate of risk per area for each 6-hour
window of the next three days, in its own violet colours. It's built from:
- announced protests;
- counter-demonstrations or other gatherings near them at the same time;
- violent incidents in the last 7 days.

It never changes the current danger levels, and an area with only past incidents can't
go above "moderate risk". Tap an area to see why it has its level. Details:
`src/lib/forecast-model.ts`.

## Admin and monitoring

- `/admin` (set `ADMIN_PASSWORD`, at least 12 characters) shows source status, today's
  quota use, the active extractor and its rules fallbacks, the last 50 events and a
  click-a-cell override tool.
- `/api/health` returns `ok`, `degraded` or `down`, for uptime monitors.

## End-to-end check (local)

```bash
npm run db:up
npm run db:migrate
npm run e2e:seed
# PowerShell: set the SOURCE_*_ENABLED variables to false first, so only fixtures run
npm run worker:once
npm run dev          # in another terminal
npm run e2e:check
```

If something else already uses port 5432 (e.g. a native Postgres), set `POSTGRES_PORT`
and the port in `DATABASE_URL` in `.env.local` to a free one, such as 5433.
| `npm test`            | Run vitest once (`test:watch` to watch)         |

## Deployment (zero cost)

Everything runs on free tiers. **Never add a payment method or enable billing** on Neon,
Vercel, GitHub or Google AI Studio. If a free limit is reached, that service pauses or
throttles; nothing is charged.

| Part     | Where                                        | Notes |
|----------|----------------------------------------------|-------|
| Web      | Vercel Hobby                                 | Non-commercial use only. Talks to Neon over HTTP (`@neondatabase/serverless`). |
| Database | Neon free tier                               | Pooled URL for the web, direct URL for the worker and migrations. |
| Worker   | (a) your machine / a Raspberry Pi, or (b) GitHub Actions every 5 min | Applies migrations at start. |

Free-tier limits change: check each provider's current limits before relying on them.

### 1. Database: Neon

1. Create a free account at [neon.com](https://neon.com) and a project in **Europe
   (Frankfurt)**, close to Bologna. Postgres 16 or newer.
2. From **Connect**, copy two connection strings for the same database:
   - **Pooled** (host contains `-pooler`): becomes `DATABASE_URL`.
   - **Direct** (no `-pooler`): becomes `DATABASE_URL_UNPOOLED`.

   Both end in `?sslmode=require`.
3. You don't create tables yourself: the worker applies the `drizzle/` migrations when
   it starts. To apply them from your laptop instead, put the Neon URLs in `.env.local` and
   run `npm run db:migrate`.

Neon suspends the database after a few idle minutes and wakes it on the next query
(the first request takes about a second). The worker scores every minute, which keeps it
awake. If the free plan's monthly compute allowance runs out, the database pauses until
the next month and the map shows its "out of date" banner. If that happens, run the
worker less often (for example mode b).

### 2. Web app: Vercel Hobby

1. Push the repo to GitHub. Create a free Vercel account and **Add New → Project**,
   then import the repo. Framework: Next.js. Build and output settings: defaults
   (`npm run build`, which also copies the MapLibre worker).
2. **Settings → Environment Variables** (Production):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** URL |
   | `ADMIN_PASSWORD` | a long random password (≥ 12 characters) for `/admin` |
   | `SCORE_THRESHOLDS` | optional, default `0.15,0.4,0.8,1.4` |
   | `CELLS_RATE_LIMIT_PER_MIN` | optional, default `60` |
   | `LOG_LEVEL` | optional, default `info` |
   | `PRIVACY_CONTROLLER_NAME` | your name (or organisation), shown on `/privacy` as data controller |
   | `PRIVACY_CONTACT_EMAIL` | contact for privacy requests, shown on `/privacy` |

   The web app never fetches sources, so no source or LLM keys go here. On Vercel it
   uses Neon's HTTP driver automatically (`DB_DRIVER=neon`).
3. Deploy, then open `https://<your-app>.vercel.app/api/health`. It reports
   `database: "ok"`, and `snapshot.stale: true` until the worker has run.

`/api/cells` is cached by Vercel's CDN for 30 s and rate-limited to 60 requests per
minute per IP. The limit is kept in memory per function instance, so treat it as a soft
limit.

### 3a. Worker on your machine or a Raspberry Pi

Requirements: Node 20+ (24 recommended), git. A Raspberry Pi 4/5 with 4 GB+ is enough
for the worker; add Ollama only on 8 GB models (see below).

```bash
sudo useradd --system --create-home --home-dir /opt/bologna-safety-map bsm
sudo -u bsm git clone https://github.com/<you>/bologna-safety-map.git /opt/bologna-safety-map
cd /opt/bologna-safety-map
sudo -u bsm npm ci
sudo -u bsm cp .env.example .env.local
sudo -u bsm chmod 600 .env.local
sudo -u bsm nano .env.local      # Neon URLs, sources, LLM, SOURCE_USER_AGENT with a contact
sudo -u bsm npm run worker:dry   # optional: one pass against live sources, no database writes
```

Then run it with **one** of these:

- **systemd** (recommended on Linux / Pi):
  ```bash
  sudo cp deploy/systemd/bologna-safety-map-worker.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now bologna-safety-map-worker
  journalctl -u bologna-safety-map-worker -f
  ```
- **pm2** (any OS):
  ```bash
  npm i -g pm2
  pm2 start deploy/pm2/ecosystem.config.cjs
  pm2 save && pm2 startup
  pm2 logs bsm-worker
  ```
- **Plain**: `npm run worker` in a terminal or `tmux`.

To update: `git pull && npm ci`, then restart the service. Migrations apply on the next
start.

#### Ollama alongside the worker (optional, local LLM)

```bash
curl -fsSL https://ollama.com/install.sh | sh   # installs and starts the "ollama" systemd service
ollama pull qwen2.5:7b                           # desktop / 16 GB machines
ollama pull qwen2.5:3b                           # Raspberry Pi 5 (8 GB): smaller and faster
```

In `.env.local`: `LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434`,
`OLLAMA_MODEL=` the model you pulled. In the systemd unit, uncomment the
`After=… ollama.service` line. On a Pi, CPU inference is slow (tens of seconds per batch
of 5). The worker waits up to 3 minutes per batch and falls back to the rules extractor
if Ollama is down or too slow, so the map keeps working either way.

### 3b. Worker on GitHub Actions

`.github/workflows/worker.yml` runs `npm run worker:once` every 5 minutes. Each run
applies migrations, runs every enabled source once, then extraction, scoring and
retention, and exits.

1. **Keep the repository public.** Public repos get free Actions minutes; a private repo's
   monthly allowance is used up quickly by a 5-minute schedule (each run spends about a
   minute installing dependencies).
2. **Settings → Secrets and variables → Actions → Secrets**: `DATABASE_URL` (pooled),
   `DATABASE_URL_UNPOOLED` (direct), and as needed `GEMINI_API_KEY`, `BSKY_HANDLE`,
   `BSKY_APP_PASSWORD`, `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`.
3. **… → Variables**: `WORKER_ENABLED=true` (nothing runs without it), `SOURCE_USER_AGENT`
   (with a contact address), and optionally `LLM_PROVIDER`, `SOURCE_*_ENABLED`,
   `TELEGRAM_CHANNELS`, etc. These are the same names as in `.env.example`.
4. **Actions → worker → Run workflow** once to test it, then let the schedule take over.

Caveats:

- **Delays:** scheduled runs often start late (10+ minutes at busy times) or are
  skipped, so the map's 10-minute "out of date" banner will show up now and then. For a
  map that stays fresh, use mode (a).
- **Auto-disable:** GitHub turns off scheduled workflows in public repos after 60 days
  without activity. Re-enable them from the Actions tab.
- **No adaptive polling:** each run is one pass. Progress (cursors, quota counters) is
  stored in the database between runs.
- **Datacenter IPs:** some sites (notably Reddit) block or throttle requests from cloud
  IPs. Blocked sources are skipped, and `/admin` shows them as errors.
- **Overlap:** only one run at a time (`concurrency`), and migrations take a database
  lock.

### 4. After deploying

- `/api/health` shows `status: "ok"`, or `"degraded"` while extraction uses the rules
  fallback or data is stale.
- `/admin` (with `ADMIN_PASSWORD`) shows sources, quota, extractor, events and the
  override tool.
- Changing the schema: edit `src/db/schema.ts`, run `npm run db:generate`, and commit the
  new file in `drizzle/`. Workers apply it on their next start.

## Project layout

```
src/
  app/              pages + API route handlers
  components/map/   MapLibre map and legend
  db/               Drizzle schema and client
  lib/              env, danger levels, quota guard, geo (H3), scoring, sources, llm
  worker/           cron worker and jobs
```

## Privacy

No usernames, handles, profile links or post text are shown in the UI or returned by the
API. Raw posts are kept for at most 24 hours, only to compute area aggregates. The
public notice is at `/privacy` (`src/app/privacy/page.tsx`); keep it in sync when sources,
providers or retention change.

## Geocoding

A built-in gazetteer (`src/lib/gazetteer/`) recognises about 150 Bologna places in Italian
text: piazze, main streets, landmarks, city gates, quartieri and neighbourhoods. It
handles abbreviations ("P.zza", "v."), missing accents, hashtags and small typos, and
converts each place to H3 cells. Unknown places fall back to Nominatim, at most 1
request per second, with results cached in the database.

## Data and attribution

- Map tiles from [OpenFreeMap](https://openfreemap.org) (© OpenMapTiles); map data and gazetteer
  geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, ODbL 1.0.
- Quartieri, zone and aree statistiche: [Comune di Bologna Open Data](https://opendata.comune.bologna.it),
  CC BY 4.0.
