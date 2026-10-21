import { createHash } from "node:crypto";

/**
 * Stable dedupe id for a post whose native id embeds the author (Bluesky at://did/...,
 * Mastodon https://instance/users/name/...). Only the hash is stored (CLAUDE.md rule 1).
 */
export function hashedId(prefix: string, nativeId: string): string {
  return `${prefix}:${createHash("sha256").update(nativeId).digest("hex").slice(0, 32)}`;
}

export const daysSince = (iso: string | undefined, now: Date): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
};
