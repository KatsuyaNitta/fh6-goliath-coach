import type { BoundaryMarker, SectionDefinition, SectionId } from "./reference";
import type { ProjectedLapPayload, ProjectedLapPoint } from "./telemetryLap";

export type TelemetryChannelId = "speed" | "throttle" | "brake" | "steering";
export type TelemetryRangeMode = "full" | "section";

export interface TelemetryChannelConfig {
  id: TelemetryChannelId;
  label: string;
  unit: string;
  description: string;
  fixedDomain?: [number, number];
}

export interface TelemetryChartRange {
  startM: number;
  endM: number;
}

export interface DecimatedTelemetryResult {
  points: ProjectedLapPoint[];
  rawCount: number;
  bucketCount: number;
}

export const TELEMETRY_CHANNELS: TelemetryChannelConfig[] = [
  { id: "speed", label: "Speed", unit: "km/h", description: "Speed" },
  { id: "throttle", label: "Throttle", unit: "%", description: "Source accel_pct", fixedDomain: [0, 100] },
  { id: "brake", label: "Brake", unit: "%", description: "Source brake_pct", fixedDomain: [0, 100] },
  { id: "steering", label: "Steering", unit: "normalized", description: "Normalized input (-1 to +1)", fixedDomain: [-1, 1] },
];

export function effectiveTelemetryPoints(payload: ProjectedLapPayload): ProjectedLapPoint[] {
  return payload.effectivePoints.length > 0 ? payload.effectivePoints : payload.points;
}

export function telemetryChannelValue(point: ProjectedLapPoint, channel: TelemetryChannelId): number | null {
  if (channel === "speed") {
    return point.speedKmh;
  }
  if (channel === "throttle") {
    return point.throttlePct;
  }
  if (channel === "brake") {
    return point.brakePct;
  }
  return point.steerNorm;
}

export function telemetryChannelAvailable(payload: ProjectedLapPayload, channel: TelemetryChannelId): boolean {
  if (channel === "speed") {
    return payload.channelAvailability.speed;
  }
  if (channel === "throttle") {
    return payload.channelAvailability.throttle;
  }
  if (channel === "brake") {
    return payload.channelAvailability.brake;
  }
  return payload.channelAvailability.steering;
}

export function telemetryRange(
  payload: ProjectedLapPayload,
  mode: TelemetryRangeMode,
  selectedSectionId: SectionId,
  sections: SectionDefinition[],
): TelemetryChartRange {
  const points = effectiveTelemetryPoints(payload);
  if (points.length === 0) {
    return { startM: 0, endM: 0 };
  }
  if (mode === "section") {
    const section = sections.find((candidate) => candidate.id === selectedSectionId);
    if (section) {
      return { startM: section.start_distance_m, endM: section.end_distance_m };
    }
  }
  return {
    startM: points[0].courseDistanceM,
    endM: points[points.length - 1].courseDistanceM,
  };
}

export function pointsInRange(points: ProjectedLapPoint[], range: TelemetryChartRange): ProjectedLapPoint[] {
  if (points.length === 0 || range.endM < range.startM) {
    return [];
  }
  const start = lowerBoundCourseDistance(points, range.startM);
  const end = upperBoundCourseDistance(points, range.endM);
  return points.slice(start, end);
}

export function nearestTelemetryPoint(points: ProjectedLapPoint[], distanceM: number): ProjectedLapPoint | null {
  if (points.length === 0) {
    return null;
  }
  const insert = lowerBoundCourseDistance(points, distanceM);
  if (insert <= 0) {
    return points[0];
  }
  if (insert >= points.length) {
    return points[points.length - 1];
  }
  const before = points[insert - 1];
  const after = points[insert];
  return Math.abs(before.courseDistanceM - distanceM) <= Math.abs(after.courseDistanceM - distanceM) ? before : after;
}

export function decimateTelemetryPoints(
  points: ProjectedLapPoint[],
  pixelWidth: number,
  channels: TelemetryChannelId[] = ["speed", "throttle", "brake", "steering"],
): DecimatedTelemetryResult {
  if (points.length <= 2) {
    return { points: [...points], rawCount: points.length, bucketCount: points.length };
  }
  const bucketCount = Math.max(1, Math.floor(Math.max(1, pixelWidth)));
  if (points.length <= bucketCount * 8) {
    return { points: [...points], rawCount: points.length, bucketCount };
  }
  const selected = new Set<number>();
  selected.add(0);
  selected.add(points.length - 1);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * points.length) / bucketCount);
    const end = Math.min(points.length, Math.floor(((bucket + 1) * points.length) / bucketCount));
    if (start >= end) {
      continue;
    }
    selected.add(start);
    selected.add(end - 1);
    for (const channel of channels) {
      addExtrema(selected, points, start, end, channel);
    }
  }
  return {
    points: [...selected].sort((left, right) => left - right).map((index) => points[index]),
    rawCount: points.length,
    bucketCount,
  };
}

export function visibleMarkers(markers: BoundaryMarker[], range: TelemetryChartRange): BoundaryMarker[] {
  return markers.filter((marker) => marker.course_distance_m >= range.startM && marker.course_distance_m <= range.endM);
}

export function visibleSections(sections: SectionDefinition[], range: TelemetryChartRange): SectionDefinition[] {
  return sections.filter((section) => section.end_distance_m >= range.startM && section.start_distance_m <= range.endM);
}

function addExtrema(
  selected: Set<number>,
  points: ProjectedLapPoint[],
  start: number,
  end: number,
  channel: TelemetryChannelId,
): void {
  let minIndex = -1;
  let maxIndex = -1;
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let index = start; index < end; index += 1) {
    const value = telemetryChannelValue(points[index], channel);
    if (value === null) {
      continue;
    }
    if (value < minValue) {
      minValue = value;
      minIndex = index;
    }
    if (value > maxValue) {
      maxValue = value;
      maxIndex = index;
    }
  }
  if (minIndex >= 0) {
    selected.add(minIndex);
  }
  if (maxIndex >= 0) {
    selected.add(maxIndex);
  }
}

function lowerBoundCourseDistance(points: ProjectedLapPoint[], distanceM: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].courseDistanceM < distanceM) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBoundCourseDistance(points: ProjectedLapPoint[], distanceM: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].courseDistanceM <= distanceM) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}