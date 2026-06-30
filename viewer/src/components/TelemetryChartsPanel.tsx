import { useState } from "react";
import type { ReferencePayload, SectionId } from "../lib/reference";
import type { ProjectedLapPayload, ProjectedLapPoint, RewindClusterPayload } from "../lib/telemetryLap";
import {
  effectiveTelemetryPoints,
  telemetryChannelAvailable,
  telemetryChannelValue,
  telemetryRange,
  TELEMETRY_CHANNELS,
  type TelemetryRangeMode,
} from "../lib/telemetryChart";
import { TelemetryChartCanvas } from "./TelemetryChartCanvas";

interface TelemetryChartsPanelProps {
  reference: ReferencePayload | null;
  projectedLap: ProjectedLapPayload | null;
  selectedSectionId: SectionId;
  selectedRewindClusterId: string;
  activeTelemetryPoint: ProjectedLapPoint | null;
  pinnedTelemetryPoint: ProjectedLapPoint | null;
  onHoverTelemetryPoint: (point: ProjectedLapPoint | null) => void;
  onPinTelemetryPoint: (point: ProjectedLapPoint | null) => void;
  onSelectSection: (sectionId: SectionId) => void;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
}

export function TelemetryChartsPanel({
  reference,
  projectedLap,
  selectedSectionId,
  selectedRewindClusterId,
  activeTelemetryPoint,
  pinnedTelemetryPoint,
  onHoverTelemetryPoint,
  onPinTelemetryPoint,
  onSelectSection,
  onSelectRewindCluster,
}: TelemetryChartsPanelProps) {
  const [rangeMode, setRangeMode] = useTelemetryRangeMode();

  if (!reference) {
    return null;
  }

  if (!projectedLap) {
    return (
      <section className="telemetry-charts-panel" aria-label="Telemetry charts">
        <div className="panel-heading">
          <h2>Telemetry Charts</h2>
          <p>Load a processed lap to view telemetry charts.</p>
        </div>
      </section>
    );
  }

  const points = effectiveTelemetryPoints(projectedLap);
  const range = telemetryRange(projectedLap, rangeMode, selectedSectionId, reference.sections);
  const cursorPoint = activeTelemetryPoint;

  function pinPoint(point: ProjectedLapPoint | null): void {
    onPinTelemetryPoint(point);
    if (point) {
      onSelectSection(point.sectionId);
    }
  }

  function setMode(mode: TelemetryRangeMode): void {
    setRangeMode(mode);
  }

  return (
    <section className="telemetry-charts-panel" aria-label="Telemetry charts">
      <div className="telemetry-charts-header">
        <div className="panel-heading">
          <h2>Telemetry Charts</h2>
          <p>{projectedLap.vehicle.displayName} - {projectedLap.sessionId || "Unknown session"}</p>
        </div>
        <div className="telemetry-chart-controls" aria-label="Telemetry chart range">
          <button className={rangeMode === "full" ? "active" : ""} type="button" onClick={() => setMode("full")}>Full lap</button>
          <button className={rangeMode === "section" ? "active" : ""} type="button" onClick={() => setMode("section")}>Selected section</button>
          <button disabled={!pinnedTelemetryPoint} type="button" onClick={() => onPinTelemetryPoint(null)}>Clear cursor</button>
        </div>
      </div>
      <div className="telemetry-cursor-readout" aria-live="polite">
        {cursorPoint ? <CursorValues point={cursorPoint} /> : <span>Move over a chart to inspect distance, section, lap time, and channel values.</span>}
      </div>
      <div className="telemetry-chart-stack">
        {TELEMETRY_CHANNELS.map((channel) => (
          <TelemetryChartCanvas
            activePoint={cursorPoint}
            available={telemetryChannelAvailable(projectedLap, channel.id)}
            channel={channel}
            key={channel.id}
            markers={reference.markers}
            onHoverPoint={onHoverTelemetryPoint}
            onPinPoint={pinPoint}
            onSelectRewindCluster={onSelectRewindCluster}
            points={points}
            range={range}
            rewindClusters={projectedLap.rewindClusters}
            sections={reference.sections}
            selectedRewindClusterId={selectedRewindClusterId}
          />
        ))}
      </div>
      <p className="telemetry-chart-description-text">
        Effective driving trace uses non-superseded samples. Rewind markers remain event markers. Decimation is display-only and preserves extrema.
      </p>
    </section>
  );
}

function CursorValues({ point }: { point: ProjectedLapPoint }) {
  return (
    <dl>
      <div><dt>Distance</dt><dd>{(point.courseDistanceM / 1000).toFixed(3)} km</dd></div>
      <div><dt>Section</dt><dd>{point.sectionId}</dd></div>
      <div><dt>Lap time</dt><dd>{formatSeconds(point.lapTimeS)}</dd></div>
      <div><dt>Speed</dt><dd>{point.speedKmh.toFixed(1)} km/h</dd></div>
      <div><dt>Throttle</dt><dd>{formatNullable(telemetryChannelValue(point, "throttle"), "%")}</dd></div>
      <div><dt>Brake</dt><dd>{formatNullable(telemetryChannelValue(point, "brake"), "%")}</dd></div>
      <div><dt>Steering</dt><dd>{formatNullable(telemetryChannelValue(point, "steering"), "")}</dd></div>
    </dl>
  );
}

function useTelemetryRangeMode(): [TelemetryRangeMode, (mode: TelemetryRangeMode) => void] {
  return useState<TelemetryRangeMode>("full");
}

function formatNullable(value: number | null, unit: string): string {
  if (value === null) {
    return "N/A";
  }
  const formatted = unit === "%" ? value.toFixed(0) : value.toFixed(3);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}