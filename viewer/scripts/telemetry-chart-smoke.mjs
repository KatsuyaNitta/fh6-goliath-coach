import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  let source = await readFile(sourceUrl, "utf-8");
  source = source.replace('from "./uiText"', 'from "./uiText.mjs"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const directory = join(tmpdir(), `fh6-telemetry-chart-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const uiTextSource = await readFile(new URL("../src/lib/uiText.ts", import.meta.url), "utf-8");
  const uiTextCompiled = ts.transpileModule(uiTextSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  await writeFile(join(directory, "uiText.mjs"), uiTextCompiled, "utf-8");
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const telemetryLap = await compileModule(new URL("../src/lib/telemetryLap.ts", import.meta.url), "telemetryLap.mjs");
const telemetryChart = await compileModule(new URL("../src/lib/telemetryChart.ts", import.meta.url), "telemetryChart.mjs");

const newCsv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,accel_pct,brake_pct,steer_norm,manual_marker_id,exclude_from_driving_analysis,is_effective,rewind_event_id,rewind_cluster_id,rewind_classification,rewind_confidence,rewind_impact_direction,rewound_time_s,rewound_course_distance_m",
  "1,0,0,0,S1,0,0,0,0,100,0,0,-0.5,,False,True,,,,,,,",
  "2,1,1,100,S1,0,1,0,1,120,55,0,0.25,,False,True,,,,,,,",
  "3,2,2,200,S1,0,2,0,2,80,0,70,0.75,,False,True,RW001,RC001,driving_error_suspected,medium,left,2.5,120",
].join("\n");
const payload = telemetryLap.parseProjectedLapCsv(newCsv, "20260630_005550_projected-lap.csv");
assert.equal(payload.points[0].throttlePct, 0);
assert.equal(payload.points[0].brakePct, 0);
assert.equal(payload.points[0].steerNorm, -0.5);
assert.equal(payload.points[1].throttlePct, 55);
assert.equal(payload.points[2].brakePct, 70);
assert.equal(payload.points[2].steerNorm, 0.75);
assert.deepEqual(payload.channelAvailability, { speed: true, throttle: true, brake: true, steering: true });

const oldCsv = [
  "source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis",
  "1,0,0,0,S1,0,0,0,0,100,,False",
  "2,1,1,100,S1,0,1,0,1,120,,False",
].join("\n");
const oldPayload = telemetryLap.parseProjectedLapCsv(oldCsv, "old_projected-lap.csv");
assert.equal(oldPayload.points[0].throttlePct, null);
assert.equal(oldPayload.points[0].brakePct, null);
assert.equal(oldPayload.points[0].steerNorm, null);
assert.deepEqual(oldPayload.channelAvailability, { speed: true, throttle: false, brake: false, steering: false });

const emptyOptionalCsv = newCsv.replace("55,0,0.25", ",,");
const emptyPayload = telemetryLap.parseProjectedLapCsv(emptyOptionalCsv, "empty_projected-lap.csv");
assert.equal(emptyPayload.points[1].throttlePct, null);
assert.equal(emptyPayload.points[1].brakePct, null);
assert.equal(emptyPayload.points[1].steerNorm, null);

const sections = [
  { id: "S1", name_ja: "", name_en: "", start_distance_m: 0, end_distance_m: 100, length_m: 100, description: "" },
  { id: "S2", name_ja: "", name_en: "", start_distance_m: 100, end_distance_m: 200, length_m: 100, description: "" },
];
assert.deepEqual(telemetryChart.telemetryRange(payload, "full", "S1", sections), { startM: 0, endM: 200 });
assert.deepEqual(telemetryChart.telemetryRange(payload, "section", "S2", sections), { startM: 100, endM: 200 });
assert.equal(telemetryChart.nearestTelemetryPoint(payload.effectivePoints, -1).sourceRowIndex, 1);
assert.equal(telemetryChart.nearestTelemetryPoint(payload.effectivePoints, 100).sourceRowIndex, 2);
assert.equal(telemetryChart.nearestTelemetryPoint(payload.effectivePoints, 151).sourceRowIndex, 3);
assert.equal(telemetryChart.nearestTelemetryPoint(payload.effectivePoints, 999).sourceRowIndex, 3);
assert.deepEqual(telemetryChart.pointsInRange(payload.effectivePoints, { startM: 300, endM: 400 }), []);

const many = Array.from({ length: 120 }, (_, index) => ({
  ...payload.points[0],
  sourceRowIndex: index + 1,
  courseDistanceM: index,
  speedKmh: index === 80 ? 300 : 100,
  throttlePct: index === 30 ? 100 : 5,
  brakePct: index === 40 ? 100 : 0,
  steerNorm: index === 50 ? 1 : index === 60 ? -1 : 0,
}));
const first = telemetryChart.decimateTelemetryPoints(many, 8);
const second = telemetryChart.decimateTelemetryPoints(many, 8);
assert.equal(first.points[0].sourceRowIndex, 1);
assert.equal(first.points.at(-1).sourceRowIndex, 120);
assert.deepEqual(first.points.map((point) => point.sourceRowIndex), second.points.map((point) => point.sourceRowIndex));
assert.ok(first.points.length < many.length);
assert.ok(first.points.some((point) => point.throttlePct === 100), "throttle spike retained");
assert.ok(first.points.some((point) => point.brakePct === 100), "brake spike retained");
assert.ok(first.points.some((point) => point.steerNorm === 1), "positive steering extreme retained");
assert.ok(first.points.some((point) => point.steerNorm === -1), "negative steering extreme retained");
for (let index = 1; index < first.points.length; index += 1) {
  assert.ok(first.points[index].courseDistanceM >= first.points[index - 1].courseDistanceM, "ordering retained");
}
assert.ok(telemetryChart.decimateTelemetryPoints(many, 4).points.length <= telemetryChart.decimateTelemetryPoints(many, 16).points.length);

assert.deepEqual(telemetryChart.TELEMETRY_CHANNELS.map((channel) => channel.id), ["speed", "throttle", "brake", "steering"]);
assert.ok(telemetryChart.TELEMETRY_TRACK_LAYOUTS.speed.height > telemetryChart.TELEMETRY_TRACK_LAYOUTS.throttle.height);
assert.equal(telemetryChart.TELEMETRY_TRACK_LAYOUTS.throttle.height, telemetryChart.TELEMETRY_TRACK_LAYOUTS.brake.height);
assert.equal(telemetryChart.TELEMETRY_TRACK_LAYOUTS.brake.height, telemetryChart.TELEMETRY_TRACK_LAYOUTS.steering.height);
assert.deepEqual(
  Object.entries(telemetryChart.TELEMETRY_TRACK_LAYOUTS).filter(([, layout]) => layout.showDistanceLabels).map(([channel]) => channel),
  ["steering"],
);
assert.deepEqual(
  Object.entries(telemetryChart.TELEMETRY_TRACK_LAYOUTS).filter(([, layout]) => layout.showSectionLabels).map(([channel]) => channel),
  ["steering"],
);
assert.deepEqual(
  Object.entries(telemetryChart.TELEMETRY_TRACK_LAYOUTS).filter(([, layout]) => layout.showMarkerLabels).map(([channel]) => channel),
  ["speed"],
);
assert.deepEqual(
  Object.entries(telemetryChart.TELEMETRY_TRACK_LAYOUTS).filter(([, layout]) => layout.showRewindLabels).map(([channel]) => channel),
  ["speed"],
);
assert.equal(Object.values(telemetryChart.TELEMETRY_TRACK_LAYOUTS).every((layout) => layout.showGuideLines), true);

const panelSource = await readFile(new URL("../src/components/TelemetryChartsPanel.tsx", import.meta.url), "utf-8");
const canvasSource = await readFile(new URL("../src/components/TelemetryChartCanvas.tsx", import.meta.url), "utf-8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf-8");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const tasksSource = await readFile(new URL("../../TASKS.md", import.meta.url), "utf-8");
assert.match(panelSource, /CHART_TEXT\.title/);
assert.match(panelSource, /CHART_TEXT\.fullLap/);
assert.match(panelSource, /CHART_TEXT\.selectedSection/);
assert.match(panelSource, /CHART_TEXT\.clearCursor/);
assert.doesNotMatch(appSource, /UI_TEXT\.loadCsvManually|manualCsvDescription|projectedLapInputRef|handleProjectedLapFile/);
assert.doesNotMatch(appSource, /accept="\.csv,text\/csv"|type="file"/);
assert.match(panelSource, /ProjectedLapPayload/);
assert.match(panelSource, /TELEMETRY_TRACK_LAYOUTS/);
assert.match(panelSource, /height=\{layout\.height\}/);
assert.match(panelSource, /showDistanceLabels=\{layout\.showDistanceLabels\}/);
assert.match(panelSource, /showSectionLabels=\{layout\.showSectionLabels\}/);
assert.match(panelSource, /showMarkerLabels=\{layout\.showMarkerLabels\}/);
assert.match(panelSource, /showRewindLabels=\{layout\.showRewindLabels\}/);
assert.match(canvasSource, /visibleDrawnSamples/s);
assert.doesNotMatch(canvasSource, /className="telemetry-chart-description"/);
assert.match(canvasSource, /<small>\{CHART_TEXT\.unavailable\}<\/small>/);
assert.match(canvasSource, /CHART_TEXT\.notAvailable/);
assert.match(canvasSource, /onHoverPoint\(point\)/);
assert.match(canvasSource, /onPinPoint\(point\)/);
assert.match(stylesSource, /\.telemetry-chart-stack\s*\{[^}]*gap:\s*6px/s);
assert.match(stylesSource, /grid-template-columns:\s*96px minmax\(0, 1fr\)/);
assert.match(stylesSource, /@media \(max-width: 700px\)/);
const desktopBreakpointBlock = stylesSource.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.doesNotMatch(desktopBreakpointBlock, /\.telemetry-chart-track[\s\S]*?grid-template-columns:\s*1fr/);
assert.match(tasksSource, /- \[x\] Overview map mode:/);
assert.match(tasksSource, /slow automatic rotation/);
assert.match(appSource, /const \[elevationScale, setElevationScale\] = useState\(5\)/);
const lifecycleCall = appSource.slice(appSource.indexOf("const cameraLifecycleKey"), appSource.indexOf("}, [cameraResetKey"));
assert.doesNotMatch(lifecycleCall, /activeTelemetryPoint|hoveredTelemetryPoint|pinnedTelemetryPoint/);
console.log("telemetry chart smoke test passed");
