import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  let source = await readFile(sourceUrl, "utf-8");
  source = rewriteLocalImports(source);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const viewerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = join(viewerRoot, ".tmp-smoke", `fh6-course-geometry-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  for (const dependency of ["reference", "courseGeometry", "uiText"]) {
    const dependencySource = await readFile(new URL(`../src/lib/${dependency}.ts`, import.meta.url), "utf-8");
    const dependencyCompiled = ts.transpileModule(rewriteLocalImports(dependencySource), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    await writeFile(join(directory, `${dependency}.mjs`), dependencyCompiled, "utf-8");
  }
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  const imported = await import(`file:///${modulePath.replaceAll("\\", "/")}`);
  await rm(directory, { recursive: true, force: true });
  return imported;
}

function rewriteLocalImports(source) {
  return source
    .replaceAll('from "./reference"', 'from "./reference.mjs"')
    .replaceAll('from "./courseGeometry"', 'from "./courseGeometry.mjs"')
    .replaceAll('from "./uiText"', 'from "./uiText.mjs"');
}

const reference = JSON.parse(
  await readFile(new URL("../public/reference/goliath_reference.json", import.meta.url), "utf-8"),
);
const geometryPayload = JSON.parse(
  await readFile(new URL("../public/reference/goliath_course_geometry.json", import.meta.url), "utf-8"),
);
const geometry = await compileModule(new URL("../src/lib/courseGeometry.ts", import.meta.url), "courseGeometry.mjs");
const colorMode = await compileModule(new URL("../src/lib/courseColorMode.ts", import.meta.url), "courseColorMode.mjs");

geometry.validateCourseGeometryPayload(geometryPayload, reference);
assert.equal(geometryPayload.schema_version, "goliath-course-geometry-v1");
assert.equal(geometryPayload.points.length, reference.points.length);
assert.equal(geometryPayload.source.point_count, 84678);
assert.deepEqual(geometryPayload.point_columns, [
  "reference_index",
  "course_distance_m",
  "section_id",
  "tangent_x",
  "tangent_z",
  "heading_deg",
  "gradient_ratio",
  "gradient_pct",
  "gradient_angle_deg",
  "signed_curvature_1pm",
  "estimated_radius_m",
  "turn_direction",
  "slope_direction",
  "quality_flags",
]);
assert.ok(geometryPayload.display_scale.gradient_abs_clamp_pct >= 5);
assert.ok(geometryPayload.display_scale.curvature_abs_clamp_1pm >= 0.002);

const sample = geometry.sampleGeometryAtDistance(geometryPayload, 1000.4);
assert.equal(sample.sectionId, "S1");
assert.ok(Number.isFinite(sample.headingDeg));
assert.ok(Array.isArray(sample.qualityFlags));

const exact = geometry.nearestGeometryPoint(geometryPayload, geometryPayload.points[10][1]);
assert.equal(exact[0], 10);
assert.deepEqual(reference.markers.map((marker) => marker.id), ["P1", "P2", "P3", "P4", "P5"]);
assert.deepEqual(reference.markers.map((marker) => marker.label), ["P1", "P2", "P3", "P4", "P5"]);
assert.equal(reference.sections.length, 6);

assert.equal(colorMode.GRADIENT_DISPLAY_THRESHOLD_PCT, 1);
assert.equal(colorMode.CURVATURE_DISPLAY_THRESHOLD_1PM, 0.0015);
assert.equal(colorMode.NEUTRAL_GEOMETRY_COLOR, "#59616c");
assert.equal(colorMode.UNAVAILABLE_GEOMETRY_COLOR, "#2f3b4d");
assert.equal(colorMode.GEOMETRY_BASE_COLOR, "#101722");
assert.equal(colorMode.GEOMETRY_STRONG_BAND_THRESHOLD, 0.72);

const fakeGeometry = {
  display_scale: {
    gradient_abs_clamp_pct: 13,
    curvature_abs_clamp_1pm: 0.016,
  },
  points: [
    [0, 0, "S1", 1, 0, 0, 0, 0.5, 0, 0.001, 1000, "straight", "flat", []],
    [1, 1, "S1", 1, 0, 0, 0, 1, 0, 0.004, 250, "left", "uphill", []],
    [2, 2, "S1", 1, 0, 0, 0, -4, 0, -0.004, 250, "right", "downhill", []],
    [3, 3, "S1", 1, 0, 0, 0, null, null, null, null, "straight", "flat", []],
  ],
};

const belowGradient = colorMode.referenceGeometryDisplaySample("gradient", fakeGeometry, 0, "S1");
assert.equal(belowGradient.direction, "neutral");
assert.equal(`#${belowGradient.color.getHexString()}`, colorMode.NEUTRAL_GEOMETRY_COLOR);
assert.equal(fakeGeometry.points[0][7], 0.5);

const thresholdGradient = colorMode.referenceGeometryDisplaySample("gradient", fakeGeometry, 1, "S1");
assert.equal(thresholdGradient.direction, "uphill");
assert.equal(thresholdGradient.band, "low");
assert.notEqual(`#${thresholdGradient.color.getHexString()}`, colorMode.NEUTRAL_GEOMETRY_COLOR);

const downhillGradient = colorMode.referenceGeometryDisplaySample("gradient", fakeGeometry, 2, "S1");
assert.equal(downhillGradient.direction, "downhill");

const unavailableGradient = colorMode.referenceGeometryDisplaySample("gradient", fakeGeometry, 3, "S1");
assert.equal(unavailableGradient.direction, "unavailable");
assert.equal(`#${unavailableGradient.color.getHexString()}`, colorMode.UNAVAILABLE_GEOMETRY_COLOR);
assert.notEqual(`#${unavailableGradient.color.getHexString()}`, colorMode.NEUTRAL_GEOMETRY_COLOR);

const belowCurvature = colorMode.referenceGeometryDisplaySample("curvature", fakeGeometry, 0, "S1");
assert.equal(belowCurvature.direction, "neutral");
assert.equal(`#${belowCurvature.color.getHexString()}`, colorMode.NEUTRAL_GEOMETRY_COLOR);

const leftCurvature = colorMode.referenceGeometryDisplaySample("curvature", fakeGeometry, 1, "S1");
assert.equal(leftCurvature.direction, "left");

const rightCurvature = colorMode.referenceGeometryDisplaySample("curvature", fakeGeometry, 2, "S1");
assert.equal(rightCurvature.direction, "right");

const unavailableCurvature = colorMode.referenceGeometryDisplaySample("curvature", fakeGeometry, 3, "S1");
assert.equal(`#${unavailableCurvature.color.getHexString()}`, colorMode.UNAVAILABLE_GEOMETRY_COLOR);

const nonlinearStrength = colorMode.displayStrengthFromValue(4, 1, 13);
assert.ok(nonlinearStrength > (4 - 1) / (13 - 1));
assert.equal(colorMode.displayStrengthFromValue(50, 1, 13), 1);
assert.equal(colorMode.displayStrengthFromValue(4, 1, 1), 1);
assert.equal(colorMode.strengthBand(0.719), "medium");
assert.equal(colorMode.strengthBand(0.72), "strong");
assert.equal(colorMode.strengthBand(0.4), "medium");

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const sceneSource = await readFile(new URL("../src/components/CourseScene.tsx", import.meta.url), "utf-8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf-8");
const uiTextSource = await readFile(new URL("../src/lib/uiText.ts", import.meta.url), "utf-8");
const colorModeSource = await readFile(new URL("../src/lib/courseColorMode.ts", import.meta.url), "utf-8");

assert.match(sceneSource, /formatTelemetryCursorSpeed\(activeTelemetryPoint\?\.speedKmh\)/);
assert.match(sceneSource, /Math\.round\(speedKmh\)/);
assert.match(sceneSource, /`\$\{Math\.round\(speedKmh\)\} km\/h`/);
assert.doesNotMatch(sceneSource, /telemetry-cursor-label">\{\(point\.courseDistanceM \/ 1000\)\.toFixed\(3\)\} km/);
assert.match(sceneSource, /return UI_TEXT\.speedUnavailable/);
assert.match(sceneSource, /function TelemetryCursorProjector/);
assert.match(sceneSource, /className="telemetry-cursor-hud"/);
assert.match(sceneSource, /className="telemetry-cursor-badge"/);
assert.match(sceneSource, /className="telemetry-cursor-leader"/);
assert.match(sceneSource, /className="telemetry-cursor-diamond"/);
assert.match(sceneSource, /activeTelemetryPosition/);
assert.match(sceneSource, /\.project\(camera\)/);
assert.match(sceneSource, /hud\.style\.setProperty\("--cursor-x"/);
assert.match(sceneSource, /hud\.dataset\.placement = hasRoomAbove \? "above" : "below"/);
assert.match(sceneSource, /hud\.dataset\.visible = "false"/);
assert.match(sceneSource, /hud\.dataset\.visible = "true"/);
assert.doesNotMatch(sceneSource, /function TelemetryCursorMarker/);
assert.doesNotMatch(sceneSource, /telemetryCursorDirectionQuaternion/);
assert.doesNotMatch(sceneSource, /nearestGeometryPoint\(courseGeometry, courseDistanceM\)/);
assert.doesNotMatch(sceneSource, /TELEMETRY_CURSOR_FALLBACK_DIRECTION/);
assert.doesNotMatch(sceneSource, /<coneGeometry/);
assert.doesNotMatch(sceneSource, /<torusGeometry/);
assert.doesNotMatch(sceneSource, /<tetrahedronGeometry/);
assert.doesNotMatch(sceneSource, /distanceFactor=\{11000\} position=\{\[0, 430, 0\]\}/);
assert.match(sceneSource, /function RewindClusterMarker[\s\S]*<sphereGeometry args=\{\[selected \? 180 : 135, 18, 18\]\}/);

assert.match(appSource, /<dt>\{UI_TEXT\.speed\}<\/dt><dd>\{formatSpeed\(activeTelemetryPoint\?\.speedKmh\)\}<\/dd>/);
assert.match(appSource, /function formatSpeed\(speedKmh: number \| undefined\): string/);
assert.match(appSource, /return `\$\{Math\.round\(speedKmh\)\} km\/h`/);
assert.match(appSource, /<dt>\{UI_TEXT\.distance\}<\/dt><dd>\{\(activeGeometrySample\.courseDistanceM \/ 1000\)\.toFixed\(3\)\} km<\/dd>/);
assert.match(appSource, /\(\["section", "gradient", "curvature"\] as CourseColorMode\[\]\)/);
assert.match(appSource, /title=\{geometryLegend\.helpText\}/);
assert.match(appSource, /geometryLegend\.unavailableColor/);

assert.match(uiTextSource, /courseColorSection: "Section"/);
assert.match(uiTextSource, /courseColorGradient: "勾配"/);
assert.match(uiTextSource, /courseColorCurvature: "曲率"/);
assert.match(uiTextSource, /geometryLegendStrengthNote: "色と発光が強いほど急"/);
assert.match(uiTextSource, /gradientLegendThresholdHelp: "表示閾値: ±1\.0%未満は平坦表示"/);
assert.match(uiTextSource, /curvatureLegendThresholdHelp: "表示閾値: \|曲率\| 0\.0015 1\/m未満は直線表示"/);
assert.doesNotMatch(uiTextSource, /courseColorSection: "セクション"/);

assert.match(colorModeSource, /GRADIENT_DISPLAY_THRESHOLD_PCT = 1\.0/);
assert.match(colorModeSource, /CURVATURE_DISPLAY_THRESHOLD_1PM = 0\.0015/);
assert.match(colorModeSource, /NEUTRAL_GEOMETRY_COLOR = "#59616c"/);
assert.match(colorModeSource, /UNAVAILABLE_GEOMETRY_COLOR = "#2f3b4d"/);
assert.match(colorModeSource, /Math\.sqrt\(raw\)/);
assert.match(colorModeSource, /geometryRunKey/);

assert.match(sceneSource, /GEOMETRY_BASE_COLOR/);
assert.match(sceneSource, /buildGeometryRenderRuns/);
assert.match(sceneSource, /run\.band === "strong"/);
assert.match(sceneSource, /startGeometryRunFromBoundary/);
assert.match(sceneSource, /geometryOverlayWidth/);
assert.match(sceneSource, /SECTION_COLORS\[section\.id\]/);
assert.match(sceneSource, /MUTED_LINE_WIDTH/);
assert.match(sceneSource, /for \(const \[runIndex, run\] of runs\.entries\(\)\)/);
assert.match(sceneSource, /label="START"/);
assert.match(sceneSource, /label="FINISH"/);
assert.doesNotMatch(sceneSource, /markerPoints/);
assert.doesNotMatch(sceneSource, /markerTouchesSection/);
assert.doesNotMatch(sceneSource, /label=\{marker\.label\}/);
assert.doesNotMatch(sceneSource, /key=\{marker\.id\}/);
assert.doesNotMatch(sceneSource, /actual-marker-\$\{marker\.id\}/);
assert.doesNotMatch(sceneSource, /MUTED_MARKER_COLOR/);

assert.match(stylesSource, /\.segmented-group\.three-up\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*width: 100%;[\s\S]*\}/);
assert.match(stylesSource, /\.segmented-group\.three-up button\s*\{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*\}/);
assert.match(stylesSource, /\.course-legend em,[\s\S]*\.course-legend small/);
assert.match(stylesSource, /\.telemetry-cursor-hud\s*\{[\s\S]*pointer-events: none;[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-diamond\s*\{[\s\S]*width: 16px;[\s\S]*height: 16px;[\s\S]*transform: rotate\(45deg\);[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-leader\s*\{[\s\S]*height: 11px;[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-badge\s*\{[\s\S]*height: 30px;[\s\S]*font-size: 16px;[\s\S]*font-variant-numeric: tabular-nums;[\s\S]*\}/);
assert.doesNotMatch(stylesSource, /\.telemetry-cursor-badge[\s\S]*animation:/);
const threeUpButtonCss = stylesSource.match(/\.segmented-group\.three-up button\s*\{[\s\S]*?\}/)?.[0] ?? "";
assert.doesNotMatch(threeUpButtonCss, /font-size:\s*0(?:;|\s)/);
assert.doesNotMatch(threeUpButtonCss, /color:\s*transparent/);

console.log("course geometry smoke test passed");
