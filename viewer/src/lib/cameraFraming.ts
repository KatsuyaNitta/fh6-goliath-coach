import type { RenderBounds } from "./renderCoordinates";

export type CameraPositionTuple = [x: number, y: number, z: number];
export type CameraUpTuple = [x: number, y: number, z: number];

export function getCanonical3DAnalysisCameraPosition(bounds: RenderBounds): CameraPositionTuple {
  return [
    bounds.center[0],
    bounds.center[1] + bounds.size * 1.35,
    bounds.center[2] + bounds.size * 0.18,
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
  position: CameraPositionTuple,
  target: CameraPositionTuple,
  viewMode: "2d" | "3d",
): CameraUpTuple {
  if (viewMode === "2d") {
    return [0, 0, -1];
  }

  const forward: CameraPositionTuple = [
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ];
  const desiredScreenRight: CameraPositionTuple = [1, 0, 0];
  const up: CameraUpTuple = [
    desiredScreenRight[1] * forward[2] - desiredScreenRight[2] * forward[1],
    desiredScreenRight[2] * forward[0] - desiredScreenRight[0] * forward[2],
    desiredScreenRight[0] * forward[1] - desiredScreenRight[1] * forward[0],
  ];
  const length = Math.hypot(...up);
  return [up[0] / length, up[1] / length, up[2] / length];
}
