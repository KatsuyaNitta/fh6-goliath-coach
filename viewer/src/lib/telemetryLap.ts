import type { SectionId } from "./reference";

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
  manualMarkerId: string;
  excludeFromDrivingAnalysis: boolean;
}

export interface ProjectedLapSectionSummary {
  sectionId: SectionId;
  startTimeS: number;
  endTimeS: number;
  elapsedTimeS: number;
  sampleCount: number;
}

export interface ProjectedLapPayload {
  fileName: string;
  totalLapTimeS: number;
  points: ProjectedLapPoint[];
  markers: ProjectedLapPoint[];
  sectionSummaries: ProjectedLapSectionSummary[];
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
    if (!["S1", "S2", "S3", "S4", "S5", "S6"].includes(sectionId)) {
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
      manualMarkerId: readString(row, column.manual_marker_id, index),
      excludeFromDrivingAnalysis: readString(row, column.exclude_from_driving_analysis, index).toLowerCase() === "true",
    };
  });

  const first = points[0];
  const last = points[points.length - 1];
  return {
    fileName,
    totalLapTimeS: last.lapTimeS - first.lapTimeS,
    points,
    markers: points.filter((point) => point.manualMarkerId !== ""),
    sectionSummaries: buildSectionSummaries(points),
  };
}

function buildSectionSummaries(points: ProjectedLapPoint[]): ProjectedLapSectionSummary[] {
  return (["S1", "S2", "S3", "S4", "S5", "S6"] as SectionId[]).map((sectionId) => {
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
