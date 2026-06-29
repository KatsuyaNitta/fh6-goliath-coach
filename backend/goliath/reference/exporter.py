from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from goliath.config.sections import boundary_markers, sections_as_dicts
from goliath.reference.loader import load_reference_csv


def build_reference_json(input_csv: Path, output_json: Path) -> dict[str, object]:
    points, origin = load_reference_csv(input_csv)
    payload: dict[str, object] = {
        "schema_version": "goliath-reference-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "provenance": {
            "source_file": str(input_csv),
            "description": "1 m resampled sampled driving path for FH6 Goliath.",
            "limitations": [
                "This is a sampled driving path, not a verified road centerline.",
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
        "sections": sections_as_dicts(),
        "markers": boundary_markers(),
        "start_finish": {
            "start_course_distance_m": points[0].course_distance_m,
            "finish_course_distance_m": points[-1].course_distance_m,
        },
        "points": [asdict(point) for point in points],
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return payload
