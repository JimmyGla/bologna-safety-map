import { createHmac, randomBytes } from "node:crypto";

// Pseudonymous author keys (CLAUDE.md rule 3 counts independent *people*, not platforms).
//
// key = HMAC(salt of the UTC day, "<source>:<platform account id>"), truncated. The salt is
// random, stored in the database for the day and deleted after 48h (purge job); keys are
// deleted after 24h. So a key only says "same account as another post today": it can't be
// reversed, can't be recomputed once the salt is gone, and can't link days.
// Adapters receive only ctx.authorKey(); the account id never leaves the adapter.

export const AUTHOR_SALT_ADAPTER = "_author_salt";
export const AUTHOR_SALT_KEEP_MS = 48 * 3_600_000;
export const AUTHOR_KEY_KEEP_MS = 24 * 3_600_000;

export const newSalt = () => randomBytes(32).toString("base64url");

export function authorKey(salt: string, source: string, accountId: string): string {
  return `a:${createHmac("sha256", salt).update(`${source}:${accountId}`).digest("hex").slice(0, 24)}`;
}

/** UTC day the salt belongs to. */
export const saltDay = (d: Date) => d.toISOString().slice(0, 10);
