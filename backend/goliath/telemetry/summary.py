from __future__ import annotations

from dataclasses import asdict
from statistics import mean

from goliath.config.sections import SECTIONS, boundary_markers
from goliath.telemetry.model import MarkerEvent, ProjectedSample


def build_section_summary(projected: list[ProjectedSample]) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []
    for section in SECTIONS:
        samples = [sample for sample in projected if sample.section_id == section.id]
        if samples:
            start_time = samples[0].row.lap_time_s
            end_time = samples[-1].row.lap_time_s
            speeds = [sample.row.speed_kmh for sample in samples]
            summaries.append(
                {
                    "section_id": section.id,
                    "name_en": section.name_en,
                    "start_distance_m": section.start_distance_m,
                    "end_distance_m": section.end_distance_m,
                    "start_time_s": start_time,
                    "end_time_s": end_time,
                    "elapsed_time_s": end_time - start_time,
                    "average_speed_kmh": mean(speeds),
                    "maximum_speed_kmh": max(speeds),
                    "sample_count": len(samples),
                }
            )
        else:
            summaries.append(
                {
                    "section_id": section.id,
                    "name_en": section.name_en,
                    "start_distance_m": section.start_distance_m,
                    "end_distance_m": section.end_distance_m,
                    "start_time_s": None,
                    "end_time_s": None,
                    "elapsed_time_s": None,
                    "average_speed_kmh": None,
                    "maximum_speed_kmh": None,
                    "sample_count": 0,
                }
            )
    return summaries


def build_marker_boundary_offsets(
    markers: list[MarkerEvent],
    projected_by_row: dict[int, ProjectedSample],
) -> list[dict[str, object]]:
    boundaries = {marker["id"]: marker for marker in boundary_markers()}
    offsets = []
    for marker in markers:
        projected = projected_by_row.get(marker.midpoint_source_row_index)
        boundary = boundaries.get(marker.id)
        if not projected or not boundary:
            continue
        boundary_distance = float(boundary["course_distance_m"])
        offsets.append(
            {
                "marker_id": marker.id,
                "projected_course_distance_m": projected.course_distance_m,
                "boundary_course_distance_m": boundary_distance,
                "offset_m": projected.course_distance_m - boundary_distance,
                "projection_error_m": projected.projection_error_m,
            }
        )
    return offsets


def markers_as_dicts(markers: list[MarkerEvent]) -> list[dict[str, object]]:
    return [asdict(marker) for marker in markers]

