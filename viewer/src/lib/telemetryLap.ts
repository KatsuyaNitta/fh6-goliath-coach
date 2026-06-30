import type { SectionId } from "./reference";

export type RewindClassification = "external_impact_suspected" | "driving_error_suspected" | "undetermined" | "";
export type RewindConfidence = "high" | "medium" | "low" | "";
export type RewindImpactDirection = "rear" | "front" | "left" | "right" | "unknown" | "";

export interface ProjectedLapVehicle {
  displayName: string;
  filenameSlug: string;
  carOrdinal?: number;
  identificationSource: string;
  catalogSha256?: string;
}

export interface ProjectedLapPoint {
  sourceRowIndex: number;
  timestampS: number;
  lapTimeS: number;
  courseDistanceM: number;
  sectionId: SectionId;
  projectionErrorM: number;
  displayX: number;
  displayY: number;
  displayZ: number;
  speedKmh: number;
  throttlePct: number | null;
  brakePct: number | null;
  steerNorm: number | null;
  manualMarkerId: string;
  excludeFromDrivingAnalysis: boolean;
  isEffective: boolean;
  supersededByRewindEventId: string;
  rewindEventId: string;
  rewindClusterId: string;
  rewindClassification: RewindClassification;
  rewindConfidence: RewindConfidence;
  rewindImpactDirection: RewindImpactDirection;
  rewoundTimeS: number | null;
  rewoundCourseDistanceM: number | null;
}

export interface ProjectedLapSectionSummary {
  sectionId: SectionId;
  startTimeS: number;
  endTimeS: number;
  elapsedTimeS: number;
  sampleCount: number;
}

export interface RewindClusterPayload {
  clusterId: string;
  sectionId: SectionId;
  courseDistanceM: number;
  eventCount: number;
  externalImpactSuspectedCount: number;
  drivingErrorSuspectedCount: number;
  undeterminedCount: number;
  confidence: RewindConfidence;
  impactDirection: RewindImpactDirection;
  rewoundTimeS: number;
  rewoundCourseDistanceM: number;
  eventIds: string[];
  points: ProjectedLapPoint[];
}

export interface RewindSummaryPayload {
  rewindCount: number;
  externalImpactSuspectedCount: number;
  drivingErrorSuspectedCount: number;
  undeterminedCount: number;
  bySection: Record<SectionId, number>;
  practiceFocus: RewindClusterPayload[];
}

export interface ProjectedLapChannelAvailability {
  speed: boolean;
  throttle: boolean;
  brake: boolean;
  steering: boolean;
}

export interface ProjectedLapPayload {
  fileName: string;
  sessionId: string;
  vehicle: ProjectedLapVehicle;
  totalLapTimeS: number;
  points: ProjectedLapPoint[];
  effectivePoints: ProjectedLapPoint[];
  markers: ProjectedLapPoint[];
  rewindEvents: ProjectedLapPoint[];
  rewindClusters: RewindClusterPayload[];
  rewindSummary: RewindSummaryPayload;
  sectionSummaries: ProjectedLapSectionSummary[];
  channelAvailability: ProjectedLapChannelAvailability;
}

const REQUIRED_COLUMNS = [
  "source_row_index",
  "timestamp_s",
  "lap_time_s",
  "course_distance_m",
  "section_id",
  "projection_error_m",
  "telemetry_display_x",
  "telemetry_display_y",
  "telemetry_display_z",
  "speed_kmh",
  "manual_marker_id",
  "exclude_from_driving_analysis",
];

const SECTION_IDS: SectionId[] = ["S1", "S2", "S3", "S4", "S5", "S6"];

export function parseProjectedLapCsv(text: string, fileName = "projected-lap.csv"): ProjectedLapPayload {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) {
    throw new Error("Projected lap CSV contains no data rows.");
  }
  const headers = rows[0];
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_COLUMNS.filter((name) => column[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Projected lap CSV is missing required columns: ${missing.join(", ")}`);
  }

  const points = rows.slice(1).map((row, index) => {
    const sectionId = readString(row, column.section_id, index) as SectionId;
    if (!SECTION_IDS.includes(sectionId)) {
      throw new Error(`Projected lap row ${index + 2} has invalid section_id: ${sectionId}`);
    }
    return {
      sourceRowIndex: readNumber(row, column.source_row_index, index),
      timestampS: readNumber(row, column.timestamp_s, index),
      lapTimeS: readNumber(row, column.lap_time_s, index),
      courseDistanceM: readNumber(row, column.course_distance_m, index),
      sectionId,
      projectionErrorM: readNumber(row, column.projection_error_m, index),
      displayX: readNumber(row, column.telemetry_display_x, index),
      displayY: readNumber(row, column.telemetry_display_y, index),
      displayZ: readNumber(row, column.telemetry_display_z, index),
      speedKmh: readNumber(row, column.speed_kmh, index),
      throttlePct: readOptionalNumber(row, column.accel_pct),
      brakePct: readOptionalNumber(row, column.brake_pct),
      steerNorm: readOptionalNumber(row, column.steer_norm),
      manualMarkerId: readString(row, column.manual_marker_id, index),
      excludeFromDrivingAnalysis: readString(row, column.exclude_from_driving_analysis, index).toLowerCase() === "true",
      isEffective: readOptionalBoolean(row, column.is_effective, true),
      supersededByRewindEventId: readOptionalString(row, column.superseded_by_rewind_event_id),
      rewindEventId: readOptionalString(row, column.rewind_event_id),
      rewindClusterId: readOptionalString(row, column.rewind_cluster_id),
      rewindClassification: readOptionalString(row, column.rewind_classification) as RewindClassification,
      rewindConfidence: readOptionalString(row, column.rewind_confidence) as RewindConfidence,
      rewindImpactDirection: readOptionalString(row, column.rewind_impact_direction) as RewindImpactDirection,
      rewoundTimeS: readOptionalNumber(row, column.rewound_time_s),
      rewoundCourseDistanceM: readOptionalNumber(row, column.rewound_course_distance_m),
    };
  });

  const vehicle = readVehicleMetadata(rows.slice(1), column);
  const effectivePoints = points.filter((point) => point.isEffective);
  const timelinePoints = effectivePoints.length > 0 ? effectivePoints : points;
  const first = timelinePoints[0];
  const last = timelinePoints[timelinePoints.length - 1];
  const rewindEvents = points.filter((point) => point.rewindEventId !== "");
  const rewindClusters = buildRewindClusters(rewindEvents);
  return {
    fileName,
    sessionId: sessionIdFromFileName(fileName),
    vehicle,
    totalLapTimeS: last.lapTimeS - first.lapTimeS,
    points,
    effectivePoints,
    markers: points.filter((point) => point.manualMarkerId !== ""),
    rewindEvents,
    rewindClusters,
    rewindSummary: buildRewindSummary(rewindClusters),
    sectionSummaries: buildSectionSummaries(timelinePoints),
    channelAvailability: buildChannelAvailability(points),
  };
}

function buildChannelAvailability(points: ProjectedLapPoint[]): ProjectedLapChannelAvailability {
  return {
    speed: points.length > 0,
    throttle: points.some((point) => point.throttlePct !== null),
    brake: points.some((point) => point.brakePct !== null),
    steering: points.some((point) => point.steerNorm !== null),
  };
}
function buildSectionSummaries(points: ProjectedLapPoint[]): ProjectedLapSectionSummary[] {
  return SECTION_IDS.map((sectionId) => {
    const sectionPoints = points.filter((point) => point.sectionId === sectionId);
    if (sectionPoints.length === 0) {
      return {
        sectionId,
        startTimeS: 0,
        endTimeS: 0,
        elapsedTimeS: 0,
        sampleCount: 0,
      };
    }
    const startTimeS = sectionPoints[0].lapTimeS;
    const endTimeS = sectionPoints[sectionPoints.length - 1].lapTimeS;
    return {
      sectionId,
      startTimeS,
      endTimeS,
      elapsedTimeS: endTimeS - startTimeS,
      sampleCount: sectionPoints.length,
    };
  });
}

function buildRewindClusters(events: ProjectedLapPoint[]): RewindClusterPayload[] {
  const grouped = new Map<string, ProjectedLapPoint[]>();
  for (const event of events) {
    const key = event.rewindClusterId || event.rewindEventId;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.entries()].map(([clusterId, points]) => {
    const first = points[0];
    return {
      clusterId,
      sectionId: first.sectionId,
      courseDistanceM: average(points.map((point) => point.courseDistanceM)),
      eventCount: points.length,
      externalImpactSuspectedCount: points.filter((point) => point.rewindClassification === "external_impact_suspected").length,
      drivingErrorSuspectedCount: points.filter((point) => point.rewindClassification === "driving_error_suspected").length,
      undeterminedCount: points.filter((point) => point.rewindClassification === "undetermined").length,
      confidence: highestConfidence(points.map((point) => point.rewindConfidence)),
      impactDirection: first.rewindImpactDirection || "unknown",
      rewoundTimeS: sum(points.map((point) => point.rewoundTimeS ?? 0)),
      rewoundCourseDistanceM: sum(points.map((point) => point.rewoundCourseDistanceM ?? 0)),
      eventIds: points.map((point) => point.rewindEventId),
      points,
    };
  });
}

function buildRewindSummary(clusters: RewindClusterPayload[]): RewindSummaryPayload {
  const bySection = Object.fromEntries(SECTION_IDS.map((sectionId) => [sectionId, 0])) as Record<SectionId, number>;
  for (const cluster of clusters) {
    bySection[cluster.sectionId] += cluster.eventCount;
  }
  const practiceFocus = clusters
    .filter((cluster) => cluster.drivingErrorSuspectedCount > 0 && ["high", "medium"].includes(cluster.confidence))
    .sort((left, right) => right.drivingErrorSuspectedCount - left.drivingErrorSuspectedCount)
    .slice(0, 3);
  return {
    rewindCount: sum(clusters.map((cluster) => cluster.eventCount)),
    externalImpactSuspectedCount: sum(clusters.map((cluster) => cluster.externalImpactSuspectedCount)),
    drivingErrorSuspectedCount: sum(clusters.map((cluster) => cluster.drivingErrorSuspectedCount)),
    undeterminedCount: sum(clusters.map((cluster) => cluster.undeterminedCount)),
    bySection,
    practiceFocus,
  };
}

function readVehicleMetadata(rows: string[][], column: Record<string, number>): ProjectedLapVehicle {
  const displayName = firstNonEmpty(rows, column.vehicle_display_name);
  const filenameSlug = firstNonEmpty(rows, column.vehicle_filename_slug);
  const identificationSource = firstNonEmpty(rows, column.vehicle_identification_source);
  const catalogSha256 = firstNonEmpty(rows, column.vehicle_catalog_sha256);
  const carOrdinal = firstOptionalNumber(rows, column.vehicle_car_ordinal);
  const fallbackDisplayName = carOrdinal === undefined ? "Unknown vehicle" : `Car ${carOrdinal}`;
  const fallbackSlug = carOrdinal === undefined ? "unknown-vehicle" : `car-${carOrdinal}`;
  return {
    displayName: displayName || fallbackDisplayName,
    filenameSlug: filenameSlug || fallbackSlug,
    carOrdinal,
    identificationSource: identificationSource || (carOrdinal === undefined ? "unknown" : "ordinal_fallback"),
    catalogSha256: catalogSha256 || undefined,
  };
}

function firstNonEmpty(rows: string[][], columnIndex: number | undefined): string {
  if (columnIndex === undefined) {
    return "";
  }
  for (const row of rows) {
    const value = row[columnIndex]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function firstOptionalNumber(rows: string[][], columnIndex: number | undefined): number | undefined {
  const raw = firstNonEmpty(rows, columnIndex);
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function sessionIdFromFileName(fileName: string): string {
  const match = fileName.match(/^(\d{8}_\d{6})_/);
  return match?.[1] ?? "";
}

export function classificationLabel(classification: RewindClassification): string {
  if (classification === "external_impact_suspected") {
    return "External impact suspected";
  }
  if (classification === "driving_error_suspected") {
    return "Driving error suspected";
  }
  return "Undetermined";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);
  return rows.filter((parsedRow) => parsedRow.some((cell) => cell !== ""));
}

function readNumber(row: string[], columnIndex: number, rowIndex: number): number {
  const value = Number(row[columnIndex]);
  if (!Number.isFinite(value)) {
    throw new Error(`Projected lap row ${rowIndex + 2} contains a non-finite numeric value.`);
  }
  return value;
}

function readString(row: string[], columnIndex: number, rowIndex: number): string {
  const value = row[columnIndex];
  if (value === undefined) {
    throw new Error(`Projected lap row ${rowIndex + 2} is shorter than the header.`);
  }
  return value;
}

function readOptionalString(row: string[], columnIndex: number | undefined): string {
  if (columnIndex === undefined) {
    return "";
  }
  return row[columnIndex] ?? "";
}

function readOptionalBoolean(row: string[], columnIndex: number | undefined, defaultValue: boolean): boolean {
  if (columnIndex === undefined || row[columnIndex] === undefined || row[columnIndex] === "") {
    return defaultValue;
  }
  return row[columnIndex].toLowerCase() === "true";
}

function readOptionalNumber(row: string[], columnIndex: number | undefined): number | null {
  if (columnIndex === undefined || row[columnIndex] === undefined || row[columnIndex] === "") {
    return null;
  }
  const value = Number(row[columnIndex]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function highestConfidence(values: RewindConfidence[]): RewindConfidence {
  if (values.includes("high")) {
    return "high";
  }
  if (values.includes("medium")) {
    return "medium";
  }
  if (values.includes("low")) {
    return "low";
  }
  return "";
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}