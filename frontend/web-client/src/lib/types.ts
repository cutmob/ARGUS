export interface Hazard {
  id: string;
  rule_id: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  bbox?: BBox;
  frame_id?: string;
  image_url?: string;
  detected_at: string;
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
