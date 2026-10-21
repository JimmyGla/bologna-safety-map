import type { Env } from "@/lib/env";
import { RateLimitedError } from "@/lib/quota";
import { isProtestRelated } from "../ingest/text";
import type { FetchedItem, SourceAdapter } from "./types";

// Public Telegram channels (local news / official) through a user session (GramJS).
// READ-ONLY: the only calls are connect() and getMessages() on public channel usernames
// from TELEGRAM_CHANNELS. Never join, never send, never read groups or private chats.
// Stored per message: text, time, a t.me link to the (public) channel post. The post's
// author signature / sender is never read. Disabled by default.

export type TgMessage = { id: number; date: number; message?: string };

/** The part of GramJS we use, so tests can pass a fake. */
export type TgClient = {
  getMessages(channel: string, opts: { limit: number; minId: number }): Promise<TgMessage[]>;
};

const FIRST_RUN_LIMIT = 20;
const LIMIT = 50;

let shared: Promise<TgClient> | undefined;

async function connectClient(env: Env): Promise<TgClient> {
  const [{ TelegramClient }, { StringSession }] = await Promise.all([import("telegram"), import("telegram/sessions")]);
  const client = new TelegramClient(new StringSession(env.TG_SESSION!), env.TG_API_ID!, env.TG_API_HASH!, { connectionRetries: 3 });
  client.setLogLevel("error" as never);
  // connect(), not start(): never prompts for a login inside the worker.
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error("TG_SESSION is not authorized; run npm run telegram:login");
  return {
    async getMessages(channel, opts) {
      const msgs = await client.getMessages(channel, opts);
      return msgs.map((m) => ({ id: m.id, date: m.date, message: m.message }));
    },
  };
}

/** GramJS FLOOD_WAIT errors carry `seconds`: hand them to the quota guard as a 429. */
async function floodAware<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const seconds = (err as { seconds?: unknown })?.seconds;
    if (typeof seconds === "number") throw new RateLimitedError(seconds * 1000);
    throw err;
  }
}

export function createTelegramAdapter(makeClient?: (env: Env) => Promise<TgClient>): SourceAdapter {
  const clientFor = (env: Env) => {
    if (makeClient) return makeClient(env);
    shared ??= connectClient(env).catch((err) => {
      shared = undefined;
      throw err;
    });
    return shared;
  };

  return {
    id: "telegram",
    source: "telegram",
    sourceClass: "social",
    schedule: "*/3 * * * *",
    adaptive: { baseMinutes: 3, minMinutes: 1, maxMinutes: 15 },
    enabled: (env) => env.SOURCE_TELEGRAM_ENABLED,

    async fetch(ctx) {
      const { env, guard } = ctx;
      if (!env.TG_API_ID || !env.TG_API_HASH || !env.TG_SESSION) {
        return { items: [], failedFeeds: ["telegram (TG_API_ID/TG_API_HASH/TG_SESSION not set)"] };
      }
      if (!env.TELEGRAM_CHANNELS.length) return { items: [], failedFeeds: [] };
      const client = await guard.run("telegram_api", () => floodAware(() => clientFor(env)));
      if (!client) return { items: [], failedFeeds: ["telegram (could not connect)"] };

      const items: FetchedItem[] = [];
      const failedFeeds: string[] = [];
      const cursors: Record<string, string> = {};
      for (const channel of env.TELEGRAM_CHANNELS) {
        const minId = Number(ctx.cursors?.[channel] ?? 0);
        const msgs = await guard.run("telegram_api", () =>
          floodAware(() => client.getMessages(channel, { limit: minId ? LIMIT : FIRST_RUN_LIMIT, minId })),
        );
        if (!msgs) {
          failedFeeds.push(channel);
          continue;
        }
        if (msgs.length) cursors[channel] = String(Math.max(minId, ...msgs.map((m) => m.id)));
        for (const m of msgs) {
          if (!m.message || !isProtestRelated(m.message)) continue;
          items.push({
            feed: channel,
            externalId: `tg:${channel}/${m.id}`,
            text: m.message,
            url: `https://t.me/${channel}/${m.id}`, // a public channel post, not a person
            publishedAt: new Date(m.date * 1000),
          });
        }
      }
      return { items, failedFeeds, cursors };
    },
  };
}

export const telegramAdapter = createTelegramAdapter();
