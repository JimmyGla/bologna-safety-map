import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Server-only. Never import from client components.
//
// Two drivers, one query API:
// - "neon": Neon's HTTP driver (@neondatabase/serverless). Stateless, one HTTPS request per
//   query, no connection pool to exhaust — right for Vercel functions. Default on Vercel.
// - "postgres": a normal TCP connection pool (postgres-js). Used by the worker, scripts and
//   local development (incl. the docker-compose Postgres).
// DB_DRIVER overrides the choice. The app uses only plain selects/inserts/updates/deletes
// (no transactions), which both drivers support identically.

export type Db = PostgresJsDatabase<typeof schema>;

const env = getEnv();
const driver = env.DB_DRIVER ?? (process.env.VERCEL ? "neon" : "postgres");

let client: postgres.Sql | null = null;

function connect(): Db {
  if (driver === "neon") {
    // The HTTP driver's database type differs only in its result HKT; the query builder
    // surface the app uses is the same, so it is exposed under one type.
    return drizzleNeon(neon(env.DATABASE_URL), { schema }) as unknown as Db;
  }
  // Worker: prefer Neon's direct (unpooled) URL when given. Behind PgBouncer (a "-pooler"
  // host) prepared statements must be off.
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  const pooled = new URL(url).hostname.includes("-pooler");
  client = postgres(url, { prepare: !pooled, max: 5 });
  return drizzle(client, { schema });
}

export const db: Db = connect();
export const dbDriver = driver;

/** Closes the pool so short-lived processes (worker:once, scripts) can exit. */
export const closeDb = async () => {
  await client?.end({ timeout: 5 });
};
