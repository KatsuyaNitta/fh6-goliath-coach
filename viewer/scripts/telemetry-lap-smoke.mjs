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

  const directory = join(tmpdir(), `fh6-telemetry-lap-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const { parseProjectedLapCsv } = await compileModule(
  new URL("../src/lib/telemetryLap.ts", import.meta.url),
  "telemetryLap.mjs",
);

const csv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,reference_index,uncertain_mapping,position_x,position_y,position_z,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis",
  "10,0,0,0,S1,0.5,0,False,1,2,3,0,0,0,100,,False",
  "20,1,1,17630.242,S2,1.5,17630,False,1,2,3,10,1,20,120,P1,True",
  "30,2,2,31659.142,S3,2.5,31659,False,1,2,3,20,2,40,130,P2,True",
  "40,3,3,42581.232,S4,3.5,42581,False,1,2,3,30,3,60,140,P3,True",
  "50,4,4,60737.384,S5,4.5,60737,False,1,2,3,40,4,80,150,P4,True",
  "60,5,5,74188.316,S6,5.5,74188,False,1,2,3,50,5,100,160,P5,True",
].join("\n");

const payload = parseProjectedLapCsv(csv, "fixture-projected-lap.csv");

assert.equal(payload.fileName, "fixture-projected-lap.csv");
assert.equal(payload.points.length, 6);
assert.equal(payload.markers.length, 5);
assert.equal(payload.totalLapTimeS, 5);
assert.deepEqual(
  payload.sectionSummaries.map((section) => section.sectionId),
  ["S1", "S2", "S3", "S4", "S5", "S6"],
);
assert.equal(payload.sectionSummaries[1].sampleCount, 1);

console.log("telemetry lap loader smoke test passed");
