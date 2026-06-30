from __future__ import annotations

import csv
from dataclasses import asdict, replace
from datetime import UTC, datetime
import json
from pathlib import Path

from goliath.config.sections import SECTIONS
from goliath.reference.loader import load_reference_csv
from goliath.telemetry.importer import load_telemetry_session
from goliath.telemetry.lap import extract_completed_lap
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


def process_session(
    session_dir: Path,
    *,
    reference_csv: Path = Path("data/reference/goliath_reference_1m.csv"),
    output_root: Path = Path("data/processed"),
) -> dict[str, object]:
    session = load_telemetry_session(session_dir)
    reference_points, origin = load_reference_csv(reference_csv)

    normalization = normalize_rewinds(session.rows)
    lap = extract_completed_lap(normalization.effective_rows)
    validate_effective_lap_time(lap.rows)
    raw_lap_rows = [
        row for row in session.rows
        if lap.start_source_row_index <= row.source_row_index <= lap.end_source_row_index
    ]

    markers = detect_handbrake_markers(lap.rows)
    projected_effective, projection_summary = project_lap_to_reference(lap.rows, reference_points, origin)
    projected_effective = _apply_marker_annotations(projected_effective, markers)
    projected_by_row = {sample.row.source_row_index: sample for sample in projected_effective}

    rows_by_source = {row.source_row_index: row for row in session.rows}
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

    projected_for_csv = _build_projected_lap_output_samples(projected_effective, normalization, projected_by_row)
    sections = build_section_summary([sample for sample in projected_effective if sample.is_effective])
    marker_offsets = build_marker_boundary_offsets(markers, projected_by_row)

    output_dir = output_root / session.session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    _write_completed_lap(output_dir / "completed-lap.csv", session.source_columns, raw_lap_rows, normalization)
    _write_projected_lap(output_dir / "projected-lap.csv", projected_for_csv)
    _write_json(output_dir / "marker-events.json", {"markers": markers_as_dicts(markers)})
    _write_json(output_dir / "rewind-analysis.json", rewind_analysis)
    _write_json(
        output_dir / "section-summary.json",
        {
            "session_id": session.session_id,
            "total_lap_time_s": lap.completed_lap_time_s,
            "sections": sections,
            "marker_boundary_offsets": marker_offsets,
        },
    )

    summary: dict[str, object] = {
        "schema_version": "goliath-processed-session-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "session_id": session.session_id,
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
        "handbrake_marker_count": len(markers),
        "projection_summary": asdict(projection_summary),
        "rewind_summary": rewind_analysis["summary"],
        "outputs": {
            "session_summary_json": str(output_dir / "session-summary.json"),
            "completed_lap_csv": str(output_dir / "completed-lap.csv"),
            "marker_events_json": str(output_dir / "marker-events.json"),
            "projected_lap_csv": str(output_dir / "projected-lap.csv"),
            "rewind_analysis_json": str(output_dir / "rewind-analysis.json"),
            "section_summary_json": str(output_dir / "section-summary.json"),
        },
    }
    _write_json(output_dir / "session-summary.json", summary)
    return summary


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


def _write_projected_lap(path: Path, projected: list[ProjectedSample]) -> None:
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
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for sample in projected:
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
                }
            )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")