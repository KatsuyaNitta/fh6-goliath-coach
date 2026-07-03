export type TelemetryCalloutPlacement = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface TelemetryCalloutRoutePoint {
  x: number;
  y: number;
}

export interface TelemetryCalloutPlacementInput {
  anchorX: number;
  anchorY: number;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  previousPlacement?: TelemetryCalloutPlacement | null;
  routePoints?: TelemetryCalloutRoutePoint[];
  insetPx?: number;
  verticalGapPx?: number;
  horizontalGapPx?: number;
  hysteresisPx?: number;
  routeClearancePx?: number;
  switchThreshold?: number;
  denseOverlapThreshold?: number;
  denseVerticalGapPx?: number;
}

export interface TelemetryCalloutPlacementResult {
  placement: TelemetryCalloutPlacement;
  offsetX: number;
  offsetY: number;
  leaderOffsetX: number;
  leaderOffsetY: number;
  routeOverlapCount: number;
  routeSampleCount: number;
  denseFallback: boolean;
}

export const DEFAULT_TELEMETRY_CALLOUT_PLACEMENT: TelemetryCalloutPlacement = "top-right";
export const TELEMETRY_CALLOUT_PLACEMENT_ORDER: TelemetryCalloutPlacement[] = [
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
];
export const CARD_VERTICAL_GAP_PX = 44;
export const CARD_HORIZONTAL_GAP_PX = 28;
export const LEADER_MIN_LENGTH_PX = 24;
export const VIEWPORT_INSET_PX = 12;
export const PLACEMENT_HYSTERESIS_PX = 24;
export const ROUTE_CLEARANCE_PX = 10;
export const ROUTE_POINT_OVERLAP_WEIGHT = 1;
export const OUT_OF_VIEWPORT_PENALTY = 1_000_000;
export const BOTTOM_PLACEMENT_PENALTY = 3;
export const PLACEMENT_SWITCH_PENALTY = 8;
export const PLACEMENT_SWITCH_THRESHOLD = 7;
export const DENSE_ROUTE_OVERLAP_THRESHOLD = 12;
export const DENSE_VERTICAL_GAP_PX = 64;

interface PlacementCandidate {
  placement: TelemetryCalloutPlacement;
  offsetX: number;
  offsetY: number;
  leaderOffsetX: number;
  leaderOffsetY: number;
  rect: TelemetryCalloutRect;
  fits: boolean;
  routeOverlapCount: number;
  score: number;
}

interface TelemetryCalloutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function chooseTelemetryCalloutPlacement({
  anchorX,
  anchorY,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
  previousPlacement,
  routePoints = [],
  insetPx = VIEWPORT_INSET_PX,
  verticalGapPx = CARD_VERTICAL_GAP_PX,
  horizontalGapPx = CARD_HORIZONTAL_GAP_PX,
  hysteresisPx = PLACEMENT_HYSTERESIS_PX,
  routeClearancePx = ROUTE_CLEARANCE_PX,
  switchThreshold = PLACEMENT_SWITCH_THRESHOLD,
  denseOverlapThreshold = DENSE_ROUTE_OVERLAP_THRESHOLD,
  denseVerticalGapPx = DENSE_VERTICAL_GAP_PX,
}: TelemetryCalloutPlacementInput): TelemetryCalloutPlacementResult {
  const candidates = scoreCandidates({
    anchorX,
    anchorY,
    cardWidth,
    cardHeight,
    viewportWidth,
    viewportHeight,
    previousPlacement,
    routePoints,
    insetPx,
    verticalGapPx,
    horizontalGapPx,
    routeClearancePx,
  });
  let selected = selectStableCandidate(candidates, previousPlacement, switchThreshold);
  let denseFallback = false;

  if (selected.routeOverlapCount >= denseOverlapThreshold && denseVerticalGapPx > verticalGapPx) {
    const denseCandidates = scoreCandidates({
      anchorX,
      anchorY,
      cardWidth,
      cardHeight,
      viewportWidth,
      viewportHeight,
      previousPlacement,
      routePoints,
      insetPx,
      verticalGapPx: denseVerticalGapPx,
      horizontalGapPx,
      routeClearancePx,
    });
    const denseSelected = selectStableCandidate(denseCandidates, previousPlacement, switchThreshold);
    if (denseSelected.score + hysteresisPx < selected.score || denseSelected.routeOverlapCount < selected.routeOverlapCount) {
      selected = denseSelected;
      denseFallback = true;
    }
  }

  return {
    placement: selected.placement,
    offsetX: selected.offsetX,
    offsetY: selected.offsetY,
    leaderOffsetX: selected.leaderOffsetX,
    leaderOffsetY: selected.leaderOffsetY,
    routeOverlapCount: selected.routeOverlapCount,
    routeSampleCount: routePoints.length,
    denseFallback,
  };
}

function scoreCandidates({
  anchorX,
  anchorY,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
  previousPlacement,
  routePoints,
  insetPx,
  verticalGapPx,
  horizontalGapPx,
  routeClearancePx,
}: Required<Pick<
  TelemetryCalloutPlacementInput,
  | "anchorX"
  | "anchorY"
  | "cardWidth"
  | "cardHeight"
  | "viewportWidth"
  | "viewportHeight"
  | "routePoints"
  | "insetPx"
  | "verticalGapPx"
  | "horizontalGapPx"
  | "routeClearancePx"
>> & Pick<TelemetryCalloutPlacementInput, "previousPlacement">): PlacementCandidate[] {
  return TELEMETRY_CALLOUT_PLACEMENT_ORDER.map((placement, index) => {
    const offset = rawPlacementOffset(placement, cardWidth, cardHeight, verticalGapPx, horizontalGapPx);
    const rawLeft = anchorX + offset.offsetX;
    const rawTop = anchorY + offset.offsetY;
    const clampedLeft = clamp(rawLeft, insetPx, viewportWidth - insetPx - cardWidth);
    const clampedTop = clamp(rawTop, insetPx, viewportHeight - insetPx - cardHeight);
    const rect = {
      left: clampedLeft,
      top: clampedTop,
      right: clampedLeft + cardWidth,
      bottom: clampedTop + cardHeight,
    };
    const rawRect = {
      left: rawLeft,
      top: rawTop,
      right: rawLeft + cardWidth,
      bottom: rawTop + cardHeight,
    };
    const fits = rectFits(rawRect, viewportWidth, viewportHeight, insetPx);
    const routeOverlapCount = countRoutePointOverlap(rect, routePoints, routeClearancePx);
    const bottomPenalty = placement.startsWith("bottom") ? BOTTOM_PLACEMENT_PENALTY : 0;
    const switchPenalty = previousPlacement && placement !== previousPlacement ? PLACEMENT_SWITCH_PENALTY : 0;
    return {
      placement,
      offsetX: clampedLeft - anchorX,
      offsetY: clampedTop - anchorY,
      leaderOffsetX: leaderOffsetX(placement, cardWidth, clampedLeft - anchorX),
      leaderOffsetY: leaderOffsetY(placement, cardHeight, clampedTop - anchorY),
      rect,
      fits,
      routeOverlapCount,
      score: (fits ? 0 : OUT_OF_VIEWPORT_PENALTY) +
        routeOverlapCount * ROUTE_POINT_OVERLAP_WEIGHT +
        bottomPenalty +
        switchPenalty +
        index * 0.01,
    };
  });
}

function selectStableCandidate(
  candidates: PlacementCandidate[],
  previousPlacement: TelemetryCalloutPlacement | null | undefined,
  switchThreshold: number,
): PlacementCandidate {
  const sorted = [...candidates].sort((a, b) => a.score - b.score);
  const best = sorted[0];
  const current = previousPlacement ? candidates.find((candidate) => candidate.placement === previousPlacement) : null;
  if (
    current &&
    current.fits &&
    current.score <= best.score + switchThreshold
  ) {
    return current;
  }
  return best;
}

function rawPlacementOffset(
  placement: TelemetryCalloutPlacement,
  cardWidth: number,
  cardHeight: number,
  verticalGapPx: number,
  horizontalGapPx: number,
): { offsetX: number; offsetY: number } {
  const isLeft = placement.endsWith("left");
  const isBottom = placement.startsWith("bottom");
  return {
    offsetX: isLeft ? -(cardWidth + horizontalGapPx) : horizontalGapPx,
    offsetY: isBottom ? verticalGapPx : -(cardHeight + verticalGapPx),
  };
}

function leaderOffsetX(placement: TelemetryCalloutPlacement, cardWidth: number, offsetX: number): number {
  if (placement.endsWith("left")) {
    return offsetX + cardWidth;
  }
  return offsetX;
}

function leaderOffsetY(placement: TelemetryCalloutPlacement, cardHeight: number, offsetY: number): number {
  if (placement.startsWith("bottom")) {
    return offsetY;
  }
  return offsetY + cardHeight;
}

function rectFits(rect: TelemetryCalloutRect, viewportWidth: number, viewportHeight: number, insetPx: number): boolean {
  return (
    rect.left >= insetPx &&
    rect.top >= insetPx &&
    rect.right <= viewportWidth - insetPx &&
    rect.bottom <= viewportHeight - insetPx
  );
}

function countRoutePointOverlap(
  rect: TelemetryCalloutRect,
  routePoints: TelemetryCalloutRoutePoint[],
  clearancePx: number,
): number {
  if (routePoints.length === 0) {
    return 0;
  }
  const expanded = {
    left: rect.left - clearancePx,
    top: rect.top - clearancePx,
    right: rect.right + clearancePx,
    bottom: rect.bottom + clearancePx,
  };
  let count = 0;
  for (const point of routePoints) {
    if (point.x >= expanded.left && point.x <= expanded.right && point.y >= expanded.top && point.y <= expanded.bottom) {
      count += 1;
    }
  }
  return count;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
