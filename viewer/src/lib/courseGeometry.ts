import type { ReferencePayload, SectionId } from "./reference";

export type TurnDirection = "unknown" | "straight" | "left" | "right";
export type SlopeDirection = "unknown" | "flat" | "uphill" | "downhill";
export type CourseColorMode = "section" | "speed" | "operation";
export type GeometryColorMode = "section" | "gradient" | "curvature";

export const GEOMETRY_POINT = {
  referenceIndex: 0,
  courseDistanceM: 1,
  sectionId: 2,
  tangentX: 3,
  tangentZ: 4,
  headingDeg: 5,
  gradientRatio: 6,
  gradientPct: 7,
  gradientAngleDeg: 8,
  signedCurvature1pm: 9,
  estimatedRadiusM: 10,
  turnDirection: 11,
  slopeDirection: 12,
  qualityFlags: 13,
} as const;

export type CourseGeometryPointTuple = [
  referenceIndex: number,
  courseDistanceM: number,
  sectionId: SectionId,
  tangentX: number | null,
  tangentZ: number | null,
  headingDeg: number | null,
  gradientRatio: number | null,
  gradientPct: number | null,
  gradientAngleDeg: number | null,
  signedCurvature1pm: number | null,
  estimatedRadiusM: number | null,
  turnDirection: TurnDirection,
  slopeDirection: SlopeDirection,
  qualityFlags: string[],
];

export interface CourseGeometryPayload {
  schema_version: "goliath-course-geometry-v1";
  source: {
    logical_path: string;
    sha256: string;
    point_count: number;
    finish_course_distance_m: number;
  };
  coordinate_convention: Record<string, unknown>;
  algorithm: {
    half_window_m: number;
    stability_half_window_m: number;
    straight_curvature_threshold_1pm: number;
    flat_gradient_threshold_pct: number;
  };
  units: Record<string, string>;
  quality_summary: Record<string, unknown>;
  display_scale: {
    abs_gradient_pct_p95: number | null;
    abs_curvature_1pm_p95: number | null;
    gradient_abs_clamp_pct: number;
    curvature_abs_clamp_1pm: number;
  };
  point_columns: string[];
  points: CourseGeometryPointTuple[];
}

export interface GeometrySample {
  courseDistanceM: number;
  sectionId: SectionId;
  headingDeg: number | null;
  gradientPct: number | null;
  signedCurvature1pm: number | null;
  estimatedRadiusM: number | null;
  turnDirection: TurnDirection;
  slopeDirection: SlopeDirection;
  qualityFlags: string[];
}

const EXPECTED_GEOMETRY_POINT_COLUMNS = [
  "reference_index",
  "course_distance_m",
  "section_id",
  "tangent_x",
  "tangent_z",
  "heading_deg",
  "gradient_ratio",
  "gradient_pct",
  "gradient_angle_deg",
  "signed_curvature_1pm",
  "estimated_radius_m",
  "turn_direction",
  "slope_direction",
  "quality_flags",
];

const VALID_TURNS: TurnDirection[] = ["unknown", "straight", "left", "right"];
const VALID_SLOPES: SlopeDirection[] = ["unknown", "flat", "uphill", "downhill"];

export async function fetchCourseGeometry(reference: ReferencePayload): Promise<CourseGeometryPayload> {
  const response = await fetch("/reference/goliath_course_geometry.json");
  if (!response.ok) {
    throw new Error(`Failed to load course geometry: ${response.status}`);
  }
  const payload = (await response.json()) as CourseGeometryPayload;
  validateCourseGeometryPayload(payload, reference);
  return payload;
}

export function validateCourseGeometryPayload(
  payload: CourseGeometryPayload,
  reference: ReferencePayload,
): void {
  if (payload.schema_version !== "goliath-course-geometry-v1") {
    throw new Error(`Unexpected course geometry schema: ${payload.schema_version}`);
  }
  const columnsMatch =
    Array.isArray(payload.point_columns) &&
    payload.point_columns.length === EXPECTED_GEOMETRY_POINT_COLUMNS.length &&
    payload.point_columns.every((column, index) => column === EXPECTED_GEOMETRY_POINT_COLUMNS[index]);
  if (!columnsMatch) {
    throw new Error("Course geometry has unexpected point columns.");
  }
  if (payload.source.point_count !== reference.stats.point_count || payload.points.length !== reference.points.length) {
    throw new Error("Course geometry point count does not match the reference path.");
  }
  if (Math.abs(payload.source.finish_course_distance_m - reference.start_finish.finish_course_distance_m) > 0.01) {
    throw new Error("Course geometry finish distance does not match the reference path.");
  }
  if (!Number.isFinite(payload.display_scale.gradient_abs_clamp_pct) || payload.display_scale.gradient_abs_clamp_pct <= 0) {
    throw new Error("Course geometry gradient clamp is invalid.");
  }
  if (!Number.isFinite(payload.display_scale.curvature_abs_clamp_1pm) || payload.display_scale.curvature_abs_clamp_1pm <= 0) {
    throw new Error("Course geometry curvature clamp is invalid.");
  }

  let previousDistance = -Infinity;
  for (const [index, point] of payload.points.entries()) {
    if (point[GEOMETRY_POINT.referenceIndex] !== index) {
      throw new Error(`Course geometry point ${index} has an unexpected reference index.`);
    }
    const distance = point[GEOMETRY_POINT.courseDistanceM];
    if (!Number.isFinite(distance) || distance <= previousDistance) {
      throw new Error(`Course geometry point ${index} has a non-monotonic distance.`);
    }
    previousDistance = distance;
    const sectionId = point[GEOMETRY_POINT.sectionId];
    if (!reference.sections.some((section) => section.id === sectionId)) {
      throw new Error(`Course geometry point ${index} has an unknown section id.`);
    }
    for (const value of point.slice(3, 11)) {
      if (value !== null && (!Number.isFinite(value) || typeof value !== "number")) {
        throw new Error(`Course geometry point ${index} has an invalid numeric value.`);
      }
    }
    if (!VALID_TURNS.includes(point[GEOMETRY_POINT.turnDirection])) {
      throw new Error(`Course geometry point ${index} has an invalid turn direction.`);
    }
    if (!VALID_SLOPES.includes(point[GEOMETRY_POINT.slopeDirection])) {
      throw new Error(`Course geometry point ${index} has an invalid slope direction.`);
    }
    if (!Array.isArray(point[GEOMETRY_POINT.qualityFlags])) {
      throw new Error(`Course geometry point ${index} has invalid quality flags.`);
    }
  }
}

export function nearestGeometryPoint(
  geometry: CourseGeometryPayload,
  distanceM: number,
): CourseGeometryPointTuple | undefined {
  if (geometry.points.length === 0) {
    return undefined;
  }
  let low = 0;
  let high = geometry.points.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const distance = geometry.points[mid][GEOMETRY_POINT.courseDistanceM];
    if (distance < distanceM) {
      low = mid + 1;
    } else if (distance > distanceM) {
      high = mid - 1;
    } else {
      return geometry.points[mid];
    }
  }
  const before = geometry.points[Math.max(0, high)];
  const after = geometry.points[Math.min(geometry.points.length - 1, low)];
  return Math.abs(before[GEOMETRY_POINT.courseDistanceM] - distanceM) <=
    Math.abs(after[GEOMETRY_POINT.courseDistanceM] - distanceM)
    ? before
    : after;
}

export function sampleGeometryAtDistance(
  geometry: CourseGeometryPayload | null,
  distanceM: number | undefined,
): GeometrySample | null {
  if (!geometry || distanceM === undefined || !Number.isFinite(distanceM)) {
    return null;
  }
  const points = geometry.points;
  if (points.length === 0) {
    return null;
  }
  const nearest = nearestGeometryPoint(geometry, distanceM);
  if (!nearest) {
    return null;
  }
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const distance = points[mid][GEOMETRY_POINT.courseDistanceM];
    if (distance < distanceM) {
      low = mid + 1;
    } else if (distance > distanceM) {
      high = mid - 1;
    } else {
      low = mid;
      high = mid;
      break;
    }
  }
  const before = points[Math.max(0, high)];
  const after = points[Math.min(points.length - 1, low)];
  const fraction =
    before === after
      ? 0
      : (distanceM - before[GEOMETRY_POINT.courseDistanceM]) /
        Math.max(1e-9, after[GEOMETRY_POINT.courseDistanceM] - before[GEOMETRY_POINT.courseDistanceM]);
  return {
    courseDistanceM: distanceM,
    sectionId: nearest[GEOMETRY_POINT.sectionId],
    headingDeg: interpolateNullable(before, after, fraction, GEOMETRY_POINT.headingDeg),
    gradientPct: interpolateNullable(before, after, fraction, GEOMETRY_POINT.gradientPct),
    signedCurvature1pm: interpolateNullable(before, after, fraction, GEOMETRY_POINT.signedCurvature1pm),
    estimatedRadiusM: nearest[GEOMETRY_POINT.estimatedRadiusM],
    turnDirection: nearest[GEOMETRY_POINT.turnDirection],
    slopeDirection: nearest[GEOMETRY_POINT.slopeDirection],
    qualityFlags: nearest[GEOMETRY_POINT.qualityFlags],
  };
}

function interpolateNullable(
  before: CourseGeometryPointTuple,
  after: CourseGeometryPointTuple,
  fraction: number,
  column:
    | typeof GEOMETRY_POINT.headingDeg
    | typeof GEOMETRY_POINT.gradientPct
    | typeof GEOMETRY_POINT.signedCurvature1pm,
): number | null {
  const left = before[column];
  const right = after[column];
  if (left === null || right === null) {
    return null;
  }
  return left + (right - left) * Math.min(1, Math.max(0, fraction));
}
