import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ElementRef, type RefObject } from "react";
import * as THREE from "three";
import type { ReferencePayload, ReferencePointTuple, SectionId } from "../lib/reference";
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
import { getSectionFocusCameraPose } from "../lib/sectionFocusCamera";
import { activeCourseRenderSource, renderableLapPoints } from "../lib/courseRenderSource";
import type { CourseColorMode, CourseGeometryPayload } from "../lib/courseGeometry";
import {
  actualTelemetryDisplaySample,
  geometryRunKey,
  type GeometryDisplayBand,
  type GeometryDisplaySample,
} from "../lib/courseColorMode";
import {
  CARD_HORIZONTAL_GAP_PX,
  CARD_VERTICAL_GAP_PX,
  LEADER_MIN_LENGTH_PX,
  PLACEMENT_HYSTERESIS_PX,
  ROUTE_CLEARANCE_PX,
  VIEWPORT_INSET_PX,
  chooseTelemetryCalloutPlacement,
  type TelemetryCalloutPlacement,
  type TelemetryCalloutRoutePoint,
} from "../lib/telemetryCalloutPlacement";
import { telemetryChannelValue } from "../lib/telemetryChart";
import type { ProjectedLapPayload, ProjectedLapPoint, RewindClusterPayload } from "../lib/telemetryLap";
import { UI_TEXT } from "../lib/uiText";

const MUTED_SECTION_COLOR = "#343b44";
const NON_SELECTED_OPACITY = 0.26;
const OVERVIEW_LINE_OPACITY = 1;
const OVERVIEW_REFERENCE_WIDTH = 5;
const OVERVIEW_ACTUAL_WIDTH = 7;
const SELECTED_REFERENCE_WIDTH = 9;
const SELECTED_ACTUAL_WIDTH = 11;
const REFERENCE_HALO_WIDTH = 17;
const ACTUAL_HALO_WIDTH = 19;
const MUTED_LINE_WIDTH = 2;
const TELEMETRY_ROUTE_PROJECTION_SAMPLE_LIMIT = 1000;
const BASE_PLANE_MARGIN = 1800;
const GUIDE_DEDUP_DISTANCE_M = 1;
const START_FINISH_MERGE_DISTANCE_M = 500;
const START_FINISH_LABEL = "START / FINISH";

type ViewMode = "2d" | "3d";
interface SectionFocusRequest {
  sectionId: SectionId;
  requestId: number;
}

interface GeometryRenderPoint {
  position: THREE.Vector3;
  sample: GeometryDisplaySample;
}

interface GeometryRenderRun {
  band: GeometryDisplayBand;
  colors: THREE.Color[];
  key: string;
  points: THREE.Vector3[];
}

interface CourseSceneProps {
  reference: ReferencePayload;
  elevationScale: number;
  selectedSectionId: SectionId;
  mapDisplayMode: MapDisplayMode;
  viewMode: ViewMode;
  overviewAutoRotate: boolean;
  sectionFocusRequest?: SectionFocusRequest | null;
  projectedLap?: ProjectedLapPayload | null;
  courseGeometry: CourseGeometryPayload | null;
  courseColorMode: CourseColorMode;
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
  sectionFocusRequest,
  projectedLap,
  courseGeometry,
  courseColorMode,
  showElevationContext,
  showRewinds,
  selectedRewindClusterId,
  onSelectRewindCluster,
  onManualCameraInteraction,
  activeTelemetryPoint,
}: CourseSceneProps) {
  const telemetryCursorHudRef = useRef<HTMLDivElement | null>(null);
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
  const activeTelemetryPosition = useMemo(
    () => activeTelemetryPoint ? projectedLapPointToRenderVector(activeTelemetryPoint, elevationScale, baselineDisplayY) : null,
    [activeTelemetryPoint, baselineDisplayY, elevationScale],
  );
  const telemetryRouteProjectionSamples = useMemo(
    () => telemetryRouteProjectionSamplePositions(projectedLap, elevationScale, baselineDisplayY),
    [baselineDisplayY, elevationScale, projectedLap],
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
        courseGeometry={courseGeometry}
        courseColorMode={courseColorMode}
        elevationScale={elevationScale}
        baselineDisplayY={baselineDisplayY}
        selectedSectionId={selectedSectionId}
        mapDisplayMode={mapDisplayMode}
        showRewinds={showRewinds}
        selectedRewindClusterId={selectedRewindClusterId}
        onSelectRewindCluster={onSelectRewindCluster}
      />
      <TelemetryCursorProjector
        hudRef={telemetryCursorHudRef}
        position={activeTelemetryPosition}
        routeSamplePositions={telemetryRouteProjectionSamples}
      />
      <SceneControls
        bounds={bounds}
        cameraPosition={cameraPosition}
        elevationScale={elevationScale}
        baselineDisplayY={baselineDisplayY}
        overviewAutoRotate={overviewAutoRotate}
        overviewTarget={overviewTarget}
        reference={reference}
        sectionFocusRequest={sectionFocusRequest}
        viewMode={viewMode}
        onManualCameraInteraction={onManualCameraInteraction}
      />
      </Canvas>
      <div
        aria-hidden="true"
        className="telemetry-cursor-hud"
        data-visible={activeTelemetryPoint ? "true" : "false"}
        ref={telemetryCursorHudRef}
      >
        <div className="telemetry-cursor-callout">
          <div className="telemetry-cursor-speed">{formatTelemetryCursorSpeed(activeTelemetryPoint?.speedKmh)}</div>
          <div className="telemetry-cursor-input-row">
            <span><b>アクセル</b><em className="telemetry-cursor-throttle">{formatTelemetryCursorPercent(telemetryCursorChannelValue(activeTelemetryPoint, "throttle"))}</em></span>
            <span><b>ブレーキ</b><em className="telemetry-cursor-brake">{formatTelemetryCursorPercent(telemetryCursorChannelValue(activeTelemetryPoint, "brake"))}</em></span>
          </div>
          <div className="telemetry-cursor-steering-row">
            <b>ステアリング</b>
            <em>{formatTelemetryCursorSteering(telemetryCursorChannelValue(activeTelemetryPoint, "steering"))}</em>
          </div>
        </div>
        <div className="telemetry-cursor-leader" />
        <div className="telemetry-cursor-diamond" />
      </div>
    </div>
  );
}

function TelemetryCursorProjector({
  hudRef,
  position,
  routeSamplePositions,
}: {
  hudRef: RefObject<HTMLDivElement | null>;
  position: THREE.Vector3 | null;
  routeSamplePositions: THREE.Vector3[];
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const projectedRef = useRef(new THREE.Vector3());
  const placementRef = useRef<TelemetryCalloutPlacement | null>(null);
  const routeProjectionCacheRef = useRef<TelemetryRouteProjectionCache>({
    matrixWorld: new THREE.Matrix4(),
    projectionMatrix: new THREE.Matrix4(),
    routeSamplePositions: null,
    screenPoints: [],
    sizeHeight: 0,
    sizeWidth: 0,
  });

  useFrame(() => {
    const hud = hudRef.current;
    if (!hud || !position) {
      if (hud) {
        hud.dataset.visible = "false";
      }
      return;
    }

    const projected = projectedRef.current.copy(position).project(camera);
    const x = (projected.x * 0.5 + 0.5) * size.width;
    const y = (-projected.y * 0.5 + 0.5) * size.height;
    const isVisible =
      projected.z >= -1 &&
      projected.z <= 1 &&
      x >= 0 &&
      x <= size.width &&
      y >= 0 &&
      y <= size.height;

    if (!isVisible) {
      hud.dataset.visible = "false";
      return;
    }

    const callout = hud.querySelector<HTMLElement>(".telemetry-cursor-callout");
    const cardWidth = callout?.offsetWidth ?? 230;
    const cardHeight = callout?.offsetHeight ?? 92;
    const routeScreenPoints = projectedRouteScreenPoints(routeProjectionCacheRef.current, routeSamplePositions, camera, size);
    const placement = chooseTelemetryCalloutPlacement({
      anchorX: x,
      anchorY: y,
      cardWidth,
      cardHeight,
      viewportWidth: size.width,
      viewportHeight: size.height,
      previousPlacement: placementRef.current,
      routePoints: routeScreenPoints,
      insetPx: VIEWPORT_INSET_PX,
      verticalGapPx: CARD_VERTICAL_GAP_PX,
      horizontalGapPx: CARD_HORIZONTAL_GAP_PX,
      hysteresisPx: PLACEMENT_HYSTERESIS_PX,
      routeClearancePx: ROUTE_CLEARANCE_PX,
    });
    placementRef.current = placement.placement;
    const leaderLength = Math.max(LEADER_MIN_LENGTH_PX, Math.hypot(placement.leaderOffsetX, placement.leaderOffsetY));
    const leaderAngle = Math.atan2(placement.leaderOffsetY, placement.leaderOffsetX);

    hud.style.setProperty("--cursor-x", `${x}px`);
    hud.style.setProperty("--cursor-y", `${y}px`);
    hud.style.setProperty("--callout-offset-x", `${placement.offsetX}px`);
    hud.style.setProperty("--callout-offset-y", `${placement.offsetY}px`);
    hud.style.setProperty("--leader-length", `${leaderLength}px`);
    hud.style.setProperty("--leader-angle", `${leaderAngle}rad`);
    hud.dataset.placement = placement.placement;
    hud.dataset.visible = "true";
  });

  return null;
}

interface TelemetryRouteProjectionCache {
  matrixWorld: THREE.Matrix4;
  projectionMatrix: THREE.Matrix4;
  routeSamplePositions: THREE.Vector3[] | null;
  screenPoints: TelemetryCalloutRoutePoint[];
  sizeHeight: number;
  sizeWidth: number;
}

function projectedRouteScreenPoints(
  cache: TelemetryRouteProjectionCache,
  routeSamplePositions: THREE.Vector3[],
  camera: THREE.Camera,
  size: { width: number; height: number },
): TelemetryCalloutRoutePoint[] {
  if (
    cache.routeSamplePositions === routeSamplePositions &&
    cache.sizeWidth === size.width &&
    cache.sizeHeight === size.height &&
    cache.matrixWorld.equals(camera.matrixWorld) &&
    cache.projectionMatrix.equals(camera.projectionMatrix)
  ) {
    return cache.screenPoints;
  }

  const projected = new THREE.Vector3();
  const screenPoints: TelemetryCalloutRoutePoint[] = [];
  for (const position of routeSamplePositions) {
    projected.copy(position).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      continue;
    }
    screenPoints.push({
      x: (projected.x * 0.5 + 0.5) * size.width,
      y: (-projected.y * 0.5 + 0.5) * size.height,
    });
  }

  cache.routeSamplePositions = routeSamplePositions;
  cache.sizeWidth = size.width;
  cache.sizeHeight = size.height;
  cache.matrixWorld.copy(camera.matrixWorld);
  cache.projectionMatrix.copy(camera.projectionMatrix);
  cache.screenPoints = screenPoints;
  return screenPoints;
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
  elevationScale,
  baselineDisplayY,
  overviewAutoRotate,
  overviewTarget,
  reference,
  sectionFocusRequest,
  viewMode,
  onManualCameraInteraction,
}: {
  bounds: RenderBounds;
  cameraPosition: [number, number, number];
  elevationScale: number;
  baselineDisplayY: number;
  overviewAutoRotate: boolean;
  overviewTarget: [number, number, number];
  reference: ReferencePayload;
  sectionFocusRequest?: SectionFocusRequest | null;
  viewMode: ViewMode;
  onManualCameraInteraction: () => void;
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls> | null>(null);
  const size = useThree((state) => state.size);
  const appliedSectionFocusRequestRef = useRef<number | null>(null);

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
    if (
      viewMode === "3d" &&
      sectionFocusRequest &&
      appliedSectionFocusRequestRef.current === sectionFocusRequest.requestId
    ) {
      return;
    }
    const target = viewMode === "2d" ? bounds.center : overviewTarget;
    applyCameraPose(controls.object, cameraPosition, target, viewMode);
    controls.target.set(...target);
    controls.update();
  }, [bounds.center, cameraPosition, overviewTarget, sectionFocusRequest, viewMode]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !sectionFocusRequest || viewMode !== "3d") {
      return;
    }
    if (appliedSectionFocusRequestRef.current === sectionFocusRequest.requestId) {
      return;
    }
    const pose = getSectionFocusCameraPose({
      reference,
      sectionId: sectionFocusRequest.sectionId,
      elevationScale,
      baselineDisplayY,
      overviewTarget,
      fullBounds: bounds,
      aspect: size.width / Math.max(1, size.height),
    });
    if (!pose) {
      return;
    }
    applyCameraPose(controls.object, pose.position, pose.target, "3d");
    controls.target.set(...pose.target);
    controls.update();
    appliedSectionFocusRequestRef.current = sectionFocusRequest.requestId;
  }, [baselineDisplayY, bounds, elevationScale, overviewTarget, reference, sectionFocusRequest, size.height, size.width, viewMode]);

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
        <span className="elevation-context-label">{UI_TEXT.relativeElevation} 0 m</span>
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
  const startPoint = reference.points[0];
  const finishPoint = reference.points[reference.points.length - 1];
  const mergeStartFinish = areReferencePointsNear(startPoint, finishPoint, elevationScale, baselineDisplayY);
  const candidates: Array<{ label: string; point: ReferencePointTuple | undefined }> = [
    { label: "START", point: mergeStartFinish ? undefined : startPoint },
    { label: "FINISH", point: mergeStartFinish ? undefined : finishPoint },
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
  courseGeometry,
  courseColorMode,
  elevationScale,
  baselineDisplayY,
  selectedSectionId,
  mapDisplayMode,
  showRewinds,
  selectedRewindClusterId,
  onSelectRewindCluster,
}: {
  reference: ReferencePayload;
  projectedLap?: ProjectedLapPayload | null;
  courseGeometry: CourseGeometryPayload | null;
  courseColorMode: CourseColorMode;
  elevationScale: number;
  baselineDisplayY: number;
  selectedSectionId: SectionId;
  mapDisplayMode: MapDisplayMode;
  showRewinds: boolean;
  selectedRewindClusterId: string;
  onSelectRewindCluster: (cluster: RewindClusterPayload) => void;
}) {
  const sectionPoints = useMemo(() => {
    const grouped = new Map<SectionId, Array<{ point: ReferencePointTuple; index: number }>>();
    for (const [index, point] of reference.points.entries()) {
      const id = pointSectionId(reference, point);
      const points = grouped.get(id) ?? [];
      points.push({ point, index });
      grouped.set(id, points);
    }
    return grouped;
  }, [reference]);

  const actualSectionPoints = useMemo(() => {
    const grouped = new Map<SectionId, ProjectedLapPoint[]>();
    for (const point of renderableLapPoints(projectedLap)) {
      const points = grouped.get(point.sectionId) ?? [];
      points.push(point);
      grouped.set(point.sectionId, points);
    }
    return grouped;
  }, [projectedLap]);
  const renderSource = activeCourseRenderSource(projectedLap);
  const showReferenceCourse = renderSource === "reference-fallback";
  const showActualCourse = renderSource === "loaded-actual" && Boolean(projectedLap);

  const startPoint = reference.points[0];
  const finishPoint = reference.points[reference.points.length - 1];
  const actualRenderPoints = useMemo(() => renderableLapPoints(projectedLap), [projectedLap]);
  const actualMarkersById = useMemo(() => {
    const markers = new Map<string, ProjectedLapPoint>();
    for (const point of projectedLap?.markers ?? []) {
      if (!markers.has(point.manualMarkerId)) {
        markers.set(point.manualMarkerId, point);
      }
    }
    return markers;
  }, [projectedLap]);
  const actualStartPoint = actualMarkersById.get("START") ?? actualRenderPoints[0];
  const actualFinishPoint = actualMarkersById.get("FINISH") ?? actualRenderPoints[actualRenderPoints.length - 1];
  const mergeReferenceStartFinish = areReferencePointsNear(startPoint, finishPoint, elevationScale, baselineDisplayY);
  const mergeActualStartFinish = areProjectedLapPointsNear(actualStartPoint, actualFinishPoint, elevationScale, baselineDisplayY);

  return (
    <group>
      {showReferenceCourse ? reference.sections.flatMap((section) => {
        const points = sectionPoints.get(section.id) ?? [];
        const renderedPoints = points.map(({ point }) => referencePointToRenderVector(point, elevationScale, baselineDisplayY));
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
            color={courseColorMode === "section" ? SECTION_COLORS[section.id] : "#d6ffcc"}
            lineWidth={REFERENCE_HALO_WIDTH}
            transparent
            opacity={0.22}
          />,
          mainLine,
        ];
      }) : null}
      {showActualCourse && projectedLap ? reference.sections.flatMap((section) => {
        const points = actualSectionPoints.get(section.id) ?? [];
        if (points.length === 0) {
          return [];
        }
        const renderedPoints = points.map((point) => projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY));
        const isSelected = section.id === selectedSectionId;
        const isOverview = mapDisplayMode === "overview";
        const usesTelemetryColors = courseColorMode !== "section" && (isOverview || isSelected);
        if (usesTelemetryColors) {
          const geometryItems = points.map((point, pointIndex) => ({
            position: renderedPoints[pointIndex],
            sample: actualTelemetryDisplaySample(courseColorMode, point),
          }));
          return renderGeometryRouteLines({
            baseWidth: isOverview ? OVERVIEW_ACTUAL_WIDTH : SELECTED_ACTUAL_WIDTH,
            keyPrefix: `actual-${section.id}`,
            points: geometryItems,
          });
        }
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
            color={courseColorMode === "section" ? SECTION_COLORS[section.id] : "#d6ffcc"}
            lineWidth={ACTUAL_HALO_WIDTH}
            transparent
            opacity={0.18}
          />,
          mainLine,
        ];
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
      {showReferenceCourse ? (
        mergeReferenceStartFinish ? (
          <Marker
            color="#35f28b"
            label={START_FINISH_LABEL}
            point={startPoint}
            elevationScale={elevationScale}
            baselineDisplayY={baselineDisplayY}
          />
        ) : (
          <>
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
          </>
        )
      ) : null}
      {showActualCourse && actualStartPoint && actualFinishPoint && mergeActualStartFinish ? (
        <Marker
          color="#35f28b"
          label={START_FINISH_LABEL}
          position={projectedLapPointToRenderVector(actualStartPoint, elevationScale, baselineDisplayY)}
        />
      ) : null}
      {showActualCourse && actualStartPoint && !mergeActualStartFinish ? (
        <Marker
          color="#35f28b"
          label="START"
          position={projectedLapPointToRenderVector(actualStartPoint, elevationScale, baselineDisplayY)}
        />
      ) : null}
      {showActualCourse && actualFinishPoint && !mergeActualStartFinish ? (
        <Marker
          color="#ff4f64"
          label="FINISH"
          position={projectedLapPointToRenderVector(actualFinishPoint, elevationScale, baselineDisplayY)}
        />
      ) : null}
    </group>
  );
}

function renderGeometryRouteLines({
  baseWidth,
  keyPrefix,
  points,
}: {
  baseWidth: number;
  keyPrefix: string;
  points: GeometryRenderPoint[];
}) {
  if (points.length < 2) {
    return [];
  }
  const runs = buildGeometryRenderRuns(points);
  const lines = [];

  for (const [runIndex, run] of runs.entries()) {
    if (run.points.length < 2) {
      continue;
    }
    lines.push(
      <Line
        key={`${keyPrefix}-telemetry-color-${runIndex}-${run.key}`}
        points={run.points}
        color="#ffffff"
        vertexColors={run.colors}
        lineWidth={geometryOverlayWidth(baseWidth, run.band)}
        depthTest
        depthWrite
        opacity={1}
        toneMapped={false}
        transparent={false}
      />,
    );
  }
  return lines;
}

function buildGeometryRenderRuns(points: GeometryRenderPoint[]): GeometryRenderRun[] {
  const runs: GeometryRenderRun[] = [];
  let current: GeometryRenderRun | null = null;
  let previous: GeometryRenderPoint | null = null;

  for (const point of points) {
    const key = geometryRunKey(point.sample);
    if (!current) {
      current = startGeometryRun(key, point);
    } else if (current.key === key) {
      appendGeometryRunPoint(current, point);
    } else {
      pushGeometryRenderRun(runs, current);
      current = previous ? startGeometryRunFromBoundary(key, previous.position, point.sample) : startGeometryRun(key, point);
      if (previous) {
        appendGeometryRunPoint(current, point);
      }
    }
    previous = point;
  }
  if (current) {
    pushGeometryRenderRun(runs, current);
  }
  return runs;
}

function startGeometryRun(key: string, point: GeometryRenderPoint): GeometryRenderRun {
  return {
    band: point.sample.band,
    colors: [point.sample.color],
    key,
    points: [point.position],
  };
}

function startGeometryRunFromBoundary(
  key: string,
  boundaryPosition: THREE.Vector3,
  sample: GeometryDisplaySample,
): GeometryRenderRun {
  return {
    band: sample.band,
    colors: [sample.color],
    key,
    points: [boundaryPosition],
  };
}

function appendGeometryRunPoint(run: GeometryRenderRun, point: GeometryRenderPoint): void {
  run.points.push(point.position);
  run.colors.push(point.sample.color);
}

function pushGeometryRenderRun(runs: GeometryRenderRun[], run: GeometryRenderRun): void {
  if (run.points.length >= 2) {
    runs.push(run);
  }
}

function geometryOverlayWidth(baseWidth: number, band: GeometryDisplayBand): number {
  if (band === "strong") {
    return baseWidth + 4;
  }
  if (band === "medium") {
    return baseWidth + 2.5;
  }
  if (band === "low") {
    return baseWidth + 1.5;
  }
  return baseWidth + 0.75;
}

function formatTelemetryCursorSpeed(speedKmh: number | undefined): string {
  if (speedKmh === undefined || !Number.isFinite(speedKmh)) {
    return UI_TEXT.speedUnavailable;
  }
  return `${Math.round(speedKmh)} km/h`;
}

function telemetryCursorChannelValue(
  point: ProjectedLapPoint | null | undefined,
  channel: "throttle" | "brake" | "steering",
): number | null {
  return point ? telemetryChannelValue(point, channel) : null;
}

function formatTelemetryCursorPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(0)}%`;
}

function formatTelemetryCursorSteering(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  return value.toFixed(3);
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

function areReferencePointsNear(
  first: ReferencePointTuple | undefined,
  second: ReferencePointTuple | undefined,
  elevationScale: number,
  baselineDisplayY: number,
): boolean {
  if (!first || !second) {
    return false;
  }
  return (
    referencePointToRenderVector(first, elevationScale, baselineDisplayY)
      .distanceTo(referencePointToRenderVector(second, elevationScale, baselineDisplayY)) <= START_FINISH_MERGE_DISTANCE_M
  );
}

function areProjectedLapPointsNear(
  first: ProjectedLapPoint | undefined,
  second: ProjectedLapPoint | undefined,
  elevationScale: number,
  baselineDisplayY: number,
): boolean {
  if (!first || !second) {
    return false;
  }
  return (
    projectedLapPointToRenderVector(first, elevationScale, baselineDisplayY)
      .distanceTo(projectedLapPointToRenderVector(second, elevationScale, baselineDisplayY)) <= START_FINISH_MERGE_DISTANCE_M
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

function telemetryRouteProjectionSamplePositions(
  projectedLap: ProjectedLapPayload | null | undefined,
  elevationScale: number,
  baselineDisplayY: number,
): THREE.Vector3[] {
  const points = renderableLapPoints(projectedLap);
  if (points.length === 0) {
    return [];
  }
  if (points.length <= TELEMETRY_ROUTE_PROJECTION_SAMPLE_LIMIT) {
    return points.map((point) => projectedLapPointToRenderVector(point, elevationScale, baselineDisplayY));
  }
  const positions: THREE.Vector3[] = [];
  const step = (points.length - 1) / (TELEMETRY_ROUTE_PROJECTION_SAMPLE_LIMIT - 1);
  let previousIndex = -1;
  for (let sampleIndex = 0; sampleIndex < TELEMETRY_ROUTE_PROJECTION_SAMPLE_LIMIT; sampleIndex += 1) {
    const pointIndex = Math.min(points.length - 1, Math.round(sampleIndex * step));
    if (pointIndex === previousIndex) {
      continue;
    }
    positions.push(projectedLapPointToRenderVector(points[pointIndex], elevationScale, baselineDisplayY));
    previousIndex = pointIndex;
  }
  return positions;
}

function formatGuideHeight(heightM: number): string {
  const rounded = Math.round(heightM);
  if (Math.abs(rounded) === 0) {
    return "0 m";
  }
  return rounded > 0 ? `+${rounded} m` : `${rounded} m`;
}
