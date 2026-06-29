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

const { displayCoordinatesToRenderVector } = await import(`file:///${modulePath.replaceAll("\\", "/")}`);
const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(12.5, -3.25, 44.75, 5);

assert.equal(renderX, 12.5);
assert.equal(renderY, -16.25);
assert.equal(renderZ, -44.75);

console.log("render coordinate transform smoke test passed");
