import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  const source = await readFile(sourceUrl, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const directory = join(tmpdir(), `fh6-camera-orientation-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const { getCameraUpVector, getCanonical3DAnalysisCameraPosition } = await compileModule(
  new URL("../src/lib/cameraFraming.ts", import.meta.url),
  "cameraFraming.mjs",
);

const payload = JSON.parse(
  await readFile(new URL("../public/reference/goliath_reference.json", import.meta.url), "utf-8"),
);
const columns = Object.fromEntries(payload.point_columns.map((name, index) => [name, index]));
const baselineDisplayY = payload.coordinate_system.relative_elevation.baseline_display_y;

function renderPoint(point, elevationScale = 1) {
  return new THREE.Vector3(
    point[columns.display_x],
    (point[columns.display_y] - baselineDisplayY) * elevationScale,
    -point[columns.display_z],
  );
}
function nearestPoint(distanceM) {
  return payload.points.reduce((best, point) =>
    Math.abs(point[columns.course_distance_m] - distanceM) <
    Math.abs(best[columns.course_distance_m] - distanceM)
      ? point
      : best,
  payload.points[0]);
}

function overviewTarget(points, elevationScale = 1) {
  const weighted = new THREE.Vector3();
  let totalWeight = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const weight = Math.max(0, current[columns.course_distance_m] - previous[columns.course_distance_m]);
    if (weight <= 0) {
      continue;
    }
    const midpoint = renderPoint(previous, elevationScale).add(renderPoint(current, elevationScale)).multiplyScalar(0.5);
    weighted.add(midpoint.multiplyScalar(weight));
    totalWeight += weight;
  }
  return weighted.divideScalar(totalWeight);
}

const box = new THREE.Box3().setFromPoints(payload.points.map(renderPoint));
const center = new THREE.Vector3();
const sizeVector = new THREE.Vector3();
box.getCenter(center);
box.getSize(sizeVector);
const bounds = {
  center: [center.x, center.y, center.z],
  size: Math.max(sizeVector.x, sizeVector.y, sizeVector.z),
};

const target = overviewTarget(payload.points);
const targetTuple = [target.x, target.y, target.z];
const cameraPosition = getCanonical3DAnalysisCameraPosition(bounds, targetTuple);
assert.equal(cameraPosition[0], targetTuple[0]);
assert.equal(cameraPosition[2], targetTuple[2] + bounds.size * 0.9);
assert.notEqual(Math.round(targetTuple[0]), Math.round(bounds.center[0]), "overview target should not blindly use bounds center");
assert.notEqual(Math.round(targetTuple[2]), Math.round(bounds.center[2]), "overview target should not blindly use bounds center");
assert.ok(cameraPosition[2] > targetTuple[2], "3D camera must be on positive render-Z side of the overview target");
assert.ok(
  cameraPosition[2] - targetTuple[2] > cameraPosition[1] - targetTuple[1],
  "3D reset camera should use a low oblique turntable view",
);

const maximumElevationPoint = renderPoint(nearestPoint(payload.coordinate_system.relative_elevation.maximum_course_distance_m));
assert.notEqual(Math.round(target.x), Math.round(maximumElevationPoint.x), "overview target X should not collapse to maximum-elevation point");
assert.notEqual(Math.round(target.z), Math.round(maximumElevationPoint.z), "overview target Z should not collapse to maximum-elevation point");

const scaledTarget = overviewTarget(payload.points, 5);
assert.equal(Math.round(scaledTarget.x), Math.round(target.x), "elevation scaling must not move overview target X");
assert.equal(Math.round(scaledTarget.z), Math.round(target.z), "elevation scaling must not move overview target Z");

const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 200000);
camera.position.set(...cameraPosition);
camera.up.set(...getCameraUpVector("3d"));
camera.lookAt(...targetTuple);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);

const start = renderPoint(payload.points[0]).project(camera);
const finish = renderPoint(payload.points.at(-1)).project(camera);
const p2 = renderPoint(nearestPoint(31659.142)).project(camera);
const p3 = renderPoint(nearestPoint(42581.232)).project(camera);

function cameraDepth(point) {
  return renderPoint(point).applyMatrix4(camera.matrixWorldInverse).z;
}

const startDepth = cameraDepth(payload.points[0]);
const finishDepth = cameraDepth(payload.points.at(-1));
const p2Depth = cameraDepth(nearestPoint(31659.142));
const p3Depth = cameraDepth(nearestPoint(42581.232));

assert.deepEqual(getCameraUpVector("3d"), [0, 1, 0], "3D camera up must stay on world Y");
assert.ok(startDepth > p2Depth, "START should be closer than the S2 summit side");
assert.ok(finishDepth > p3Depth, "FINISH should be closer than the S3 summit side");
assert.ok(start.y < p2.y, "START should project nearer the foreground than P2");
assert.ok(finish.y < p3.y, "FINISH should project nearer the foreground than P3");

console.log("camera orientation smoke test passed");
