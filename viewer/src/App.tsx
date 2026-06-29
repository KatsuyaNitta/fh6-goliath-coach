import { useEffect, useMemo, useState } from "react";
import type { ReferencePayload, SectionDefinition, SectionId } from "./lib/reference";
import { SECTION_COLORS, fetchReference } from "./lib/reference";
import { CourseScene } from "./components/CourseScene";

type ViewMode = "3d" | "2d";

export function App() {
  const [reference, setReference] = useState<ReferencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>("S1");
  const [elevationScale, setElevationScale] = useState(8);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");

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

  return (
    <main className="app-shell">
      <section className="viewer-surface">
        {reference ? (
          <CourseScene
            reference={reference}
            elevationScale={elevationScale}
            selectedSectionId={selectedSectionId}
            viewMode={viewMode}
          />
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

        <label className="slider-row">
          <span>Elevation scale</span>
          <strong>{elevationScale.toFixed(1)}x</strong>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={elevationScale}
            onChange={(event) => setElevationScale(Number(event.target.value))}
          />
        </label>

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
            </dl>
          </section>
        ) : null}
      </aside>
    </main>
  );
}
