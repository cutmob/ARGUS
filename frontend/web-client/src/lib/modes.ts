/** All available inspection modules — matches /modules directory on the backend. */
export const INSPECTION_MODES = [
  "construction",
  "facility",
  "warehouse",
  "manufacturing",
  "electrical",
  "kitchen",
  "healthcare",
  "refinery",
  "laboratory",
  "office",
  "retail",
  "hotel",
  "school",
  "datacenter",
  "parking",
  "elevator",
  "loading-dock",
  "cold-storage",
  "rooftop",
  "fleet",
] as const;

export type InspectionMode = (typeof INSPECTION_MODES)[number];

/** Human-readable label for display. */
export function modeLabel(mode: string): string {
  return mode.replace(/-/g, " ");
}
