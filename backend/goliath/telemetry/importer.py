from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from statistics import median

from goliath.telemetry.model import SampleStats, TelemetryRow, TelemetrySession

REQUIRED_COLUMNS = (
    "game_elapsed_s",
    "session_elapsed_s",
    "current_lap_time",
    "last_lap_time",
    "lap_number",
    "position_x",
    "position_y",
    "position_z",
    "speed_kmh",
    "handbrake_raw",
    "handbrake_pct",
)

REQUIRED_NUMERIC_COLUMNS = REQUIRED_COLUMNS
OPTIONAL_NUMERIC_COLUMNS = (
    "packet_index",
    "kept_index",
    "current_race_time",
    "distance_traveled",
    "accel_x",
    "accel_y",
    "accel_z",
    "velocity_x",
    "velocity_y",
    "velocity_z",
    "angular_velocity_x",
    "angular_velocity_y",
    "angular_velocity_z",
    "yaw",
    "pitch",
    "roll",
    "accel_pct",
    "brake_pct",
    "steer_norm",
)


def load_telemetry_session(session_dir: Path) -> TelemetrySession:
    session_dir = Path(session_dir)
    csv_files = sorted(session_dir.glob("*_telemetry.csv"))
    json_files = sorted(session_dir.glob("*_session.json"))
    if len(csv_files) != 1:
        raise ValueError(f"expected exactly one telemetry CSV in {session_dir}, found {len(csv_files)}")
    if len(json_files) != 1:
        raise ValueError(f"expected exactly one session JSON in {session_dir}, found {len(json_files)}")

    session_json_path = json_files[0]
    try:
        session_metadata = json.loads(session_json_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid session JSON {session_json_path}: {exc}") from exc
    if not isinstance(session_metadata, dict):
        raise ValueError(f"session JSON {session_json_path} must contain an object")

    csv_path = csv_files[0]
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        source_columns = list(reader.fieldnames or [])
        _validate_headers(source_columns, csv_path)
        rows = [
            _parse_row(row, source_row_index=row_index)
            for row_index, row in enumerate(reader, start=2)
        ]

    if not rows:
        raise ValueError(f"telemetry CSV {csv_path} contains no data rows")

    return TelemetrySession(
        session_id=session_dir.name,
        csv_path=str(csv_path),
        session_json_path=str(session_json_path),
        source_columns=source_columns,
        session_metadata=session_metadata,
        rows=rows,
        sample_stats=_build_sample_stats(rows),
    )


def _validate_headers(source_columns: list[str], csv_path: Path) -> None:
    missing = sorted(set(REQUIRED_COLUMNS) - set(source_columns))
    if missing:
        raise ValueError(f"telemetry CSV {csv_path} is missing required columns: {missing}")


def _parse_row(row: dict[str, str], source_row_index: int) -> TelemetryRow:
    numeric = {
        column: _parse_required_float(row, column, source_row_index)
        for column in REQUIRED_NUMERIC_COLUMNS
    }
    optional = {
        column: _parse_optional_float(row, column, source_row_index)
        for column in OPTIONAL_NUMERIC_COLUMNS
    }
    timestamp_s = numeric["game_elapsed_s"]
    if timestamp_s == 0 and numeric["session_elapsed_s"] > 0:
        timestamp_s = numeric["game_elapsed_s"]
    return TelemetryRow(
        source_row_index=source_row_index,
        source=dict(row),
        timestamp_s=timestamp_s,
        lap_time_s=numeric["current_lap_time"],
        lap_number=int(numeric["lap_number"]),
        position_x=numeric["position_x"],
        position_y=numeric["position_y"],
        position_z=numeric["position_z"],
        speed_kmh=numeric["speed_kmh"],
        handbrake_raw=numeric["handbrake_raw"],
        handbrake_pct=numeric["handbrake_pct"],
        packet_index=int(optional["packet_index"]),
        kept_index=int(optional["kept_index"]),
        game_elapsed_s=numeric["game_elapsed_s"],
        session_elapsed_s=numeric["session_elapsed_s"],
        current_race_time_s=optional["current_race_time"],
        distance_traveled=optional["distance_traveled"],
        accel_x=optional["accel_x"],
        accel_y=optional["accel_y"],
        accel_z=optional["accel_z"],
        velocity_x=optional["velocity_x"],
        velocity_y=optional["velocity_y"],
        velocity_z=optional["velocity_z"],
        angular_velocity_x=optional["angular_velocity_x"],
        angular_velocity_y=optional["angular_velocity_y"],
        angular_velocity_z=optional["angular_velocity_z"],
        yaw=optional["yaw"],
        pitch=optional["pitch"],
        roll=optional["roll"],
        accel_pct=optional["accel_pct"],
        brake_pct=optional["brake_pct"],
        steer_norm=optional["steer_norm"],
    )


def _parse_required_float(row: dict[str, str], column: str, source_row_index: int) -> float:
    raw = row.get(column)
    if raw is None or raw == "":
        raise ValueError(f"telemetry row {source_row_index} has an empty value for {column}")
    return _parse_float(raw, column, source_row_index)


def _parse_optional_float(row: dict[str, str], column: str, source_row_index: int) -> float:
    raw = row.get(column)
    if raw is None or raw == "":
        return 0.0
    return _parse_float(raw, column, source_row_index)


def _parse_float(raw: str, column: str, source_row_index: int) -> float:
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"telemetry row {source_row_index} has invalid {column}: {raw}") from exc
    if not math.isfinite(value):
        raise ValueError(f"telemetry row {source_row_index} has non-finite {column}: {raw}")
    return value


def _build_sample_stats(rows: list[TelemetryRow]) -> SampleStats:
    intervals = [
        current.timestamp_s - previous.timestamp_s
        for previous, current in zip(rows, rows[1:])
        if current.timestamp_s >= previous.timestamp_s
    ]
    if intervals:
        median_interval = median(intervals)
        min_interval = min(intervals)
        max_interval = max(intervals)
        gap_threshold = max(0.25, median_interval * 10)
    else:
        median_interval = min_interval = max_interval = 0.0
        gap_threshold = 0.25

    gaps = []
    for previous, current in zip(rows, rows[1:]):
        interval = current.timestamp_s - previous.timestamp_s
        if interval > gap_threshold:
            gaps.append(
                {
                    "source_row_index": current.source_row_index,
                    "start_timestamp_s": previous.timestamp_s,
                    "end_timestamp_s": current.timestamp_s,
                    "duration_s": interval,
                }
            )

    return SampleStats(
        sample_count=len(rows),
        session_duration_s=rows[-1].timestamp_s - rows[0].timestamp_s,
        median_sample_interval_s=median_interval,
        min_sample_interval_s=min_interval,
        max_sample_interval_s=max_interval,
        large_sampling_gaps=gaps,
    )