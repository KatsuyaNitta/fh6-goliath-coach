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

  const directory = join(tmpdir(), `fh6-map-display-mode-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const mapDisplayMode = await compileModule(
  new URL("../src/lib/mapDisplayMode.ts", import.meta.url),
  "mapDisplayMode.mjs",
);

assert.deepEqual(mapDisplayMode.MAP_DISPLAY_MODES, ["overview", "section-focus"]);
assert.equal(mapDisplayMode.INITIAL_MAP_DISPLAY_MODE, "overview");
assert.equal(mapDisplayMode.OVERVIEW_AUTO_ROTATE_SPEED, 0.35);
assert.equal(
  mapDisplayMode.shouldAutoRotateOverview({
    viewMode: "3d",
    mapDisplayMode: "overview",
    overviewRotationStopped: false,
    prefersReducedMotion: false,
  }),
  true,
);
assert.equal(
  mapDisplayMode.shouldAutoRotateOverview({
    viewMode: "3d",
    mapDisplayMode: "section-focus",
    overviewRotationStopped: false,
    prefersReducedMotion: false,
  }),
  false,
);
assert.equal(
  mapDisplayMode.shouldAutoRotateOverview({
    viewMode: "2d",
    mapDisplayMode: "overview",
    overviewRotationStopped: false,
    prefersReducedMotion: false,
  }),
  false,
);
assert.equal(
  mapDisplayMode.shouldAutoRotateOverview({
    viewMode: "3d",
    mapDisplayMode: "overview",
    overviewRotationStopped: true,
    prefersReducedMotion: false,
  }),
  false,
);
assert.equal(
  mapDisplayMode.shouldAutoRotateOverview({
    viewMode: "3d",
    mapDisplayMode: "overview",
    overviewRotationStopped: false,
    prefersReducedMotion: true,
  }),
  false,
);

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const sceneSource = await readFile(new URL("../src/components/CourseScene.tsx", import.meta.url), "utf-8");
const lifecycleSource = await readFile(new URL("../src/lib/cameraLifecycle.ts", import.meta.url), "utf-8");
const reducedMotionSource = await readFile(new URL("../src/lib/useReducedMotion.ts", import.meta.url), "utf-8");

assert.match(appSource, /useState<MapDisplayMode>\(INITIAL_MAP_DISPLAY_MODE\)/);
assert.match(appSource, /aria-label=\{UI_TEXT\.mapDisplayMode\}/);
assert.match(appSource, /\{UI_TEXT\.overview\}/);
assert.match(appSource, /\{UI_TEXT\.sectionFocus\}/);
assert.match(appSource, /aria-pressed=\{mapDisplayMode === "overview"\}/);
assert.match(appSource, /aria-pressed=\{mapDisplayMode === "section-focus"\}/);
assert.match(appSource, /function activateOverviewMode\(\)/);
assert.match(appSource, /setCameraResetKey\(\(key\) => key \+ 1\)/);
assert.match(appSource, /function activateSectionFocusMode\(\)/);
assert.match(appSource, /setOverviewRotationStopped\(true\)/);
assert.match(appSource, /requestSectionFocusCamera\(selectedSectionId\)/);
assert.match(appSource, /function selectSectionForFocus\(sectionId: SectionId\)/);
assert.match(appSource, /function selectSectionForChartPin\(sectionId: SectionId\)/);
assert.match(appSource, /mapDisplayMode !== "section-focus" \|\| selectedSectionId !== sectionId/);
assert.match(appSource, /if \(shouldRequestFocusCamera\) \{\s*requestSectionFocusCamera\(sectionId\);/s);
assert.match(appSource, /function requestSectionFocusCamera\(sectionId: SectionId\)/);
assert.match(appSource, /requestId: \(current\?\.requestId \?\? 0\) \+ 1/);
assert.match(appSource, /function resetCamera\(\)/);
assert.match(appSource, /if \(mapDisplayMode === "section-focus"\) \{\s*setOverviewRotationStopped\(true\);\s*requestSectionFocusCamera\(selectedSectionId\);\s*return;/s);
assert.match(appSource, /onManualCameraInteraction=\{\(\) => setOverviewRotationStopped\(true\)\}/);
assert.match(appSource, /mapDisplayMode=\{mapDisplayMode\}/);
assert.match(appSource, /overviewAutoRotate=\{overviewAutoRotate\}/);
assert.match(appSource, /sectionFocusRequest=\{sectionFocusRequest\}/);
assert.match(appSource, /onSelectSection=\{selectSectionForChartPin\}/);
assert.match(appSource, /onClick=\{\(\) => selectSectionForFocus\(section\.id\)\}/);
assert.match(appSource, /setSelectedSectionId\(\(current\) => sectionForRewindSelection\(current, cluster\.sectionId\)\)/);
assert.doesNotMatch(appSource, /selectRewindCluster[\s\S]*setMapDisplayMode/);
assert.doesNotMatch(appSource, /onHoverTelemetryPoint=\{selectSectionForFocus\}/);
assert.doesNotMatch(appSource, /setMode\("section"\)[\s\S]{0,160}setMapDisplayMode/);

const lifecycleCall = appSource.slice(appSource.indexOf("const cameraLifecycleKey"), appSource.indexOf("}, [cameraResetKey"));
assert.doesNotMatch(
  lifecycleCall,
  /selectedSectionId|hoveredTelemetryPoint|pinnedTelemetryPoint|selectedRewindClusterId|selectedRewindEventId|mapDisplayMode/,
);
assert.doesNotMatch(lifecycleSource, /MapDisplayMode|selectedSectionId|hoveredTelemetryPoint|pinnedTelemetryPoint|selectedRewind/);

assert.match(sceneSource, /const OVERVIEW_REFERENCE_WIDTH = 5/);
assert.match(sceneSource, /const OVERVIEW_ACTUAL_WIDTH = 7/);
assert.match(sceneSource, /const OVERVIEW_LINE_OPACITY = 1/);
assert.match(sceneSource, /mapDisplayMode === "overview"/);
assert.match(sceneSource, /color=\{isOverview \|\| isSelected \? SECTION_COLORS\[section\.id\] : MUTED_SECTION_COLOR\}/);
assert.match(sceneSource, /lineWidth=\{isOverview \? OVERVIEW_REFERENCE_WIDTH : isSelected \? SELECTED_REFERENCE_WIDTH : MUTED_LINE_WIDTH\}/);
assert.match(sceneSource, /lineWidth=\{isOverview \? OVERVIEW_ACTUAL_WIDTH : isSelected \? SELECTED_ACTUAL_WIDTH : MUTED_LINE_WIDTH\}/);
assert.match(sceneSource, /if \(isOverview \|\| !isSelected\)/);
assert.match(sceneSource, /mapDisplayMode === "overview" \? true : markerTouchesSection/);
assert.match(sceneSource, /autoRotate=\{overviewAutoRotate\}/);
assert.match(sceneSource, /autoRotateSpeed=\{OVERVIEW_AUTO_ROTATE_SPEED\}/);
assert.match(sceneSource, /getSectionFocusCameraPose/);
assert.match(sceneSource, /sectionFocusRequest\?: SectionFocusRequest \| null/);
assert.match(sceneSource, /appliedSectionFocusRequestRef/);
assert.match(sceneSource, /appliedSectionFocusRequestRef\.current === sectionFocusRequest\.requestId/);
assert.match(sceneSource, /controls\.target\.set\(\.\.\.pose\.target\)/);
assert.match(sceneSource, /controls\.autoRotate = overviewAutoRotate/);
assert.match(sceneSource, /controls\.autoRotateSpeed = OVERVIEW_AUTO_ROTATE_SPEED/);
assert.match(sceneSource, /className="course-canvas-wrap"/);
assert.match(sceneSource, /onPointerDown=\{onManualCameraInteraction\}/);
assert.match(sceneSource, /onWheel=\{onManualCameraInteraction\}/);
assert.match(sceneSource, /addEventListener\("start", onManualCameraInteraction\)/);
assert.match(sceneSource, /onStart=\{onManualCameraInteraction\}/);
assert.match(sceneSource, /viewMode === "2d" \? bounds\.center : overviewTarget/);
assert.match(sceneSource, /getCanonical3DAnalysisCameraPosition\(bounds, overviewTarget\)/);
assert.match(sceneSource, /up=\{\[0, 1, 0\]\}/);

assert.match(reducedMotionSource, /prefers-reduced-motion: reduce/);
assert.match(reducedMotionSource, /addEventListener\("change"/);

const chartsSource = await readFile(new URL("../src/components/TelemetryChartsPanel.tsx", import.meta.url), "utf-8");
assert.match(chartsSource, /function pinPoint\(point: ProjectedLapPoint \| null\)/);
assert.match(chartsSource, /onPinTelemetryPoint\(point\);\s*if \(point\) \{\s*onSelectSection\(point\.sectionId\);/s);
assert.match(chartsSource, /onHoverPoint=\{onHoverTelemetryPoint\}/);
assert.doesNotMatch(chartsSource, /onPointerMove[\s\S]*onSelectSection/);
assert.match(chartsSource, /onClick=\{\(\) => onPinTelemetryPoint\(null\)\}>\{CHART_TEXT\.clearCursor\}/);
assert.doesNotMatch(chartsSource, /Clear cursor[\s\S]{0,200}onSelectSection/);

console.log("map display mode smoke test passed");
