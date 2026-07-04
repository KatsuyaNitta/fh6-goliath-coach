import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf-8");
const chartsSource = await readFile(new URL("../src/components/TelemetryChartsPanel.tsx", import.meta.url), "utf-8");
const sessionBrowserSource = await readFile(new URL("../src/components/SessionBrowserPanel.tsx", import.meta.url), "utf-8");
const vehicleTunePanelSource = await readFile(new URL("../src/components/VehicleTunePanel.tsx", import.meta.url), "utf-8");
const lifecycleSource = await readFile(new URL("../src/lib/cameraLifecycle.ts", import.meta.url), "utf-8");

function indexOfRequired(source, text) {
  const index = source.indexOf(text);
  assert.notEqual(index, -1, `missing required source text: ${text}`);
  return index;
}

assert.match(stylesSource, /grid-template-columns:\s*320px minmax\(760px, 1fr\) 352px/);
assert.match(appSource, /<header className="app-header">/);
assert.match(appSource, /<div className="desktop-workspace">/);
assert.match(appSource, /<aside className="input-pane workspace-pane"/);
assert.match(appSource, /<section ref=\{observationWorkspaceRef\} className="observation-workspace"/);
assert.match(appSource, /<aside className="interpretation-pane workspace-pane"/);

const leftIndex = indexOfRequired(appSource, 'className="input-pane workspace-pane"');
const centerIndex = indexOfRequired(appSource, 'className="observation-workspace"');
const rightIndex = indexOfRequired(appSource, 'className="interpretation-pane workspace-pane"');
assert.ok(leftIndex < centerIndex && centerIndex < rightIndex, "desktop panes must render left, center, then right");

const sessionIndex = indexOfRequired(appSource, "<SessionBrowserPanel");
const vehicleTuneIndex = indexOfRequired(appSource, "<VehicleTunePanel");
assert.ok(sessionIndex > leftIndex && sessionIndex < centerIndex, "session browser must be in the left pane");
assert.ok(vehicleTuneIndex > leftIndex && vehicleTuneIndex < centerIndex, "vehicle/tune controls must be in the left pane");

const toolbarIndex = indexOfRequired(appSource, 'className="map-toolbar"');
const mapIndex = indexOfRequired(appSource, 'className="viewer-surface"');
const splitterIndex = indexOfRequired(appSource, 'className={isMapSplitterDragging ? "map-chart-splitter dragging" : "map-chart-splitter"}');
const chartsIndex = indexOfRequired(appSource, "<TelemetryChartsPanel");
assert.ok(toolbarIndex > centerIndex && toolbarIndex < mapIndex, "map toolbar must be above the map");
assert.ok(mapIndex < splitterIndex && splitterIndex < chartsIndex, "center workspace must render map, splitter, then telemetry charts");

const selectedPointIndex = indexOfRequired(appSource, 'className="section-detail compact-panel selected-point-panel"');
const practiceIndex = indexOfRequired(appSource, 'className="section-detail compact-panel practice-focus-panel"');
const selectedRewindIndex = indexOfRequired(appSource, "standalone-rewind-detail");
const rewindSummaryIndex = indexOfRequired(appSource, 'className="section-detail compact-panel rewind-summary-panel"');
assert.ok(selectedPointIndex > rightIndex, "selected-point content must be in the right pane");
assert.ok(selectedPointIndex < practiceIndex, "selected point must precede Practice Focus");
assert.ok(practiceIndex < selectedRewindIndex, "Practice Focus must precede selected rewind detail");
assert.ok(selectedRewindIndex < rewindSummaryIndex, "selected rewind detail must precede aggregate rewind summary");
const rewindSummaryPanelSource = appSource.slice(
  rewindSummaryIndex,
  appSource.indexOf('<section className="telemetry-panel secondary-readout-panel"', rewindSummaryIndex),
);
assert.doesNotMatch(rewindSummaryPanelSource, /checked=\{showRewinds\}|setShowRewinds\(event\.target\.checked\)/);
assert.match(rewindSummaryPanelSource, /projectedLap\.rewindSummary\.rewindCount/);
assert.match(rewindSummaryPanelSource, /projectedLap\.rewindSummary\.bySection/);

const sidePaneSource = `${appSource.slice(leftIndex, centerIndex)}\n${appSource.slice(rightIndex)}`;
assert.doesNotMatch(sidePaneSource, /UI_TEXT\.overview|UI_TEXT\.sectionFocus|setCourseColorMode|resetCamera\(\)|setShowRewinds\(event\.target\.checked\)/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /UI_TEXT\.overview/);
assert.doesNotMatch(appSource.slice(toolbarIndex, mapIndex), /UI_TEXT\.sectionFocus/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /selectSectionForFocus\(section\.id\)/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /"section", "speed", "operation"/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /resetCamera/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /UI_TEXT\.elevationContext/);
assert.match(appSource.slice(toolbarIndex, mapIndex), /checked=\{showRewinds\}[\s\S]*setShowRewinds\(event\.target\.checked\)[\s\S]*UI_TEXT\.rewinds/);

for (const sectionId of ["S1", "S2", "S3", "S4", "S5", "S6"]) {
  assert.ok(appSource.includes("reference?.sections.map"), `section toolbar should derive ${sectionId} from reference sections`);
}
assert.match(appSource, /UI_TEXT\.courseColorSection/);
assert.match(appSource, /UI_TEXT\.courseColorSpeed/);
assert.match(appSource, /UI_TEXT\.courseColorOperation/);

assert.match(appSource, /const COURSE_ELEVATION_DISPLAY_SCALE = 5/);
assert.match(appSource, /elevationScale=\{COURSE_ELEVATION_DISPLAY_SCALE\}/);
assert.doesNotMatch(appSource, /useState\(5\)/);
assert.doesNotMatch(appSource, /setElevationScale/);
assert.doesNotMatch(appSource, /UI_TEXT\.elevationScale/);
assert.doesNotMatch(appSource, /\{[A-Za-z0-9_]+Scale\}x/);
assert.doesNotMatch(appSource, /\[1,\s*2,\s*3,\s*5\]/);

assert.match(chartsSource, /CHART_TEXT\.fullLap/);
assert.match(chartsSource, /CHART_TEXT\.selectedSection/);
assert.match(chartsSource, /CHART_TEXT\.clearCursor/);
assert.match(chartsSource, /onHoverPoint=\{onHoverTelemetryPoint\}/);
assert.match(chartsSource, /onPinPoint=\{pinPoint\}/);

const lifecycleCall = appSource.slice(appSource.indexOf("const cameraLifecycleKey"), appSource.indexOf("}, [cameraResetKey"));
assert.doesNotMatch(
  lifecycleCall,
  /selectedSectionId|hoveredTelemetryPoint|pinnedTelemetryPoint|selectedRewindClusterId|selectedRewindEventId|mapDisplayMode/,
);
assert.doesNotMatch(lifecycleSource, /MapDisplayMode|selectedSectionId|hoveredTelemetryPoint|pinnedTelemetryPoint|selectedRewind/);

assert.match(appSource, /SESSION_BROWSER|SessionBrowserPanel|VehicleTunePanel/);
assert.match(sessionBrowserSource, /session-browser-command-row/);
assert.match(sessionBrowserSource, /session-browser-toggle-row/);
assert.match(stylesSource, /\.session-browser-command-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(stylesSource, /\.session-browser-toggle-row\s*\{[\s\S]*white-space:\s*nowrap/);
assert.doesNotMatch(stylesSource, /\.session-browser-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, 1fr\)/);
assert.match(sessionBrowserSource, /SESSION_TEXT\.refresh/);
assert.match(sessionBrowserSource, /SESSION_TEXT\.clear/);
assert.match(sessionBrowserSource, /SESSION_TEXT\.showIgnored/);
assert.match(sessionBrowserSource, /processAndLoad/);
assert.match(sessionBrowserSource, /loadProcessedSession/);
assert.match(sessionBrowserSource, /showIgnored/);
assert.match(vehicleTunePanelSource, /applyTelemetryVehicleDefaults/);
assert.match(vehicleTunePanelSource, /compareVehicleIdentities/);
assert.match(vehicleTunePanelSource, /parseVehicleTuneJson/);

assert.match(appSource, /const CENTER_MAP_HEIGHT_STORAGE_KEY = "fh6-goliath-coach:center-map-height-v1"/);
assert.match(appSource, /const CENTER_MAP_MIN_HEIGHT_PX = 520/);
assert.match(appSource, /const CENTER_CHART_MIN_VISIBLE_HEIGHT_PX = 260/);
assert.match(appSource, /const CENTER_MAP_DEFAULT_HEIGHT_MIN_PX = 620/);
assert.match(appSource, /const CENTER_MAP_DEFAULT_HEIGHT_MAX_PX = 1280/);
assert.match(appSource, /const CENTER_MAP_MAX_VIEWPORT_RATIO = 0\.82/);
assert.match(appSource, /role="separator"/);
assert.match(appSource, /aria-orientation="horizontal"/);
assert.match(appSource, /aria-label="マップとテレメトリーチャートの高さを調整"/);
assert.match(appSource, /aria-valuemin=\{CENTER_MAP_MIN_HEIGHT_PX\}/);
assert.match(appSource, /aria-valuemax=\{mapHeightLimit\}/);
assert.match(appSource, /aria-valuenow=\{Math\.round\(mapViewportHeight\)\}/);
assert.match(appSource, /onPointerDown=\{handleMapSplitterPointerDown\}/);
assert.match(appSource, /onPointerMove=\{handleMapSplitterPointerMove\}/);
assert.match(appSource, /onPointerUp=\{finishMapSplitterPointerDrag\}/);
assert.match(appSource, /onPointerCancel=\{finishMapSplitterPointerDrag\}/);
assert.match(appSource, /setPointerCapture\(event\.pointerId\)/);
assert.match(appSource, /releasePointerCapture\(event\.pointerId\)/);
assert.match(appSource, /onDoubleClick=\{resetMapViewportHeight\}/);
for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter"]) {
  assert.ok(appSource.includes(`event.key === "${key}"`), `missing splitter keyboard handler for ${key}`);
}
assert.match(appSource, /Number\.isFinite\(parsed\) \? clampMapHeight\(parsed, CENTER_MAP_DEFAULT_HEIGHT_MAX_PX\) : null/);
assert.match(appSource, /window\.localStorage\.setItem\(CENTER_MAP_HEIGHT_STORAGE_KEY/);
assert.match(appSource, /window\.localStorage\.removeItem\(CENTER_MAP_HEIGHT_STORAGE_KEY\)/);
assert.match(stylesSource, /\.map-chart-splitter/);
assert.match(stylesSource, /cursor:\s*row-resize/);
assert.doesNotMatch(appSource + stylesSource, /side-pane-resizer|input-rail|overlay drawer|mobile-destinations|bottom-nav|bottom navigation|pane-resizer|resize-handle/);
assert.doesNotMatch(appSource, /braking-zone|corner detection|recommendation|replay/i);

console.log("desktop workspace smoke test passed");
