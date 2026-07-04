import type { ReferencePayload, SectionId } from "../lib/reference";
import type { ProjectedLapPayload, ProjectedLapPoint, RewindClusterPayload } from "../lib/telemetryLap";
import {
  effectiveTelemetryPoints,
  telemetryChannelAvailable,
  telemetryChannelValue,
  telemetryRange,
  TELEMETRY_CHANNELS,
  TELEMETRY_TRACK_LAYOUTS,
  type TelemetryRangeMode,
} from "../lib/telemetryChart";
import { getRelativeHeightM } from "../lib/renderTransform";
import { CHART_TEXT } from "../lib/uiText";
import { TelemetryChartCanvas } from "./TelemetryChartCanvas";

const CURSOR_ALTITUDE_LABEL = "高度";

interface TelemetryChartsPanelProps {
  reference: ReferencePayload | null;
  projectedLap: ProjectedLapPayload | null;
  selectedSectionId: SectionId;
  chartRangeMode: TelemetryRangeMode;
  selectedRewindClusterId: string;
  activeTelemetryPoint: ProjectedLapPoint | null;
  pinnedTelemetryPoint: ProjectedLapPoint | null;
  onHoverTelemetryPoint: (point: ProjectedLapPoint | null) => void;
  onPinTelemetryPoint: (point: ProjectedLapPoint | null) => void;
  onChartRangeModeChange: (mode: TelemetryRangeMode) => void;
  onSelectSection: (sectionId: SectionId) => void;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
}

export function TelemetryChartsPanel({
  reference,
  projectedLap,
  selectedSectionId,
  chartRangeMode,
  selectedRewindClusterId,
  activeTelemetryPoint,
  pinnedTelemetryPoint,
  onHoverTelemetryPoint,
  onPinTelemetryPoint,
  onChartRangeModeChange,
  onSelectSection,
  onSelectRewindCluster,
}: TelemetryChartsPanelProps) {
  if (!reference) {
    return null;
  }

  if (!projectedLap) {
    return (
      <section className="telemetry-charts-panel" aria-label={CHART_TEXT.title}>
        <div className="panel-heading">
          <h2>{CHART_TEXT.title}</h2>
          <p>{CHART_TEXT.empty}</p>
        </div>
      </section>
    );
  }

  const points = effectiveTelemetryPoints(projectedLap);
  const range = telemetryRange(projectedLap, chartRangeMode, selectedSectionId, reference.sections);
  const cursorPoint = activeTelemetryPoint;

  function pinPoint(point: ProjectedLapPoint | null): void {
    onPinTelemetryPoint(point);
    if (point) {
      onSelectSection(point.sectionId);
    }
  }

  return (
    <section className="telemetry-charts-panel" aria-label={CHART_TEXT.title}>
      <div className="telemetry-charts-header">
        <div className="panel-heading">
          <h2>{CHART_TEXT.title}</h2>
          <p>{projectedLap.vehicle.displayName} - {projectedLap.sessionId || CHART_TEXT.unknownSession}</p>
        </div>
        <div className="telemetry-chart-controls" aria-label={CHART_TEXT.rangeLabel}>
          <button className={chartRangeMode === "full" ? "active" : ""} type="button" onClick={() => onChartRangeModeChange("full")}>{CHART_TEXT.fullLap}</button>
          <button className={chartRangeMode === "section" ? "active" : ""} type="button" onClick={() => onChartRangeModeChange("section")}>{CHART_TEXT.selectedSection}</button>
          <button disabled={!pinnedTelemetryPoint} type="button" onClick={() => onPinTelemetryPoint(null)}>{CHART_TEXT.clearCursor}</button>
        </div>
      </div>
      <div className="telemetry-cursor-readout" aria-live="polite">
        {cursorPoint ? (
          <CursorValues
            baselineDisplayY={reference.coordinate_system.relative_elevation.baseline_display_y}
            point={cursorPoint}
          />
        ) : <span>{CHART_TEXT.cursorHelp}</span>}
      </div>
      <div className="telemetry-chart-stack">
        {TELEMETRY_CHANNELS.map((channel) => {
          const layout = TELEMETRY_TRACK_LAYOUTS[channel.id];
          return (
            <TelemetryChartCanvas
              activePoint={cursorPoint}
              available={telemetryChannelAvailable(projectedLap, channel.id)}
              channel={channel}
              height={layout.height}
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
              showDistanceLabels={layout.showDistanceLabels}
              showGuideLines={layout.showGuideLines}
              showMarkerLabels={layout.showMarkerLabels}
              showRewindLabels={layout.showRewindLabels}
              showSectionLabels={layout.showSectionLabels}
            />
          );
        })}
      </div>
      <p className="telemetry-chart-description-text">
        {CHART_TEXT.description}
      </p>
    </section>
  );
}

function CursorValues({ baselineDisplayY, point }: { baselineDisplayY: number; point: ProjectedLapPoint }) {
  return (
    <dl className="telemetry-cursor-values">
      <div><dt>{CHART_TEXT.distance}</dt><dd>{(point.courseDistanceM / 1000).toFixed(3)} km</dd></div>
      <div><dt>{CHART_TEXT.section}</dt><dd>{point.sectionId}</dd></div>
      <div><dt>{CURSOR_ALTITUDE_LABEL}</dt><dd>{formatAltitude(point.displayY, baselineDisplayY)}</dd></div>
      <div><dt>{CHART_TEXT.lapTime}</dt><dd>{formatSeconds(point.lapTimeS)}</dd></div>
      <div><dt>Speed</dt><dd>{point.speedKmh.toFixed(1)} km/h</dd></div>
      <div><dt>Throttle</dt><dd>{formatNullable(telemetryChannelValue(point, "throttle"), "%")}</dd></div>
      <div><dt>Brake</dt><dd>{formatNullable(telemetryChannelValue(point, "brake"), "%")}</dd></div>
      <div><dt>Steering</dt><dd>{formatNullable(telemetryChannelValue(point, "steering"), "")}</dd></div>
    </dl>
  );
}

function formatAltitude(displayY: number, baselineDisplayY: number): string {
  if (!Number.isFinite(displayY) || !Number.isFinite(baselineDisplayY)) {
    return "N/A";
  }
  return `${Math.round(getRelativeHeightM(displayY, baselineDisplayY))} m`;
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
