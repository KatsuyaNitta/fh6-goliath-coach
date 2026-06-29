import * as THREE from "three";
import type { ReferencePointTuple } from "./reference";
import { POINT } from "./reference";
import { displayCoordinatesToRenderVector } from "./renderTransform";

export interface RenderBounds {
  center: [number, number, number];
  size: number;
}

export function referencePointToRenderVector(
  point: ReferencePointTuple,
  elevationScale: number,
): THREE.Vector3 {
  const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(
    point[POINT.displayX],
    point[POINT.displayY],
    point[POINT.displayZ],
    elevationScale,
  );
  return new THREE.Vector3(renderX, renderY, renderZ);
}

export function referencePointsToRenderBounds(
  points: ReferencePointTuple[],
  elevationScale: number,
): RenderBounds {
  const box = new THREE.Box3();
  for (const point of points) {
    box.expandByPoint(referencePointToRenderVector(point, elevationScale));
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    center: [center.x, center.y, center.z],
    size: Math.max(size.x, size.y, size.z),
  };
}
