from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from goliath.telemetry.importer import REQUIRED_COLUMNS
from goliath.telemetry.model import TelemetrySessionVehicle
from goliath.vehicle.catalog import DEFAULT_CATALOG_DIR
from goliath.vehicle.resolver import resolve_vehicle_identity
from goliath.sessions.model import (
    DEFAULT_PROCESSED_ROOT,
    DEFAULT_SESSIONS_ROOT,
    DEFAULT_STATE_ROOT,
    PROCESSED_SCHEMA_VERSION,
    ProcessState,
    SessionRecord,
    SessionVehicle,
)
from goliath.sessions.state import load_ignored_state, validate_session_id

CSV_PROBE_ROW_LIMIT = 10_000


def discover_sessions(
    sessions_root: Path = DEFAULT_SESSIONS_ROOT,
    *,
    processed_root: Path = DEFAULT_PROCESSED_ROOT,
    state_root: Path = DEFAULT_STATE_ROOT,
    vehicle_catalog_dir: Path = DEFAULT_CATALOG_DIR,
    include_incomplete: bool = False,
    include_invalid: bool = False,
    include_ignored: bool = False,
) -> list[SessionRecord]:
    sessions_root = Path(sessions_root)
    if not sessions_root.exists():
        return []
    records = [
        inspect_session_directory(
            child,
            processed_root=processed_root,
            state_root=state_root,
            vehicle_catalog_dir=vehicle_catalog_dir,
        )
        for child in sessions_root.iterdir()
        if child.is_dir()
    ]
    records.sort(key=_sort_key, reverse=True)
    return [
        record
        for record in records
        if _include_record(
            record,
            include_incomplete=include_incomplete,
            include_invalid=include_invalid,
            include_ignored=include_ignored,
        )
    ]


def find_session(
    session_id: str,
    sessions_root: Path = DEFAULT_SESSIONS_ROOT,
    *,
    processed_root: Path = DEFAULT_PROCESSED_ROOT,
    state_root: Path = DEFAULT_STATE_ROOT,
    vehicle_catalog_dir: Path = DEFAULT_CATALOG_DIR,
) -> SessionRecord | None:
    session_id = validate_session_id(session_id)
    session_dir = Path(sessions_root) / session_id
    if not session_dir.exists() or not session_dir.is_dir():
        return None
    return inspect_session_directory(
        session_dir,
        processed_root=processed_root,
        state_root=state_root,
        vehicle_catalog_dir=vehicle_catalog_dir,
    )


def inspect_session_directory(
    session_dir: Path,
    *,
    processed_root: Path = DEFAULT_PROCESSED_ROOT,
    state_root: Path = DEFAULT_STATE_ROOT,
    vehicle_catalog_dir: Path = DEFAULT_CATALOG_DIR,
) -> SessionRecord:
    session_dir = Path(session_dir)
    session_id = session_dir.name
    errors: list[str] = []
    warnings: list[str] = []
    metadata: dict[str, object] = {}

    try:
        validate_session_id(session_id)
    except ValueError as exc:
        errors.append(str(exc))

    csv_files = sorted(session_dir.glob("*_telemetry.csv"))
    json_files = sorted(session_dir.glob("*_session.json"))
    raw_files = sorted(session_dir.glob("*_packets.fh6raw"))

    csv_path = _single_file(csv_files, "telemetry CSV", errors)
    json_path = _single_file(json_files, "session JSON", errors)
    raw_path = None
    if len(raw_files) > 1:
        errors.append(f"expected zero or one raw packet file, found {len(raw_files)}")
    elif raw_files:
        raw_path = raw_files[0]

    if csv_path and not csv_path.name.startswith(session_id):
        errors.append(f"telemetry CSV filename does not start with session ID {session_id}")
    if json_path and not json_path.name.startswith(session_id):
        errors.append(f"session JSON filename does not start with session ID {session_id}")
    if raw_path and not raw_path.name.startswith(session_id):
        warnings.append(f"raw packet filename does not start with session ID {session_id}")

    if json_path:
        try:
            loaded = json.loads(json_path.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                metadata = loaded
            else:
                errors.append(f"session JSON {json_path} must contain an object")
        except json.JSONDecodeError as exc:
            errors.append(f"invalid session JSON {json_path}: {exc}")
        except OSError as exc:
            errors.append(f"could not read session JSON {json_path}: {exc}")

    metadata_session_id = metadata.get("session_id")
    if isinstance(metadata_session_id, str) and metadata_session_id.strip():
        if metadata_session_id != session_id:
            errors.append(
                f"session ID mismatch: directory is {session_id}, metadata is {metadata_session_id}"
            )
    elif json_path and "session_id" not in metadata:
        warnings.append("legacy session JSON has no session_id")

    header: list[str] = []
    probe_vehicle: dict[str, int] = {}
    csv_has_data = False
    if csv_path:
        header, csv_has_data, probe_vehicle, csv_warnings, csv_errors = _inspect_csv(csv_path)
        warnings.extend(csv_warnings)
        errors.extend(csv_errors)

    recording_complete = _as_bool_or_none(metadata.get("recording_complete"))
    recording_state = _as_str_or_none(metadata.get("recording_state"))
    source_status = _classify_source(recording_complete, recording_state, json_path is not None, errors, warnings)

    started_at = _as_str_or_none(metadata.get("started_at"))
    ended_at = _as_str_or_none(metadata.get("ended_at"))
    duration_s = _duration_seconds(started_at, ended_at)
    received_packets = _as_int_or_none(metadata.get("received_packets"))
    saved_packets = _as_int_or_none(metadata.get("saved_packets"))
    ignored_off_packets = _as_int_or_none(metadata.get("ignored_off_packets"))

    ignored_state = load_ignored_state(state_root, session_id) if not errors else load_ignored_state(state_root, session_id)
    warnings.extend(ignored_state.warnings)
    process_state = inspect_process_state(processed_root, session_id)
    process_status = "ignored" if ignored_state.ignored else process_state.status

    vehicle = _resolve_vehicle(metadata, probe_vehicle, vehicle_catalog_dir, warnings)
    if errors:
        source_status = "invalid"

    return SessionRecord(
        session_id=session_id,
        session_dir=session_dir,
        telemetry_csv_path=csv_path,
        session_json_path=json_path,
        raw_packets_path=raw_path,
        source_status=source_status,
        process_status=process_status,
        validation_errors=errors,
        validation_warnings=[*warnings, *process_state.warnings],
        recording_complete=recording_complete,
        recording_state=recording_state,
        started_at=started_at,
        ended_at=ended_at,
        duration_s=duration_s,
        received_packets=received_packets,
        saved_packets=saved_packets,
        ignored_off_packets=ignored_off_packets,
        vehicle=vehicle,
        processed_dir=process_state.processed_dir,
        session_summary_path=process_state.session_summary_path,
        ignored_reason=ignored_state.reason if ignored_state.ignored else None,
        session_metadata=metadata,
    )


def inspect_process_state(processed_root: Path, session_id: str) -> ProcessState:
    processed_dir = Path(processed_root) / session_id
    if not processed_dir.exists():
        return ProcessState("unprocessed", processed_dir)
    if not processed_dir.is_dir():
        return ProcessState("partial", processed_dir, errors=[f"processed path is not a directory: {processed_dir}"])

    summaries = sorted(processed_dir.glob("*_session-summary.json"))
    if len(summaries) != 1:
        return ProcessState(
            "partial",
            processed_dir,
            errors=[f"expected exactly one session summary, found {len(summaries)}"],
        )
    summary_path = summaries[0]
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        return ProcessState("partial", processed_dir, summary_path, errors=[f"invalid session summary: {exc}"])
    if not isinstance(summary, dict):
        return ProcessState("partial", processed_dir, summary_path, errors=["session summary must contain an object"])
    schema = summary.get("schema_version")
    if schema is not None and schema != PROCESSED_SCHEMA_VERSION:
        return ProcessState("partial", processed_dir, summary_path, errors=[f"unsupported processed schema {schema}"])
    if summary.get("session_id") != session_id:
        return ProcessState("partial", processed_dir, summary_path, errors=["session summary session_id mismatch"])
    outputs = summary.get("outputs")
    if not isinstance(outputs, dict):
        return ProcessState("partial", processed_dir, summary_path, errors=["session summary missing outputs"])

    missing: list[str] = []
    invalid: list[str] = []
    for key in ("session_summary_json", "projected_lap_csv", "rewind_analysis_json"):
        resolved, error = _resolve_processed_output(outputs.get(key), processed_dir)
        if error:
            invalid.append(f"{key}: {error}")
        elif resolved is None:
            missing.append(key)
    if missing:
        return ProcessState("partial", processed_dir, summary_path, errors=[f"missing processed outputs: {', '.join(missing)}"])
    if invalid:
        return ProcessState("partial", processed_dir, summary_path, errors=["invalid processed outputs: " + "; ".join(invalid)])
    return ProcessState("processed", processed_dir, summary_path)


def _resolve_processed_output(raw_value: object, processed_dir: Path) -> tuple[Path | None, str | None]:
    if not isinstance(raw_value, str) or not raw_value:
        return None, None
    raw_path = Path(raw_value)
    processed_dir_resolved = processed_dir.resolve()

    candidates: list[Path] = []
    if raw_path.is_absolute():
        candidates.append(raw_path)
    else:
        candidates.append((Path.cwd() / raw_path).resolve())

    for candidate in candidates:
        if candidate.exists():
            if not _is_relative_to(candidate.resolve(), processed_dir_resolved):
                return None, f"path is outside processed session directory: {candidate}"
            if not candidate.is_file():
                return None, f"path is not a file: {candidate}"
            return candidate, None

    basename = raw_path.name
    if not basename:
        return None, None
    fallback = (processed_dir / basename).resolve()
    if fallback.exists():
        if not _is_relative_to(fallback, processed_dir_resolved):
            return None, f"path is outside processed session directory: {fallback}"
        if not fallback.is_file():
            return None, f"path is not a file: {fallback}"
        return fallback, None
    return None, None


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _include_record(
    record: SessionRecord,
    *,
    include_incomplete: bool,
    include_invalid: bool,
    include_ignored: bool,
) -> bool:
    if record.is_ignored and not include_ignored:
        return False
    if record.source_status == "invalid" and not include_invalid:
        return False
    if record.source_status == "incomplete" and not include_incomplete:
        return False
    return True


def _single_file(files: list[Path], label: str, errors: list[str]) -> Path | None:
    if len(files) != 1:
        errors.append(f"expected exactly one {label}, found {len(files)}")
        return None
    return files[0]


def _inspect_csv(csv_path: Path) -> tuple[list[str], bool, dict[str, int], list[str], list[str]]:
    warnings: list[str] = []
    errors: list[str] = []
    probe_vehicle: dict[str, int] = {}
    try:
        if csv_path.stat().st_size == 0:
            return [], False, {}, warnings, [f"telemetry CSV {csv_path} is empty"]
        with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            header = list(reader.fieldnames or [])
            missing = sorted(set(REQUIRED_COLUMNS) - set(header))
            if missing:
                errors.append(f"telemetry CSV missing required columns: {missing}")
            row_count = 0
            for row in reader:
                row_count += 1
                if not probe_vehicle:
                    probe_vehicle = _vehicle_from_csv_row(row)
                if row_count >= CSV_PROBE_ROW_LIMIT or probe_vehicle:
                    break
            if row_count == 0:
                errors.append(f"telemetry CSV {csv_path} contains no data rows")
            return header, row_count > 0, probe_vehicle, warnings, errors
    except OSError as exc:
        return [], False, {}, warnings, [f"could not read telemetry CSV {csv_path}: {exc}"]


def _vehicle_from_csv_row(row: dict[str, str]) -> dict[str, int]:
    ordinal = _parse_positive_int(row.get("car_ordinal"))
    if ordinal is None:
        return {}
    vehicle = {"car_ordinal": ordinal}
    for column in ("car_class", "car_performance_index", "drive_train", "car_group", "num_cylinders"):
        value = _parse_positive_int(row.get(column))
        if value is not None:
            vehicle[column] = value
    return vehicle


def _resolve_vehicle(
    metadata: dict[str, object],
    probe_vehicle: dict[str, int],
    vehicle_catalog_dir: Path,
    warnings: list[str],
) -> SessionVehicle:
    vehicle_raw = metadata.get("vehicle")
    vehicle_dict = vehicle_raw if isinstance(vehicle_raw, dict) else probe_vehicle
    session_vehicle = TelemetrySessionVehicle(
        car_ordinal=_as_int_or_none(vehicle_dict.get("car_ordinal")) if isinstance(vehicle_dict, dict) else None,
        car_class=_as_int_or_none(vehicle_dict.get("car_class")) if isinstance(vehicle_dict, dict) else None,
        car_performance_index=_as_int_or_none(vehicle_dict.get("car_performance_index")) if isinstance(vehicle_dict, dict) else None,
        drive_train=_as_int_or_none(vehicle_dict.get("drive_train")) if isinstance(vehicle_dict, dict) else None,
        car_group=_as_int_or_none(vehicle_dict.get("car_group")) if isinstance(vehicle_dict, dict) else None,
        num_cylinders=_as_int_or_none(vehicle_dict.get("num_cylinders")) if isinstance(vehicle_dict, dict) else None,
        ordinal_distribution={str(vehicle_dict.get("car_ordinal")): 1}
        if isinstance(vehicle_dict, dict) and _as_int_or_none(vehicle_dict.get("car_ordinal")) is not None
        else {},
    )
    try:
        identity = resolve_vehicle_identity(
            session_vehicle,
            session_metadata=metadata,
            catalog_dir=vehicle_catalog_dir,
        )
    except ValueError as exc:
        warnings.append(f"vehicle catalog could not be used: {exc}")
        display = f"Car {session_vehicle.car_ordinal}" if session_vehicle.car_ordinal else "Unknown vehicle"
        return SessionVehicle(display_name=display, car_ordinal=session_vehicle.car_ordinal)
    return SessionVehicle(
        display_name=identity.display_name,
        car_ordinal=identity.car_ordinal,
        car_class=identity.car_class,
        car_performance_index=identity.car_performance_index,
        drive_train=identity.drive_train,
        car_group=identity.car_group,
        num_cylinders=identity.num_cylinders,
        identification_source=identity.identification_source,
        catalog_sha256=identity.catalog_sha256,
    )


def _classify_source(
    recording_complete: bool | None,
    recording_state: str | None,
    has_metadata: bool,
    errors: list[str],
    warnings: list[str],
) -> str:
    if errors:
        return "invalid"
    if recording_complete is None and recording_state is None:
        return "legacy-ready" if has_metadata else "invalid"
    if recording_complete is True and recording_state == "completed":
        return "completed"
    if recording_complete is True and recording_state is None:
        warnings.append("recording_complete is true but recording_state is missing")
        return "completed"
    if recording_complete is True and recording_state != "completed":
        errors.append(f"inconsistent completion fields: recording_complete true with state {recording_state}")
        return "invalid"
    if recording_complete is False and recording_state == "completed":
        errors.append("inconsistent completion fields: recording_complete false with state completed")
        return "invalid"
    if recording_complete is False or recording_state in {"recording", "finalizing", "failed"}:
        return "incomplete"
    errors.append(f"unsupported recording state combination: complete={recording_complete}, state={recording_state}")
    return "invalid"


def _sort_key(record: SessionRecord) -> tuple[str, str]:
    return (record.started_at or record.session_id, record.session_id)


def _duration_seconds(started_at: str | None, ended_at: str | None) -> float | None:
    start = _parse_iso_datetime(started_at)
    end = _parse_iso_datetime(ended_at)
    if not start or not end:
        return None
    return (end - start).total_seconds()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _as_str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _as_bool_or_none(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _as_int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(float(value.strip()))
        except ValueError:
            return None
    return None


def _parse_positive_int(value: object) -> int | None:
    integer = _as_int_or_none(value)
    return integer if integer is not None and integer > 0 else None