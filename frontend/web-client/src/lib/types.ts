export interface Hazard {
  id: string;
  rule_id: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  occurrences?: number;
  first_seen_at?: string;
  last_seen_at?: string;
  persistence_seconds?: number;
  risk_trend?: string;
  location?: string;
  bbox?: BBox;
  frame_id?: string;
  image_url?: string;
  camera_id?: string;
  detected_at: string;
}

export interface ActionCard {
  title: string;
  priority: string;
  reason: string;
  actions: string[];
  camera_id?: string;
  hazard_ref_id?: string;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Overlay {
  type: string;
  label: string;
  bbox?: BBox;
  severity: string;
  color: string;
}

export interface InspectionReport {
  id: string;
  session_id: string;
  inspection_mode: string;
  location: string;
  inspector: string;
  hazards: Hazard[];
  risk_level: string;
  risk_score: number;
  summary: string;
  recommendations: string[];
  created_at: string;
}

export interface InspectionModule {
  name: string;
  version: string;
  description: string;
  industry: string;
  rules: InspectionRule[];
  metadata: ModuleMetadata;
}

export interface InspectionRule {
  rule_id: string;
  description: string;
  severity: string;
  visual_signals: string[];
  category: string;
  enabled: boolean;
}

export interface ModuleMetadata {
  author: string;
  version: string;
  tags: string[];
  required_objects?: string[];
}
