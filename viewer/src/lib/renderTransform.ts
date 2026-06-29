export type RenderVectorTuple = [renderX: number, renderY: number, renderZ: number];

export function displayCoordinatesToRenderVector(
  displayX: number,
  displayY: number,
  displayZ: number,
  elevationScale: number,
): RenderVectorTuple {
  return [displayX, displayY * elevationScale, -displayZ];
}
