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

const directory = join(tmpdir(), `fh6-render-transform-${Date.now()}`);
await mkdir(directory, { recursive: true });
const modulePath = join(directory, "renderTransform.mjs");
await writeFile(modulePath, compiled, "utf-8");

const {
  basePlaneRenderY,
  displayCoordinatesToRenderVector,
  getRelativeHeightM,
  getRenderedRelativeHeightY,
} = await import(`file:///${modulePath.replaceAll("\\", "/")}`);

const baselineDisplayY = -42.5;
const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(12.5, 57.5, 44.75, 5, baselineDisplayY);

assert.equal(renderX, 12.5);
assert.equal(renderY, 500);
assert.equal(renderZ, -44.75);
assert.equal(getRelativeHeightM(baselineDisplayY, baselineDisplayY), 0);
assert.equal(getRenderedRelativeHeightY(baselineDisplayY + 100, baselineDisplayY, 1), 100);
assert.equal(basePlaneRenderY(), 0);

console.log("render coordinate transform smoke test passed");