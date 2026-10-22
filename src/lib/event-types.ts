// Shared by the DB schema, extraction and the client (no dependencies, safe to bundle).
// New values need a migration (`npm run db:generate`): event_type is a Postgres enum.
export const EVENT_TYPES = [
  "clashes",
  "march",
  "blockade",
  "police_presence",
  "peaceful_gathering",
  "aftermath",
  /** Physical attack on people: aggressione, pestaggio, accoltellamento, rissa. */
  "assault",
  /** Group or hate-motivated attack: squadristi, spedizione punitiva, aggressione razzista/omofoba. */
  "hate_attack",
  /** Violenza sessuale, stupro, molestie. */
  "sexual_violence",
  /** Property being smashed or burned now: vetrine spaccate, auto incendiate, devastazioni. */
  "vandalism",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
