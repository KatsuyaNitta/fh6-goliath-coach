import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/renderTransform.ts", import.meta.url), "utf-8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const directory = join(tmpdir(), `fh6-relative-elevation-${Date.now()}`);
await mkdir(directory, { recursive: true });
const modulePath = join(directory, "renderTransform.mjs");
await writeFile(modulePath, compiled, "utf-8");

const {
  basePlaneRenderY,
  displayCoordinatesToRenderVector,
  getRelativeHeightM,
  getRenderedRelativeHeightY,
} = await import(`file:///${modulePath.replaceAll("\\", "/")}`);

const baselineDisplayY = -25;
assert.equal(getRelativeHeightM(baselineDisplayY, baselineDisplayY), 0);
assert.equal(getRenderedRelativeHeightY(baselineDisplayY + 100, baselineDisplayY, 1), 100);
assert.equal(getRenderedRelativeHeightY(baselineDisplayY + 100, baselineDisplayY, 2), 200);
assert.equal(getRenderedRelativeHeightY(baselineDisplayY + 100, baselineDisplayY, 3), 300);
assert.equal(getRenderedRelativeHeightY(baselineDisplayY + 100, baselineDisplayY, 5), 500);

const numericRelativeHeight = getRelativeHeightM(baselineDisplayY + 123.45, baselineDisplayY);
assert.equal(numericRelativeHeight, getRelativeHeightM(baselineDisplayY + 123.45, baselineDisplayY));
assert.equal(numericRelativeHeight, 123.45);

const referenceHeight = getRelativeHeightM(80, baselineDisplayY);
const telemetryHeight = getRelativeHeightM(90, baselineDisplayY);
assert.equal(referenceHeight, 105);
assert.equal(telemetryHeight, 115);

const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(12, baselineDisplayY + 100, 34, 3, baselineDisplayY);
assert.equal(renderX, 12);
assert.equal(renderY, 300);
assert.equal(renderZ, -34);
assert.equal(basePlaneRenderY(), 0);

console.log("relative elevation smoke test passed");