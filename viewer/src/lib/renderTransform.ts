export type RenderVectorTuple = [renderX: number, renderY: number, renderZ: number];

export interface RelativeElevationMetadata {
  baseline_display_y: number;
}

export function getRelativeHeightM(displayY: number, baselineDisplayY: number): number {
  return displayY - baselineDisplayY;
}

export function getRenderedRelativeHeightY(
  displayY: number,
  baselineDisplayY: number,
  elevationScale: number,
): number {
  return getRelativeHeightM(displayY, baselineDisplayY) * elevationScale;
}

export function displayCoordinatesToRenderVector(
  displayX: number,
  displayY: number,
  displayZ: number,
  elevationScale: number,
  baselineDisplayY = 0,
): RenderVectorTuple {
  return [displayX, getRenderedRelativeHeightY(displayY, baselineDisplayY, elevationScale), -displayZ];
}

export function basePlaneRenderY(): number {
  return 0;
}