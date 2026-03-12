import { INSPECTION_MODES } from "@/lib/modes";

export type VoiceIntentType =
  | "start_inspection"
  | "stop_inspection"
  | "generate_report"
  | "open_report"
  | "close_report"
  | "operator_actions"
  | "query_status"
  | "clear_hazards"
  | "describe_scene"
  | "switch_mode"
  | "toggle_overlays"
  | "set_glass_light"
  | "set_glass_dark"
  | "mute_voice"
  | "unmute_voice"
  | "unknown";

export interface VoiceIntent {
  type: VoiceIntentType;
  mode?: string;
  confidence: number;
}

const MODE_SYNONYMS: Record<string, string[]> = {
  construction: ["construction", "build site", "building site", "site"],
  warehouse: ["warehouse", "storage", "storage bay"],
  electrical: ["electrical", "panel", "power room"],
  elevator: ["elevator", "lift"],
  kitchen: ["kitchen", "restaurant", "food prep"],
  manufacturing: ["manufacturing", "factory", "production"],
  facility: ["facility", "plant", "operations"],
  parking: ["parking", "car park", "garage"],
  datacenter: ["datacenter", "data center", "server room"],
};

const containsAny = (text: string, phrases: string[]) => phrases.some((p) => text.includes(p));

export function resolveVoiceIntent(transcript: string): VoiceIntent {
  const text = normalizeTranscript(transcript);

  if (!text) return { type: "unknown", confidence: 0 };

  if (containsAny(text, ["open report", "expand report", "view report", "show report", "report view"])) {
    return { type: "open_report", confidence: 0.98 };
  }

  if (containsAny(text, ["close report", "dismiss report", "hide report", "collapse report"])) {
    return { type: "close_report", confidence: 0.98 };
  }

  if (
    containsAny(text, ["start", "begin", "kick off", "run", "inspect", "inspection on"]) &&
    !containsAny(text, ["stop", "end", "cancel", "off"])
  ) {
    return { type: "start_inspection", confidence: 0.92 };
  }

  if (containsAny(text, ["stop", "end", "halt", "pause", "cancel inspection", "inspection off"])) {
    return { type: "stop_inspection", confidence: 0.95 };
  }

  if (containsAny(text, ["generate report", "create report", "make report", "run report", "export report", "report now"])) {
    return { type: "generate_report", confidence: 0.95 };
  }

  if (containsAny(text, ["top actions", "top 3", "top three", "immediate actions", "what should we do", "next actions"])) {
    return { type: "operator_actions", confidence: 0.92 };
  }

  if (containsAny(text, ["status", "how many hazards", "risk level", "what is the risk", "current risk"])) {
    return { type: "query_status", confidence: 0.88 };
  }

  if (containsAny(text, ["clear", "reset", "wipe", "start fresh", "clear hazards"])) {
    return { type: "clear_hazards", confidence: 0.9 };
  }

  if (containsAny(text, ["describe", "what do you see", "summarize", "summary", "analyse", "analyze"])) {
    return { type: "describe_scene", confidence: 0.86 };
  }

  if (containsAny(text, ["overlay", "show overlays", "hide overlays", "toggle overlays"])) {
    return { type: "toggle_overlays", confidence: 0.86 };
  }

  if (containsAny(text, ["light glass", "bright glass", "light mode"])) {
    return { type: "set_glass_light", confidence: 0.85 };
  }

  if (containsAny(text, ["dark glass", "dark mode"])) {
    return { type: "set_glass_dark", confidence: 0.85 };
  }

  if (containsAny(text, ["mute", "voice off", "sound off"]) && !containsAny(text, ["unmute"])) {
    return { type: "mute_voice", confidence: 0.88 };
  }

  if (containsAny(text, ["unmute", "voice on", "sound on"])) {
    return { type: "unmute_voice", confidence: 0.9 };
  }

  if (containsAny(text, ["switch", "change", "set mode", "use mode", "go to"])) {
    const mode = extractMode(text);
    if (mode) return { type: "switch_mode", mode, confidence: 0.9 };
  }

  const mode = extractMode(text);
  if (mode && containsAny(text, ["mode", "inspection"])) {
    return { type: "switch_mode", mode, confidence: 0.75 };
  }

  return { type: "unknown", confidence: 0.2 };
}

function extractMode(text: string): string | undefined {
  for (const mode of INSPECTION_MODES) {
    if (text.includes(mode) || text.includes(mode.replace(/-/g, " "))) return mode;
  }

  for (const [mode, aliases] of Object.entries(MODE_SYNONYMS)) {
    if (aliases.some((a) => text.includes(a))) {
      return INSPECTION_MODES.find((m) => m === mode) ?? undefined;
    }
  }

  return undefined;
}

function normalizeTranscript(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
