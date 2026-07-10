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
  for (const dependency of ["reference", "courseGeometry", "uiText", "courseOperationMode", "speedDisplay"]) {
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
    .replaceAll('from "./courseOperationMode"', 'from "./courseOperationMode.mjs"')
    .replaceAll('from "./speedDisplay"', 'from "./speedDisplay.mjs"')
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
const calloutPlacement = await compileModule(new URL("../src/lib/telemetryCalloutPlacement.ts", import.meta.url), "telemetryCalloutPlacement.mjs");

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
assert.deepEqual(colorMode.SPEED_COLOR_STOPS, [
  { speedKmh: 0, color: "#1d4ed8" },
  { speedKmh: 80, color: "#06b6d4" },
  { speedKmh: 160, color: "#22c55e" },
  { speedKmh: 240, color: "#facc15" },
  { speedKmh: 300, color: "#f97316" },
  { speedKmh: 360, color: "#ef4444" },
]);
assert.equal(`#${colorMode.speedDisplaySample(-10).color.getHexString()}`, "#1d4ed8");
assert.equal(`#${colorMode.speedDisplaySample(360).color.getHexString()}`, "#ef4444");
assert.equal(`#${colorMode.speedDisplaySample(500).color.getHexString()}`, "#ef4444");
assert.equal(`#${colorMode.speedDisplaySample(null).color.getHexString()}`, colorMode.UNAVAILABLE_GEOMETRY_COLOR);
assert.equal(colorMode.speedDisplaySample(300).halo, false);

assert.equal(colorMode.BRAKE_ACTIVE_THRESHOLD_PCT, 2);
assert.equal(colorMode.THROTTLE_OFF_THRESHOLD_PCT, 2);
assert.equal(colorMode.FULL_THROTTLE_THRESHOLD_PCT, 95);
assert.equal(colorMode.classifyOperationState(10, 10), "simultaneous-input");
assert.equal(colorMode.classifyOperationState(0, 3), "braking");
assert.equal(colorMode.classifyOperationState(2, 2), "coast");
assert.equal(colorMode.classifyOperationState(2.1, 2), "partial-throttle");
assert.equal(colorMode.classifyOperationState(95, 0), "full-throttle");
assert.equal(colorMode.classifyOperationState(null, 0), "unavailable");
assert.equal(colorMode.classifyOperationState(0, null), "unavailable");
assert.equal(`#${colorMode.operationDisplaySample(100, 0).color.getHexString()}`, "#355843");
assert.equal(colorMode.operationDisplaySample(100, 0).halo, false);
assert.equal(colorMode.operationDisplaySample(0, 100).halo, true);
assert.notEqual(
  `#${colorMode.operationDisplaySample(0, 20).color.getHexString()}`,
  `#${colorMode.operationDisplaySample(0, 100).color.getHexString()}`,
);
assert.equal(colorMode.operationDisplaySample(50, 0).direction, "partial-throttle");
assert.equal(colorMode.operationDisplaySample(0, 0).direction, "coast");
const telemetrySample = colorMode.actualTelemetryDisplaySample("operation", {
  sectionId: "S2",
  speedKmh: 210,
  throttlePct: 0,
  brakePct: 40,
});
assert.equal(telemetrySample.direction, "braking");

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const sceneSource = await readFile(new URL("../src/components/CourseScene.tsx", import.meta.url), "utf-8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf-8");
const uiTextSource = await readFile(new URL("../src/lib/uiText.ts", import.meta.url), "utf-8");
const colorModeSource = await readFile(new URL("../src/lib/courseColorMode.ts", import.meta.url), "utf-8");
const placementSource = await readFile(new URL("../src/lib/telemetryCalloutPlacement.ts", import.meta.url), "utf-8");

assert.match(sceneSource, /formatTelemetryCursorSpeed\(activeTelemetryPoint\?\.speedKmh, speedDisplayUnit\)/);
assert.match(sceneSource, /formatSpeedDisplay\(speedKmh, unit, UI_TEXT\.speedUnavailable\)/);
assert.doesNotMatch(sceneSource, /telemetry-cursor-label">\{\(point\.courseDistanceM \/ 1000\)\.toFixed\(3\)\} km/);
assert.match(sceneSource, /UI_TEXT\.speedUnavailable/);
assert.match(sceneSource, /function TelemetryCursorProjector/);
assert.match(sceneSource, /className="telemetry-cursor-hud"/);
assert.match(sceneSource, /className="telemetry-cursor-callout"/);
assert.match(sceneSource, /className="telemetry-cursor-speed"/);
assert.match(sceneSource, /アクセル/);
assert.match(sceneSource, /ブレーキ/);
assert.match(sceneSource, /ステアリング/);
assert.match(sceneSource, /className="telemetry-cursor-leader"/);
assert.match(sceneSource, /className="telemetry-cursor-diamond"/);
assert.match(sceneSource, /activeTelemetryPosition/);
assert.match(sceneSource, /\.project\(camera\)/);
assert.match(sceneSource, /hud\.style\.setProperty\("--cursor-x"/);
assert.match(sceneSource, /chooseTelemetryCalloutPlacement/);
assert.match(sceneSource, /TELEMETRY_ROUTE_PROJECTION_SAMPLE_LIMIT = 1000/);
assert.match(sceneSource, /telemetryRouteProjectionSamplePositions\(projectedLap, elevationScale, baselineDisplayY\)/);
assert.match(sceneSource, /projectedRouteScreenPoints\(routeProjectionCacheRef\.current, routeSamplePositions, camera, size\)/);
assert.match(sceneSource, /routePoints: routeScreenPoints/);
assert.match(sceneSource, /hud\.style\.setProperty\("--callout-offset-x"/);
assert.match(sceneSource, /hud\.style\.setProperty\("--callout-offset-y"/);
assert.match(sceneSource, /hud\.style\.setProperty\("--leader-length"/);
assert.match(sceneSource, /hud\.style\.setProperty\("--leader-angle"/);
assert.match(sceneSource, /hud\.dataset\.visible = "false"/);
assert.match(sceneSource, /hud\.dataset\.visible = "true"/);
assert.match(sceneSource, /telemetryChannelValue\(point, channel\)/);
assert.match(sceneSource, /formatTelemetryCursorPercent/);
assert.match(sceneSource, /formatTelemetryCursorSteering/);
assert.match(sceneSource, /value\.toFixed\(0\)/);
assert.match(sceneSource, /value\.toFixed\(3\)/);
assert.match(sceneSource, /return "N\/A"/);
const hudSource = sceneSource.slice(
  sceneSource.indexOf('className="telemetry-cursor-hud"'),
  sceneSource.indexOf("function TelemetryCursorProjector"),
);
assert.doesNotMatch(hudSource, /UI_TEXT\.distance|CHART_TEXT\.distance|courseDistanceM|sectionId|lapTimeS|Lap time|Section/);
assert.doesNotMatch(sceneSource, /function TelemetryCursorMarker/);
assert.doesNotMatch(sceneSource, /telemetryCursorDirectionQuaternion/);
assert.doesNotMatch(sceneSource, /nearestGeometryPoint\(courseGeometry, courseDistanceM\)/);
assert.doesNotMatch(sceneSource, /TELEMETRY_CURSOR_FALLBACK_DIRECTION/);
assert.doesNotMatch(sceneSource, /<coneGeometry/);
assert.doesNotMatch(sceneSource, /<torusGeometry/);
assert.doesNotMatch(sceneSource, /<tetrahedronGeometry/);
assert.doesNotMatch(sceneSource, /distanceFactor=\{11000\} position=\{\[0, 430, 0\]\}/);
assert.match(sceneSource, /function RewindClusterMarker[\s\S]*<sphereGeometry args=\{\[selected \? 180 : 135, 18, 18\]\}/);

assert.match(appSource, /<dt>\{UI_TEXT\.speed\}<\/dt><dd>\{formatSpeed\(activeTelemetryPoint\?\.speedKmh, speedDisplayUnit\)\}<\/dd>/);
assert.match(appSource, /function formatSpeed\(speedKmh: number \| undefined, unit: SpeedDisplayUnit\): string/);
assert.match(appSource, /formatSpeedDisplay\(speedKmh, unit, CHART_TEXT\.unavailable\)/);
assert.match(appSource, /<dt>\{UI_TEXT\.distance\}<\/dt><dd>\{\(activeGeometrySample\.courseDistanceM \/ 1000\)\.toFixed\(3\)\} km<\/dd>/);
assert.match(appSource, /\(\["section", "speed", "operation"\] as CourseColorMode\[\]\)/);
assert.doesNotMatch(appSource, /\(\["section", "gradient", "curvature"\] as CourseColorMode\[\]\)/);
assert.match(appSource, /courseColorMode === "speed" && !speedColorModeAvailable/);
assert.match(appSource, /courseColorMode === "operation" && !operationColorModeAvailable/);
assert.match(appSource, /setCourseColorMode\("section"\)/);
assert.match(appSource, /title=\{disabledReason\}/);
assert.match(appSource, /title=\{colorLegend\.helpText\}/);
assert.doesNotMatch(appSource, /courseColorGradient/);
assert.doesNotMatch(appSource, /courseColorCurvature/);

assert.match(uiTextSource, /courseColorSection: "Section"/);
assert.match(uiTextSource, /courseColorSpeed: "速度"/);
assert.match(uiTextSource, /courseColorOperation: "操作"/);
assert.match(uiTextSource, /courseColorRequiresLap: "走行データを読み込むと利用できます。"/);
assert.match(uiTextSource, /operationBraking: "ブレーキ"/);
assert.match(uiTextSource, /operationFullThrottle: "全開"/);
assert.match(uiTextSource, /geometryLegendStrengthNote: "色と発光が強いほど急"/);
assert.match(uiTextSource, /gradientLegendThresholdHelp: "表示閾値: ±1\.0%未満は平坦表示"/);
assert.match(uiTextSource, /curvatureLegendThresholdHelp: "表示閾値: \|曲率\| 0\.0015 1\/m未満は直線表示"/);
assert.doesNotMatch(uiTextSource, /courseColorSection: "セクション"/);

assert.match(colorModeSource, /GRADIENT_DISPLAY_THRESHOLD_PCT = 1\.0/);
assert.match(colorModeSource, /CURVATURE_DISPLAY_THRESHOLD_1PM = 0\.0015/);
assert.match(colorModeSource, /NEUTRAL_GEOMETRY_COLOR = "#59616c"/);
assert.match(colorModeSource, /UNAVAILABLE_GEOMETRY_COLOR = "#2f3b4d"/);
assert.match(colorModeSource, /SPEED_COLOR_STOPS/);
assert.match(colorModeSource, /FULL_THROTTLE_THRESHOLD_PCT/);
assert.match(colorModeSource, /classifyOperationState/);
assert.match(colorModeSource, /Math\.sqrt\(raw\)/);
assert.match(colorModeSource, /geometryRunKey/);

assert.match(sceneSource, /buildGeometryRenderRuns/);
assert.match(sceneSource, /startGeometryRunFromBoundary/);
assert.match(sceneSource, /geometryOverlayWidth/);
assert.match(sceneSource, /key=\{`\$\{keyPrefix\}-telemetry-color-\$\{runIndex\}-\$\{run\.key\}`\}/);
assert.match(sceneSource, /depthTest\s*[\r\n]+\s*depthWrite\s*[\r\n]+\s*opacity=\{1\}\s*[\r\n]+\s*toneMapped=\{false\}\s*[\r\n]+\s*transparent=\{false\}/);
assert.doesNotMatch(sceneSource, /geometry-base/);
assert.doesNotMatch(sceneSource, /geometry-halo/);
assert.doesNotMatch(sceneSource, /GEOMETRY_BASE_COLOR/);
assert.doesNotMatch(sceneSource, /GEOMETRY_BASE_OPACITY/);
assert.doesNotMatch(sceneSource, /GEOMETRY_HALO_OPACITY/);
assert.doesNotMatch(sceneSource, /geometryBaseWidth/);
assert.doesNotMatch(sceneSource, /geometryHaloWidth/);
assert.match(sceneSource, /SECTION_COLORS\[section\.id\]/);
assert.match(sceneSource, /MUTED_LINE_WIDTH/);
assert.match(sceneSource, /for \(const \[runIndex, run\] of runs\.entries\(\)\)/);
assert.match(sceneSource, /const usesTelemetryColors = courseColorMode !== "section" && \(isOverview \|\| isSelected\)/);
assert.match(sceneSource, /actualTelemetryDisplaySample\(courseColorMode, point\)/);
assert.doesNotMatch(sceneSource, /referenceGeometryDisplaySample\(courseColorMode/);
assert.doesNotMatch(sceneSource, /actualGeometryDisplaySample\(courseColorMode/);
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
assert.match(stylesSource, /\.telemetry-cursor-leader\s*\{[\s\S]*width: var\(--leader-length\);[\s\S]*height: 2px;[\s\S]*transform: rotate\(var\(--leader-angle\)\);[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-callout\s*\{[\s\S]*width: 232px;[\s\S]*min-height: 92px;[\s\S]*font-variant-numeric: tabular-nums;[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-speed\s*\{[\s\S]*font-size: 22px;[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-input-row\s*\{[\s\S]*grid-template-columns: 1fr 1fr;[\s\S]*\}/);
assert.match(stylesSource, /\.telemetry-cursor-throttle\s*\{[\s\S]*#86efac/);
assert.match(stylesSource, /\.telemetry-cursor-brake\s*\{[\s\S]*#fca5a5/);
assert.match(stylesSource, /@media \(max-width: 520px\)[\s\S]*\.telemetry-cursor-callout\s*\{[\s\S]*width: 206px/);
assert.doesNotMatch(stylesSource, /\.telemetry-cursor-callout[\s\S]*animation:/);
const threeUpButtonCss = stylesSource.match(/\.segmented-group\.three-up button\s*\{[\s\S]*?\}/)?.[0] ?? "";
assert.doesNotMatch(threeUpButtonCss, /font-size:\s*0(?:;|\s)/);
assert.doesNotMatch(threeUpButtonCss, /color:\s*transparent/);

assert.match(placementSource, /TelemetryCalloutPlacement = "top-right" \| "top-left" \| "bottom-right" \| "bottom-left"/);
assert.match(placementSource, /TELEMETRY_CALLOUT_PLACEMENT_ORDER: TelemetryCalloutPlacement\[\] = \[\s*"top-right",\s*"top-left",\s*"bottom-right",\s*"bottom-left"/);
assert.match(placementSource, /CARD_VERTICAL_GAP_PX = 44/);
assert.match(placementSource, /CARD_HORIZONTAL_GAP_PX = 28/);
assert.match(placementSource, /LEADER_MIN_LENGTH_PX = 24/);
assert.match(placementSource, /VIEWPORT_INSET_PX = 12/);
assert.match(placementSource, /PLACEMENT_HYSTERESIS_PX = 24/);
assert.match(placementSource, /ROUTE_CLEARANCE_PX = 10/);
assert.match(placementSource, /DENSE_VERTICAL_GAP_PX = 64/);
assert.match(placementSource, /previousPlacement/);
assert.match(placementSource, /countRoutePointOverlap/);
assert.match(placementSource, /selectStableCandidate/);
const defaultPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
});
assert.equal(defaultPlacement.placement, "top-right");
assert.equal(defaultPlacement.offsetX, 28);
assert.equal(defaultPlacement.offsetY, -136);
assert.equal(defaultPlacement.leaderOffsetX, 28);
assert.equal(defaultPlacement.leaderOffsetY, -44);
assert.equal(defaultPlacement.routeSampleCount, 0);
const topLeftPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 760,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
});
assert.equal(topLeftPlacement.placement, "top-left");
const bottomRightPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 70,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
});
assert.equal(bottomRightPlacement.placement, "bottom-right");
const bottomLeftPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 760,
  anchorY: 70,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
});
assert.equal(bottomLeftPlacement.placement, "bottom-left");
const hysteresisPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 560,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
  previousPlacement: "top-left",
});
assert.equal(hysteresisPlacement.placement, "top-left");
assert.ok(bottomLeftPlacement.offsetX < 0);
assert.ok(bottomLeftPlacement.offsetY > 0);
const overlapAwarePlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
  routePoints: [
    { x: 360, y: 130 },
    { x: 420, y: 150 },
    { x: 500, y: 170 },
  ],
});
assert.equal(overlapAwarePlacement.placement, "top-left");
assert.equal(overlapAwarePlacement.routeOverlapCount, 0);
const bottomFallbackPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 100,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 260,
  routePoints: [
    { x: 80, y: 10 },
    { x: 140, y: 20 },
    { x: 190, y: 30 },
    { x: 370, y: 200 },
    { x: 430, y: 210 },
  ],
});
assert.equal(bottomFallbackPlacement.placement, "bottom-left");
const stickyPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
  previousPlacement: "top-left",
  routePoints: [{ x: 100, y: 160 }],
});
assert.equal(stickyPlacement.placement, "top-left");
const denseFallbackPlacement = calloutPlacement.chooseTelemetryCalloutPlacement({
  anchorX: 320,
  anchorY: 250,
  cardWidth: 232,
  cardHeight: 92,
  viewportWidth: 900,
  viewportHeight: 520,
  previousPlacement: "top-right",
  routePoints: Array.from({ length: 16 }, (_, index) => ({ x: 360 + index * 4, y: 210 })),
  denseOverlapThreshold: 4,
  switchThreshold: 100,
});
assert.equal(denseFallbackPlacement.denseFallback, true);
assert.ok(denseFallbackPlacement.offsetY <= -156);

console.log("course geometry smoke test passed");
