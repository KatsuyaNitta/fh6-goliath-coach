export type SectionId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

export interface ReferencePoint {
  current_lap_time: number;
  course_distance_m: number;
  course_distance_km: number;
  position_x: number;
  position_y: number;
  position_z: number;
  speed_kmh: number;
  display_x: number;
  display_y: number;
  display_z: number;
  section_id: SectionId;
}

export interface SectionDefinition {
  id: SectionId;
  name_ja: string;
  name_en: string;
  start_distance_m: number;
  end_distance_m: number;
  length_m: number;
  description: string;
}

export interface BoundaryMarker {
  id: string;
  label: string;
  course_distance_m: number;
  from_section_id: SectionId;
  to_section_id: SectionId;
}

export interface ReferencePayload {
  schema_version: string;
  provenance: {
    description: string;
    limitations: string[];
  };
  coordinate_system: {
    display_origin: {
      position_x: number;
      position_y: number;
      position_z: number;
    };
  };
  sections: SectionDefinition[];
  markers: BoundaryMarker[];
  points: ReferencePoint[];
}

export const SECTION_COLORS: Record<SectionId, string> = {
  S1: "#39c6f0",
  S2: "#7bd66f",
  S3: "#f7c94b",
  S4: "#ff7a59",
  S5: "#c084fc",
  S6: "#f472b6",
};

export async function fetchReference(): Promise<ReferencePayload> {
  const response = await fetch("/reference/goliath_reference.json");
  if (!response.ok) {
    throw new Error(`Failed to load reference JSON: ${response.status}`);
  }
  return response.json() as Promise<ReferencePayload>;
}

export function nearestPointByDistance(
  points: ReferencePoint[],
  distanceM: number,
): ReferencePoint | undefined {
  let best: ReferencePoint | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const delta = Math.abs(point.course_distance_m - distanceM);
    if (delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  return best;
}
