from __future__ import annotations

import csv
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
import json
from pathlib import Path

from goliath.config.sections import SECTIONS
from goliath.reference.loader import load_reference_csv
from goliath.telemetry.attempt import (
    AttemptCandidate,
    AttemptValidation,
    build_lap_selection_from_effective_attempt,
    select_restart_aware_attempt,
)
from goliath.telemetry.importer import load_telemetry_session
from goliath.telemetry.markers import detect_handbrake_markers
from goliath.telemetry.model import ProjectedSample, TelemetryRow
from goliath.telemetry.projection import project_lap_to_reference, project_single_row_to_reference
from goliath.telemetry.rewind import (
    build_rewind_analysis_payload,
    build_rewind_clusters,
    enrich_events_with_projection_and_classification,
    normalize_rewinds,
    validate_effective_lap_time,
)
from goliath.telemetry.summary import (
    build_marker_boundary_offsets,
    build_section_summary,
    markers_as_dicts,
)
from goliath.vehicle.resolver import resolve_vehicle_identity, vehicle_identity_payload


def process_session(
    session_dir: Path,
    *,
    reference_csv: Path = Path("data/reference/goliath_reference_1m.csv"),
    output_root: Path = Path("data/processed"),
    vehicle_catalog_dir: Path = Path("data/local/vehicle-catalog"),
) -> dict[str, object]:
    session = load_telemetry_session(session_dir)
    vehicle_identity = resolve_vehicle_identity(
        session.vehicle,
        session_metadata=session.session_metadata,
        catalog_dir=vehicle_catalog_dir,
    )
    vehicle_payload = vehicle_identity_payload(vehicle_identity)
    reference_points, origin = load_reference_csv(reference_csv)

    evaluation_by_attempt: dict[int, _AttemptEvaluation] = {}

    def validate_attempt(attempt: AttemptCandidate) -> AttemptValidation:
        evaluation = _evaluate_attempt_candidate(
            attempt,
            reference_points=reference_points,
            origin=origin,
            source_row_count=len(session.rows),
        )
        evaluation_by_attempt[attempt.index] = evaluation
        return AttemptValidation(valid=evaluation.valid, reason=evaluation.reason, summary=evaluation.summary)

    attempt_selection = select_restart_aware_attempt(session.rows, validator=validate_attempt)
    selected_evaluation = evaluation_by_attempt[attempt_selection.selected_attempt_index]
    raw_lap_rows = attempt_selection.selected_attempt.rows
    normalization = selected_evaluation.normalization
    lap = replace(
        selected_evaluation.lap,
        notes=["Selected the only restart candidate that passed full-lap validation."],
    )

    markers = detect_handbrake_markers(lap.rows)
    projected_effective = selected_evaluation.projected_effective
    projection_summary = selected_evaluation.projection_summary
    projected_effective = _apply_marker_annotations(projected_effective, markers)
    projected_by_row = {sample.row.source_row_index: sample for sample in projected_effective}

    rows_by_source = {row.source_row_index: row for row in raw_lap_rows}
    for event in normalization.events:
        for source_row_index in (event.pre_rewind_source_row_index, event.target_source_row_index):
            if source_row_index not in projected_by_row and source_row_index in rows_by_source:
                sample = project_single_row_to_reference(rows_by_source[source_row_index], reference_points, origin)
                projected_by_row[source_row_index] = sample

    enrich_events_with_projection_and_classification(normalization.events, projected_by_row, rows_by_source)
    clusters = build_rewind_clusters(normalization.events)
    rewind_analysis = build_rewind_analysis_payload(
        session_id=session.session_id,
        events=normalization.events,
        clusters=clusters,
        section_ids=[section.id for section in SECTIONS],
        normalization=normalization,
    )
    attempt_detection = attempt_selection.diagnostics()
    rewind_analysis["vehicle"] = vehicle_payload
    rewind_analysis["attempt_detection"] = attempt_detection

    projected_for_csv = _build_projected_lap_output_samples(projected_effective, normalization, projected_by_row)
    sections = build_section_summary([sample for sample in projected_effective if sample.is_effective])
    marker_offsets = build_marker_boundary_offsets(markers, projected_by_row)

    output_dir = output_root / session.session_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_prefix = f"{session.session_id}_{vehicle_identity.filename_slug}"
    completed_lap_path = output_dir / f"{output_prefix}_completed-lap.csv"
    projected_lap_path = output_dir / f"{output_prefix}_projected-lap.csv"
    marker_events_path = output_dir / f"{output_prefix}_marker-events.json"
    rewind_analysis_path = output_dir / f"{output_prefix}_rewind-analysis.json"
    section_summary_path = output_dir / f"{output_prefix}_section-summary.json"
    session_summary_path = output_dir / f"{output_prefix}_session-summary.json"

    _write_completed_lap(completed_lap_path, session.source_columns, raw_lap_rows, normalization)
    _write_projected_lap(projected_lap_path, projected_for_csv, vehicle_payload)
    _write_json(marker_events_path, {"markers": markers_as_dicts(markers)})
    _write_json(rewind_analysis_path, rewind_analysis)
    _write_json(
        section_summary_path,
        {
            "session_id": session.session_id,
            "vehicle": vehicle_payload,
            "total_lap_time_s": lap.completed_lap_time_s,
            "sections": sections,
            "marker_boundary_offsets": marker_offsets,
        },
    )

    summary: dict[str, object] = {
        "schema_version": "goliath-processed-session-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "session_id": session.session_id,
        "vehicle": vehicle_payload,
        "source": {
            "csv_path": session.csv_path,
            "session_json_path": session.session_json_path,
            "source_columns": session.source_columns,
        },
        "session_metadata": session.session_metadata,
        "sample_stats": asdict(session.sample_stats),
        "completed_lap": {
            "start_source_row_index": lap.start_source_row_index,
            "end_source_row_index": lap.end_source_row_index,
            "start_timestamp_s": lap.start_timestamp_s,
            "end_timestamp_s": lap.end_timestamp_s,
            "start_lap_time_s": lap.start_lap_time_s,
            "end_lap_time_s": lap.end_lap_time_s,
            "completed_lap_time_s": lap.completed_lap_time_s,
            "ambiguous": lap.ambiguous,
            "incomplete": lap.incomplete,
            "notes": lap.notes,
        },
        "attempt_detection": attempt_detection,
        "handbrake_marker_count": len(markers),
        "projection_summary": asdict(projection_summary),
        "rewind_summary": rewind_analysis["summary"],
        "outputs": {
            "session_summary_json": str(session_summary_path),
            "completed_lap_csv": str(completed_lap_path),
            "marker_events_json": str(marker_events_path),
            "projected_lap_csv": str(projected_lap_path),
            "rewind_analysis_json": str(rewind_analysis_path),
            "section_summary_json": str(section_summary_path),
        },
    }
    _write_json(session_summary_path, summary)
    return summary


@dataclass(frozen=True)
class _AttemptEvaluation:
    normalization: object | None
    lap: object | None
    projected_effective: list[ProjectedSample]
    projection_summary: object | None
    valid: bool
    reason: str
    summary: dict[str, object]


def _evaluate_attempt_candidate(
    attempt: AttemptCandidate,
    *,
    reference_points,
    origin,
    source_row_count: int,
) -> _AttemptEvaluation:
    try:
        normalization = normalize_rewinds(attempt.rows)
        lap = build_lap_selection_from_effective_attempt(normalization.effective_rows)
        validate_effective_lap_time(lap.rows)
        projected_effective, projection_summary = project_lap_to_reference(lap.rows, reference_points, origin)
        summary = _attempt_validation_summary(lap, projected_effective, reference_points, source_row_count, normalization)
        try:
            _validate_completed_lap_quality(lap, projected_effective, reference_points, source_row_count)
        except ValueError as exc:
            return _AttemptEvaluation(
                normalization=normalization,
                lap=lap,
                projected_effective=projected_effective,
                projection_summary=projection_summary,
                valid=False,
                reason=str(exc),
                summary={**summary, "valid": False, "reason": str(exc)},
            )
        return _AttemptEvaluation(
            normalization=normalization,
            lap=lap,
            projected_effective=projected_effective,
            projection_summary=projection_summary,
            valid=True,
            reason="passes full-lap validation",
            summary=summary,
        )
    except ValueError as exc:
        return _AttemptEvaluation(
            normalization=None,
            lap=None,
            projected_effective=[],
            projection_summary=None,
            valid=False,
            reason=str(exc),
            summary={
                "valid": False,
                "effective_row_count": 0,
                "reason": str(exc),
            },
        )


def _attempt_validation_summary(
    lap,
    projected: list[ProjectedSample],
    reference_points,
    source_row_count: int,
    normalization,
) -> dict[str, object]:
    distances = [sample.course_distance_m for sample in projected]
    section_ids = {sample.section_id for sample in projected}
    reference_length_m = reference_points[-1].course_distance_m if reference_points else 0.0
    covered_distance_m = max(distances) - min(distances) if distances else 0.0
    return {
        "valid": True,
        "effective_row_count": len(projected),
        "effective_row_ratio": len(projected) / max(1, source_row_count),
        "completed_lap_time_s": lap.completed_lap_time_s,
        "start_distance_m": distances[0] if distances else None,
        "end_distance_m": distances[-1] if distances else None,
        "covered_distance_m": covered_distance_m,
        "reference_length_m": reference_length_m,
        "reference_coverage_ratio": covered_distance_m / reference_length_m if reference_length_m else 0.0,
        "section_ids": sorted(section_ids),
        "missing_section_ids": sorted({section.id for section in SECTIONS} - section_ids),
        "rewind_event_count": len(normalization.events),
    }



MIN_COMPLETED_LAP_TIME_S = 300.0
LARGE_RECORDING_ROW_COUNT = 10_000
MIN_LARGE_RECORDING_EFFECTIVE_ROWS = 1_000
MIN_LARGE_RECORDING_EFFECTIVE_RATIO = 0.20
MIN_REFERENCE_COVERAGE_RATIO = 0.85
START_DISTANCE_TOLERANCE_M = 2_000.0
FINISH_DISTANCE_TOLERANCE_M = 2_000.0
MIN_UNIQUE_REFERENCE_RATIO = 0.25


def _validate_completed_lap_quality(
    lap,
    projected: list[ProjectedSample],
    reference_points,
    source_row_count: int,
) -> None:
    errors: list[str] = []
    effective_row_count = len(projected)
    if lap.incomplete:
        errors.append("completed lap is marked incomplete")
    if lap.completed_lap_time_s <= 0:
        errors.append("completed lap time must be positive")
    if lap.end_lap_time_s <= lap.start_lap_time_s:
        errors.append("lap timer did not advance across selected attempt")
    if lap.completed_lap_time_s < MIN_COMPLETED_LAP_TIME_S:
        errors.append(f"completed lap duration is too short: {lap.completed_lap_time_s:.3f}s")
    if effective_row_count == 0:
        errors.append("projected lap has no effective rows")
    if source_row_count >= LARGE_RECORDING_ROW_COUNT:
        if effective_row_count < MIN_LARGE_RECORDING_EFFECTIVE_ROWS:
            errors.append(f"effective row count is too small for a dense recording: {effective_row_count}")
        ratio = effective_row_count / max(1, source_row_count)
        if ratio < MIN_LARGE_RECORDING_EFFECTIVE_RATIO:
            errors.append(f"selected attempt covers too little of the recording: {ratio:.3f}")
    if projected and reference_points:
        reference_length_m = reference_points[-1].course_distance_m
        distances = [sample.course_distance_m for sample in projected]
        start_distance = distances[0]
        end_distance = distances[-1]
        covered_distance = max(distances) - min(distances)
        if start_distance > START_DISTANCE_TOLERANCE_M:
            errors.append(f"selected lap does not start near the reference start: {start_distance:.3f}m")
        if end_distance < reference_length_m - FINISH_DISTANCE_TOLERANCE_M:
            errors.append(f"selected lap does not finish near the reference end: {end_distance:.3f}m")
        if covered_distance < reference_length_m * MIN_REFERENCE_COVERAGE_RATIO:
            errors.append(f"projected lap covers too little reference distance: {covered_distance:.3f}m")
        section_ids = [sample.section_id for sample in projected]
        missing_sections = sorted({section.id for section in SECTIONS} - set(section_ids))
        if missing_sections:
            errors.append(f"projected lap is missing sections: {', '.join(missing_sections)}")
        section_order = {section.id: index for index, section in enumerate(SECTIONS)}
        previous_order = section_order.get(section_ids[0], 0) if section_ids else 0
        for section_id in section_ids[1:]:
            order = section_order.get(section_id, previous_order)
            if order < previous_order:
                errors.append("projected section order moves backward unexpectedly")
                break
            previous_order = order
        unique_reference_indices = len({sample.reference_index for sample in projected})
        if unique_reference_indices < max(1, int(effective_row_count * MIN_UNIQUE_REFERENCE_RATIO)):
            errors.append("projected lap collapses onto too few reference points")
    if errors:
        raise ValueError("invalid completed Goliath lap: " + "; ".join(errors))


def _apply_marker_annotations(
    projected: list[ProjectedSample],
    markers,
) -> list[ProjectedSample]:
    marker_midpoints = {marker.midpoint_source_row_index: marker.id for marker in markers}
    windows = [
        (marker.exclusion_window["start_time_s"], marker.exclusion_window["end_time_s"])
        for marker in markers
    ]
    annotated: list[ProjectedSample] = []
    for sample in projected:
        marker_id = marker_midpoints.get(sample.row.source_row_index, "")
        excluded = any(start <= sample.row.lap_time_s <= end for start, end in windows)
        annotated.append(
            replace(
                sample,
                marker_id=marker_id,
                exclude_from_driving_analysis=excluded,
            )
        )
    return annotated


def _build_projected_lap_output_samples(
    projected_effective: list[ProjectedSample],
    normalization,
    projected_by_row: dict[int, ProjectedSample],
) -> list[ProjectedSample]:
    samples_by_source = {sample.row.source_row_index: sample for sample in projected_effective}
    for event in normalization.events:
        incident = projected_by_row.get(event.pre_rewind_source_row_index)
        if incident is None:
            continue
        samples_by_source[event.pre_rewind_source_row_index] = replace(
            incident,
            is_effective=normalization.is_effective_by_source_row.get(event.pre_rewind_source_row_index, False),
            superseded_by_rewind_event_id=normalization.superseded_by_source_row.get(event.pre_rewind_source_row_index, event.event_id),
            rewind_event_id=event.event_id,
            rewind_cluster_id=event.cluster_id,
            rewind_classification=event.classification,
            rewind_confidence=event.confidence,
            rewind_impact_direction=event.impact_direction,
            rewound_time_s=event.rewound_time_s,
            rewound_course_distance_m=event.rewound_course_distance_m,
        )
    return [samples_by_source[key] for key in sorted(samples_by_source)]


def _write_completed_lap(path: Path, source_columns: list[str], rows: list[TelemetryRow], normalization) -> None:
    fieldnames = [
        "source_row_index",
        "is_effective",
        "superseded_by_rewind_event_id",
        *source_columns,
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "source_row_index": row.source_row_index,
                    "is_effective": normalization.is_effective_by_source_row.get(row.source_row_index, True),
                    "superseded_by_rewind_event_id": normalization.superseded_by_source_row.get(row.source_row_index, ""),
                    **row.source,
                }
            )


def _write_projected_lap(path: Path, projected: list[ProjectedSample], vehicle: dict[str, object]) -> None:
    fieldnames = [
        "source_row_index",
        "timestamp_s",
        "lap_time_s",
        "course_distance_m",
        "section_id",
        "projection_error_m",
        "reference_index",
        "uncertain_mapping",
        "position_x",
        "position_y",
        "position_z",
        "telemetry_display_x",
        "telemetry_display_y",
        "telemetry_display_z",
        "speed_kmh",
        "accel_pct",
        "brake_pct",
        "steer_norm",
        "manual_marker_id",
        "exclude_from_driving_analysis",
        "is_effective",
        "superseded_by_rewind_event_id",
        "rewind_event_id",
        "rewind_cluster_id",
        "rewind_classification",
        "rewind_confidence",
        "rewind_impact_direction",
        "rewound_time_s",
        "rewound_course_distance_m",
        "vehicle_display_name",
        "vehicle_filename_slug",
        "vehicle_car_ordinal",
        "vehicle_identification_source",
        "vehicle_catalog_sha256",
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for index, sample in enumerate(projected):
            first_row_vehicle = vehicle if index == 0 else {}
            writer.writerow(
                {
                    "source_row_index": sample.row.source_row_index,
                    "timestamp_s": sample.row.timestamp_s,
                    "lap_time_s": sample.row.lap_time_s,
                    "course_distance_m": sample.course_distance_m,
                    "section_id": sample.section_id,
                    "projection_error_m": sample.projection_error_m,
                    "reference_index": sample.reference_index,
                    "uncertain_mapping": sample.uncertain_mapping,
                    "position_x": sample.row.position_x,
                    "position_y": sample.row.position_y,
                    "position_z": sample.row.position_z,
                    "telemetry_display_x": sample.telemetry_display_x,
                    "telemetry_display_y": sample.telemetry_display_y,
                    "telemetry_display_z": sample.telemetry_display_z,
                    "speed_kmh": sample.row.speed_kmh,
                    "accel_pct": sample.row.accel_pct,
                    "brake_pct": sample.row.brake_pct,
                    "steer_norm": sample.row.steer_norm,
                    "manual_marker_id": sample.marker_id,
                    "exclude_from_driving_analysis": sample.exclude_from_driving_analysis,
                    "is_effective": sample.is_effective,
                    "superseded_by_rewind_event_id": sample.superseded_by_rewind_event_id,
                    "rewind_event_id": sample.rewind_event_id,
                    "rewind_cluster_id": sample.rewind_cluster_id,
                    "rewind_classification": sample.rewind_classification,
                    "rewind_confidence": sample.rewind_confidence,
                    "rewind_impact_direction": sample.rewind_impact_direction,
                    "rewound_time_s": "" if sample.rewound_time_s is None else sample.rewound_time_s,
                    "rewound_course_distance_m": "" if sample.rewound_course_distance_m is None else sample.rewound_course_distance_m,
                    "vehicle_display_name": first_row_vehicle.get("display_name", ""),
                    "vehicle_filename_slug": first_row_vehicle.get("filename_slug", ""),
                    "vehicle_car_ordinal": first_row_vehicle.get("car_ordinal", ""),
                    "vehicle_identification_source": first_row_vehicle.get("identification_source", ""),
                    "vehicle_catalog_sha256": first_row_vehicle.get("catalog_sha256", ""),
                }
            )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
