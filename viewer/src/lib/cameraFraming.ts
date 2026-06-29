import type { RenderBounds } from "./renderCoordinates";

export type CameraPositionTuple = [x: number, y: number, z: number];
export type CameraUpTuple = [x: number, y: number, z: number];

export function getCanonical3DAnalysisCameraPosition(bounds: RenderBounds): CameraPositionTuple {
  return [
    bounds.center[0],
    bounds.center[1] + bounds.size * 0.36,
    bounds.center[2] + bounds.size * 0.9,
  ];
}

export function getTopDownCameraPosition(bounds: RenderBounds): CameraPositionTuple {
  return [
    bounds.center[0],
    bounds.center[1] + bounds.size * 1.35,
    bounds.center[2],
  ];
}

export function getCameraUpVector(
  viewMode: "2d" | "3d",
): CameraUpTuple {
  if (viewMode === "2d") {
    return [0, 0, -1];
  }

  return [0, 1, 0];
}
