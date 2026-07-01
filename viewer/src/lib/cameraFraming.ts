import type { RenderBounds } from "./renderCoordinates";

export type CameraPositionTuple = [x: number, y: number, z: number];
export type CameraUpTuple = [x: number, y: number, z: number];

const OVERVIEW_CAMERA_FOV_DEG = 45;
const OVERVIEW_FIT_ASPECT = 4 / 3;
const OVERVIEW_FIT_MARGIN = 1.18;
const OVERVIEW_CAMERA_VERTICAL_RATIO = 0.36;
const OVERVIEW_CAMERA_DEPTH_RATIO = 0.9;

export function getCanonical3DAnalysisCameraPosition(
  bounds: RenderBounds,
  target: CameraPositionTuple = bounds.center,
): CameraPositionTuple {
  const distance = overviewFitDistance(bounds, target);
  const offsetLength = Math.hypot(OVERVIEW_CAMERA_VERTICAL_RATIO, OVERVIEW_CAMERA_DEPTH_RATIO);
  const vertical = (OVERVIEW_CAMERA_VERTICAL_RATIO / offsetLength) * distance;
  const depth = (OVERVIEW_CAMERA_DEPTH_RATIO / offsetLength) * distance;
  return [
    target[0],
    target[1] + vertical,
    target[2] + depth,
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

function overviewFitDistance(
  bounds: RenderBounds,
  target: CameraPositionTuple,
): number {
  const tanHalfFov = Math.tan((OVERVIEW_CAMERA_FOV_DEG * Math.PI / 180) / 2);
  const directionLength = Math.hypot(OVERVIEW_CAMERA_VERTICAL_RATIO, OVERVIEW_CAMERA_DEPTH_RATIO);
  const forward: CameraPositionTuple = [
    0,
    -OVERVIEW_CAMERA_VERTICAL_RATIO / directionLength,
    -OVERVIEW_CAMERA_DEPTH_RATIO / directionLength,
  ];
  const right: CameraPositionTuple = [1, 0, 0];
  const cameraUp: CameraPositionTuple = [
    0,
    OVERVIEW_CAMERA_DEPTH_RATIO / directionLength,
    -OVERVIEW_CAMERA_VERTICAL_RATIO / directionLength,
  ];
  let requiredDistance = bounds.size * directionLength;

  for (const corner of renderBoundsCorners(bounds)) {
    const relative: CameraPositionTuple = [
      corner[0] - target[0],
      corner[1] - target[1],
      corner[2] - target[2],
    ];
    const forwardOffset = dot(relative, forward);
    requiredDistance = Math.max(
      requiredDistance,
      Math.abs(dot(relative, right)) / (tanHalfFov * OVERVIEW_FIT_ASPECT) - forwardOffset,
      Math.abs(dot(relative, cameraUp)) / tanHalfFov - forwardOffset,
    );
  }

  return Math.max(requiredDistance * OVERVIEW_FIT_MARGIN, bounds.size * directionLength);
}

function renderBoundsCorners(bounds: RenderBounds): CameraPositionTuple[] {
  return [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ];
}

function dot(left: CameraPositionTuple, right: CameraPositionTuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
