from __future__ import annotations

import csv
from dataclasses import asdict, replace
from datetime import UTC, datetime
import json
from pathlib import Path

from goliath.reference.loader import load_reference_csv
from goliath.telemetry.importer import load_telemetry_session
from goliath.telemetry.lap import extract_completed_lap
from goliath.telemetry.markers import detect_handbrake_markers
from goliath.telemetry.model import ProjectedSample
from goliath.telemetry.projection import project_lap_to_reference
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
    lap = extract_completed_lap(session.rows)
    markers = detect_handbrake_markers(lap.rows)
    if len(markers) != 5:
        raise ValueError(f"expected exactly five handbrake marker events, found {len(markers)}")

    reference_points, origin = load_reference_csv(reference_csv)
    projected, projection_summary = project_lap_to_reference(lap.rows, reference_points, origin)
    projected = _apply_marker_annotations(projected, markers)
    projected_by_row = {sample.row.source_row_index: sample for sample in projected}
    sections = build_section_summary(projected)
    marker_offsets = build_marker_boundary_offsets(markers, projected_by_row)

    output_dir = output_root / session.session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    _write_completed_lap(output_dir / "completed-lap.csv", session.source_columns, lap.rows)
    _write_projected_lap(output_dir / "projected-lap.csv", projected)
    _write_json(output_dir / "marker-events.json", {"markers": markers_as_dicts(markers)})
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
        "outputs": {
            "session_summary_json": str(output_dir / "session-summary.json"),
            "completed_lap_csv": str(output_dir / "completed-lap.csv"),
            "marker_events_json": str(output_dir / "marker-events.json"),
            "projected_lap_csv": str(output_dir / "projected-lap.csv"),
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


def _write_completed_lap(path: Path, source_columns: list[str], rows) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["source_row_index", *source_columns])
        writer.writeheader()
        for row in rows:
            writer.writerow({"source_row_index": row.source_row_index, **row.source})


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
                }
            )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
