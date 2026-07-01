import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";
import ts from "typescript";

const directory = join(tmpdir(), `fh6-section-focus-camera-${Date.now()}-${Math.random()}`);
await mkdir(directory, { recursive: true });
const threeModuleUrl = pathToFileURL(fileURLToPath(new URL("../node_modules/three/build/three.module.js", import.meta.url))).href;
await compileLibModule("reference.ts");
await compileLibModule("renderTransform.ts");
await compileLibModule("renderCoordinates.ts");
await compileLibModule("sectionFocusCamera.ts");

const sectionFocusCamera = await import(pathToFileURL(join(directory, "sectionFocusCamera.mjs")).href);
const referencePayload = (await import("../public/reference/goliath_reference.json", { with: { type: "json" } })).default;
const { getSectionFocusCameraPose, SECTION_FOCUS_CAMERA_PRESETS } = sectionFocusCamera;

const sectionIds = ["S1", "S2", "S3", "S4", "S5", "S6"];
assert.deepEqual(Object.keys(SECTION_FOCUS_CAMERA_PRESETS), sectionIds);

const pointColumns = Object.fromEntries(referencePayload.point_columns.map((name, index) => [name, index]));
const baselineDisplayY = referencePayload.coordinate_system.relative_elevation.baseline_display_y;
const elevationScale = 5;
const points = referencePayload.points.map((point) => renderPoint(point, elevationScale));
const fullBounds = boundsFromPoints(points);
const overviewTarget = overviewTargetFromPoints(referencePayload.points, elevationScale);

for (const sectionId of sectionIds) {
  const pose = getSectionFocusCameraPose({
    reference: referencePayload,
    sectionId,
    elevationScale,
    baselineDisplayY,
    overviewTarget,
    fullBounds,
    aspect: 16 / 9,
  });
  assert.ok(pose, `${sectionId} should produce a focus pose`);
  assert.ok(pose.distance > 0, `${sectionId} distance should be positive`);
  assert.ok(pose.polarAngleRad > 0.5 && pose.polarAngleRad < Math.PI / 2, `${sectionId} polar angle should be safe`);
  assertFiniteTuple(pose.position, `${sectionId} position`);
  assertFiniteTuple(pose.target, `${sectionId} target`);
  assert.deepEqual(
    pose,
    getSectionFocusCameraPose({
      reference: referencePayload,
      sectionId,
      elevationScale,
      baselineDisplayY,
      overviewTarget,
      fullBounds,
      aspect: 16 / 9,
    }),
    `${sectionId} pose should be deterministic`,
  );
  assertSectionFits(sectionId, pose, 16 / 9, 0.96);
  assertSectionFits(sectionId, getSectionFocusCameraPose({
    reference: referencePayload,
    sectionId,
    elevationScale,
    baselineDisplayY,
    overviewTarget,
    fullBounds,
    aspect: 4 / 3,
  }), 4 / 3, 0.96);
  assertSectionFits(sectionId, getSectionFocusCameraPose({
    reference: referencePayload,
    sectionId,
    elevationScale,
    baselineDisplayY,
    overviewTarget,
    fullBounds,
    aspect: 9 / 16,
  }), 9 / 16, 0.98);
}

const scaledPose = getSectionFocusCameraPose({
  reference: referencePayload,
  sectionId: "S5",
  elevationScale: 3,
  baselineDisplayY,
  overviewTarget: overviewTargetFromPoints(referencePayload.points, 3),
  fullBounds: boundsFromPoints(referencePayload.points.map((point) => renderPoint(point, 3))),
  aspect: 16 / 9,
});
assert.ok(scaledPose, "elevation-scale changes should produce a valid focus pose");
assertFiniteTuple(scaledPose.position, "scaled position");

const emptyReference = {
  ...referencePayload,
  points: referencePayload.points.filter((point) => sectionForPoint(point) !== "S3"),
};
assert.equal(getSectionFocusCameraPose({
  reference: emptyReference,
  sectionId: "S3",
  elevationScale,
  baselineDisplayY,
  overviewTarget,
  fullBounds,
  aspect: 16 / 9,
}), null, "empty selected section should fail safely");
assert.equal(getSectionFocusCameraPose({
  reference: referencePayload,
  sectionId: "S9",
  elevationScale,
  baselineDisplayY,
  overviewTarget,
  fullBounds,
  aspect: 16 / 9,
}), null, "unknown section should fail safely");

function renderPoint(point, scale) {
  return new THREE.Vector3(
    point[pointColumns.display_x],
    (point[pointColumns.display_y] - baselineDisplayY) * scale,
    -point[pointColumns.display_z],
  );
}

function sectionForPoint(point) {
  const distance = point[pointColumns.course_distance_m];
  return referencePayload.sections.find((section) => (
    distance >= section.start_distance_m &&
    (distance < section.end_distance_m || section.id === "S6")
  ))?.id;
}

function boundsFromPoints(renderedPoints) {
  const box = new THREE.Box3().setFromPoints(renderedPoints);
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

function overviewTargetFromPoints(referencePoints, scale) {
  const weighted = new THREE.Vector3();
  let totalWeight = 0;
  for (let index = 1; index < referencePoints.length; index += 1) {
    const previous = referencePoints[index - 1];
    const current = referencePoints[index];
    const weight = Math.max(0, current[pointColumns.course_distance_m] - previous[pointColumns.course_distance_m]);
    if (weight <= 0) {
      continue;
    }
    weighted.add(renderPoint(previous, scale).add(renderPoint(current, scale)).multiplyScalar(0.5 * weight));
    totalWeight += weight;
  }
  weighted.divideScalar(totalWeight);
  return [weighted.x, weighted.y, weighted.z];
}

function assertSectionFits(sectionId, pose, aspect, limit) {
  assert.ok(pose, `${sectionId} pose should exist for aspect ${aspect}`);
  const camera = new THREE.PerspectiveCamera(45, aspect, 1, 200000);
  camera.position.set(...pose.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const sectionPoints = referencePayload.points
    .filter((point) => sectionForPoint(point) === sectionId)
    .map((point) => renderPoint(point, elevationScale));
  for (const point of sectionPoints) {
    const projected = point.clone().project(camera);
    assert.ok(Math.abs(projected.x) <= limit, `${sectionId} point should fit horizontally at aspect ${aspect}`);
    assert.ok(Math.abs(projected.y) <= limit, `${sectionId} point should fit vertically at aspect ${aspect}`);
  }
}

function assertFiniteTuple(tuple, label) {
  assert.equal(tuple.length, 3, `${label} should have three components`);
  for (const value of tuple) {
    assert.ok(Number.isFinite(value), `${label} should be finite`);
  }
}

console.log("section focus camera smoke test passed");

async function compileLibModule(filename) {
  const sourceUrl = new URL(`../src/lib/${filename}`, import.meta.url);
  const compiled = ts.transpileModule(await readFile(sourceUrl, "utf-8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
    .replaceAll('from "three"', `from "${threeModuleUrl}"`)
    .replaceAll('from "./reference"', 'from "./reference.mjs"')
    .replaceAll('from "./renderCoordinates"', 'from "./renderCoordinates.mjs"')
    .replaceAll('from "./renderTransform"', 'from "./renderTransform.mjs"');
  const outputPath = join(directory, `${filename.replace(/\.ts$/, "")}.mjs`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, compiled, "utf-8");
}
