from __future__ import annotations

import csv
from pathlib import Path

from goliath.config.sections import assign_section_id
from goliath.reference.model import DisplayOrigin, ReferencePoint

REQUIRED_COLUMNS = {
    "current_lap_time",
    "course_distance_m",
    "course_distance_km",
    "position_x",
    "position_y",
    "position_z",
    "speed_kmh",
}


def load_reference_csv(path: Path) -> tuple[list[ReferencePoint], DisplayOrigin]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        headers = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - headers
        if missing:
            raise ValueError(f"reference CSV is missing required columns: {sorted(missing)}")

        points: list[ReferencePoint] = []
        origin: DisplayOrigin | None = None
        previous_distance = -1.0

        for row_number, row in enumerate(reader, start=2):
            point = _parse_row(row, row_number)
            if point["course_distance_m"] < previous_distance:
                raise ValueError(
                    "course_distance_m must be monotonic: "
                    f"row {row_number} has {point['course_distance_m']} after {previous_distance}"
                )
            previous_distance = point["course_distance_m"]

            if origin is None:
                origin = DisplayOrigin(
                    point["position_x"],
                    point["position_y"],
                    point["position_z"],
                )

            points.append(
                ReferencePoint(
                    current_lap_time=point["current_lap_time"],
                    course_distance_m=point["course_distance_m"],
                    course_distance_km=point["course_distance_km"],
                    position_x=point["position_x"],
                    position_y=point["position_y"],
                    position_z=point["position_z"],
                    speed_kmh=point["speed_kmh"],
                    display_x=point["position_x"] - origin.position_x,
                    display_y=point["position_y"] - origin.position_y,
                    display_z=point["position_z"] - origin.position_z,
                    section_id=assign_section_id(point["course_distance_m"]),
                )
            )

    if origin is None or not points:
        raise ValueError("reference CSV contains no points")

    return points, origin


def _parse_row(row: dict[str, str], row_number: int) -> dict[str, float]:
    parsed: dict[str, float] = {}
    for column in REQUIRED_COLUMNS:
        raw = row.get(column)
        if raw is None or raw == "":
            raise ValueError(f"row {row_number} has an empty value for {column}")
        try:
            parsed[column] = float(raw)
        except ValueError as exc:
            raise ValueError(f"row {row_number} has an invalid {column}: {raw}") from exc
    return parsed
