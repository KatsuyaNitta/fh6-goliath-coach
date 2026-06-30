import * as THREE from "three";
import type { ReferencePointTuple } from "./reference";
import { POINT } from "./reference";
import { displayCoordinatesToRenderVector } from "./renderTransform";

export interface RenderBounds {
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  size: number;
}

export function referencePointToRenderVector(
  point: ReferencePointTuple,
  elevationScale: number,
  baselineDisplayY = 0,
): THREE.Vector3 {
  const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(
    point[POINT.displayX],
    point[POINT.displayY],
    point[POINT.displayZ],
    elevationScale,
    baselineDisplayY,
  );
  return new THREE.Vector3(renderX, renderY, renderZ);
}

export function referencePointsToRenderBounds(
  points: ReferencePointTuple[],
  elevationScale: number,
  baselineDisplayY = 0,
): RenderBounds {
  const box = new THREE.Box3();
  for (const point of points) {
    box.expandByPoint(referencePointToRenderVector(point, elevationScale, baselineDisplayY));
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    center: [center.x, center.y, center.z],
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    size: Math.max(size.x, size.y, size.z),
  };
}