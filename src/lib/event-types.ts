// Shared by the DB schema, extraction and the client (no dependencies, safe to bundle).
export const EVENT_TYPES = ["clashes", "march", "blockade", "police_presence", "peaceful_gathering", "aftermath"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
