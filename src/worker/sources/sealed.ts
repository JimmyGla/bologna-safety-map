import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts runtime credentials kept in the database between worker runs (e.g. the Bluesky
// session), with a key derived from a secret that lives only in the worker's env. A copy of
// the database alone can't be used to log in (CLAUDE.md rule 6).

const VERSION = "v1";
const key = (secret: string) => createHash("sha256").update(`bologna-safety-map:sealed:${secret}`).digest();

export function seal(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The sealed value, or null if it is missing, corrupt or sealed with another secret. */
export function unseal<T>(sealed: string | undefined, secret: string): T | null {
  if (!sealed?.startsWith(`${VERSION}.`)) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}
