import { useEffect, useMemo, useRef, useState } from "react";
import type { ReferencePayload, SectionDefinition, SectionId } from "./lib/reference";
import { SECTION_COLORS, fetchReference } from "./lib/reference";
import { CourseScene } from "./components/CourseScene";
import { VehicleTunePanel } from "./components/VehicleTunePanel";
import { SessionBrowserPanel } from "./components/SessionBrowserPanel";
import { classificationLabel, parseProjectedLapCsv, type ProjectedLapPayload, type ProjectedLapPoint, type RewindClusterPayload } from "./lib/telemetryLap";
import { buildCameraLifecycleKey } from "./lib/cameraLifecycle";
import { sectionForRewindSelection } from "./lib/rewindSelection";

type ViewMode = "3d" | "2d";

export function App() {
  const [reference, setReference] = useState<ReferencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>("S1");
  const [elevationScale, setElevationScale] = useState(5);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [projectedLap, setProjectedLap] = useState<ProjectedLapPayload | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState("");
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(true);
  const [showActual, setShowActual] = useState(true);
  const [showElevationContext, setShowElevationContext] = useState(true);
  const [showRewinds, setShowRewinds] = useState(true);
  const [selectedRewindClusterId, setSelectedRewindClusterId] = useState("");
  const [selectedRewindEventId, setSelectedRewindEventId] = useState("");
  const projectedLapInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchReference()
      .then((payload) => {
        setReference(payload);
        setSelectedSectionId(payload.sections[0]?.id ?? "S1");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Failed to load reference data.");
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

  function applyProjectedLap(parsed: ProjectedLapPayload, loadedSession: string): void {
    setProjectedLap(parsed);
    setLoadedSessionId(loadedSession);
    const firstRewindCluster = parsed.rewindClusters[0];
    setSelectedRewindClusterId(firstRewindCluster?.clusterId ?? "");
    setSelectedRewindEventId("");
    setSelectedSectionId((current) => sectionForRewindSelection(current, firstRewindCluster?.sectionId));
    setTelemetryError(null);
    setShowActual(true);
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
      setTelemetryError(caught instanceof Error ? caught.message : "Failed to load projected lap.");
      setProjectedLap(null);
      setLoadedSessionId("");
    }
  }

  return (
    <main className="app-shell">
      <section className="viewer-surface">
        {reference ? (
          <>
            <CourseScene
              key={cameraLifecycleKey}
              reference={reference}
              elevationScale={elevationScale}
              selectedSectionId={selectedSectionId}
              viewMode={viewMode}
              projectedLap={projectedLap}
              showReference={showReference}
              showActual={showActual}
              showElevationContext={showElevationContext}
              showRewinds={showRewinds && Boolean(projectedLap?.rewindClusters.length)}
              selectedRewindClusterId={selectedRewindClusterId}
              onSelectRewindCluster={selectRewindCluster}
            />
            <div className="orientation-indicator" aria-label="Map orientation">
              <span>+X -&gt; right</span>
              <span>+Z -&gt; map up</span>
            </div>
          </>
        ) : (
          <div className="load-state">{error ?? "Loading Goliath reference path..."}</div>
        )}
      </section>

      <aside className="control-panel" aria-label="Goliath reference controls">
        <div className="title-block">
          <h1>FH6 Goliath Coach</h1>
          <p>1 m sampled driving path, not verified road geometry.</p>
        </div>

        <div className="control-row">
          <button
            className={viewMode === "3d" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("3d")}
          >
            3D
          </button>
          <button
            className={viewMode === "2d" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("2d")}
          >
            2D
          </button>
        </div>

        <button className="command-button" type="button" onClick={() => setCameraResetKey((key) => key + 1)}>
          Reset camera
        </button>

        <SessionBrowserPanel
          loadedSessionId={loadedSessionId}
          onLoadProjectedLap={(parsed, sessionId) => applyProjectedLap(parsed, sessionId)}
        />

        <section className="telemetry-panel">
          <div className="panel-heading">
            <h2>Telemetry Overlay</h2>
            <p>Load a processed projected-lap CSV manually.</p>
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
            Load CSV manually
          </button>
          <div className="toggle-row">
            <label>
              <input
                checked={showReference}
                onChange={(event) => setShowReference(event.target.checked)}
                type="checkbox"
              />
              Reference
            </label>
            <label>
              <input
                checked={showActual}
                disabled={!projectedLap}
                onChange={(event) => setShowActual(event.target.checked)}
                type="checkbox"
              />
              Actual
            </label>
          </div>
          <label className="context-toggle">
            <input
              checked={showRewinds}
              disabled={!projectedLap?.rewindClusters.length}
              onChange={(event) => setShowRewinds(event.target.checked)}
              type="checkbox"
            />
            Rewinds
          </label>
          {projectedLap ? (
            <dl className="compact-stats telemetry-summary">
              <div>
                <dt>Vehicle</dt>
                <dd className="vehicle-name">{projectedLap.vehicle.displayName}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{projectedLap.sessionId || "Unknown"}</dd>
              </div>
              <div>
                <dt>File</dt>
                <dd className="file-name">{projectedLap.fileName}</dd>
              </div>
              <div>
                <dt>Lap time</dt>
                <dd>{formatSeconds(projectedLap.totalLapTimeS)}</dd>
              </div>
              <div>
                <dt>Rewinds</dt>
                <dd>{projectedLap.rewindSummary.rewindCount}</dd>
              </div>
              <div>
                <dt>Markers</dt>
                <dd>{projectedLap.markers.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="status-text">{telemetryError ?? "No projected lap loaded."}</p>
          )}
          {telemetryError && projectedLap ? <p className="status-text">{telemetryError}</p> : null}
        </section>

        <div className="segmented-group" aria-label="Elevation scale">
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
          Elevation context
        </label>

        {relativeElevation ? (
          <section className="section-detail compact-panel">
            <h2>Relative Elevation</h2>
            <dl>
              <div>
                <dt>Datum</dt>
                <dd>Course minimum = 0 m</dd>
              </div>
              <div>
                <dt>Start</dt>
                <dd>{formatRelativeHeight(relativeElevation.start_relative_height_m)}</dd>
              </div>
              <div>
                <dt>Finish</dt>
                <dd>{formatRelativeHeight(relativeElevation.finish_relative_height_m)}</dd>
              </div>
              <div>
                <dt>Maximum</dt>
                <dd>{formatRelativeHeight(relativeElevation.range_m)}</dd>
              </div>
              <div>
                <dt>Range</dt>
                <dd>{relativeElevation.range_m.toFixed(1)} m</dd>
              </div>
              <div>
                <dt>Minimum at</dt>
                <dd>{(relativeElevation.minimum_course_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>Maximum at</dt>
                <dd>{(relativeElevation.maximum_course_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>Visual</dt>
                <dd>{elevationScale}x</dd>
              </div>
            </dl>
          </section>
        ) : null}


        {projectedLap && projectedLap.rewindSummary.rewindCount > 0 ? (
          <section className="section-detail compact-panel">
            <h2>Rewinds</h2>
            <dl>
              <div>
                <dt>Rewinds</dt>
                <dd>{projectedLap.rewindSummary.rewindCount}</dd>
              </div>
              <div>
                <dt>External</dt>
                <dd>{projectedLap.rewindSummary.externalImpactSuspectedCount}</dd>
              </div>
              <div>
                <dt>Driving</dt>
                <dd>{projectedLap.rewindSummary.drivingErrorSuspectedCount}</dd>
              </div>
              <div>
                <dt>Unclear</dt>
                <dd>{projectedLap.rewindSummary.undeterminedCount}</dd>
              </div>
            </dl>
            <p className="status-text">External impact suspected is a cautious inference from abrupt impulses or speed changes. It does not identify AI cars, walls, or terrain.</p>
            <div className="rewind-section-breakdown">
              {Object.entries(projectedLap.rewindSummary.bySection).map(([sectionId, count]) => (
                <span key={sectionId}>{sectionId}: {count}</span>
              ))}
            </div>
            {selectedRewindCluster && selectedRewindDetailPoint ? (
              <div className="rewind-detail">
                <h3>{selectedRewindCluster.clusterId} {selectedRewindCluster.sectionId}</h3>
                <dl>
                  <div><dt>Distance</dt><dd>{(selectedRewindDetailPoint.courseDistanceM / 1000).toFixed(3)} km</dd></div>
                  <div><dt>Events</dt><dd>{selectedRewindCluster.eventCount}</dd></div>
                  <div><dt>Class</dt><dd>{classificationLabel(selectedRewindDetailPoint.rewindClassification)}</dd></div>
                  <div><dt>Confidence</dt><dd>{selectedRewindDetailPoint.rewindConfidence || selectedRewindCluster.confidence || "low"}</dd></div>
                  <div><dt>Rewound</dt><dd>{(selectedRewindDetailPoint.rewoundTimeS ?? selectedRewindCluster.rewoundTimeS).toFixed(1)} s / {(selectedRewindDetailPoint.rewoundCourseDistanceM ?? selectedRewindCluster.rewoundCourseDistanceM).toFixed(0)} m</dd></div>
                  <div><dt>Direction</dt><dd>{selectedRewindDetailPoint.rewindImpactDirection || selectedRewindCluster.impactDirection || "unknown"}</dd></div>
                </dl>
                <div className="rewind-event-list" aria-label="Rewind events">
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
                <button className="text-button" type="button" onClick={clearRewindSelection}>Clear rewind selection</button>
              </div>
            ) : null}
            <div className="practice-focus">
              <b>Practice focus</b>
              {projectedLap.rewindSummary.practiceFocus.length > 0 ? projectedLap.rewindSummary.practiceFocus.map((cluster) => (
                <button key={cluster.clusterId} type="button" onClick={() => selectRewindCluster(cluster)}>
                  {cluster.sectionId} {(cluster.courseDistanceM / 1000).toFixed(1)} km
                </button>
              )) : <p className="status-text">No high-confidence practice focus identified.</p>}
            </div>
          </section>
        ) : null}
        <div className="section-list" aria-label="Sections">
          {reference?.sections.map((section) => (
            <button
              className={section.id === selectedSectionId ? "section-button selected" : "section-button"}
              key={section.id}
              type="button"
              onClick={() => setSelectedSectionId(section.id)}
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
                <dt>Start</dt>
                <dd>{(selectedSection.start_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>End</dt>
                <dd>{(selectedSection.end_distance_m / 1000).toFixed(3)} km</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{(selectedSection.length_m / 1000).toFixed(3)} km</dd>
              </div>
              {selectedTelemetrySection && selectedTelemetrySection.sampleCount > 0 ? (
                <div>
                  <dt>Actual time</dt>
                  <dd>{formatSeconds(selectedTelemetrySection.elapsedTimeS)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        <VehicleTunePanel />
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