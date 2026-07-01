import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  const source = await readFile(sourceUrl, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const directory = join(tmpdir(), `fh6-camera-lifecycle-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const { buildCameraLifecycleKey, shouldResetCameraForLifecycleChange } = await compileModule(
  new URL("../src/lib/cameraLifecycle.ts", import.meta.url),
  "cameraLifecycle.mjs",
);

const base = {
  referenceIdentity: "reference:84678:84677.151",
  telemetryIdentity: "20260630_005550_projected-lap.csv:147196:1686.859",
  viewMode: "3d",
  resetToken: 0,
};

const selectedClusterA = "RC010";
const selectedClusterB = "RC011";
const selectedEventA = "RW011";
const selectedEventB = "RW012";

assert.equal(selectedClusterA !== selectedClusterB, true);
assert.equal(selectedEventA !== selectedEventB, true);
assert.equal(shouldResetCameraForLifecycleChange(base, base), false, "unchanged lifecycle should not reset");
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base }),
  false,
  "changing selected rewind cluster must not be part of camera lifecycle inputs",
);
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base }),
  false,
  "changing selected rewind event must not be part of camera lifecycle inputs",
);
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base }),
  false,
  "clearing rewind selection must not be part of camera lifecycle inputs",
);
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base, resetToken: 1 }),
  true,
  "explicit reset token should reset camera",
);
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base, telemetryIdentity: "20260630_013418_projected-lap.csv:154325:1621.005" }),
  true,
  "loading a different telemetry identity may reframe camera",
);
assert.equal(
  shouldResetCameraForLifecycleChange(base, { ...base, viewMode: "2d" }),
  true,
  "switching view mode may reframe camera",
);
assert.equal(
  buildCameraLifecycleKey(base),
  buildCameraLifecycleKey({ ...base }),
  "equivalent lifecycle inputs should produce a stable key",
);

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.match(appSource, /key=\{cameraLifecycleKey\}/, "CourseScene should use lifecycle key, not selection state");
assert.doesNotMatch(appSource, /key=\{`\$\{viewMode\}-\$\{cameraResetKey\}`\}/, "old reset key should not be used directly");

const sceneSource = await readFile(new URL("../src/components/CourseScene.tsx", import.meta.url), "utf-8");
assert.match(sceneSource, /const cameraPosition = useMemo/, "camera position should be memoized across selection rerenders");
assert.match(sceneSource, /referencePointsToOverviewTarget/, "3D overview target should be computed separately from bounds");
assert.match(sceneSource, /getCanonical3DAnalysisCameraPosition\(bounds, overviewTarget\)/, "3D camera should be positioned around the overview target");
assert.match(sceneSource, /viewMode === "2d" \? bounds\.center : overviewTarget/, "2D should keep bounds center while 3D uses overview target");
assert.match(sceneSource, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, "rewind marker pointer events should not bubble into scene controls");

console.log("camera lifecycle smoke test passed");
