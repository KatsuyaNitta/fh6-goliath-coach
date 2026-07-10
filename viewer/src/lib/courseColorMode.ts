import * as THREE from "three";
import type {
  CourseColorMode,
  CourseGeometryPayload,
  CourseGeometryPointTuple,
  GeometryColorMode,
} from "./courseGeometry";
import { GEOMETRY_POINT, nearestGeometryPoint } from "./courseGeometry";
import {
  BRAKE_ACTIVE_THRESHOLD_PCT,
  FULL_THROTTLE_THRESHOLD_PCT,
  THROTTLE_OFF_THRESHOLD_PCT,
  classifyOperationState,
  type OperationState,
} from "./courseOperationMode";
import type { SectionId } from "./reference";
import { SECTION_COLORS } from "./reference";
import type { ProjectedLapPoint } from "./telemetryLap";
import { UI_TEXT } from "./uiText";
import { speedLegendValueLabel, speedUnitLabel, type SpeedDisplayUnit } from "./speedDisplay";

export const GRADIENT_DISPLAY_THRESHOLD_PCT = 1.0;
export const CURVATURE_DISPLAY_THRESHOLD_1PM = 0.0015;
export const NEUTRAL_GEOMETRY_COLOR = "#59616c";
export const UNAVAILABLE_GEOMETRY_COLOR = "#2f3b4d";
export const GEOMETRY_BASE_COLOR = "#101722";
export const GEOMETRY_STRONG_BAND_THRESHOLD = 0.72;

export const SPEED_COLOR_STOPS: Array<{ speedKmh: number; color: string }> = [
  { speedKmh: 0, color: "#1d4ed8" },
  { speedKmh: 80, color: "#06b6d4" },
  { speedKmh: 160, color: "#22c55e" },
  { speedKmh: 240, color: "#facc15" },
  { speedKmh: 300, color: "#f97316" },
  { speedKmh: 360, color: "#ef4444" },
];

export const OPERATION_COLORS: Record<OperationState, string> = {
  "simultaneous-input": "#d946ef",
  braking: "#dc2626",
  coast: "#f59e0b",
  "partial-throttle": "#14b8a6",
  "full-throttle": "#355843",
  unavailable: UNAVAILABLE_GEOMETRY_COLOR,
};

const BRAKE_LOW_COLOR = "#fb7185";
const PARTIAL_THROTTLE_LOW_COLOR = "#67e8f9";

export type GeometryDisplayBand = "unavailable" | "neutral" | "low" | "medium" | "strong";
export type GeometryDisplayDirection =
  | "unavailable"
  | "neutral"
  | "speed"
  | OperationState
  | "downhill"
  | "uphill"
  | "left"
  | "right";

export interface GeometryDisplaySample {
  band: GeometryDisplayBand;
  color: THREE.Color;
  direction: GeometryDisplayDirection;
  displayStrength: number;
  halo: boolean;
}

export interface CourseColorLegend {
  mode: Exclude<CourseColorMode, "section"> | Exclude<GeometryColorMode, "section">;
  labels: string[];
  colors: string[];
  note: string;
  helpText: string;
  unavailableColor: string;
}

export function referenceGeometryColor(
  mode: GeometryColorMode,
  geometry: CourseGeometryPayload | null,
  pointIndex: number,
  sectionId: SectionId,
): THREE.Color {
  return referenceGeometryDisplaySample(mode, geometry, pointIndex, sectionId).color;
}

export function actualGeometryColor(
  mode: GeometryColorMode,
  geometry: CourseGeometryPayload | null,
  courseDistanceM: number,
  sectionId: SectionId,
): THREE.Color {
  return actualGeometryDisplaySample(mode, geometry, courseDistanceM, sectionId).color;
}

export function referenceGeometryDisplaySample(
  mode: GeometryColorMode,
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
  mode: GeometryColorMode,
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

export function actualTelemetryDisplaySample(mode: CourseColorMode, point: ProjectedLapPoint): GeometryDisplaySample {
  if (mode === "speed") {
    return speedDisplaySample(point.speedKmh);
  }
  if (mode === "operation") {
    return operationDisplaySample(point.throttlePct, point.brakePct);
  }
  return sectionDisplaySample(point.sectionId);
}

export function speedDisplaySample(speedKmh: number | null | undefined): GeometryDisplaySample {
  if (speedKmh === null || speedKmh === undefined || !Number.isFinite(speedKmh)) {
    return unavailableSample();
  }
  const clamped = Math.min(360, Math.max(0, speedKmh));
  const displayStrength = clamped / 360;
  return {
    band: speedBand(displayStrength),
    color: speedColor(clamped),
    direction: "speed",
    displayStrength,
    halo: false,
  };
}

export function speedColor(speedKmh: number): THREE.Color {
  const clamped = Math.min(360, Math.max(0, speedKmh));
  let previous = SPEED_COLOR_STOPS[0];
  for (const stop of SPEED_COLOR_STOPS.slice(1)) {
    if (clamped <= stop.speedKmh) {
      const span = stop.speedKmh - previous.speedKmh;
      const fraction = span <= 0 ? 0 : (clamped - previous.speedKmh) / span;
      return new THREE.Color(previous.color).lerp(new THREE.Color(stop.color), fraction);
    }
    previous = stop;
  }
  return new THREE.Color(SPEED_COLOR_STOPS[SPEED_COLOR_STOPS.length - 1].color);
}

export function operationDisplaySample(
  throttlePct: number | null | undefined,
  brakePct: number | null | undefined,
): GeometryDisplaySample {
  const state = classifyOperationState(throttlePct, brakePct);
  if (state === "unavailable") {
    return unavailableSample();
  }
  if (state === "simultaneous-input") {
    return operationSample(state, OPERATION_COLORS[state], "strong", 1, true);
  }
  if (state === "braking") {
    const displayStrength = Math.sqrt(clamp01((brakePct ?? 0) / 100));
    return operationSample(
      state,
      new THREE.Color(BRAKE_LOW_COLOR).lerp(new THREE.Color(OPERATION_COLORS.braking), displayStrength),
      "strong",
      displayStrength,
      true,
    );
  }
  if (state === "coast") {
    return operationSample(state, OPERATION_COLORS.coast, "medium", 0.58, false);
  }
  if (state === "partial-throttle") {
    const displayStrength = clamp01(((throttlePct ?? 0) - THROTTLE_OFF_THRESHOLD_PCT) /
      (FULL_THROTTLE_THRESHOLD_PCT - THROTTLE_OFF_THRESHOLD_PCT));
    return operationSample(
      state,
      new THREE.Color(PARTIAL_THROTTLE_LOW_COLOR).lerp(new THREE.Color(OPERATION_COLORS["partial-throttle"]), displayStrength),
      "medium",
      displayStrength,
      false,
    );
  }
  return operationSample(state, OPERATION_COLORS["full-throttle"], "neutral", 0.18, false);
}

export function mutedColor(): THREE.Color {
  return new THREE.Color("#343b44");
}

export function geometryRunKey(sample: GeometryDisplaySample): string {
  return `${sample.direction}:${sample.band}:${sample.halo ? "halo" : "plain"}`;
}

export function courseColorLegend(mode: CourseColorMode, speedDisplayUnit: SpeedDisplayUnit = "kmh"): CourseColorLegend | null {
  if (mode === "section") {
    return null;
  }
  if (mode === "speed") {
    return {
      mode,
      labels: SPEED_COLOR_STOPS.map((stop) => speedLegendValueLabel(stop.speedKmh, speedDisplayUnit)),
      colors: SPEED_COLOR_STOPS.map((stop) => stop.color),
      note: UI_TEXT.speedLegendNote,
      helpText: speedDisplayUnit === "hirosue"
        ? `速度 (${speedUnitLabel(speedDisplayUnit)}) は表示単位のみの切り替えです。色判定は従来どおり km/h の固定スケールです。`
        : UI_TEXT.speedLegendHelp,
      unavailableColor: UNAVAILABLE_GEOMETRY_COLOR,
    };
  }
  return {
    mode,
    labels: [
      UI_TEXT.operationBraking,
      UI_TEXT.operationCoast,
      UI_TEXT.operationPartialThrottle,
      UI_TEXT.operationFullThrottle,
      UI_TEXT.operationSimultaneousInput,
      UI_TEXT.operationUnavailable,
    ],
    colors: [
      OPERATION_COLORS.braking,
      OPERATION_COLORS.coast,
      OPERATION_COLORS["partial-throttle"],
      OPERATION_COLORS["full-throttle"],
      OPERATION_COLORS["simultaneous-input"],
      OPERATION_COLORS.unavailable,
    ],
    note: UI_TEXT.operationLegendNote,
    helpText: UI_TEXT.operationLegendHelp,
    unavailableColor: UNAVAILABLE_GEOMETRY_COLOR,
  };
}

export function courseGeometryLegend(
  mode: GeometryColorMode,
  _geometry: CourseGeometryPayload | null,
): CourseColorLegend | null {
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

function speedBand(displayStrength: number): GeometryDisplayBand {
  if (displayStrength >= 0.82) {
    return "strong";
  }
  if (displayStrength >= 0.38) {
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
    halo: true,
  };
}

function geometryPointDisplaySample(
  mode: Exclude<GeometryColorMode, "section">,
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
      halo: false,
    };
  }
  const displayStrength = displayStrengthFromValue(absValue, threshold, clampValue);
  return {
    band: strengthBand(displayStrength),
    color: new THREE.Color(lowColor).lerp(new THREE.Color(highColor), displayStrength),
    direction,
    displayStrength,
    halo: true,
  };
}

function operationSample(
  state: Exclude<OperationState, "unavailable">,
  color: string | THREE.Color,
  band: GeometryDisplayBand,
  displayStrength: number,
  halo: boolean,
): GeometryDisplaySample {
  return {
    band,
    color: typeof color === "string" ? new THREE.Color(color) : color,
    direction: state,
    displayStrength,
    halo,
  };
}

function unavailableSample(): GeometryDisplaySample {
  return {
    band: "unavailable",
    color: new THREE.Color(UNAVAILABLE_GEOMETRY_COLOR),
    direction: "unavailable",
    displayStrength: 0,
    halo: false,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export {
  BRAKE_ACTIVE_THRESHOLD_PCT,
  FULL_THROTTLE_THRESHOLD_PCT,
  THROTTLE_OFF_THRESHOLD_PCT,
  classifyOperationState,
};
