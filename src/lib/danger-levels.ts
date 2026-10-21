// Single source of truth for danger levels (CLAUDE.md, hard rule 2).

export const DANGER_LEVELS = [
  {
    level: 0,
    label: "No data",
    color: "grey",
    hex: "#9ca3af",
    outline: "#4b5563",
    meaning: "No recent reports for this area.",
  },
  {
    level: 1,
    label: "Low",
    color: "green",
    hex: "#22c55e",
    outline: "#15803d",
    meaning: "Small or peaceful activity reported.",
  },
  {
    level: 2,
    label: "Moderate",
    color: "yellow",
    hex: "#eab308",
    outline: "#a16207",
    meaning: "Gatherings that may disrupt traffic or transit.",
  },
  {
    level: 3,
    label: "High",
    color: "orange",
    hex: "#f97316",
    outline: "#c2410c",
    meaning: "Large crowds or tension, confirmed. Avoid if possible.",
  },
  {
    level: 4,
    label: "Severe",
    color: "red",
    hex: "#dc2626",
    outline: "#991b1b",
    meaning: "Serious incidents confirmed. Stay away.",
  },
] as const;

export type DangerLevel = (typeof DANGER_LEVELS)[number]["level"];

// Levels at or above this require corroboration (CLAUDE.md, hard rule 3).
export const CORROBORATION_REQUIRED_FROM: DangerLevel = 3;

export function getDangerLevel(level: number) {
  return DANGER_LEVELS.find((d) => d.level === level) ?? DANGER_LEVELS[0];
}
