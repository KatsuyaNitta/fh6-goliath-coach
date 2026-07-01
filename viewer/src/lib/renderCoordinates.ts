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

export function referencePointsToOverviewTarget(
  points: ReferencePointTuple[],
  elevationScale: number,
  baselineDisplayY = 0,
): [number, number, number] {
  if (points.length === 0) {
    return [0, 0, 0];
  }
  if (points.length === 1) {
    const point = referencePointToRenderVector(points[0], elevationScale, baselineDisplayY);
    return [point.x, point.y, point.z];
  }

  const weighted = new THREE.Vector3();
  let totalWeight = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const weight = Math.max(0, current[POINT.courseDistanceM] - previous[POINT.courseDistanceM]);
    if (weight <= 0) {
      continue;
    }
    const previousVector = referencePointToRenderVector(previous, elevationScale, baselineDisplayY);
    const currentVector = referencePointToRenderVector(current, elevationScale, baselineDisplayY);
    weighted.add(previousVector.add(currentVector).multiplyScalar(0.5 * weight));
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    const fallback = referencePointToRenderVector(points[0], elevationScale, baselineDisplayY);
    return [fallback.x, fallback.y, fallback.z];
  }

  weighted.divideScalar(totalWeight);
  return [weighted.x, weighted.y, weighted.z];
}
