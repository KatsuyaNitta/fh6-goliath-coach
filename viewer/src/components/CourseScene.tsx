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

interface CourseSceneProps {
  reference: ReferencePayload;
  elevationScale: number;
  selectedSectionId: SectionId;
  viewMode: "2d" | "3d";
}

export function CourseScene({
  reference,
  elevationScale,
  selectedSectionId,
  viewMode,
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
        elevationScale={elevationScale}
        selectedSectionId={selectedSectionId}
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
  camera.up.set(...getCameraUpVector(position, target, viewMode));
  camera.lookAt(...target);
}

function CourseLines({
  reference,
  elevationScale,
  selectedSectionId,
}: {
  reference: ReferencePayload;
  elevationScale: number;
  selectedSectionId: SectionId;
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
      {reference.sections.map((section) => {
        const points = sectionPoints.get(section.id) ?? [];
        return (
          <Line
            key={section.id}
            points={points.map((point) => referencePointToRenderVector(point, elevationScale))}
            color={SECTION_COLORS[section.id]}
            lineWidth={section.id === selectedSectionId ? 7 : 3}
            transparent
            opacity={section.id === selectedSectionId ? 1 : 0.42}
          />
        );
      })}
      {markerPoints.map(({ marker, point }) => (
        <Marker
          color="#ffffff"
          key={marker.id}
          label={marker.label}
          point={point}
          elevationScale={elevationScale}
        />
      ))}
      <Marker color="#35f28b" label="START" point={startPoint} elevationScale={elevationScale} />
      <Marker color="#ff4f64" label="FINISH" point={finishPoint} elevationScale={elevationScale} />
    </group>
  );
}

function Marker({
  color,
  label,
  point,
  elevationScale,
}: {
  color: string;
  label: string;
  point: ReferencePointTuple;
  elevationScale: number;
}) {
  const position = referencePointToRenderVector(point, elevationScale);
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[95, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <Html distanceFactor={11000} position={[0, 260, 0]} center>
        <span className="scene-label">{label}</span>
      </Html>
    </group>
  );
}
