import { Canvas } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ElementRef } from "react";
import * as THREE from "three";
import type { BoundaryMarker, ReferencePayload, ReferencePointTuple, SectionId } from "../lib/reference";
import { POINT, SECTION_COLORS, nearestPointByDistance, pointSectionId } from "../lib/reference";
import {
  referencePointsToOverviewTarget,
  referencePointToRenderVector,
  referencePointsToRenderBounds,
  type RenderBounds,
} from "../lib/renderCoordinates";
import { getCameraUpVector, getCanonical3DAnalysisCameraPosition, getTopDownCameraPosition } from "../lib/cameraFraming";
import { OVERVIEW_AUTO_ROTATE_SPEED, type MapDisplayMode } from "../lib/mapDisplayMode";
import { displayCoordinatesToRenderVector, getRelativeHeightM } from "../lib/renderTransform";
import type { ProjectedLapPayload, ProjectedLapPoint, RewindClusterPayload } from "../lib/telemetryLap";

const MUTED_SECTION_COLOR = "#343b44";
const MUTED_MARKER_COLOR = "#7b8490";
const NON_SELECTED_OPACITY = 0.26;
const OVERVIEW_LINE_OPACITY = 1;
const OVERVIEW_REFERENCE_WIDTH = 5;
const OVERVIEW_ACTUAL_WIDTH = 7;
const SELECTED_REFERENCE_WIDTH = 9;
const SELECTED_ACTUAL_WIDTH = 11;
const REFERENCE_HALO_WIDTH = 17;
const ACTUAL_HALO_WIDTH = 19;
const MUTED_LINE_WIDTH = 2;
const BASE_PLANE_MARGIN = 1800;
const GUIDE_DEDUP_DISTANCE_M = 1;

type ViewMode = "2d" | "3d";

interface CourseSceneProps {
  reference: ReferencePayload;
  elevationScale: number;
  selectedSectionId: SectionId;
  mapDisplayMode: MapDisplayMode;
  viewMode: ViewMode;
  overviewAutoRotate: boolean;
  projectedLap?: ProjectedLapPayload | null;
  showReference: boolean;
  showActual: boolean;
  showElevationContext: boolean;
  showRewinds: boolean;
  selectedRewindClusterId: string;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
  onManualCameraInteraction: () => void;
  activeTelemetryPoint?: ProjectedLapPoint | null;
}

export function CourseScene({
  reference,
  elevationScale,
  selectedSectionId,
  mapDisplayMode,
  viewMode,
  overviewAutoRotate,
  projectedLap,
  showReference,
  showActual,
  showElevationContext,
  showRewinds,
  selectedRewindClusterId,
  onSelectRewindCluster,
  onManualCameraInteraction,
  activeTelemetryPoint,
}: CourseSceneProps) {
  const baselineDisplayY = reference.coordinate_system.relative_elevation.baseline_display_y;
  const bounds = useMemo(
    () => referencePointsToRenderBounds(reference.points, elevationScale, baselineDisplayY),
    [baselineDisplayY, reference.points, elevationScale],
  );
  const overviewTarget = useMemo(
    () => referencePointsToOverviewTarget(reference.points, elevationScale, baselineDisplayY),
    [baselineDisplayY, reference.points, elevationScale],
  );
  const cameraPosition = useMemo(
    () => (viewMode === "2d" ? getTopDownCameraPosition(bounds) : getCanonical3DAnalysisCameraPosition(bounds, overviewTarget)),
    [bounds, overviewTarget, viewMode],
  );

  return (
    <div className="course-canvas-wrap" onPointerDown={onManualCameraInteraction} onWheel={onManualCameraInteraction}>
      <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#101318"]} />
      <SceneCamera
        bounds={bounds}
        cameraPosition={cameraPosition}
        overviewTarget={overviewTarget}
        viewMode={viewMode}
      />
      <ambientLight intensity={0.85} />
      <directionalLight position={[2500, 5000, 2500]} intensity={1.4} />
      <Grid
        args={[90000, 24]}
        position={[bounds.center[0], 0.8, bounds.center[2]]}
        cellColor="#2b323b"
        sectionColor="#46515d"
        fadeDistance={90000}
      />
      {viewMode === "3d" && showElevationContext ? (
        <ElevationContext reference={reference} bounds={bounds} elevationScale={elevationScale} />
      ) : null}
      <CourseLines
        reference={reference}
        projectedLap={projectedLap}
        elevationScale={elevationScale}
        baselineDisplayY={baselineDisplayY}
        selectedSectionId={selectedSectionId}
        mapDisplayMode={mapDisplayMode}
        showReference={showReference}
        showActual={showActual}
        showRewinds={showRewinds}
        selectedRewindClusterId={selectedRewindClusterId}
        onSelectRewindCluster={onSelectRewindCluster}
        activeTelemetryPoint={activeTelemetryPoint}
      />
      <SceneControls
        bounds={bounds}
        cameraPosition={cameraPosition}
        overviewAutoRotate={overviewAutoRotate}
        overviewTarget={overviewTarget}
        viewMode={viewMode}
        onManualCameraInteraction={onManualCameraInteraction}
      />
      </Canvas>
    </div>
  );
}

function SceneCamera({
  bounds,
  cameraPosition,
  overviewTarget,
  viewMode,
}: {
  bounds: RenderBounds;
  cameraPosition: [number, number, number];
  overviewTarget: [number, number, number];
  viewMode: ViewMode;
}) {
  const topDownRef = useRef<THREE.OrthographicCamera | null>(null);
  const perspectiveRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const camera = viewMode === "2d" ? topDownRef.current : perspectiveRef.current;
    if (!camera) {
      return;
    }
    applyCameraPose(camera, cameraPosition, viewMode === "2d" ? bounds.center : overviewTarget, viewMode);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [bounds.center, cameraPosition, overviewTarget, viewMode]);

  if (viewMode === "2d") {
    const halfSize = bounds.size * 0.55;
    return (
      <OrthographicCamera
        ref={topDownRef}
        makeDefault
        position={cameraPosition}
        up={[0, 0, -1]}
        left={-halfSize}
        right={halfSize}
        top={halfSize}
        bottom={-halfSize}
        near={1}
        far={200000}
      />
    );
  }

  return (
    <PerspectiveCamera
      ref={perspectiveRef}
      makeDefault
      position={cameraPosition}
      up={[0, 1, 0]}
      near={1}
      far={200000}
      fov={45}
    />
  );
}

function SceneControls({
  bounds,
  cameraPosition,
  overviewAutoRotate,
  overviewTarget,
  viewMode,
  onManualCameraInteraction,
}: {
  bounds: RenderBounds;
  cameraPosition: [number, number, number];
  overviewAutoRotate: boolean;
  overviewTarget: [number, number, number];
  viewMode: ViewMode;
  onManualCameraInteraction: () => void;
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls> | null>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    controls.addEventListener("start", onManualCameraInteraction);
    return () => controls.removeEventListener("start", onManualCameraInteraction);
  }, [onManualCameraInteraction]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    controls.autoRotate = overviewAutoRotate;
    controls.autoRotateSpeed = OVERVIEW_AUTO_ROTATE_SPEED;
    controls.update();
  }, [overviewAutoRotate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    const target = viewMode === "2d" ? bounds.center : overviewTarget;
    applyCameraPose(controls.object, cameraPosition, target, viewMode);
    controls.target.set(...target);
    controls.update();
  }, [bounds.center, cameraPosition, overviewTarget, viewMode]);

  return (
    <OrbitControls
      ref={controlsRef}
      autoRotate={overviewAutoRotate}
      autoRotateSpeed={OVERVIEW_AUTO_ROTATE_SPEED}
      enableRotate={viewMode === "3d"}
      enablePan
      enableZoom
      target={viewMode === "2d" ? bounds.center : overviewTarget}
      minPolarAngle={viewMode === "3d" ? 0.15 : 0}
      maxPolarAngle={viewMode === "3d" ? Math.PI / 2 - 0.03 : Math.PI}
      maxDistance={100000}
      minDistance={1500}
      onStart={onManualCameraInteraction}
    />
  );
}

function applyCameraPose(
  camera: THREE.Camera,
  position: [number, number, number],
  target: [number, number, number],
  viewMode: ViewMode,
) {
  camera.position.set(...position);
  camera.up.set(...getCameraUpVector(viewMode));
  camera.lookAt(...target);
}

function ElevationContext({
  reference,
  bounds,
  elevationScale,
}: {
  reference: ReferencePayload;
  bounds: RenderBounds;
  elevationScale: number;
}) {
  const metadata = reference.coordinate_system.relative_elevation;
  const baselineDisplayY = metadata.baseline_display_y;
  const width = bounds.max[0] - bounds.min[0] + BASE_PLANE_MARGIN * 2;
  const depth = bounds.max[2] - bounds.min[2] + BASE_PLANE_MARGIN * 2;
  const guides = useMemo(
    () => buildElevationGuides(reference, elevationScale, baselineDisplayY),
    [baselineDisplayY, elevationScale, reference],
  );

  return (
    <group>
      <mesh position={[bounds.center[0], 0, bounds.center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color="#8d99a6"
          opacity={0.08}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Html position={[bounds.min[0], 160, bounds.max[2]]} center>
        <span className="elevation-context-label">Relative elevation 0 m</span>
      </Html>
      {guides.map((guide) => (
        <group key={guide.key}>
          <Line
            points={[
              [guide.position[0], 0, guide.position[2]],
              guide.position,
            ]}
            color="#aab4bf"
            lineWidth={1}
            transparent
            opacity={0.42}
          />
          <Html position={[guide.position[0], guide.position[1] + 180, guide.position[2]]} center>
            <span className="elevation-guide-label">
              {guide.label} {formatGuideHeight(guide.relativeHeightM)}
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}

interface ElevationGuide {
  key: string;
  label: string;
  relativeHeightM: number;
  position: [number, number, number];
  courseDistanceM: number;
}

function buildElevationGuides(
  reference: ReferencePayload,
  elevationScale: number,
  baselineDisplayY: number,
): ElevationGuide[] {
  const metadata = reference.coordinate_system.relative_elevation;
  const candidates: Array<{ label: string; point: ReferencePointTuple | undefined }> = [
    { label: "START", point: reference.points[0] },
    ...reference.markers.map((marker) => ({
      label: marker.label,
      point: nearestPointByDistance(reference.points, marker.course_distance_m),
    })),
    { label: "FINISH", point: reference.points[reference.points.length - 1] },
    { label: "MIN", point: nearestPointByDistance(reference.points, metadata.minimum_course_distance_m) },
    { label: "MAX", point: nearestPointByDistance(reference.points, metadata.maximum_course_distance_m) },
  ];

  const guides: ElevationGuide[] = [];
  for (const candidate of candidates) {
    if (!candidate.point) {
      continue;
    }
    const distanceM = candidate.point[POINT.courseDistanceM];
    const existing = guides.find((guide) => Math.abs(guide.courseDistanceM - distanceM) <= GUIDE_DEDUP_DISTANCE_M);
    if (existing) {
      if (!existing.label.split(" / ").includes(candidate.label)) {
        existing.label = `${existing.label} / ${candidate.label}`;
      }
      continue;
    }
    const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(
      candidate.point[POINT.displayX],
      candidate.point[POINT.displayY],
      candidate.point[POINT.displayZ],
      elevationScale,
      baselineDisplayY,
    );
    guides.push({
      key: `${candidate.label}-${distanceM.toFixed(3)}`,
      label: candidate.label,
      relativeHeightM: getRelativeHeightM(candidate.point[POINT.displayY], baselineDisplayY),
      position: [renderX, renderY, renderZ],
      courseDistanceM: distanceM,
    });
  }
  return guides;
}

function CourseLines({
  reference,
  projectedLap,
  elevationScale,
  baselineDisplayY,
  selectedSectionId,
  mapDisplayMode,
  showReference,
  showActual,
  showRewinds,
  selectedRewindClusterId,
  onSelectRewindCluster,
  activeTelemetryPoint,
}: {
  reference: ReferencePayload;
  projectedLap?: ProjectedLapPayload | null;
  elevationScale: number;
  baselineDisplayY: number;
  selectedSectionId: SectionId;
  mapDisplayMode: MapDisplayMode;
  showReference: boolean;
  showActual: boolean;
  showRewinds: boolean;
  selectedRewindClusterId: string;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
  activeTelemetryPoint?: ProjectedLapPoint | null;
}) {
  const sectionPoints = useMemo(() => {
    const grouped = new Map<SectionId, ReferencePointTuple[]>();
    for (const point of reference.points) {
      const id = pointSectionId(reference, point);
      const points = grouped.get(id) ?? [];
      points.push(point);
      grouped.set(id, points);
    }
    return grouped;
  }, [reference]);

  const actualSectionPoints = useMemo(() => {
    const grouped = new Map<SectionId, ProjectedLapPoint[]>();
    for (const point of projectedLap?.effectivePoints ?? []) {
      const points = grouped.get(point.sectionId) ?? [];
      points.push(point);
      grouped.set(point.sectionId, points);
    }
    return grouped;
  }, [projectedLap]);

  const markerPoints = useMemo(() => {
    return reference.markers
      .map((marker) => ({
        marker,
        point: nearestPointByDistance(reference.points, marker.course_distance_m),
      }))
      .filter((item): item is typeof item & { point: ReferencePointTuple } => Boolean(item.point));
  }, [reference.markers, reference.points]);

  const startPoint = reference.points[0];
  const finishPoint = reference.points[reference.points.length - 1];

  return (
    <group>
      {showReference ? reference.sections.flatMap((section) => {
        const points = sectionPoints.get(section.id) ?? [];
        const renderedPoints = points.map((point) => referencePointToRenderVector(point, elevationScale, baselineDisplayY));
        const isSelected = section.id === selectedSectionId;
        const isOverview = mapDisplayMode === "overview";
        const mainLine = (
          <Line
            key={section.id}
            points={renderedPoints}
            color={isOverview || isSelected ? SECTION_COLORS[section.id] : MUTED_SECTION_COLOR}
            lineWidth={isOverview ? OVERVIEW_REFERENCE_WIDTH : isSelected ? SELECTED_REFERENCE_WIDTH : MUTED_LINE_WIDTH}
            transparent
            opacity={isOverview || isSelected ? OVERVIEW_LINE_OPACITY : NON_SELECTED_OPACITY}
          />
        );
        if (isOverview || !isSelected) {
          return [mainLine];
        }
        return [
          <Line
            key={`${section.id}-halo`}
            points={renderedPoints}
            color={SECTION_COLORS[section.id]}
            lineWidth={REFERENCE_HALO_WIDTH}
            transparent
            opacity={0.22}
          />,
          mainLine,
        ];
      }) : null}
      {showActual && projectedLap ? reference.sections.flatMap((section) => {
        const points = actualSectionPoints.get(section.id) ?? [];
        if (points.length === 0) {
          return [];
        }
        const renderedPoints = points.map((point) => projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY));
        const isSelected = section.id === selectedSectionId;
        const isOverview = mapDisplayMode === "overview";
        const mainLine = (
          <Line
            key={`actual-${section.id}`}
            points={renderedPoints}
            color={isOverview || isSelected ? SECTION_COLORS[section.id] : MUTED_SECTION_COLOR}
            lineWidth={isOverview ? OVERVIEW_ACTUAL_WIDTH : isSelected ? SELECTED_ACTUAL_WIDTH : MUTED_LINE_WIDTH}
            transparent
            opacity={isOverview || isSelected ? OVERVIEW_LINE_OPACITY : NON_SELECTED_OPACITY}
          />
        );
        if (isOverview || !isSelected) {
          return [mainLine];
        }
        return [
          <Line
            key={`actual-${section.id}-halo`}
            points={renderedPoints}
            color={SECTION_COLORS[section.id]}
            lineWidth={ACTUAL_HALO_WIDTH}
            transparent
            opacity={0.18}
          />,
          mainLine,
        ];
      }) : null}
      {markerPoints.map(({ marker, point }) => {
        const isBoundary = mapDisplayMode === "overview" ? true : markerTouchesSection(marker, selectedSectionId);
        return (
          <Marker
            color={isBoundary ? "#ffffff" : MUTED_MARKER_COLOR}
            key={marker.id}
            label={marker.label}
            point={point}
            elevationScale={elevationScale}
            baselineDisplayY={baselineDisplayY}
            labelDimmed={!isBoundary}
            opacity={isBoundary ? 1 : 0.38}
            scale={isBoundary ? 1.12 : 0.78}
          />
        );
      })}
      {showActual && projectedLap ? projectedLap.markers.map((point) => {
        const isBoundary = mapDisplayMode === "overview"
          ? true
          : actualMarkerTouchesSection(reference, point.manualMarkerId, selectedSectionId);
        return (
          <Marker
            color={isBoundary ? "#f8fafc" : MUTED_MARKER_COLOR}
            key={`actual-marker-${point.manualMarkerId}-${point.sourceRowIndex}`}
            label={point.manualMarkerId}
            position={projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY)}
            labelDimmed={!isBoundary}
            opacity={isBoundary ? 1 : 0.38}
            scale={isBoundary ? 1.12 : 0.78}
          />
        );
      }) : null}
      {showRewinds && projectedLap ? projectedLap.rewindClusters.map((cluster) => (
        <RewindClusterMarker
          baselineDisplayY={baselineDisplayY}
          cluster={cluster}
          elevationScale={elevationScale}
          key={cluster.clusterId}
          onSelect={onSelectRewindCluster}
          selected={cluster.clusterId === selectedRewindClusterId}
        />
      )) : null}
      <Marker
        color="#35f28b"
        label="START"
        point={startPoint}
        elevationScale={elevationScale}
        baselineDisplayY={baselineDisplayY}
      />
      <Marker
        color="#ff4f64"
        label="FINISH"
        point={finishPoint}
        elevationScale={elevationScale}
        baselineDisplayY={baselineDisplayY}
      />
    </group>
  );
}

function TelemetryCursorMarker({
  baselineDisplayY,
  elevationScale,
  point,
}: {
  baselineDisplayY: number;
  elevationScale: number;
  point: ProjectedLapPoint;
}) {
  const position = projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY);
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[155, 24, 24]} />
        <meshStandardMaterial color="#ffffff" emissive="#22d3ee" emissiveIntensity={0.8} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[230, 18, 12, 36]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.78} />
      </mesh>
      <Html distanceFactor={11000} position={[0, 430, 0]} center>
        <span className="scene-label telemetry-cursor-label">{(point.courseDistanceM / 1000).toFixed(3)} km</span>
      </Html>
    </group>
  );
}
function RewindClusterMarker({
  baselineDisplayY,
  cluster,
  elevationScale,
  onSelect,
  selected,
}: {
  baselineDisplayY: number;
  cluster: RewindClusterPayload;
  elevationScale: number;
  onSelect: (cluster: RewindClusterPayload) => void;
  selected: boolean;
}) {
  const point = cluster.points[0];
  const position = projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY);
  const color = rewindClusterColor(cluster);
  return (
    <group
      position={position}
      onClick={(event) => { event.stopPropagation(); onSelect(cluster); }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <mesh>
        <sphereGeometry args={[selected ? 180 : 135, 18, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.55 : 0.28} />
      </mesh>
      <Html distanceFactor={11000} position={[0, 360, 0]} center>
        <button
          className={selected ? "rewind-label selected" : "rewind-label"}
          onClick={(event) => { event.stopPropagation(); onSelect(cluster); }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          x{cluster.eventCount}
        </button>
      </Html>
    </group>
  );
}

function rewindClusterColor(cluster: RewindClusterPayload): string {
  if (cluster.drivingErrorSuspectedCount > 0) {
    return "#f59e0b";
  }
  if (cluster.externalImpactSuspectedCount > 0) {
    return "#60a5fa";
  }
  return "#94a3b8";
}
function markerTouchesSection(
  marker: BoundaryMarker,
  selectedSectionId: SectionId,
): boolean {
  return marker.from_section_id === selectedSectionId || marker.to_section_id === selectedSectionId;
}

function actualMarkerTouchesSection(
  reference: ReferencePayload,
  markerId: string,
  selectedSectionId: SectionId,
): boolean {
  const referenceMarker = reference.markers.find((marker) => marker.id === markerId);
  return referenceMarker ? markerTouchesSection(referenceMarker, selectedSectionId) : false;
}

function Marker({
  color,
  label,
  point,
  elevationScale,
  baselineDisplayY,
  position,
  labelDimmed = false,
  opacity = 1,
  scale = 1,
}: {
  color: string;
  label: string;
  point?: ReferencePointTuple;
  elevationScale?: number;
  baselineDisplayY?: number;
  position?: THREE.Vector3;
  labelDimmed?: boolean;
  opacity?: number;
  scale?: number;
}) {
  const markerPosition = position ?? referencePointToRenderVector(point!, elevationScale!, baselineDisplayY ?? 0);
  return (
    <group position={markerPosition}>
      <mesh>
        <sphereGeometry args={[95 * scale, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={labelDimmed ? 0.1 : 0.35}
          opacity={opacity}
          transparent={opacity < 1}
        />
      </mesh>
      <Html distanceFactor={11000} position={[0, 260, 0]} center>
        <span className={labelDimmed ? "scene-label scene-label-dimmed" : "scene-label"}>{label}</span>
      </Html>
    </group>
  );
}

function projectedLapPointToRenderVector(
  point: ProjectedLapPoint,
  elevationScale: number,
  baselineDisplayY: number,
): THREE.Vector3 {
  const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(
    point.displayX,
    point.displayY,
    point.displayZ,
    elevationScale,
    baselineDisplayY,
  );
  return new THREE.Vector3(renderX, renderY, renderZ);
}

function formatGuideHeight(heightM: number): string {
  const rounded = Math.round(heightM);
  if (Math.abs(rounded) === 0) {
    return "0 m";
  }
  return rounded > 0 ? `+${rounded} m` : `${rounded} m`;
}
