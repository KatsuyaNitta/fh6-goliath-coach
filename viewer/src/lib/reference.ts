export type SectionId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

export const POINT = {
  courseDistanceM: 0,
  displayX: 1,
  displayY: 2,
  displayZ: 3,
  positionX: 4,
  positionY: 5,
  positionZ: 6,
  speedKmh: 7,
  currentLapTime: 8,
  sectionIndex: 9,
} as const;

export type ReferencePointTuple = [
  courseDistanceM: number,
  displayX: number,
  displayY: number,
  displayZ: number,
  positionX: number,
  positionY: number,
  positionZ: number,
  speedKmh: number,
  currentLapTime: number,
  sectionIndex: number,
];

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
  start_finish: {
    start_course_distance_m: number;
    finish_course_distance_m: number;
  };
  stats: {
    point_count: number;
    source_columns: string[];
  };
  point_columns: string[];
  points: ReferencePointTuple[];
}

export const EXPECTED_POINT_COLUMNS = [
  "course_distance_m",
  "display_x",
  "display_y",
  "display_z",
  "position_x",
  "position_y",
  "position_z",
  "speed_kmh",
  "current_lap_time",
  "section_index",
];

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
    throw new Error(`Failed to load reference data: ${response.status}`);
  }
  const payload = (await response.json()) as ReferencePayload;
  validateReferencePayload(payload);
  return payload;
}

export function validateReferencePayload(payload: ReferencePayload): void {
  const columnsMatch =
    payload.point_columns.length === EXPECTED_POINT_COLUMNS.length &&
    payload.point_columns.every((column, index) => column === EXPECTED_POINT_COLUMNS[index]);
  if (!columnsMatch) {
    throw new Error("Generated reference data has unexpected point columns.");
  }
  if (payload.sections.length !== 6) {
    throw new Error(`Expected 6 sections, got ${payload.sections.length}.`);
  }
  if (payload.markers.length !== 5) {
    throw new Error(`Expected 5 section markers, got ${payload.markers.length}.`);
  }
  if (payload.points.length === 0) {
    throw new Error("Generated reference data contains no points.");
  }
}

export function pointSectionId(payload: ReferencePayload, point: ReferencePointTuple): SectionId {
  const section = payload.sections[point[POINT.sectionIndex]];
  if (!section) {
    throw new Error(`Point references unknown section index ${point[POINT.sectionIndex]}.`);
  }
  return section.id;
}

export function nearestPointByDistance(
  points: ReferencePointTuple[],
  distanceM: number,
): ReferencePointTuple | undefined {
  if (points.length === 0) {
    return undefined;
  }

  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const distance = points[mid][POINT.courseDistanceM];
    if (distance < distanceM) {
      low = mid + 1;
    } else if (distance > distanceM) {
      high = mid - 1;
    } else {
      return points[mid];
    }
  }

  const before = points[Math.max(0, high)];
  const after = points[Math.min(points.length - 1, low)];
  return Math.abs(before[POINT.courseDistanceM] - distanceM) <=
    Math.abs(after[POINT.courseDistanceM] - distanceM)
    ? before
    : after;
}
