import * as THREE from "three";
import type {
  CourseColorMode,
  CourseGeometryPayload,
  CourseGeometryPointTuple,
} from "./courseGeometry";
import { GEOMETRY_POINT, nearestGeometryPoint } from "./courseGeometry";
import type { SectionId } from "./reference";
import { SECTION_COLORS } from "./reference";
import { UI_TEXT } from "./uiText";

export const GRADIENT_DISPLAY_THRESHOLD_PCT = 1.0;
export const CURVATURE_DISPLAY_THRESHOLD_1PM = 0.0015;
export const NEUTRAL_GEOMETRY_COLOR = "#59616c";
export const UNAVAILABLE_GEOMETRY_COLOR = "#2f3b4d";
export const GEOMETRY_BASE_COLOR = "#101722";
export const GEOMETRY_STRONG_BAND_THRESHOLD = 0.72;

export type GeometryDisplayBand = "unavailable" | "neutral" | "low" | "medium" | "strong";
export type GeometryDisplayDirection =
  | "unavailable"
  | "neutral"
  | "downhill"
  | "uphill"
  | "left"
  | "right";

export interface GeometryDisplaySample {
  band: GeometryDisplayBand;
  color: THREE.Color;
  direction: GeometryDisplayDirection;
  displayStrength: number;
}

export interface GeometryLegend {
  mode: CourseColorMode;
  labels: [string, string, string];
  colors: [string, string, string];
  note: string;
  helpText: string;
  unavailableColor: string;
}

export function referenceGeometryColor(
  mode: CourseColorMode,
  geometry: CourseGeometryPayload | null,
  pointIndex: number,
  sectionId: SectionId,
): THREE.Color {
  return referenceGeometryDisplaySample(mode, geometry, pointIndex, sectionId).color;
}

export function actualGeometryColor(
  mode: CourseColorMode,
  geometry: CourseGeometryPayload | null,
  courseDistanceM: number,
  sectionId: SectionId,
): THREE.Color {
  return actualGeometryDisplaySample(mode, geometry, courseDistanceM, sectionId).color;
}

export function referenceGeometryDisplaySample(
  mode: CourseColorMode,
  geometry: CourseGeometryPayload | null,
  pointIndex: number,
  sectionId: SectionId,
): GeometryDisplaySample {
  if (mode === "section") {
    return sectionDisplaySample(sectionId);
  }
  const point = geometry?.points[pointIndex];
  return geometryPointDisplaySample(mode, geometry, point);
}

export function actualGeometryDisplaySample(
  mode: CourseColorMode,
  geometry: CourseGeometryPayload | null,
  courseDistanceM: number,
  sectionId: SectionId,
): GeometryDisplaySample {
  if (mode === "section") {
    return sectionDisplaySample(sectionId);
  }
  const point = geometry ? nearestGeometryPoint(geometry, courseDistanceM) : undefined;
  return geometryPointDisplaySample(mode, geometry, point);
}

export function mutedColor(): THREE.Color {
  return new THREE.Color("#343b44");
}

export function geometryRunKey(sample: GeometryDisplaySample): string {
  return `${sample.direction}:${sample.band}`;
}

export function courseGeometryLegend(
  mode: CourseColorMode,
  _geometry: CourseGeometryPayload | null,
): GeometryLegend | null {
  if (mode === "section") {
    return null;
  }
  if (mode === "gradient") {
    return {
      mode,
      labels: [UI_TEXT.gradientLegendDownhill, UI_TEXT.gradientLegendFlat, UI_TEXT.gradientLegendUphill],
      colors: ["#1d4ed8", NEUTRAL_GEOMETRY_COLOR, "#ef4444"],
      note: UI_TEXT.geometryLegendStrengthNote,
      helpText: UI_TEXT.gradientLegendThresholdHelp,
      unavailableColor: UNAVAILABLE_GEOMETRY_COLOR,
    };
  }
  return {
    mode,
    labels: [UI_TEXT.curvatureLegendLeft, UI_TEXT.curvatureLegendStraight, UI_TEXT.curvatureLegendRight],
    colors: ["#9333ea", NEUTRAL_GEOMETRY_COLOR, "#16a34a"],
    note: UI_TEXT.geometryLegendStrengthNote,
    helpText: UI_TEXT.curvatureLegendThresholdHelp,
    unavailableColor: UNAVAILABLE_GEOMETRY_COLOR,
  };
}

export function displayStrengthFromValue(absValue: number, threshold: number, clampValue: number): number {
  if (!Number.isFinite(absValue) || absValue < threshold) {
    return 0;
  }
  if (!Number.isFinite(clampValue) || clampValue <= threshold) {
    return 1;
  }
  const raw = Math.min(1, Math.max(0, (absValue - threshold) / (clampValue - threshold)));
  return Math.sqrt(raw);
}

export function strengthBand(displayStrength: number): GeometryDisplayBand {
  if (displayStrength >= GEOMETRY_STRONG_BAND_THRESHOLD) {
    return "strong";
  }
  if (displayStrength >= 0.4) {
    return "medium";
  }
  return "low";
}

function sectionDisplaySample(sectionId: SectionId): GeometryDisplaySample {
  return {
    band: "strong",
    color: new THREE.Color(SECTION_COLORS[sectionId]),
    direction: "neutral",
    displayStrength: 1,
  };
}

function geometryPointDisplaySample(
  mode: CourseColorMode,
  geometry: CourseGeometryPayload | null,
  point: CourseGeometryPointTuple | undefined,
): GeometryDisplaySample {
  if (!geometry || !point) {
    return unavailableSample();
  }
  if (mode === "gradient") {
    const gradientPct = point[GEOMETRY_POINT.gradientPct];
    if (gradientPct === null || !Number.isFinite(gradientPct)) {
      return unavailableSample();
    }
    return directionalDisplaySample(
      gradientPct,
      GRADIENT_DISPLAY_THRESHOLD_PCT,
      geometry.display_scale.gradient_abs_clamp_pct,
      gradientPct < 0 ? "downhill" : "uphill",
      gradientPct < 0 ? "#38bdf8" : "#fb923c",
      gradientPct < 0 ? "#1d4ed8" : "#ef4444",
    );
  }
  const curvature = point[GEOMETRY_POINT.signedCurvature1pm];
  if (curvature === null || !Number.isFinite(curvature)) {
    return unavailableSample();
  }
  return directionalDisplaySample(
    curvature,
    CURVATURE_DISPLAY_THRESHOLD_1PM,
    geometry.display_scale.curvature_abs_clamp_1pm,
    curvature > 0 ? "left" : "right",
    curvature > 0 ? "#c084fc" : "#4ade80",
    curvature > 0 ? "#9333ea" : "#16a34a",
  );
}

function directionalDisplaySample(
  value: number,
  threshold: number,
  clampValue: number,
  direction: GeometryDisplayDirection,
  lowColor: string,
  highColor: string,
): GeometryDisplaySample {
  const absValue = Math.abs(value);
  if (!Number.isFinite(absValue)) {
    return unavailableSample();
  }
  if (absValue < threshold) {
    return {
      band: "neutral",
      color: new THREE.Color(NEUTRAL_GEOMETRY_COLOR),
      direction: "neutral",
      displayStrength: 0,
    };
  }
  const displayStrength = displayStrengthFromValue(absValue, threshold, clampValue);
  return {
    band: strengthBand(displayStrength),
    color: new THREE.Color(lowColor).lerp(new THREE.Color(highColor), displayStrength),
    direction,
    displayStrength,
  };
}

function unavailableSample(): GeometryDisplaySample {
  return {
    band: "unavailable",
    color: new THREE.Color(UNAVAILABLE_GEOMETRY_COLOR),
    direction: "unavailable",
    displayStrength: 0,
  };
}
