import { useEffect, useMemo, useRef, useState } from "react";
import type { ReferencePayload, SectionDefinition, SectionId } from "./lib/reference";
import { SECTION_COLORS, fetchReference } from "./lib/reference";
import { CourseScene } from "./components/CourseScene";
import { VehicleTunePanel } from "./components/VehicleTunePanel";
import { parseProjectedLapCsv, type ProjectedLapPayload } from "./lib/telemetryLap";

type ViewMode = "3d" | "2d";

export function App() {
  const [reference, setReference] = useState<ReferencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>("S1");
  const [elevationScale, setElevationScale] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [projectedLap, setProjectedLap] = useState<ProjectedLapPayload | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(true);
  const [showActual, setShowActual] = useState(true);
  const [showElevationContext, setShowElevationContext] = useState(true);
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

  async function handleProjectedLapFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setProjectedLap(parseProjectedLapCsv(text, file.name));
      setTelemetryError(null);
      setShowActual(true);
    } catch (caught: unknown) {
      setTelemetryError(caught instanceof Error ? caught.message : "Failed to load projected lap.");
      setProjectedLap(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="viewer-surface">
        {reference ? (
          <>
            <CourseScene
              key={`${viewMode}-${cameraResetKey}`}
              reference={reference}
              elevationScale={elevationScale}
              selectedSectionId={selectedSectionId}
              viewMode={viewMode}
              projectedLap={projectedLap}
              showReference={showReference}
              showActual={showActual}
              showElevationContext={showElevationContext}
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

        <section className="telemetry-panel">
          <div className="panel-heading">
            <h2>Telemetry Overlay</h2>
            <p>Load a processed projected-lap CSV.</p>
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
            Load projected lap
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
          {projectedLap ? (
            <dl className="compact-stats">
              <div>
                <dt>File</dt>
                <dd>{projectedLap.fileName}</dd>
              </div>
              <div>
                <dt>Lap time</dt>
                <dd>{formatSeconds(projectedLap.totalLapTimeS)}</dd>
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