import { useEffect, useMemo, useRef, useState } from "react";
import type { ReferencePayload, SectionDefinition, SectionId } from "./lib/reference";
import { SECTION_COLORS, fetchReference } from "./lib/reference";
import { CourseScene } from "./components/CourseScene";
import { VehicleTunePanel } from "./components/VehicleTunePanel";
import { SessionBrowserPanel } from "./components/SessionBrowserPanel";
import { TelemetryChartsPanel } from "./components/TelemetryChartsPanel";
import { classificationLabel, parseProjectedLapCsv, type ProjectedLapPayload, type ProjectedLapPoint, type RewindClusterPayload } from "./lib/telemetryLap";
import { buildCameraLifecycleKey } from "./lib/cameraLifecycle";
import { INITIAL_MAP_DISPLAY_MODE, shouldAutoRotateOverview, type MapDisplayMode } from "./lib/mapDisplayMode";
import { sectionForRewindSelection } from "./lib/rewindSelection";
import { usePrefersReducedMotion } from "./lib/useReducedMotion";
import { UI_TEXT } from "./lib/uiText";
import type { LoadedSessionVehicleMetadata } from "./lib/vehicleAutofill";

type ViewMode = "3d";
interface SectionFocusRequest {
  sectionId: SectionId;
  requestId: number;
}

export function App() {
  const [reference, setReference] = useState<ReferencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>("S1");
  const [elevationScale, setElevationScale] = useState(5);
  const viewMode: ViewMode = "3d";
  const [mapDisplayMode, setMapDisplayMode] = useState<MapDisplayMode>(INITIAL_MAP_DISPLAY_MODE);
  const [sectionFocusRequest, setSectionFocusRequest] = useState<SectionFocusRequest | null>(null);
  const [overviewRotationStopped, setOverviewRotationStopped] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [projectedLap, setProjectedLap] = useState<ProjectedLapPayload | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState("");
  const [loadedVehicleMetadata, setLoadedVehicleMetadata] = useState<LoadedSessionVehicleMetadata | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [showElevationContext, setShowElevationContext] = useState(true);
  const [showRewinds, setShowRewinds] = useState(true);
  const [selectedRewindClusterId, setSelectedRewindClusterId] = useState("");
  const [selectedRewindEventId, setSelectedRewindEventId] = useState("");
  const [hoveredTelemetryPoint, setHoveredTelemetryPoint] = useState<ProjectedLapPoint | null>(null);
  const [pinnedTelemetryPoint, setPinnedTelemetryPoint] = useState<ProjectedLapPoint | null>(null);
  const projectedLapInputRef = useRef<HTMLInputElement | null>(null);
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
  const overviewAutoRotate = shouldAutoRotateOverview({
    viewMode,
    mapDisplayMode,
    overviewRotationStopped,
    prefersReducedMotion,
  });

  function activateOverviewMode(): void {
    setMapDisplayMode("overview");
    setOverviewRotationStopped(prefersReducedMotion);
    setCameraResetKey((key) => key + 1);
  }

  function activateSectionFocusMode(): void {
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    requestSectionFocusCamera(selectedSectionId);
  }

  function selectSectionForFocus(sectionId: SectionId): void {
    setSelectedSectionId(sectionId);
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    requestSectionFocusCamera(sectionId);
  }

  function selectSectionForChartPin(sectionId: SectionId): void {
    const shouldRequestFocusCamera = mapDisplayMode !== "section-focus" || selectedSectionId !== sectionId;
    setSelectedSectionId(sectionId);
    setMapDisplayMode("section-focus");
    setOverviewRotationStopped(true);
    if (shouldRequestFocusCamera) {
      requestSectionFocusCamera(sectionId);
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
    setSelectedSectionId((current) => sectionForRewindSelection(current, cluster.sectionId));
  }

  function selectRewindEvent(event: ProjectedLapPoint | undefined): void {
    if (!event) {
      return;
    }
    setSelectedRewindClusterId(event.rewindClusterId || event.rewindEventId);
    setSelectedRewindEventId(event.rewindEventId);
    setSelectedSectionId((current) => sectionForRewindSelection(current, event.sectionId));
  }

  function clearRewindSelection(): void {
    setSelectedRewindClusterId("");
    setSelectedRewindEventId("");
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
    setTelemetryError(null);
    setHoveredTelemetryPoint(null);
    setPinnedTelemetryPoint(null);
    setShowRewinds(parsed.rewindClusters.length > 0);
  }

  async function handleProjectedLapFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseProjectedLapCsv(text, file.name);
      applyProjectedLap(parsed, parsed.sessionId);
    } catch (caught: unknown) {
      setTelemetryError(caught instanceof Error ? caught.message : UI_TEXT.failedProjectedLap);
      setHoveredTelemetryPoint(null);
      setPinnedTelemetryPoint(null);
    }
  }

  return (
    <main className="app-shell">
      <div className="analysis-column">
        <section className="viewer-surface">
        {reference ? (
          <>
            <CourseScene
              key={cameraLifecycleKey}
              reference={reference}
              elevationScale={elevationScale}
              selectedSectionId={selectedSectionId}
              mapDisplayMode={mapDisplayMode}
              viewMode={viewMode}
              overviewAutoRotate={overviewAutoRotate}
              sectionFocusRequest={sectionFocusRequest}
              projectedLap={projectedLap}
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
        )}        </section>
        <TelemetryChartsPanel
          activeTelemetryPoint={activeTelemetryPoint}
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
      </div>

      <aside className="control-panel" aria-label="Goliath reference controls">
        <div className="title-block">
          <h1>{UI_TEXT.appName}</h1>
          <p>{UI_TEXT.appDescription}</p>
        </div>

        <div className="segmented-group two-up" aria-label={UI_TEXT.mapDisplayMode}>
          <button
            className={mapDisplayMode === "overview" ? "active" : ""}
            aria-pressed={mapDisplayMode === "overview"}
            type="button"
            onClick={activateOverviewMode}
          >
            {UI_TEXT.overview}
          </button>
          <button
            className={mapDisplayMode === "section-focus" ? "active" : ""}
            aria-pressed={mapDisplayMode === "section-focus"}
            type="button"
            onClick={activateSectionFocusMode}
          >
            {UI_TEXT.sectionFocus}
          </button>
        </div>

        <button className="command-button" type="button" onClick={resetCamera}>
          {UI_TEXT.resetCamera}
        </button>

        <SessionBrowserPanel
          loadedSessionId={loadedSessionId}
          onLoadProjectedLap={(parsed, sessionId, vehicleMetadata) => applyProjectedLap(parsed, sessionId, vehicleMetadata)}
        />

        <section className="telemetry-panel">
          <div className="panel-heading">
            <h2>{UI_TEXT.telemetryOverlay}</h2>
            <p>{UI_TEXT.manualCsvDescription}</p>
          </div>
          <input
            accept=".csv,text/csv"
            className="hidden-input"
            onChange={(event) => void handleProjectedLapFile(event.target.files?.[0])}
            ref={projectedLapInputRef}
            type="file"
          />
          <button
            className="command-button"
            type="button"
            onClick={() => projectedLapInputRef.current?.click()}
          >
            {UI_TEXT.loadCsvManually}
          </button>
          <label className="context-toggle">
            <input
              checked={showRewinds}
              disabled={!projectedLap?.rewindClusters.length}
              onChange={(event) => setShowRewinds(event.target.checked)}
              type="checkbox"
            />
            {UI_TEXT.rewinds}
          </label>
          {projectedLap ? (
            <dl className="compact-stats telemetry-summary">
              <div>
                <dt>{UI_TEXT.vehicle}</dt>
                <dd className="vehicle-name">{projectedLap.vehicle.displayName}</dd>
              </div>
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
                <dt>{UI_TEXT.rewinds}</dt>
                <dd>{projectedLap.rewindSummary.rewindCount}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.markers}</dt>
                <dd>{projectedLap.markers.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="status-text">{telemetryError ?? UI_TEXT.noProjectedLap}</p>
          )}
          {telemetryError && projectedLap ? <p className="status-text">{telemetryError}</p> : null}
        </section>

        <div className="segmented-group" aria-label={UI_TEXT.elevationScale}>
          {[1, 2, 3, 5].map((scale) => (
            <button
              className={elevationScale === scale ? "active" : ""}
              key={scale}
              type="button"
              onClick={() => setElevationScale(scale)}
            >
              {scale}x
            </button>
          ))}
        </div>

        <label className="context-toggle">
          <input
            checked={showElevationContext}
            onChange={(event) => setShowElevationContext(event.target.checked)}
            type="checkbox"
          />
          {UI_TEXT.elevationContext}
        </label>

        {relativeElevation ? (
          <section className="section-detail compact-panel">
            <h2>{UI_TEXT.relativeElevation}</h2>
            <dl>
              <div>
                <dt>{UI_TEXT.datum}</dt>
                <dd>{UI_TEXT.courseMinimum}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.start}</dt>
                <dd>{formatRelativeHeight(relativeElevation.start_relative_height_m)}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.finish}</dt>
                <dd>{formatRelativeHeight(relativeElevation.finish_relative_height_m)}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.maximum}</dt>
                <dd>{formatRelativeHeight(relativeElevation.range_m)}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.range}</dt>
                <dd>{relativeElevation.range_m.toFixed(1)} m</dd>
              </div>
              <div>
                <dt>{UI_TEXT.minimumAt}</dt>
                <dd>{(relativeElevation.minimum_course_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>{UI_TEXT.maximumAt}</dt>
                <dd>{(relativeElevation.maximum_course_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>{UI_TEXT.visual}</dt>
                <dd>{elevationScale}x</dd>
              </div>
            </dl>
          </section>
        ) : null}


        {projectedLap && projectedLap.rewindSummary.rewindCount > 0 ? (
          <section className="section-detail compact-panel">
            <h2>{UI_TEXT.rewinds}</h2>
            <dl>
              <div>
                <dt>{UI_TEXT.rewinds}</dt>
                <dd>{projectedLap.rewindSummary.rewindCount}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.external}</dt>
                <dd>{projectedLap.rewindSummary.externalImpactSuspectedCount}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.driving}</dt>
                <dd>{projectedLap.rewindSummary.drivingErrorSuspectedCount}</dd>
              </div>
              <div>
                <dt>{UI_TEXT.unclear}</dt>
                <dd>{projectedLap.rewindSummary.undeterminedCount}</dd>
              </div>
            </dl>
            <p className="status-text">{UI_TEXT.rewindCaution}</p>
            <div className="rewind-section-breakdown">
              {Object.entries(projectedLap.rewindSummary.bySection).map(([sectionId, count]) => (
                <span key={sectionId}>{sectionId}: {count}</span>
              ))}
            </div>
            {selectedRewindCluster && selectedRewindDetailPoint ? (
              <div className="rewind-detail">
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
            ) : null}
            <div className="practice-focus">
              <b>{UI_TEXT.practiceFocus}</b>
              {projectedLap.rewindSummary.practiceFocus.length > 0 ? projectedLap.rewindSummary.practiceFocus.map((cluster) => (
                <button key={cluster.clusterId} type="button" onClick={() => selectRewindCluster(cluster)}>
                  {cluster.sectionId} {(cluster.courseDistanceM / 1000).toFixed(1)} km
                </button>
              )) : <p className="status-text">{UI_TEXT.noPracticeFocus}</p>}
            </div>
          </section>
        ) : null}
        <div className="section-list" aria-label={UI_TEXT.sections}>
          {reference?.sections.map((section) => (
            <button
              className={section.id === selectedSectionId ? "section-button selected" : "section-button"}
              key={section.id}
              type="button"
              onClick={() => selectSectionForFocus(section.id)}
            >
              <span style={{ backgroundColor: SECTION_COLORS[section.id] }} />
              <b>{section.id}</b>
              <em>{section.name_en}</em>
            </button>
          ))}
        </div>

        {selectedSection ? (
          <section className="section-detail">
            <h2>{selectedSection.id} {selectedSection.name_ja}</h2>
            <p>{selectedSection.name_en}</p>
            <dl>
              <div>
                <dt>{UI_TEXT.start}</dt>
                <dd>{(selectedSection.start_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>{UI_TEXT.end}</dt>
                <dd>{(selectedSection.end_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>{UI_TEXT.length}</dt>
                <dd>{(selectedSection.length_m / 1000).toFixed(3)} km</dd>
              </div>
              {selectedTelemetrySection && selectedTelemetrySection.sampleCount > 0 ? (
                <div>
                  <dt>{UI_TEXT.actualTime}</dt>
                  <dd>{formatSeconds(selectedTelemetrySection.elapsedTimeS)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        <VehicleTunePanel loadedVehicleMetadata={loadedVehicleMetadata} />
      </aside>
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
  if (value === "low") {
    return UI_TEXT.low;
  }
  if (!value) {
    return UI_TEXT.unknown;
  }
  return value;
}

function formatDirection(value: string): string {
  if (value === "unknown" || !value) {
    return UI_TEXT.unknown;
  }
  return value;
}
