import * as THREE from "three";
import type { ReferencePayload, ReferencePointTuple, SectionId } from "./reference";
import { pointSectionId } from "./reference";
import { referencePointToRenderVector, type RenderBounds } from "./renderCoordinates";

export type CameraPositionTuple = [x: number, y: number, z: number];

export interface SectionFocusCameraPreset {
  azimuthOffsetRad: number;
  polarAngleRad: number;
  distanceScale: number;
  targetBlendToOverview: number;
  targetOffsetRight?: number;
  targetOffsetUp?: number;
}

export interface SectionFocusCameraPose {
  position: CameraPositionTuple;
  target: CameraPositionTuple;
  azimuthRad: number;
  polarAngleRad: number;
  distance: number;
}

export interface SectionFocusCameraInputs {
  reference: ReferencePayload;
  sectionId: SectionId;
  elevationScale: number;
  baselineDisplayY: number;
  overviewTarget: CameraPositionTuple;
  fullBounds: RenderBounds;
  aspect: number;
}

export const SECTION_FOCUS_CAMERA_PRESETS: Record<SectionId, SectionFocusCameraPreset> = {
  S1: { azimuthOffsetRad: -0.42, polarAngleRad: 1.14, distanceScale: 1.02, targetBlendToOverview: 0.18 },
  S2: {
    azimuthOffsetRad: -1.75,
    polarAngleRad: 0.866,
    distanceScale: 0.65,
    targetBlendToOverview: 0.164,
    targetOffsetRight: -500,
    targetOffsetUp: 0,
  },
  S3: { azimuthOffsetRad: Math.PI + 0.34, polarAngleRad: 1.1, distanceScale: 1.02, targetBlendToOverview: 0.2 },
  S4: { azimuthOffsetRad: -0.16, polarAngleRad: 1.12, distanceScale: 1.08, targetBlendToOverview: 0.16 },
  S5: { azimuthOffsetRad: 0.58, polarAngleRad: 0.98, distanceScale: 1.02, targetBlendToOverview: 0.22 },
  S6: { azimuthOffsetRad: -0.54, polarAngleRad: 0.98, distanceScale: 1.02, targetBlendToOverview: 0.2 },
};

const FOCUS_CAMERA_FOV_DEG = 45;
const FULL_CONTEXT_FIT_MARGIN = 1.08;
const SELECTED_SECTION_FIT_MARGIN = 1.28;
const MIN_ASPECT = 0.35;

export function getSectionFocusCameraPose(inputs: SectionFocusCameraInputs): SectionFocusCameraPose | null {
  const preset = SECTION_FOCUS_CAMERA_PRESETS[inputs.sectionId];
  if (!preset || !Number.isFinite(inputs.aspect) || inputs.aspect <= 0) {
    return null;
  }

  const fullPoints = referenceToRenderPoints(inputs.reference.points, inputs.elevationScale, inputs.baselineDisplayY);
  const sectionPoints = referenceToRenderPoints(
    inputs.reference.points.filter((point) => pointSectionId(inputs.reference, point) === inputs.sectionId),
    inputs.elevationScale,
    inputs.baselineDisplayY,
  );
  if (fullPoints.length === 0 || sectionPoints.length === 0) {
    return null;
  }

  const sectionCentroid = centroid(sectionPoints);
  if (!isFiniteVector(sectionCentroid)) {
    return null;
  }

  const overviewTarget = new THREE.Vector3(...inputs.overviewTarget);
  const horizontalFromOverview = new THREE.Vector3(
    sectionCentroid.x - overviewTarget.x,
    0,
    sectionCentroid.z - overviewTarget.z,
  );
  if (horizontalFromOverview.lengthSq() <= 0.000001) {
    horizontalFromOverview.set(0, 0, 1);
  }
  horizontalFromOverview.normalize();
  horizontalFromOverview.applyAxisAngle(new THREE.Vector3(0, 1, 0), preset.azimuthOffsetRad);

  const polarAngle = clamp(preset.polarAngleRad, 0.55, Math.PI / 2 - 0.08);
  const sinPolar = Math.sin(polarAngle);
  const cosPolar = Math.cos(polarAngle);
  const forward = new THREE.Vector3(
    -horizontalFromOverview.x * sinPolar,
    -cosPolar,
    -horizontalFromOverview.z * sinPolar,
  ).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() <= 0.000001) {
    return null;
  }
  right.normalize();
  const cameraUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  const target = sectionCentroid
    .clone()
    .lerp(overviewTarget, preset.targetBlendToOverview)
    .addScaledVector(right, preset.targetOffsetRight ?? 0)
    .addScaledVector(cameraUp, preset.targetOffsetUp ?? 0);

  const aspect = Math.max(MIN_ASPECT, inputs.aspect);
  const fullContextDistance = perspectiveFitDistance(fullPoints, target, forward, right, cameraUp, aspect, FULL_CONTEXT_FIT_MARGIN);
  const sectionDistance = perspectiveFitDistance(sectionPoints, target, forward, right, cameraUp, aspect, SELECTED_SECTION_FIT_MARGIN);
  const minimumDistance = Math.max(1500, inputs.fullBounds.size * 0.18);
  const distance = Math.max(fullContextDistance, sectionDistance, minimumDistance) * preset.distanceScale;
  const position = target.clone().addScaledVector(forward, -distance);

  if (!isFiniteVector(position) || !isFiniteVector(target) || !Number.isFinite(distance) || distance <= 0) {
    return null;
  }

  return {
    position: vectorToTuple(position),
    target: vectorToTuple(target),
    azimuthRad: Math.atan2(horizontalFromOverview.x, horizontalFromOverview.z),
    polarAngleRad: polarAngle,
    distance,
  };
}

function referenceToRenderPoints(
  points: ReferencePointTuple[],
  elevationScale: number,
  baselineDisplayY: number,
): THREE.Vector3[] {
  return points
    .map((point) => referencePointToRenderVector(point, elevationScale, baselineDisplayY))
    .filter(isFiniteVector);
}

function perspectiveFitDistance(
  points: THREE.Vector3[],
  target: THREE.Vector3,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  cameraUp: THREE.Vector3,
  aspect: number,
  margin: number,
): number {
  const tanHalfFov = Math.tan((FOCUS_CAMERA_FOV_DEG * Math.PI / 180) / 2);
  let requiredDistance = 0;
  for (const point of points) {
    const relative = point.clone().sub(target);
    const forwardOffset = relative.dot(forward);
    requiredDistance = Math.max(
      requiredDistance,
      Math.abs(relative.dot(right)) / (tanHalfFov * aspect) - forwardOffset,
      Math.abs(relative.dot(cameraUp)) / tanHalfFov - forwardOffset,
    );
  }
  return Math.max(0, requiredDistance) * margin;
}

function centroid(points: THREE.Vector3[]): THREE.Vector3 {
  const total = new THREE.Vector3();
  for (const point of points) {
    total.add(point);
  }
  return total.divideScalar(points.length);
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function vectorToTuple(vector: THREE.Vector3): CameraPositionTuple {
  return [vector.x, vector.y, vector.z];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
