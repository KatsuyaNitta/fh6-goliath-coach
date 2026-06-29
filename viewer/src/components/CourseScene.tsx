import { Canvas } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ElementRef } from "react";
import * as THREE from "three";
import type { ReferencePayload, ReferencePointTuple, SectionId } from "../lib/reference";
import { SECTION_COLORS, nearestPointByDistance, pointSectionId } from "../lib/reference";
import {
  referencePointToRenderVector,
  referencePointsToRenderBounds,
  type RenderBounds,
} from "../lib/renderCoordinates";
import { getCameraUpVector, getCanonical3DAnalysisCameraPosition, getTopDownCameraPosition } from "../lib/cameraFraming";
import { displayCoordinatesToRenderVector } from "../lib/renderTransform";
import type { ProjectedLapPayload, ProjectedLapPoint } from "../lib/telemetryLap";

const MUTED_SECTION_COLOR = "#343b44";
const MUTED_MARKER_COLOR = "#7b8490";
const NON_SELECTED_OPACITY = 0.26;
const SELECTED_REFERENCE_WIDTH = 9;
const SELECTED_ACTUAL_WIDTH = 11;
const REFERENCE_HALO_WIDTH = 17;
const ACTUAL_HALO_WIDTH = 19;
const MUTED_LINE_WIDTH = 2;

interface CourseSceneProps {
  reference: ReferencePayload;
  elevationScale: number;
  selectedSectionId: SectionId;
  viewMode: "2d" | "3d";
  projectedLap?: ProjectedLapPayload | null;
  showReference: boolean;
  showActual: boolean;
}

export function CourseScene({
  reference,
  elevationScale,
  selectedSectionId,
  viewMode,
  projectedLap,
  showReference,
  showActual,
}: CourseSceneProps) {
  const bounds = useMemo(
    () => referencePointsToRenderBounds(reference.points, elevationScale),
    [reference.points, elevationScale],
  );
  const cameraPosition: [number, number, number] =
    viewMode === "2d" ? getTopDownCameraPosition(bounds) : getCanonical3DAnalysisCameraPosition(bounds);

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#101318"]} />
      <SceneCamera
        bounds={bounds}
        cameraPosition={cameraPosition}
        viewMode={viewMode}
      />
      <ambientLight intensity={0.85} />
      <directionalLight position={[2500, 5000, 2500]} intensity={1.4} />
      <Grid
        args={[90000, 24]}
        position={[bounds.center[0], bounds.center[1] - 40, bounds.center[2]]}
        cellColor="#2b323b"
        sectionColor="#46515d"
        fadeDistance={90000}
      />
      <CourseLines
        reference={reference}
        projectedLap={projectedLap}
        elevationScale={elevationScale}
        selectedSectionId={selectedSectionId}
        showReference={showReference}
        showActual={showActual}
      />
      <SceneControls bounds={bounds} cameraPosition={cameraPosition} viewMode={viewMode} />
    </Canvas>
  );
}

function SceneCamera({
  bounds,
  cameraPosition,
  viewMode,
}: {
  bounds: RenderBounds;
  cameraPosition: [number, number, number];
  viewMode: "2d" | "3d";
}) {
  const topDownRef = useRef<THREE.OrthographicCamera | null>(null);
  const perspectiveRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const camera = viewMode === "2d" ? topDownRef.current : perspectiveRef.current;
    if (!camera) {
      return;
    }
    applyCameraPose(camera, cameraPosition, bounds.center, viewMode);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [bounds.center, cameraPosition, viewMode]);

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
  viewMode,
}: {
  bounds: RenderBounds;
  cameraPosition: [number, number, number];
  viewMode: "2d" | "3d";
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls> | null>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    applyCameraPose(controls.object, cameraPosition, bounds.center, viewMode);
    controls.target.set(...bounds.center);
    controls.update();
  }, [bounds.center, cameraPosition, viewMode]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableRotate={viewMode === "3d"}
      enablePan
      enableZoom
      target={bounds.center}
      minPolarAngle={viewMode === "3d" ? 0.15 : 0}
      maxPolarAngle={viewMode === "3d" ? Math.PI / 2 - 0.03 : Math.PI}
      maxDistance={100000}
      minDistance={1500}
    />
  );
}

function applyCameraPose(
  camera: THREE.Camera,
  position: [number, number, number],
  target: [number, number, number],
  viewMode: "2d" | "3d",
) {
  camera.position.set(...position);
  camera.up.set(...getCameraUpVector(viewMode));
  camera.lookAt(...target);
}

function CourseLines({
  reference,
  projectedLap,
  elevationScale,
  selectedSectionId,
  showReference,
  showActual,
}: {
  reference: ReferencePayload;
  projectedLap?: ProjectedLapPayload | null;
  elevationScale: number;
  selectedSectionId: SectionId;
  showReference: boolean;
  showActual: boolean;
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
    for (const point of projectedLap?.points ?? []) {
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
        const renderedPoints = points.map((point) => referencePointToRenderVector(point, elevationScale));
        const isSelected = section.id === selectedSectionId;
        const mainLine = (
          <Line
            key={section.id}
            points={renderedPoints}
            color={isSelected ? SECTION_COLORS[section.id] : MUTED_SECTION_COLOR}
            lineWidth={isSelected ? SELECTED_REFERENCE_WIDTH : MUTED_LINE_WIDTH}
            transparent
            opacity={isSelected ? 1 : NON_SELECTED_OPACITY}
          />
        );
        if (!isSelected) {
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
        const renderedPoints = points.map((point) => projectedLapPointToRenderVector(point, elevationScale));
        const isSelected = section.id === selectedSectionId;
        const mainLine = (
          <Line
            key={`actual-${section.id}`}
            points={renderedPoints}
            color={isSelected ? SECTION_COLORS[section.id] : MUTED_SECTION_COLOR}
            lineWidth={isSelected ? SELECTED_ACTUAL_WIDTH : MUTED_LINE_WIDTH}
            transparent
            opacity={isSelected ? 1 : NON_SELECTED_OPACITY}
          />
        );
        if (!isSelected) {
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
        const isBoundary = markerTouchesSection(marker, selectedSectionId);
        return (
          <Marker
            color={isBoundary ? "#ffffff" : MUTED_MARKER_COLOR}
            key={marker.id}
            label={marker.label}
            point={point}
            elevationScale={elevationScale}
            labelDimmed={!isBoundary}
            opacity={isBoundary ? 1 : 0.38}
            scale={isBoundary ? 1.12 : 0.78}
          />
        );
      })}
      {showActual && projectedLap ? projectedLap.markers.map((point) => {
        const isBoundary = actualMarkerTouchesSection(reference, point.manualMarkerId, selectedSectionId);
        return (
          <Marker
            color={isBoundary ? "#f8fafc" : MUTED_MARKER_COLOR}
            key={`actual-marker-${point.manualMarkerId}-${point.sourceRowIndex}`}
            label={point.manualMarkerId}
            position={projectedLapPointToRenderVector(point, elevationScale)}
            labelDimmed={!isBoundary}
            opacity={isBoundary ? 1 : 0.38}
            scale={isBoundary ? 1.12 : 0.78}
          />
        );
      }) : null}
      <Marker color="#35f28b" label="START" point={startPoint} elevationScale={elevationScale} />
      <Marker color="#ff4f64" label="FINISH" point={finishPoint} elevationScale={elevationScale} />
    </group>
  );
}

function markerTouchesSection(
  marker: ReferencePayload["markers"][number],
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
  position,
  labelDimmed = false,
  opacity = 1,
  scale = 1,
}: {
  color: string;
  label: string;
  point?: ReferencePointTuple;
  elevationScale?: number;
  position?: THREE.Vector3;
  labelDimmed?: boolean;
  opacity?: number;
  scale?: number;
}) {
  const markerPosition = position ?? referencePointToRenderVector(point!, elevationScale!);
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
function projectedLapPointToRenderVector(point: ProjectedLapPoint, elevationScale: number): THREE.Vector3 {
  const [renderX, renderY, renderZ] = displayCoordinatesToRenderVector(
    point.displayX,
    point.displayY,
    point.displayZ,
    elevationScale,
  );
  return new THREE.Vector3(renderX, renderY, renderZ);
}
