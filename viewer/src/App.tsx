import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ReferencePayload, SectionDefinition, SectionId } from "./lib/reference";
import { SECTION_COLORS, fetchReference } from "./lib/reference";
import { CourseScene } from "./components/CourseScene";
import { VehicleTunePanel } from "./components/VehicleTunePanel";
import { SessionBrowserPanel } from "./components/SessionBrowserPanel";
import { TelemetryChartsPanel } from "./components/TelemetryChartsPanel";
import { classificationLabel, type ProjectedLapPayload, type ProjectedLapPoint, type RewindClusterPayload } from "./lib/telemetryLap";
import type { PracticeFocusReason } from "./lib/practiceFocus";
import { buildCameraLifecycleKey } from "./lib/cameraLifecycle";
import { INITIAL_MAP_DISPLAY_MODE, shouldAutoRotateOverview, type MapDisplayMode } from "./lib/mapDisplayMode";
import { rewindNavigationDecision, sectionForRewindSelection } from "./lib/rewindSelection";
import {
  fetchCourseGeometry,
  sampleGeometryAtDistance,
  type CourseColorMode,
  type CourseGeometryPayload,
} from "./lib/courseGeometry";
import { courseColorLegend } from "./lib/courseColorMode";
import { telemetryChannelValue, type TelemetryRangeMode } from "./lib/telemetryChart";
import { usePrefersReducedMotion } from "./lib/useReducedMotion";
import { CHART_TEXT, UI_TEXT } from "./lib/uiText";
import type { LoadedSessionVehicleMetadata } from "./lib/vehicleAutofill";

type ViewMode = "3d";
const COURSE_ELEVATION_DISPLAY_SCALE = 5;
const CENTER_MAP_HEIGHT_STORAGE_KEY = "fh6-goliath-coach:center-map-height-v1";
const CENTER_MAP_MIN_HEIGHT_PX = 520;
const CENTER_CHART_MIN_VISIBLE_HEIGHT_PX = 260;
const CENTER_MAP_SPLITTER_HEIGHT_PX = 14;
const CENTER_MAP_DEFAULT_HEIGHT_MIN_PX = 620;
const CENTER_MAP_DEFAULT_HEIGHT_MAX_PX = 1280;
const CENTER_MAP_MAX_VIEWPORT_RATIO = 0.82;
const CENTER_MAP_KEYBOARD_STEP_PX = 20;
const CENTER_MAP_KEYBOARD_PAGE_STEP_PX = 80;

interface SectionFocusRequest {
  sectionId: SectionId;
  requestId: number;
}

export function App() {
  const [reference, setReference] = useState<ReferencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [courseGeometry, setCourseGeometry] = useState<CourseGeometryPayload | null>(null);
  const [courseGeometryError, setCourseGeometryError] = useState<string | null>(null);
  const [courseColorMode, setCourseColorMode] = useState<CourseColorMode>("section");
  const [chartRangeMode, setChartRangeMode] = useState<TelemetryRangeMode>("full");
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>("S1");
  const viewMode: ViewMode = "3d";
  const [mapDisplayMode, setMapDisplayMode] = useState<MapDisplayMode>(INITIAL_MAP_DISPLAY_MODE);
  const [sectionFocusRequest, setSectionFocusRequest] = useState<SectionFocusRequest | null>(null);
  const [overviewRotationStopped, setOverviewRotationStopped] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [projectedLap, setProjectedLap] = useState<ProjectedLapPayload | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState("");
  const [loadedVehicleMetadata, setLoadedVehicleMetadata] = useState<LoadedSessionVehicleMetadata | null>(null);
  const [showElevationContext, setShowElevationContext] = useState(true);
  const [showRewinds, setShowRewinds] = useState(true);
  const [selectedRewindClusterId, setSelectedRewindClusterId] = useState("");
  const [selectedRewindEventId, setSelectedRewindEventId] = useState("");
  const [hoveredTelemetryPoint, setHoveredTelemetryPoint] = useState<ProjectedLapPoint | null>(null);
  const [pinnedTelemetryPoint, setPinnedTelemetryPoint] = useState<ProjectedLapPoint | null>(null);
  const observationWorkspaceRef = useRef<HTMLElement | null>(null);
  const mapToolbarRef = useRef<HTMLDivElement | null>(null);
  const mapToolbarSupportRef = useRef<HTMLDivElement | null>(null);
  const mapChartSplitterRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const [mapHeightLimit, setMapHeightLimit] = useState(() => computeDefaultMapHeight());
  const [mapViewportHeight, setMapViewportHeight] = useState(() => readStoredMapHeight() ?? computeDefaultMapHeight());
  const [isMapSplitterDragging, setIsMapSplitterDragging] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    fetchReference()
      .then((payload) => {
        setReference(payload);
        setSelectedSectionId(payload.sections[0]?.id ?? "S1");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : UI_TEXT.referenceLoadFailed);
      });
  }, []);

  useEffect(() => {
    if (!reference) {
      return;
    }
    fetchCourseGeometry(reference)
      .then((geometry) => {
        setCourseGeometry(geometry);
        setCourseGeometryError(null);
      })
      .catch((caught: unknown) => {
        setCourseGeometry(null);
        setCourseGeometryError(caught instanceof Error ? caught.message : UI_TEXT.courseGeometryUnavailable);
        setCourseColorMode("section");
      });
  }, [reference]);

  const selectedSection = useMemo<SectionDefinition | undefined>(() => {
    return reference?.sections.find((section) => section.id === selectedSectionId);
  }, [reference, selectedSectionId]);
  const selectedTelemetrySection = useMemo(() => {
    return projectedLap?.sectionSummaries.find((section) => section.sectionId === selectedSectionId);
  }, [projectedLap, selectedSectionId]);
  const relativeElevation = reference?.coordinate_system.relative_elevation;
  const selectedRewindCluster = useMemo<RewindClusterPayload | undefined>(() => {
    return projectedLap?.rewindClusters.find((cluster) => cluster.clusterId === selectedRewindClusterId);
  }, [projectedLap, selectedRewindClusterId]);
  const selectedRewindEvent = useMemo<ProjectedLapPoint | undefined>(() => {
    if (!selectedRewindEventId) {
      return undefined;
    }
    return projectedLap?.rewindEvents.find((event) => event.rewindEventId === selectedRewindEventId);
  }, [projectedLap, selectedRewindEventId]);
  const selectedRewindDetailPoint = selectedRewindEvent ?? selectedRewindCluster?.points[0];
  const activeTelemetryPoint = hoveredTelemetryPoint ?? pinnedTelemetryPoint;
  const activeGeometrySample = useMemo(() => {
    return sampleGeometryAtDistance(courseGeometry, activeTelemetryPoint?.courseDistanceM);
  }, [activeTelemetryPoint?.courseDistanceM, courseGeometry]);
  const speedColorModeAvailable = Boolean(projectedLap?.channelAvailability.speed);
  const operationColorModeAvailable = Boolean(projectedLap?.channelAvailability.throttle && projectedLap?.channelAvailability.brake);
  useEffect(() => {
    if (
      (courseColorMode === "speed" && !speedColorModeAvailable) ||
      (courseColorMode === "operation" && !operationColorModeAvailable)
    ) {
      setCourseColorMode("section");
    }
  }, [courseColorMode, operationColorModeAvailable, speedColorModeAvailable]);
  const colorLegend = useMemo(() => courseColorLegend(courseColorMode), [courseColorMode]);
  const colorModeStatusText = useMemo(() => {
    if (!projectedLap) {
      return UI_TEXT.courseColorRequiresLap;
    }
    if (!speedColorModeAvailable) {
      return UI_TEXT.courseColorSpeedMissing;
    }
    if (!operationColorModeAvailable) {
      return UI_TEXT.courseColorOperationMissing;
    }
    return null;
  }, [operationColorModeAvailable, projectedLap, speedColorModeAvailable]);
  const overviewAutoRotate = shouldAutoRotateOverview({
    viewMode,
    mapDisplayMode,
    overviewRotationStopped,
    prefersReducedMotion,
  });

  useEffect(() => {
    const workspace = observationWorkspaceRef.current;
    if (!workspace) {
      return;
    }
    const currentWorkspace = workspace;

    function updateMapHeightLimit(): void {
      const toolbarHeight = mapToolbarRef.current?.offsetHeight ?? 0;
      const splitterHeight = mapChartSplitterRef.current?.offsetHeight ?? CENTER_MAP_SPLITTER_HEIGHT_PX;
      const viewportHeight = typeof window === "undefined" ? currentWorkspace.clientHeight : window.innerHeight;
      const visibleChartHeightLimit = viewportHeight - toolbarHeight - splitterHeight - CENTER_CHART_MIN_VISIBLE_HEIGHT_PX;
      const scrollSafeHeightLimit = viewportHeight * CENTER_MAP_MAX_VIEWPORT_RATIO;
      const availableHeight = Math.max(visibleChartHeightLimit, scrollSafeHeightLimit);
      const nextLimit = Math.max(CENTER_MAP_MIN_HEIGHT_PX, Math.floor(availableHeight));
      setMapHeightLimit(nextLimit);
      setMapViewportHeight((height) => clampMapHeight(height, nextLimit));
    }

    updateMapHeightLimit();
    const resizeObserver = new ResizeObserver(updateMapHeightLimit);
    resizeObserver.observe(currentWorkspace);
    if (mapToolbarRef.current) {
      resizeObserver.observe(mapToolbarRef.current);
    }
    if (mapToolbarSupportRef.current) {
      resizeObserver.observe(mapToolbarSupportRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [colorLegend, colorModeStatusText, courseGeometryError]);

  useEffect(() => {
    document.body.classList.toggle("map-chart-splitter-dragging", isMapSplitterDragging);
    return () => document.body.classList.remove("map-chart-splitter-dragging");
  }, [isMapSplitterDragging]);

  function activateOverviewMode(): void {
    setChartRangeMode("full");
    setMapDisplayMode("overview");
    setOverviewRotationStopped(prefersReducedMotion);
    setCameraResetKey((key) => key + 1);
  }

  function activateSectionFocusMode(): void {
    setChartRangeMode("section");
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    requestSectionFocusCamera(selectedSectionId);
  }

  function selectSectionForFocus(sectionId: SectionId): void {
    setSelectedSectionId(sectionId);
    setChartRangeMode("section");
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    requestSectionFocusCamera(sectionId);
  }

  function selectSectionForChartPin(sectionId: SectionId): void {
    setSelectedSectionId(sectionId);
  }

  function activateChartRangeMode(mode: TelemetryRangeMode): void {
    if (mode === "full") {
      activateOverviewMode();
      return;
    }
    activateSectionFocusMode();
  }

  function navigateToRewindSection(sectionId: string | undefined): void {
    const { shouldReframe, targetSectionId } = rewindNavigationDecision(selectedSectionId, mapDisplayMode, sectionId);
    setSelectedSectionId(targetSectionId);
    setChartRangeMode("section");
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    if (shouldReframe) {
      requestSectionFocusCamera(targetSectionId);
    }
  }

  function requestSectionFocusCamera(sectionId: SectionId): void {
    setSectionFocusRequest((current) => ({
      sectionId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  function resetCamera(): void {
    if (mapDisplayMode === "section-focus") {
      setOverviewRotationStopped(true);
      requestSectionFocusCamera(selectedSectionId);
      return;
    }
    setCameraResetKey((key) => key + 1);
  }

  function selectRewindCluster(cluster: RewindClusterPayload | undefined): void {
    if (!cluster) {
      return;
    }
    setSelectedRewindClusterId(cluster.clusterId);
    setSelectedRewindEventId("");
    navigateToRewindSection(cluster.sectionId);
  }

  function selectRewindEvent(event: ProjectedLapPoint | undefined): void {
    if (!event) {
      return;
    }
    setSelectedRewindClusterId(event.rewindClusterId || event.rewindEventId);
    setSelectedRewindEventId(event.rewindEventId);
    navigateToRewindSection(event.sectionId);
  }

  function clearRewindSelection(): void {
    setSelectedRewindClusterId("");
    setSelectedRewindEventId("");
  }

  function applyMapViewportHeight(nextHeight: number, persist = false): void {
    const clamped = clampMapHeight(nextHeight, mapHeightLimit);
    setMapViewportHeight(clamped);
    if (persist) {
      persistMapHeight(clamped);
    }
  }

  function resetMapViewportHeight(): void {
    const nextHeight = clampMapHeight(computeDefaultMapHeight(), mapHeightLimit);
    setMapViewportHeight(nextHeight);
    clearStoredMapHeight();
  }

  function handleMapSplitterPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: mapViewportHeight,
    };
    setIsMapSplitterDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMapSplitterPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    applyMapViewportHeight(dragState.startHeight + event.clientY - dragState.startY);
  }

  function finishMapSplitterPointerDrag(event: PointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const finalHeight = clampMapHeight(dragState.startHeight + event.clientY - dragState.startY, mapHeightLimit);
    dragStateRef.current = null;
    setIsMapSplitterDragging(false);
    setMapViewportHeight(finalHeight);
    persistMapHeight(finalHeight);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleMapSplitterKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    let nextHeight: number | null = null;
    if (event.key === "ArrowUp") {
      nextHeight = mapViewportHeight + CENTER_MAP_KEYBOARD_STEP_PX;
    } else if (event.key === "ArrowDown") {
      nextHeight = mapViewportHeight - CENTER_MAP_KEYBOARD_STEP_PX;
    } else if (event.key === "PageUp") {
      nextHeight = mapViewportHeight + CENTER_MAP_KEYBOARD_PAGE_STEP_PX;
    } else if (event.key === "PageDown") {
      nextHeight = mapViewportHeight - CENTER_MAP_KEYBOARD_PAGE_STEP_PX;
    } else if (event.key === "Home") {
      nextHeight = CENTER_MAP_MIN_HEIGHT_PX;
    } else if (event.key === "End") {
      nextHeight = mapHeightLimit;
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetMapViewportHeight();
      return;
    }
    if (nextHeight === null) {
      return;
    }
    event.preventDefault();
    applyMapViewportHeight(nextHeight, true);
  }

  const cameraLifecycleKey = useMemo(() => {
    const referenceIdentity = reference
      ? `${reference.schema_version}:${reference.stats.point_count}:${reference.start_finish.finish_course_distance_m.toFixed(3)}`
      : "no-reference";
    const telemetryIdentity = projectedLap
      ? `${projectedLap.fileName}:${projectedLap.points.length}:${projectedLap.totalLapTimeS.toFixed(3)}`
      : "no-telemetry";
    return buildCameraLifecycleKey({
      referenceIdentity,
      telemetryIdentity,
      viewMode,
      resetToken: cameraResetKey,
    });
  }, [cameraResetKey, projectedLap, reference, viewMode]);

  function applyProjectedLap(parsed: ProjectedLapPayload, loadedSession: string, vehicleMetadata?: LoadedSessionVehicleMetadata): void {
    setProjectedLap(parsed);
    setLoadedSessionId(loadedSession);
    if (vehicleMetadata) {
      setLoadedVehicleMetadata(vehicleMetadata);
    }
    const firstRewindCluster = parsed.rewindClusters[0];
    setSelectedRewindClusterId(firstRewindCluster?.clusterId ?? "");
    setSelectedRewindEventId("");
    setSelectedSectionId((current) => sectionForRewindSelection(current, firstRewindCluster?.sectionId));
    setHoveredTelemetryPoint(null);
    setPinnedTelemetryPoint(null);
    setShowRewinds(parsed.rewindClusters.length > 0);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="title-block">
          <h1>{UI_TEXT.appName}</h1>
          <p>{UI_TEXT.appDescription}</p>
        </div>
        <div className="loaded-session-status" aria-live="polite">
          {projectedLap ? (
            <>
              <b>{projectedLap.vehicle.displayName}</b>
              <span>{projectedLap.sessionId || loadedSessionId || UI_TEXT.unknown}</span>
            </>
          ) : (
            <span>{UI_TEXT.noProjectedLap}</span>
          )}
        </div>
      </header>

      <div className="desktop-workspace">
        <aside className="input-pane workspace-pane" aria-label="解析入力">
          <SessionBrowserPanel
            loadedSessionId={loadedSessionId}
            onLoadProjectedLap={(parsed, sessionId, vehicleMetadata) => applyProjectedLap(parsed, sessionId, vehicleMetadata)}
          />

          <section className="metadata-panel vehicle-context-panel" aria-label={UI_TEXT.vehicle}>
            <div className="panel-heading">
              <h2>{UI_TEXT.vehicle}</h2>
              <p>{projectedLap ? projectedLap.vehicle.displayName : UI_TEXT.noProjectedLap}</p>
            </div>
            {projectedLap ? (
              <dl className="compact-stats telemetry-summary">
                <div>
                  <dt>{UI_TEXT.session}</dt>
                  <dd>{projectedLap.sessionId || UI_TEXT.unknown}</dd>
                </div>
                <div>
                  <dt>{UI_TEXT.file}</dt>
                  <dd className="file-name">{projectedLap.fileName}</dd>
                </div>
                <div>
                  <dt>{UI_TEXT.lapTime}</dt>
                  <dd>{formatSeconds(projectedLap.totalLapTimeS)}</dd>
                </div>
                <div>
                  <dt>{UI_TEXT.markers}</dt>
                  <dd>{projectedLap.markers.length}</dd>
                </div>
              </dl>
            ) : (
              <p className="status-text">{UI_TEXT.noProjectedLap}</p>
            )}
          </section>

          <VehicleTunePanel loadedVehicleMetadata={loadedVehicleMetadata} />
        </aside>

        <section ref={observationWorkspaceRef} className="observation-workspace" aria-label="走行観察">
          <div ref={mapToolbarRef} className="map-toolbar" aria-label={UI_TEXT.mapDisplayMode}>
            <div className="toolbar-group overview-toolbar">
              <button
                className={mapDisplayMode === "overview" ? "active" : ""}
                aria-pressed={mapDisplayMode === "overview"}
                type="button"
                onClick={activateOverviewMode}
              >
                {UI_TEXT.overview}
              </button>
            </div>

            <div className="toolbar-group section-toolbar" aria-label={UI_TEXT.sections}>
              {reference?.sections.map((section) => {
                const sectionIsActive = mapDisplayMode === "section-focus" && section.id === selectedSectionId;
                return (
                  <button
                    className={sectionIsActive ? "active" : ""}
                    aria-pressed={sectionIsActive}
                    key={section.id}
                    type="button"
                    onClick={() => selectSectionForFocus(section.id)}
                  >
                    {section.id}
                  </button>
                );
              })}
            </div>

            <div className="toolbar-group three-up" aria-label={UI_TEXT.courseColorMode}>
              {(["section", "speed", "operation"] as CourseColorMode[]).map((mode) => {
                const disabled = isCourseColorModeDisabled(mode, speedColorModeAvailable, operationColorModeAvailable);
                const disabledReason = disabled
                  ? courseColorModeDisabledReason(mode, projectedLap, speedColorModeAvailable, operationColorModeAvailable)
                  : undefined;
                return (
                  <button
                    className={courseColorMode === mode ? "active" : ""}
                    aria-pressed={courseColorMode === mode}
                    disabled={disabled}
                    key={mode}
                    title={disabledReason}
                    type="button"
                    onClick={() => setCourseColorMode(mode)}
                  >
                    {formatCourseColorMode(mode)}
                  </button>
                );
              })}
            </div>

            <div className="toolbar-group utility-toolbar">
              <button className="command-button" type="button" onClick={resetCamera}>
                {UI_TEXT.resetCamera}
              </button>
              <label className="context-toggle compact-toggle">
                <input
                  checked={showElevationContext}
                  onChange={(event) => setShowElevationContext(event.target.checked)}
                  type="checkbox"
                />
                {UI_TEXT.elevationContext}
              </label>
              <label className="context-toggle compact-toggle">
                <input
                  checked={showRewinds}
                  disabled={!projectedLap?.rewindClusters.length}
                  onChange={(event) => setShowRewinds(event.target.checked)}
                  type="checkbox"
                />
                {UI_TEXT.rewinds}
              </label>
            </div>
          </div>

          {colorModeStatusText || courseGeometryError || colorLegend ? (
            <div ref={mapToolbarSupportRef} className="map-toolbar-support">
              {colorModeStatusText ? <p className="status-text">{colorModeStatusText}</p> : null}
              {courseGeometryError ? <p className="status-text">{UI_TEXT.courseGeometryUnavailable}</p> : null}
              {colorLegend ? (
                <div className="course-legend" aria-label={UI_TEXT.courseColorMode} title={colorLegend.helpText}>
                  {colorLegend.labels.map((label, index) => (
                    <span key={label}>
                      <i style={{ backgroundColor: colorLegend.colors[index] }} />
                      {label}
                    </span>
                  ))}
                  <em>{colorLegend.note}</em>
                  <small>{colorLegend.helpText}</small>
                </div>
              ) : null}
            </div>
          ) : null}

          <section className="viewer-surface" style={{ height: `${mapViewportHeight}px` }}>
            {reference ? (
              <>
                <CourseScene
                  key={cameraLifecycleKey}
                  reference={reference}
                  elevationScale={COURSE_ELEVATION_DISPLAY_SCALE}
                  selectedSectionId={selectedSectionId}
                  mapDisplayMode={mapDisplayMode}
                  viewMode={viewMode}
                  overviewAutoRotate={overviewAutoRotate}
                  sectionFocusRequest={sectionFocusRequest}
                  projectedLap={projectedLap}
                  courseGeometry={courseGeometry}
                  courseColorMode={courseColorMode}
                  showElevationContext={showElevationContext}
                  showRewinds={showRewinds && Boolean(projectedLap?.rewindClusters.length)}
                  selectedRewindClusterId={selectedRewindClusterId}
                  onSelectRewindCluster={selectRewindCluster}
                  onManualCameraInteraction={() => setOverviewRotationStopped(true)}
                  activeTelemetryPoint={activeTelemetryPoint}
                />
                <div className="orientation-indicator" aria-label={UI_TEXT.mapOrientation}>
                  <span>{UI_TEXT.xRight}</span>
                  <span>{UI_TEXT.zMapUp}</span>
                </div>
              </>
            ) : (
              <div className="load-state">{error ?? UI_TEXT.loadingReference}</div>
            )}
          </section>

          <div
            ref={mapChartSplitterRef}
            className={isMapSplitterDragging ? "map-chart-splitter dragging" : "map-chart-splitter"}
            role="separator"
            aria-orientation="horizontal"
            aria-label="マップとテレメトリーチャートの高さを調整"
            aria-valuemin={CENTER_MAP_MIN_HEIGHT_PX}
            aria-valuemax={mapHeightLimit}
            aria-valuenow={Math.round(mapViewportHeight)}
            tabIndex={0}
            onDoubleClick={resetMapViewportHeight}
            onKeyDown={handleMapSplitterKeyDown}
            onPointerCancel={finishMapSplitterPointerDrag}
            onPointerDown={handleMapSplitterPointerDown}
            onPointerMove={handleMapSplitterPointerMove}
            onPointerUp={finishMapSplitterPointerDrag}
          >
            <span aria-hidden="true" />
          </div>

          <TelemetryChartsPanel
            activeTelemetryPoint={activeTelemetryPoint}
            chartRangeMode={chartRangeMode}
            onChartRangeModeChange={activateChartRangeMode}
            onHoverTelemetryPoint={setHoveredTelemetryPoint}
            onPinTelemetryPoint={setPinnedTelemetryPoint}
            onSelectRewindCluster={selectRewindCluster}
            onSelectSection={selectSectionForChartPin}
            pinnedTelemetryPoint={pinnedTelemetryPoint}
            projectedLap={projectedLap}
            reference={reference}
            selectedRewindClusterId={selectedRewindClusterId}
            selectedSectionId={selectedSectionId}
          />
        </section>

        <aside className="interpretation-pane workspace-pane" aria-label="解析結果">
          <section className="section-detail compact-panel selected-point-panel">
            <h2>選択地点</h2>
            {activeTelemetryPoint ? (
              <dl>
                <div><dt>{UI_TEXT.distance}</dt><dd>{(activeTelemetryPoint.courseDistanceM / 1000).toFixed(3)} km</dd></div>
                <div><dt>{CHART_TEXT.section}</dt><dd>{activeTelemetryPoint.sectionId}</dd></div>
                <div><dt>{UI_TEXT.lapTime}</dt><dd>{formatSeconds(activeTelemetryPoint.lapTimeS)}</dd></div>
                <div><dt>Speed</dt><dd>{formatSpeed(activeTelemetryPoint.speedKmh)}</dd></div>
                <div><dt>Throttle</dt><dd>{formatTelemetryValue(telemetryChannelValue(activeTelemetryPoint, "throttle"), "%", 0)}</dd></div>
                <div><dt>Brake</dt><dd>{formatTelemetryValue(telemetryChannelValue(activeTelemetryPoint, "brake"), "%", 0)}</dd></div>
                <div><dt>Steering</dt><dd>{formatTelemetryValue(telemetryChannelValue(activeTelemetryPoint, "steering"), "", 3)}</dd></div>
              </dl>
            ) : (
              <p className="status-text">{CHART_TEXT.cursorHelp}</p>
            )}
          </section>

          {activeGeometrySample ? (
            <section className="section-detail compact-panel">
              <h2>{UI_TEXT.courseGeometryReadout}</h2>
              <dl>
                <div><dt>{UI_TEXT.distance}</dt><dd>{(activeGeometrySample.courseDistanceM / 1000).toFixed(3)} km</dd></div>
                <div><dt>{UI_TEXT.speed}</dt><dd>{formatSpeed(activeTelemetryPoint?.speedKmh)}</dd></div>
                <div><dt>{CHART_TEXT.section}</dt><dd>{activeGeometrySample.sectionId}</dd></div>
                <div><dt>{UI_TEXT.heading}</dt><dd>{formatNullable(activeGeometrySample.headingDeg, "deg", 1)}</dd></div>
                <div><dt>{UI_TEXT.gradient}</dt><dd>{formatSignedNullable(activeGeometrySample.gradientPct, "%", 2)}</dd></div>
                <div><dt>{UI_TEXT.curvature}</dt><dd>{formatSignedNullable(activeGeometrySample.signedCurvature1pm, "1/m", 5)}</dd></div>
                <div><dt>{UI_TEXT.radius}</dt><dd>{formatNullable(activeGeometrySample.estimatedRadiusM, "m", 0)}</dd></div>
                <div><dt>{UI_TEXT.turnDirection}</dt><dd>{formatTurnDirection(activeGeometrySample.turnDirection)}</dd></div>
                <div><dt>{UI_TEXT.slopeDirection}</dt><dd>{formatSlopeDirection(activeGeometrySample.slopeDirection)}</dd></div>
                <div><dt>{UI_TEXT.quality}</dt><dd>{formatQualityFlags(activeGeometrySample.qualityFlags)}</dd></div>
              </dl>
            </section>
          ) : null}

          {projectedLap && projectedLap.rewindSummary.rewindCount > 0 ? (
            <section className="section-detail compact-panel practice-focus-panel">
              <div className="practice-focus">
                <b>{UI_TEXT.practiceFocus}</b>
                <p className="status-text">{UI_TEXT.practiceFocusDescription}</p>
                {projectedLap.rewindSummary.practiceFocus.length > 0 ? projectedLap.rewindSummary.practiceFocus.map((candidate) => (
                  <button
                    aria-pressed={candidate.cluster.clusterId === selectedRewindClusterId}
                    className={candidate.cluster.clusterId === selectedRewindClusterId ? "selected" : ""}
                    key={candidate.cluster.clusterId}
                    type="button"
                    onClick={() => selectRewindCluster(candidate.cluster)}
                  >
                    <span className="practice-focus-title">
                      {candidate.cluster.sectionId} - {(candidate.cluster.courseDistanceM / 1000).toFixed(1)} km
                    </span>
                    <span className="practice-focus-row">
                      <b>{UI_TEXT.selectionReason}</b>
                      <span>{candidate.reasons.map(formatPracticeFocusReason).join(" / ")}</span>
                    </span>
                    <span className="practice-focus-grid">
                      <span>{UI_TEXT.rewinds} {candidate.cluster.eventCount}</span>
                      <span>{UI_TEXT.driving} {candidate.cluster.drivingErrorSuspectedCount}</span>
                      <span>{UI_TEXT.external} {candidate.cluster.externalImpactSuspectedCount}</span>
                      <span>{UI_TEXT.unclear} {candidate.cluster.undeterminedCount}</span>
                      <span>{UI_TEXT.confidence} {formatConfidence(candidate.cluster.confidence)}</span>
                      <span>{UI_TEXT.rewound} {candidate.cluster.rewoundTimeS.toFixed(1)} s / {candidate.cluster.rewoundCourseDistanceM.toFixed(0)} m</span>
                    </span>
                  </button>
                )) : <p className="status-text">{UI_TEXT.noPracticeFocus}</p>}
              </div>
            </section>
          ) : null}

          {selectedRewindCluster && selectedRewindDetailPoint ? (
            <section className="section-detail compact-panel">
              <h2>選択中の{UI_TEXT.rewinds}</h2>
              <div className="rewind-detail standalone-rewind-detail">
                <h3>{selectedRewindCluster.clusterId} {selectedRewindCluster.sectionId}</h3>
                <dl>
                  <div><dt>{UI_TEXT.distance}</dt><dd>{(selectedRewindDetailPoint.courseDistanceM / 1000).toFixed(3)} km</dd></div>
                  <div><dt>{UI_TEXT.events}</dt><dd>{selectedRewindCluster.eventCount}</dd></div>
                  <div><dt>{UI_TEXT.class}</dt><dd>{classificationLabel(selectedRewindDetailPoint.rewindClassification)}</dd></div>
                  <div><dt>{UI_TEXT.confidence}</dt><dd>{formatConfidence(selectedRewindDetailPoint.rewindConfidence || selectedRewindCluster.confidence || "low")}</dd></div>
                  <div><dt>{UI_TEXT.rewound}</dt><dd>{(selectedRewindDetailPoint.rewoundTimeS ?? selectedRewindCluster.rewoundTimeS).toFixed(1)} s / {(selectedRewindDetailPoint.rewoundCourseDistanceM ?? selectedRewindCluster.rewoundCourseDistanceM).toFixed(0)} m</dd></div>
                  <div><dt>{UI_TEXT.direction}</dt><dd>{formatDirection(selectedRewindDetailPoint.rewindImpactDirection || selectedRewindCluster.impactDirection || "unknown")}</dd></div>
                </dl>
                <div className="rewind-event-list" aria-label={UI_TEXT.rewindEvents}>
                  {selectedRewindCluster.points.map((point) => (
                    <button
                      className={point.rewindEventId === selectedRewindEventId ? "selected" : ""}
                      key={point.rewindEventId}
                      type="button"
                      onClick={() => selectRewindEvent(point)}
                    >
                      {point.rewindEventId}
                    </button>
                  ))}
                </div>
                <button className="text-button" type="button" onClick={clearRewindSelection}>{UI_TEXT.clearRewindSelection}</button>
              </div>
            </section>
          ) : null}

          {projectedLap && projectedLap.rewindSummary.rewindCount > 0 ? (
            <section className="section-detail compact-panel rewind-summary-panel">
              <h2>{UI_TEXT.rewinds}</h2>
              <dl>
                <div><dt>{UI_TEXT.rewinds}</dt><dd>{projectedLap.rewindSummary.rewindCount}</dd></div>
                <div><dt>{UI_TEXT.external}</dt><dd>{projectedLap.rewindSummary.externalImpactSuspectedCount}</dd></div>
                <div><dt>{UI_TEXT.driving}</dt><dd>{projectedLap.rewindSummary.drivingErrorSuspectedCount}</dd></div>
                <div><dt>{UI_TEXT.unclear}</dt><dd>{projectedLap.rewindSummary.undeterminedCount}</dd></div>
              </dl>
              <p className="status-text">{UI_TEXT.rewindCaution}</p>
              <div className="rewind-section-breakdown">
                {Object.entries(projectedLap.rewindSummary.bySection).map(([sectionId, count]) => (
                  <span key={sectionId}>{sectionId}: {count}</span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="telemetry-panel secondary-readout-panel">
            {projectedLap ? (
              <dl className="compact-stats telemetry-summary">
                <div><dt>{UI_TEXT.vehicle}</dt><dd className="vehicle-name">{projectedLap.vehicle.displayName}</dd></div>
                <div><dt>{UI_TEXT.session}</dt><dd>{projectedLap.sessionId || UI_TEXT.unknown}</dd></div>
                <div><dt>{UI_TEXT.file}</dt><dd className="file-name">{projectedLap.fileName}</dd></div>
                <div><dt>{UI_TEXT.lapTime}</dt><dd>{formatSeconds(projectedLap.totalLapTimeS)}</dd></div>
                <div><dt>{UI_TEXT.rewinds}</dt><dd>{projectedLap.rewindSummary.rewindCount}</dd></div>
                <div><dt>{UI_TEXT.markers}</dt><dd>{projectedLap.markers.length}</dd></div>
              </dl>
            ) : (
              <p className="status-text">{UI_TEXT.noProjectedLap}</p>
            )}
          </section>

          {relativeElevation ? (
            <section className="section-detail compact-panel">
              <h2>{UI_TEXT.relativeElevation}</h2>
              <dl>
                <div><dt>{UI_TEXT.datum}</dt><dd>{UI_TEXT.courseMinimum}</dd></div>
                <div><dt>{UI_TEXT.start}</dt><dd>{formatRelativeHeight(relativeElevation.start_relative_height_m)}</dd></div>
                <div><dt>{UI_TEXT.finish}</dt><dd>{formatRelativeHeight(relativeElevation.finish_relative_height_m)}</dd></div>
                <div><dt>{UI_TEXT.maximum}</dt><dd>{formatRelativeHeight(relativeElevation.range_m)}</dd></div>
                <div><dt>{UI_TEXT.range}</dt><dd>{relativeElevation.range_m.toFixed(1)} m</dd></div>
                <div><dt>{UI_TEXT.minimumAt}</dt><dd>{(relativeElevation.minimum_course_distance_m / 1000).toFixed(3)} km</dd></div>
                <div><dt>{UI_TEXT.maximumAt}</dt><dd>{(relativeElevation.maximum_course_distance_m / 1000).toFixed(3)} km</dd></div>
              </dl>
            </section>
          ) : null}

          {selectedSection ? (
            <section className="section-detail">
              <h2>{selectedSection.id} {selectedSection.name_ja}</h2>
              <p>{selectedSection.name_en}</p>
              <dl>
                <div><dt>{UI_TEXT.start}</dt><dd>{(selectedSection.start_distance_m / 1000).toFixed(3)} km</dd></div>
                <div><dt>{UI_TEXT.end}</dt><dd>{(selectedSection.end_distance_m / 1000).toFixed(3)} km</dd></div>
                <div><dt>{UI_TEXT.length}</dt><dd>{(selectedSection.length_m / 1000).toFixed(3)} km</dd></div>
                {selectedTelemetrySection && selectedTelemetrySection.sampleCount > 0 ? (
                  <div><dt>{UI_TEXT.actualTime}</dt><dd>{formatSeconds(selectedTelemetrySection.elapsedTimeS)}</dd></div>
                ) : null}
              </dl>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function formatRelativeHeight(heightM: number): string {
  if (Math.abs(heightM) < 0.05) {
    return "0.0 m";
  }
  return `${heightM > 0 ? "+" : ""}${heightM.toFixed(1)} m`;
}

function formatConfidence(value: string): string {
  if (value === "high") {
    return UI_TEXT.high;
  }
  if (value === "medium") {
    return UI_TEXT.medium;
  }
  if (value === "low") {
    return UI_TEXT.low;
  }
  if (!value) {
    return UI_TEXT.unknown;
  }
  return value;
}

function formatPracticeFocusReason(reason: PracticeFocusReason): string {
  if (reason === "repeated-rewind") {
    return UI_TEXT.repeatedRewindReason;
  }
  return UI_TEXT.credibleDrivingErrorReason;
}

function formatDirection(value: string): string {
  if (value === "unknown" || !value) {
    return UI_TEXT.unknown;
  }
  return value;
}

function formatCourseColorMode(mode: CourseColorMode): string {
  if (mode === "speed") {
    return UI_TEXT.courseColorSpeed;
  }
  if (mode === "operation") {
    return UI_TEXT.courseColorOperation;
  }
  return UI_TEXT.courseColorSection;
}

function isCourseColorModeDisabled(
  mode: CourseColorMode,
  speedAvailable: boolean,
  operationAvailable: boolean,
): boolean {
  if (mode === "speed") {
    return !speedAvailable;
  }
  if (mode === "operation") {
    return !operationAvailable;
  }
  return false;
}

function courseColorModeDisabledReason(
  mode: CourseColorMode,
  projectedLap: ProjectedLapPayload | null,
  speedAvailable: boolean,
  operationAvailable: boolean,
): string {
  if (!projectedLap) {
    return UI_TEXT.courseColorRequiresLap;
  }
  if (mode === "speed" && !speedAvailable) {
    return UI_TEXT.courseColorSpeedMissing;
  }
  if (mode === "operation" && !operationAvailable) {
    return UI_TEXT.courseColorOperationMissing;
  }
  return "";
}

function computeDefaultMapHeight(): number {
  if (typeof window === "undefined") {
    return CENTER_MAP_DEFAULT_HEIGHT_MIN_PX;
  }
  return Math.round(
    Math.min(
      CENTER_MAP_DEFAULT_HEIGHT_MAX_PX,
      Math.max(CENTER_MAP_DEFAULT_HEIGHT_MIN_PX, window.innerHeight * 0.62),
    ),
  );
}

function clampMapHeight(height: number, maxHeight: number): number {
  const safeMaxHeight = Math.max(CENTER_MAP_MIN_HEIGHT_PX, maxHeight);
  if (!Number.isFinite(height)) {
    return Math.min(computeDefaultMapHeight(), safeMaxHeight);
  }
  return Math.min(safeMaxHeight, Math.max(CENTER_MAP_MIN_HEIGHT_PX, Math.round(height)));
}

function readStoredMapHeight(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(CENTER_MAP_HEIGHT_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = Number.parseFloat(stored);
    return Number.isFinite(parsed) ? clampMapHeight(parsed, CENTER_MAP_DEFAULT_HEIGHT_MAX_PX) : null;
  } catch {
    return null;
  }
}

function persistMapHeight(height: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CENTER_MAP_HEIGHT_STORAGE_KEY, String(Math.round(height)));
  } catch {
    // localStorage can be unavailable in private or embedded contexts.
  }
}

function clearStoredMapHeight(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(CENTER_MAP_HEIGHT_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private or embedded contexts.
  }
}

function formatNullable(value: number | null, unit: string, decimals: number): string {
  if (value === null || !Number.isFinite(value)) {
    return CHART_TEXT.unavailable;
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatSpeed(speedKmh: number | undefined): string {
  if (speedKmh === undefined || !Number.isFinite(speedKmh)) {
    return CHART_TEXT.unavailable;
  }
  return `${Math.round(speedKmh)} km/h`;
}

function formatTelemetryValue(value: number | null, unit: string, decimals: number): string {
  if (value === null || !Number.isFinite(value)) {
    return CHART_TEXT.unavailable;
  }
  const formatted = value.toFixed(decimals);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatSignedNullable(value: number | null, unit: string, decimals: number): string {
  if (value === null || !Number.isFinite(value)) {
    return CHART_TEXT.unavailable;
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)} ${unit}`;
}

function formatTurnDirection(value: string): string {
  if (value === "left") {
    return "左";
  }
  if (value === "right") {
    return "右";
  }
  if (value === "straight") {
    return "直線";
  }
  return UI_TEXT.unknown;
}

function formatSlopeDirection(value: string): string {
  if (value === "uphill") {
    return "上り";
  }
  if (value === "downhill") {
    return "下り";
  }
  if (value === "flat") {
    return "平坦";
  }
  return UI_TEXT.unknown;
}

function formatQualityFlags(flags: string[]): string {
  if (flags.length === 0) {
    return "OK";
  }
  return flags.map(formatQualityFlag).join(" / ");
}

function formatQualityFlag(flag: string): string {
  const labels: Record<string, string> = {
    edge_window: "端部",
    insufficient_neighbors: "近傍不足",
    distance_gap: "距離ギャップ",
    degenerate_tangent: "接線不正",
    unstable_curvature: "曲率不安定",
    source_discontinuity: "元データ不連続",
  };
  return labels[flag] ?? flag;
}
