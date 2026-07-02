import type { ProjectedLapPayload, ProjectedLapPoint } from "./telemetryLap";

export type ActiveCourseRenderSource = "reference-fallback" | "loaded-actual";

export function renderableLapPoints(projectedLap: ProjectedLapPayload | null | undefined): ProjectedLapPoint[] {
  if (!projectedLap) {
    return [];
  }
  return projectedLap.effectivePoints.length > 0 ? projectedLap.effectivePoints : projectedLap.points;
}

export function activeCourseRenderSource(projectedLap: ProjectedLapPayload | null | undefined): ActiveCourseRenderSource {
  return renderableLapPoints(projectedLap).length > 0 ? "loaded-actual" : "reference-fallback";
}
