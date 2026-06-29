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

function renderPoint(point) {
  return new THREE.Vector3(
    point[columns.display_x],
    point[columns.display_y],
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

const box = new THREE.Box3().setFromPoints(payload.points.map(renderPoint));
const center = new THREE.Vector3();
const sizeVector = new THREE.Vector3();
box.getCenter(center);
box.getSize(sizeVector);
const bounds = {
  center: [center.x, center.y, center.z],
  size: Math.max(sizeVector.x, sizeVector.y, sizeVector.z),
};

const cameraPosition = getCanonical3DAnalysisCameraPosition(bounds);
assert.equal(cameraPosition[0], bounds.center[0]);
assert.ok(cameraPosition[2] > bounds.center[2], "3D camera must be on positive render-Z side");
assert.ok(
  cameraPosition[1] - bounds.center[1] > cameraPosition[2] - bounds.center[2],
  "3D reset camera should be height-dominant so flattened orientation matches the reference map",
);

const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 200000);
camera.position.set(...cameraPosition);
camera.up.set(...getCameraUpVector(cameraPosition, bounds.center, "3d"));
camera.lookAt(...bounds.center);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);

const centerLineLeft = new THREE.Vector3(
  bounds.center[0] - bounds.size * 0.25,
  bounds.center[1] - 40,
  bounds.center[2],
).project(camera);
const centerLineRight = new THREE.Vector3(
  bounds.center[0] + bounds.size * 0.25,
  bounds.center[1] - 40,
  bounds.center[2],
).project(camera);
const projectedCenter = new THREE.Vector3(
  bounds.center[0],
  bounds.center[1] - 40,
  bounds.center[2],
).project(camera);
const mapUpProbe = new THREE.Vector3(
  bounds.center[0],
  bounds.center[1] - 40,
  bounds.center[2] - bounds.size * 0.25,
).project(camera);

const start = renderPoint(payload.points[0]).project(camera);
const p2 = renderPoint(nearestPoint(31659.142)).project(camera);
const p4 = renderPoint(nearestPoint(60737.384)).project(camera);

assert.ok(
  Math.abs(centerLineLeft.y - centerLineRight.y) < 1e-6,
  "Reset camera should project the center X reference line horizontally",
);
assert.ok(mapUpProbe.y > projectedCenter.y, "Original positive Z should project upward on screen");
assert.ok(start.x > 0, "START / FINISH should project to the right side");
assert.ok(start.y < 0, "START / FINISH should project to the lower area");
assert.ok(p2.y > 0, "P2 should project to the upper area");
assert.ok(p4.x < 0, "P4 should project to the left side");
assert.ok(p4.y < 0, "P4 should project to the lower-left area");

console.log("camera orientation smoke test passed");
