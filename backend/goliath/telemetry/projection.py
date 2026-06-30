from __future__ import annotations

import math
from statistics import mean, median

from goliath.config.sections import assign_section_id
from goliath.reference.model import DisplayOrigin, ReferencePoint
from goliath.telemetry.model import ProjectedSample, ProjectionSummary, TelemetryRow


def project_lap_to_reference(
    rows: list[TelemetryRow],
    reference_points: list[ReferencePoint],
    origin: DisplayOrigin,
    *,
    backward_allowance_m: int = 12,
    base_forward_window_m: int = 120,
    speed_window_multiplier: float = 2.0,
    uncertain_error_threshold_m: float = 60.0,
    first_point_full_scan: bool = False,
) -> tuple[list[ProjectedSample], ProjectionSummary]:
    if not rows:
        raise ValueError("cannot project an empty lap")
    if not reference_points:
        raise ValueError("cannot project without reference points")

    projected: list[ProjectedSample] = []
    previous_index: int | None = None
    previous_row: TelemetryRow | None = None

    for row in rows:
        if previous_index is None or previous_row is None:
            if first_point_full_scan:
                search_start = 0
                search_end = len(reference_points) - 1
            else:
                search_start = 0
                search_end = min(len(reference_points) - 1, base_forward_window_m * 5)
        else:
            delta_t = max(0.0, row.lap_time_s - previous_row.lap_time_s)
            speed_mps = max(row.speed_kmh, previous_row.speed_kmh) / 3.6
            forward = int(base_forward_window_m + speed_mps * delta_t * speed_window_multiplier)
            search_start = max(0, previous_index - backward_allowance_m)
            search_end = min(len(reference_points) - 1, previous_index + max(forward, base_forward_window_m))

        reference_index, error = _nearest_reference_index(row, reference_points, search_start, search_end)
        backward_jump = previous_index is not None and reference_index < previous_index - backward_allowance_m
        uncertain = error > uncertain_error_threshold_m or backward_jump

        if uncertain and previous_index is not None:
            expanded_start = max(0, previous_index - backward_allowance_m)
            expanded_end = min(len(reference_points) - 1, previous_index + 1200)
            expanded_index, expanded_error = _nearest_reference_index(
                row,
                reference_points,
                expanded_start,
                expanded_end,
            )
            if expanded_error < error or expanded_index >= previous_index - backward_allowance_m:
                reference_index = expanded_index
                error = expanded_error
                backward_jump = reference_index < previous_index - backward_allowance_m
                uncertain = error > uncertain_error_threshold_m or backward_jump

        projected.append(project_row_with_reference_index(row, reference_points, origin, reference_index, error, uncertain))
        previous_index = reference_index
        previous_row = row

    errors = [sample.projection_error_m for sample in projected]
    return projected, ProjectionSummary(
        mean_error_m=mean(errors),
        median_error_m=median(errors),
        max_error_m=max(errors),
        uncertain_mapping_count=sum(1 for sample in projected if sample.uncertain_mapping),
    )


def project_single_row_to_reference(
    row: TelemetryRow,
    reference_points: list[ReferencePoint],
    origin: DisplayOrigin,
    *,
    uncertain_error_threshold_m: float = 60.0,
) -> ProjectedSample:
    reference_index, error = _nearest_reference_index(row, reference_points, 0, len(reference_points) - 1)
    return project_row_with_reference_index(
        row,
        reference_points,
        origin,
        reference_index,
        error,
        error > uncertain_error_threshold_m,
    )


def project_row_with_reference_index(
    row: TelemetryRow,
    reference_points: list[ReferencePoint],
    origin: DisplayOrigin,
    reference_index: int,
    error: float,
    uncertain: bool,
) -> ProjectedSample:
    point = reference_points[reference_index]
    return ProjectedSample(
        row=row,
        reference_index=reference_index,
        course_distance_m=point.course_distance_m,
        projection_error_m=error,
        section_id=assign_section_id(point.course_distance_m),
        uncertain_mapping=uncertain,
        telemetry_display_x=row.position_x - origin.position_x,
        telemetry_display_y=row.position_y - origin.position_y,
        telemetry_display_z=row.position_z - origin.position_z,
    )


def _nearest_reference_index(
    row: TelemetryRow,
    reference_points: list[ReferencePoint],
    search_start: int,
    search_end: int,
) -> tuple[int, float]:
    best_index = search_start
    best_distance_sq = math.inf
    for index in range(search_start, search_end + 1):
        point = reference_points[index]
        distance_sq = (
            (row.position_x - point.position_x) ** 2
            + (row.position_y - point.position_y) ** 2
            + (row.position_z - point.position_z) ** 2
        )
        if distance_sq < best_distance_sq:
            best_index = index
            best_distance_sq = distance_sq
    return best_index, math.sqrt(best_distance_sq)