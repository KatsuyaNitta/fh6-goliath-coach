import { useEffect, useMemo, useRef, useState } from "react";
import type { BoundaryMarker, SectionDefinition } from "../lib/reference";
import { SECTION_COLORS } from "../lib/reference";
import type { ProjectedLapPoint, RewindClusterPayload } from "../lib/telemetryLap";
import {
  decimateTelemetryPoints,
  nearestTelemetryPoint,
  pointsInRange,
  telemetryChannelValue,
  visibleMarkers,
  visibleSections,
  type TelemetryChannelConfig,
  type TelemetryChartRange,
} from "../lib/telemetryChart";

interface TelemetryChartCanvasProps {
  channel: TelemetryChannelConfig;
  points: ProjectedLapPoint[];
  range: TelemetryChartRange;
  sections: SectionDefinition[];
  markers: BoundaryMarker[];
  rewindClusters: RewindClusterPayload[];
  activePoint: ProjectedLapPoint | null;
  selectedRewindClusterId: string;
  available: boolean;
  onHoverPoint: (point: ProjectedLapPoint | null) => void;
  onPinPoint: (point: ProjectedLapPoint | null) => void;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
}

const PADDING_LEFT = 58;
const PADDING_RIGHT = 14;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 24;

export function TelemetryChartCanvas({
  channel,
  points,
  range,
  sections,
  markers,
  rewindClusters,
  activePoint,
  selectedRewindClusterId,
  available,
  onHoverPoint,
  onPinPoint,
  onSelectRewindCluster,
}: TelemetryChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 720, height: 124 });
  const visiblePoints = useMemo(() => pointsInRange(points, range), [points, range]);
  const decimated = useMemo(
    () => decimateTelemetryPoints(visiblePoints, Math.max(1, size.width - PADDING_LEFT - PADDING_RIGHT), [channel.id]),
    [channel.id, size.width, visiblePoints],
  );
  const domain = useMemo(() => valueDomain(visiblePoints, channel), [channel, visiblePoints]);
  const visibleRewinds = useMemo(
    () => rewindClusters.filter((cluster) => cluster.courseDistanceM >= range.startM && cluster.courseDistanceM <= range.endM),
    [range, rewindClusters],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setSize({ width: Math.max(240, rect.width), height: 124 });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawStaticLayer(staticCanvasRef.current, {
      available,
      channel,
      decimatedPoints: decimated.points,
      domain,
      markers: visibleMarkers(markers, range),
      range,
      rewindClusters: visibleRewinds,
      sections: visibleSections(sections, range),
      selectedRewindClusterId,
      size,
    });
  }, [available, channel, decimated.points, domain, markers, range, sections, selectedRewindClusterId, size, visibleRewinds]);

  useEffect(() => {
    drawOverlayLayer(overlayCanvasRef.current, { activePoint, channel, domain, range, size });
  }, [activePoint, channel, domain, range, size]);

  function pointerToPoint(event: React.PointerEvent<HTMLDivElement>): ProjectedLapPoint | null {
    if (!available || visiblePoints.length === 0) {
      return null;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, PADDING_LEFT, rect.width - PADDING_RIGHT);
    const distanceM = xToDistance(x, { ...size, width: rect.width }, range);
    return nearestTelemetryPoint(visiblePoints, distanceM);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointerToPoint(event);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => onHoverPoint(point));
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>): void {
    const point = pointerToPoint(event as unknown as React.PointerEvent<HTMLDivElement>);
    if (!point) {
      return;
    }
    const cluster = nearestRewindCluster(event.currentTarget.getBoundingClientRect(), event.clientX, visibleRewinds, range);
    if (cluster) {
      onSelectRewindCluster(cluster);
    }
    onPinPoint(point);
  }

  return (
    <div className="telemetry-chart-track" aria-label={`${channel.label} telemetry chart`}>
      <div className="telemetry-chart-label">
        <b>{channel.label}</b>
        <span>{channel.unit}</span>
      </div>
      <div
        className="telemetry-chart-canvas-wrap"
        onClick={handleClick}
        onPointerLeave={() => onHoverPoint(null)}
        onPointerMove={handlePointerMove}
        ref={containerRef}
      >
        <canvas aria-hidden="true" className="telemetry-chart-canvas" ref={staticCanvasRef} />
        <canvas aria-hidden="true" className="telemetry-chart-canvas overlay" ref={overlayCanvasRef} />
        {!available ? (
          <div className="telemetry-chart-empty">Not available in this processed file. Reprocess the session to add this channel.</div>
        ) : null}
      </div>
      <span className="telemetry-chart-description">
        {channel.description}. Visible samples {visiblePoints.length}; drawn {decimated.points.length}.
      </span>
    </div>
  );
}

interface StaticLayerArgs {
  available: boolean;
  channel: TelemetryChannelConfig;
  decimatedPoints: ProjectedLapPoint[];
  domain: [number, number];
  markers: BoundaryMarker[];
  range: TelemetryChartRange;
  rewindClusters: RewindClusterPayload[];
  sections: SectionDefinition[];
  selectedRewindClusterId: string;
  size: { width: number; height: number };
}

function drawStaticLayer(canvas: HTMLCanvasElement | null, args: StaticLayerArgs): void {
  const context = prepareCanvas(canvas, args.size);
  if (!context) {
    return;
  }
  const { available, channel, decimatedPoints, domain, markers, range, rewindClusters, sections, selectedRewindClusterId, size } = args;
  context.clearRect(0, 0, size.width, size.height);
  drawFrame(context, size);
  drawSectionBands(context, sections, range, size);
  drawAxisLabels(context, range, domain, size);
  if (channel.id === "steering") {
    const y = valueToY(0, domain, size);
    context.strokeStyle = "rgba(226,232,240,0.22)";
    context.setLineDash([4, 4]);
    line(context, PADDING_LEFT, y, size.width - PADDING_RIGHT, y);
    context.setLineDash([]);
  }
  for (const marker of markers) {
    const x = distanceToX(marker.course_distance_m, size, range);
    context.strokeStyle = "rgba(248,250,252,0.45)";
    line(context, x, PADDING_TOP, x, size.height - PADDING_BOTTOM);
    context.fillStyle = "rgba(248,250,252,0.82)";
    context.fillText(marker.label, x + 3, PADDING_TOP + 12);
  }
  for (const cluster of rewindClusters) {
    const x = distanceToX(cluster.courseDistanceM, size, range);
    context.strokeStyle = cluster.clusterId === selectedRewindClusterId ? "rgba(250,204,21,0.95)" : "rgba(250,204,21,0.52)";
    context.lineWidth = cluster.clusterId === selectedRewindClusterId ? 2 : 1;
    line(context, x, PADDING_TOP, x, size.height - PADDING_BOTTOM);
    context.fillStyle = "rgba(250,204,21,0.9)";
    context.fillText(`R${cluster.eventCount}`, x + 3, size.height - PADDING_BOTTOM - 4);
    context.lineWidth = 1;
  }
  if (!available || decimatedPoints.length === 0) {
    return;
  }
  context.beginPath();
  let started = false;
  for (const point of decimatedPoints) {
    const value = telemetryChannelValue(point, channel.id);
    if (value === null) {
      started = false;
      continue;
    }
    const x = distanceToX(point.courseDistanceM, size, range);
    const y = valueToY(value, domain, size);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  }
  context.strokeStyle = channelColor(channel.id);
  context.lineWidth = 2;
  context.stroke();
}

function drawOverlayLayer(
  canvas: HTMLCanvasElement | null,
  args: { activePoint: ProjectedLapPoint | null; channel: TelemetryChannelConfig; domain: [number, number]; range: TelemetryChartRange; size: { width: number; height: number } },
): void {
  const context = prepareCanvas(canvas, args.size);
  if (!context) {
    return;
  }
  const { activePoint, channel, domain, range, size } = args;
  context.clearRect(0, 0, size.width, size.height);
  if (!activePoint || activePoint.courseDistanceM < range.startM || activePoint.courseDistanceM > range.endM) {
    return;
  }
  const x = distanceToX(activePoint.courseDistanceM, size, range);
  context.strokeStyle = "rgba(255,255,255,0.88)";
  context.lineWidth = 1;
  line(context, x, PADDING_TOP, x, size.height - PADDING_BOTTOM);
  const value = telemetryChannelValue(activePoint, channel.id);
  if (value !== null) {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, valueToY(value, domain, size), 3, 0, Math.PI * 2);
    context.fill();
  }
}

function prepareCanvas(canvas: HTMLCanvasElement | null, size: { width: number; height: number }): CanvasRenderingContext2D | null {
  if (!canvas) {
    return null;
  }
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.floor(size.width * ratio);
  const height = Math.floor(size.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.font = "11px Inter, Segoe UI, sans-serif";
  context.lineWidth = 1;
  context.lineCap = "round";
  context.lineJoin = "round";
  return context;
}

function drawFrame(context: CanvasRenderingContext2D, size: { width: number; height: number }): void {
  context.fillStyle = "#121821";
  context.fillRect(0, 0, size.width, size.height);
  context.strokeStyle = "rgba(148,163,184,0.28)";
  context.strokeRect(PADDING_LEFT, PADDING_TOP, size.width - PADDING_LEFT - PADDING_RIGHT, size.height - PADDING_TOP - PADDING_BOTTOM);
}

function drawSectionBands(
  context: CanvasRenderingContext2D,
  sections: SectionDefinition[],
  range: TelemetryChartRange,
  size: { width: number; height: number },
): void {
  for (const section of sections) {
    const start = distanceToX(Math.max(section.start_distance_m, range.startM), size, range);
    const end = distanceToX(Math.min(section.end_distance_m, range.endM), size, range);
    context.fillStyle = `${SECTION_COLORS[section.id]}22`;
    context.fillRect(start, PADDING_TOP, Math.max(1, end - start), size.height - PADDING_TOP - PADDING_BOTTOM);
    context.fillStyle = "rgba(226,232,240,0.46)";
    context.fillText(section.id, start + 4, size.height - 8);
  }
}

function drawAxisLabels(
  context: CanvasRenderingContext2D,
  range: TelemetryChartRange,
  domain: [number, number],
  size: { width: number; height: number },
): void {
  context.fillStyle = "rgba(226,232,240,0.75)";
  context.fillText(domain[1].toFixed(domain[1] <= 2 ? 1 : 0), 8, PADDING_TOP + 8);
  context.fillText(domain[0].toFixed(domain[1] <= 2 ? 1 : 0), 8, size.height - PADDING_BOTTOM);
  context.fillText(`${(range.startM / 1000).toFixed(1)} km`, PADDING_LEFT, size.height - 7);
  context.fillText(`${(range.endM / 1000).toFixed(1)} km`, size.width - 72, size.height - 7);
}

function valueDomain(points: ProjectedLapPoint[], channel: TelemetryChannelConfig): [number, number] {
  if (channel.fixedDomain) {
    return channel.fixedDomain;
  }
  let max = 1;
  for (const point of points) {
    const value = telemetryChannelValue(point, channel.id);
    if (value !== null && value > max) {
      max = value;
    }
  }
  return [0, Math.max(10, Math.ceil(max / 25) * 25)];
}

function distanceToX(distanceM: number, size: { width: number }, range: TelemetryChartRange): number {
  const span = Math.max(1, range.endM - range.startM);
  return PADDING_LEFT + ((distanceM - range.startM) / span) * (size.width - PADDING_LEFT - PADDING_RIGHT);
}

function xToDistance(x: number, size: { width: number }, range: TelemetryChartRange): number {
  const span = Math.max(1, range.endM - range.startM);
  return range.startM + ((x - PADDING_LEFT) / Math.max(1, size.width - PADDING_LEFT - PADDING_RIGHT)) * span;
}

function valueToY(value: number, domain: [number, number], size: { height: number }): number {
  const span = Math.max(0.000001, domain[1] - domain[0]);
  const ratio = (value - domain[0]) / span;
  return size.height - PADDING_BOTTOM - ratio * (size.height - PADDING_TOP - PADDING_BOTTOM);
}

function nearestRewindCluster(
  rect: DOMRect,
  clientX: number,
  clusters: RewindClusterPayload[],
  range: TelemetryChartRange,
): RewindClusterPayload | null {
  let best: { cluster: RewindClusterPayload; distancePx: number } | null = null;
  for (const cluster of clusters) {
    const x = distanceToX(cluster.courseDistanceM, { width: rect.width }, range);
    const distancePx = Math.abs(clientX - rect.left - x);
    if (distancePx <= 8 && (!best || distancePx < best.distancePx)) {
      best = { cluster, distancePx };
    }
  }
  return best?.cluster ?? null;
}

function channelColor(channel: string): string {
  if (channel === "speed") {
    return "#7dd3fc";
  }
  if (channel === "throttle") {
    return "#86efac";
  }
  if (channel === "brake") {
    return "#fca5a5";
  }
  return "#fbbf24";
}

function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}