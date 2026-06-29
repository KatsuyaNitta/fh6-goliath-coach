from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
import json
from pathlib import Path

from goliath.config.sections import boundary_markers, build_sections, sections_as_dicts
from goliath.reference.loader import load_reference_csv

POINT_COLUMNS = [
    "course_distance_m",
    "display_x",
    "display_y",
    "display_z",
    "position_x",
    "position_y",
    "position_z",
    "speed_kmh",
    "current_lap_time",
    "section_index",
]


def build_reference_json(input_csv: Path, output_json: Path) -> dict[str, object]:
    points, origin = load_reference_csv(input_csv)
    sections = build_sections(points[-1].course_distance_m)
    payload: dict[str, object] = {
        "schema_version": "goliath-reference-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "provenance": {
            "source_file": str(input_csv),
            "description": "1 m resampled reference driving path for FH6 Goliath.",
            "limitations": [
                "This is a sampled driving path, not a verified road centerline.",
                "This is not an official course geometry or an ideal racing line.",
                "It does not contain road width, road edges, checkpoints, guardrails, curbs, or collision geometry.",
            ],
        },
        "coordinate_system": {
            "world_axes": {
                "position_x": "horizontal world axis",
                "position_y": "height/elevation",
                "position_z": "horizontal world axis",
            },
            "display_normalization": "display axis = original position axis - start position axis",
            "display_origin": asdict(origin),
        },
        "sections": sections_as_dicts(sections),
        "markers": boundary_markers(sections),
        "start_finish": {
            "start_course_distance_m": points[0].course_distance_m,
            "finish_course_distance_m": points[-1].course_distance_m,
        },
        "stats": {
            "point_count": len(points),
            "source_columns": [
                "current_lap_time",
                "course_distance_m",
                "course_distance_km",
                "position_x",
                "position_y",
                "position_z",
                "speed_kmh",
            ],
        },
        "point_columns": POINT_COLUMNS,
        "points": [
            [
                point.course_distance_m,
                point.display_x,
                point.display_y,
                point.display_z,
                point.position_x,
                point.position_y,
                point.position_z,
                point.speed_kmh,
                point.current_lap_time,
                point.section_index,
            ]
            for point in points
        ],
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return payload
