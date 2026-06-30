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

const { classificationLabel, parseProjectedLapCsv } = await compileModule(
  new URL("../src/lib/telemetryLap.ts", import.meta.url),
  "telemetryLap.mjs",
);

const oldCsv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,reference_index,uncertain_mapping,position_x,position_y,position_z,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis",
  "10,0,0,0,S1,0.5,0,False,1,2,3,0,0,0,100,,False",
  "20,1,1,17630.242,S2,1.5,17630,False,1,2,3,10,1,20,120,P1,True",
  "30,2,2,31659.142,S3,2.5,31659,False,1,2,3,20,2,40,130,P2,True",
  "40,3,3,42581.232,S4,3.5,42581,False,1,2,3,30,3,60,140,P3,True",
  "50,4,4,60737.384,S5,4.5,60737,False,1,2,3,40,4,80,150,P4,True",
  "60,5,5,74188.316,S6,5.5,74188,False,1,2,3,50,5,100,160,P5,True",
].join("\n");

const oldPayload = parseProjectedLapCsv(oldCsv, "fixture-projected-lap.csv");
assert.equal(oldPayload.fileName, "fixture-projected-lap.csv");
assert.equal(oldPayload.points.length, 6);
assert.equal(oldPayload.effectivePoints.length, 6);
assert.equal(oldPayload.markers.length, 5);
assert.equal(oldPayload.rewindEvents.length, 0);
assert.equal(oldPayload.totalLapTimeS, 5);
assert.equal(oldPayload.vehicle.displayName, "Unknown vehicle");
assert.equal(oldPayload.vehicle.identificationSource, "unknown");
assert.deepEqual(oldPayload.sectionSummaries.map((section) => section.sectionId), ["S1", "S2", "S3", "S4", "S5", "S6"]);

const rewindCsv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,reference_index,uncertain_mapping,position_x,position_y,position_z,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis,is_effective,superseded_by_rewind_event_id,rewind_event_id,rewind_cluster_id,rewind_classification,rewind_confidence,rewind_impact_direction,rewound_time_s,rewound_course_distance_m",
  "10,0,0,0,S1,0.5,0,False,1,2,3,0,0,0,100,,False,True,,,,,,,,",
  "20,1,1,1000,S1,1.5,1000,False,1,2,3,10,1,20,120,,False,False,RW001,RW001,RC001,driving_error_suspected,medium,left,4.2,300",
  "30,2,2,1200,S1,1.5,1200,False,1,2,3,20,1,30,125,,False,True,,,,,,,,",
  "40,3,3,2000,S2,1.5,2000,False,1,2,3,30,1,40,130,,False,True,,,,,,,,",
].join("\n");
const payload = parseProjectedLapCsv(rewindCsv, "20260630_005550_2020-lamborghini-essenza-scv12_projected-lap.csv");
assert.equal(payload.sessionId, "20260630_005550");
assert.equal(payload.points.length, 4);
assert.equal(payload.effectivePoints.length, 3);
assert.equal(payload.rewindEvents.length, 1);
assert.equal(payload.rewindClusters.length, 1);
assert.equal(payload.rewindClusters[0].eventCount, 1);
assert.equal(payload.rewindSummary.rewindCount, 1);
assert.equal(payload.rewindSummary.drivingErrorSuspectedCount, 1);
assert.equal(payload.sectionSummaries[0].sampleCount, 2);
assert.equal(classificationLabel("external_impact_suspected"), "External impact suspected");
assert.equal(classificationLabel("driving_error_suspected"), "Driving error suspected");
assert.equal(classificationLabel("undetermined"), "Undetermined");



const vehicleCsv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis,is_effective,rewind_event_id,rewind_cluster_id,rewind_classification,rewind_confidence,rewind_impact_direction,rewound_time_s,rewound_course_distance_m,vehicle_display_name,vehicle_filename_slug,vehicle_car_ordinal,vehicle_identification_source,vehicle_catalog_sha256",
  "1,0,0,0,S1,0.1,0,0,0,100,,False,True,,,,,,,,2020 Lamborghini Essenza SCV12,2020-lamborghini-essenza-scv12,3606,community_catalog,abc123",
  "2,1,1,10,S1,0.1,1,0,1,101,,False,False,RW001,RC001,driving_error_suspected,medium,left,1.5,120,,,,,",
  "3,2,2,20,S1,0.1,2,0,2,102,,False,True,,,,,,,,,,,,",
].join("\n");
const vehiclePayload = parseProjectedLapCsv(vehicleCsv, "20260630_005550_2020-lamborghini-essenza-scv12_projected-lap.csv");
assert.equal(vehiclePayload.vehicle.displayName, "2020 Lamborghini Essenza SCV12");
assert.equal(vehiclePayload.vehicle.filenameSlug, "2020-lamborghini-essenza-scv12");
assert.equal(vehiclePayload.vehicle.carOrdinal, 3606);
assert.equal(vehiclePayload.vehicle.identificationSource, "community_catalog");
assert.equal(vehiclePayload.vehicle.catalogSha256, "abc123");
assert.equal(vehiclePayload.rewindEvents.length, 1);
assert.equal(vehiclePayload.effectivePoints.length, 2);

const ordinalOnlyCsv = vehicleCsv.replace("2020 Lamborghini Essenza SCV12,2020-lamborghini-essenza-scv12,3606,community_catalog,abc123", ",,3606,,");
const ordinalOnlyPayload = parseProjectedLapCsv(ordinalOnlyCsv, "car-3606_projected-lap.csv");
assert.equal(ordinalOnlyPayload.vehicle.displayName, "Car 3606");
assert.equal(ordinalOnlyPayload.vehicle.filenameSlug, "car-3606");
assert.equal(ordinalOnlyPayload.vehicle.identificationSource, "ordinal_fallback");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.match(appSource, /const \[elevationScale, setElevationScale\] = useState\(5\)/, "elevation scale should default to 5x");
assert.match(appSource, /<dt>Vehicle<\/dt>/, "Telemetry Overlay should show a vehicle row");
assert.match(appSource, /projectedLap\.vehicle\.displayName/, "Telemetry Overlay should display vehicle metadata from the CSV");
assert.match(appSource, /className="vehicle-name"/, "vehicle names should have wrapping-friendly styling hook");
assert.match(appSource, /const \[showRewinds, setShowRewinds\] = useState\(true\)/, "rewind toggle state should start enabled");
assert.match(appSource, /setShowRewinds\(parsed\.rewindClusters\.length > 0\)/, "rewind toggle should default on only when data exists");
assert.match(appSource, /checked=\{showReference\}[\s\S]*setShowReference\(event\.target\.checked\)/, "reference visibility should keep its own control");
assert.match(appSource, /checked=\{showActual\}[\s\S]*setShowActual\(event\.target\.checked\)/, "actual visibility should keep its own control");
assert.match(appSource, /checked=\{showRewinds\}[\s\S]*setShowRewinds\(event\.target\.checked\)/, "rewind visibility should keep its own control");
console.log("telemetry lap loader smoke test passed");