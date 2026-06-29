import { Canvas } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { ReferencePayload, ReferencePoint, SectionId } from "../lib/reference";
import { SECTION_COLORS, nearestPointByDistance } from "../lib/reference";

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
  const bounds = useMemo(() => getBounds(reference.points, elevationScale), [reference.points, elevationScale]);
  const cameraPosition: [number, number, number] =
    viewMode === "2d"
      ? [bounds.center[0], bounds.size * 1.35, bounds.center[2] + 0.01]
      : [bounds.center[0] - bounds.size * 0.45, bounds.size * 0.42, bounds.center[2] + bounds.size * 0.62];

  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#101318"]} />
      <PerspectiveCamera makeDefault position={cameraPosition} near={1} far={200000} fov={45} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[2500, 5000, 2500]} intensity={1.4} />
      <Grid
        args={[90000, 24]}
        position={[bounds.center[0], -40, bounds.center[2]]}
        cellColor="#2b323b"
        sectionColor="#46515d"
        fadeDistance={90000}
      />
      <CourseLines
        reference={reference}
        elevationScale={elevationScale}
        selectedSectionId={selectedSectionId}
      />
      <OrbitControls
        enableRotate={viewMode === "3d"}
        target={bounds.center}
        maxDistance={100000}
        minDistance={1500}
      />
    </Canvas>
  );
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
    const grouped = new Map<SectionId, ReferencePoint[]>();
    for (const point of reference.points) {
      const points = grouped.get(point.section_id) ?? [];
      points.push(point);
      grouped.set(point.section_id, points);
    }
    return grouped;
  }, [reference.points]);

  const markerPoints = useMemo(() => {
    return reference.markers
      .map((marker) => ({
        marker,
        point: nearestPointByDistance(reference.points, marker.course_distance_m),
      }))
      .filter((item): item is typeof item & { point: ReferencePoint } => Boolean(item.point));
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
            points={points.map((point) => toVector(point, elevationScale))}
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
  point: ReferencePoint;
  elevationScale: number;
}) {
  const position = toVector(point, elevationScale);
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

function toVector(point: ReferencePoint, elevationScale: number): [number, number, number] {
  return [point.display_x, point.display_y * elevationScale, point.display_z];
}

function getBounds(points: ReferencePoint[], elevationScale: number) {
  const box = new THREE.Box3();
  for (const point of points) {
    box.expandByPoint(new THREE.Vector3(point.display_x, point.display_y * elevationScale, point.display_z));
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    center: [center.x, center.y, center.z] as [number, number, number],
    size: Math.max(size.x, size.y, size.z),
  };
}
