from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from goliath.reference.exporter import build_reference_json
from goliath.sessions import (
    DEFAULT_PROCESSED_ROOT,
    DEFAULT_SESSIONS_ROOT,
    DEFAULT_STATE_ROOT,
    discover_sessions,
    process_managed_session,
    remove_ignored_state,
    validate_session_id,
    write_ignored_state,
)
from goliath.sessions.model import SESSION_LIST_SCHEMA_VERSION, SessionRecord, SessionUserError
from goliath.telemetry.processor import process_session
from goliath.vehicle.catalog import DEFAULT_CATALOG_DIR, DEFAULT_SOURCE_URL, import_vehicle_catalog


def main() -> None:
    parser = argparse.ArgumentParser(prog="goliath")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_reference = subparsers.add_parser("build-reference")
    build_reference.add_argument(
        "input_csv",
        type=Path,
        help="Path to the 1 m Goliath sampled driving path CSV.",
    )
    build_reference.add_argument(
        "--output",
        type=Path,
        default=Path("viewer/public/reference/goliath_reference.json"),
        help="Browser-facing JSON output path.",
    )

    update_catalog = subparsers.add_parser("update-vehicle-catalog")
    update_catalog.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    update_catalog.add_argument("--source-file", type=Path)
    update_catalog.add_argument("--catalog-dir", type=Path, default=DEFAULT_CATALOG_DIR)
    update_catalog.add_argument("--overrides-file", type=Path)
    update_catalog.add_argument("--timeout", type=float, default=20.0)

    process = subparsers.add_parser("process-session")
    process.add_argument(
        "session_dir",
        type=Path,
        help="Directory containing one *_telemetry.csv and one *_session.json file.",
    )
    process.add_argument(
        "--reference",
        type=Path,
        default=Path("data/reference/goliath_reference_1m.csv"),
        help="Reference driving-path CSV used for projection.",
    )
    process.add_argument(
        "--output-root",
        type=Path,
        default=Path("data/processed"),
        help="Directory where processed outputs are written.",
    )
    process.add_argument(
        "--vehicle-catalog-dir",
        type=Path,
        default=DEFAULT_CATALOG_DIR,
        help="Local ignored vehicle catalog directory.",
    )

    list_sessions = subparsers.add_parser("list-sessions")
    _add_managed_roots(list_sessions)
    list_sessions.add_argument("--include-incomplete", action="store_true")
    list_sessions.add_argument("--include-invalid", action="store_true")
    list_sessions.add_argument("--include-ignored", action="store_true")
    list_sessions.add_argument("--json", action="store_true")

    process_session_id = subparsers.add_parser("process-session-id")
    process_session_id.add_argument("session_id")
    _add_managed_roots(process_session_id)
    process_session_id.add_argument(
        "--reference",
        type=Path,
        default=Path("data/reference/goliath_reference_1m.csv"),
        help="Reference driving-path CSV used for projection.",
    )
    process_session_id.add_argument("--force", action="store_true")

    ignore_session = subparsers.add_parser("ignore-session")
    ignore_session.add_argument("session_id")
    ignore_session.add_argument("--sessions-root", type=Path, default=DEFAULT_SESSIONS_ROOT)
    ignore_session.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    ignore_session.add_argument("--reason", default="")

    unignore_session = subparsers.add_parser("unignore-session")
    unignore_session.add_argument("session_id")
    unignore_session.add_argument("--sessions-root", type=Path, default=DEFAULT_SESSIONS_ROOT)
    unignore_session.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)

    args = parser.parse_args()
    try:
        if args.command == "build-reference":
            _run_build_reference(args)
        elif args.command == "update-vehicle-catalog":
            _run_update_catalog(args)
        elif args.command == "process-session":
            _run_process_session(args)
        elif args.command == "list-sessions":
            _run_list_sessions(args)
        elif args.command == "process-session-id":
            _run_process_session_id(args)
        elif args.command == "ignore-session":
            _run_ignore_session(args)
        elif args.command == "unignore-session":
            _run_unignore_session(args)
    except SessionUserError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(exc.exit_code) from None
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from None


def _add_managed_roots(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sessions-root", type=Path, default=DEFAULT_SESSIONS_ROOT)
    parser.add_argument("--processed-root", type=Path, default=DEFAULT_PROCESSED_ROOT)
    parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    parser.add_argument("--vehicle-catalog-dir", type=Path, default=DEFAULT_CATALOG_DIR)


def _run_build_reference(args: argparse.Namespace) -> None:
    payload = build_reference_json(args.input_csv, args.output)
    point_count = len(payload["points"])  # type: ignore[arg-type]
    finish_m = payload["start_finish"]["finish_course_distance_m"]  # type: ignore[index]
    print(f"wrote {args.output} with {point_count} points; finish={finish_m:.3f} m")


def _run_update_catalog(args: argparse.Namespace) -> None:
    report = import_vehicle_catalog(
        source_url=args.source_url,
        source_file=args.source_file,
        catalog_dir=args.catalog_dir,
        overrides_file=args.overrides_file,
        timeout_s=args.timeout,
    )
    print(
        "imported vehicle catalog: "
        f"source_entries={report.source_entry_count}, "
        f"accepted={report.accepted_entry_count}, "
        f"rejected={report.rejected_entry_count}, "
        f"duplicates={report.duplicate_ordinal_conflict_count}, "
        f"overrides={report.override_count}"
    )
    print(f"sha256={report.source_sha256}")
    print(f"wrote {report.normalized_catalog_path}")
    print(f"wrote {report.provenance_path}")
    if report.duplicate_conflicts:
        print("duplicate ordinal conflicts were recorded in provenance")


def _run_process_session(args: argparse.Namespace) -> None:
    summary = process_session(
        args.session_dir,
        reference_csv=args.reference,
        output_root=args.output_root,
        vehicle_catalog_dir=args.vehicle_catalog_dir,
    )
    _print_processed_summary(summary)


def _run_list_sessions(args: argparse.Namespace) -> None:
    records = discover_sessions(
        args.sessions_root,
        processed_root=args.processed_root,
        state_root=args.state_root,
        vehicle_catalog_dir=args.vehicle_catalog_dir,
        include_incomplete=args.include_incomplete,
        include_invalid=args.include_invalid,
        include_ignored=args.include_ignored,
    )
    warnings = [
        f"{record.session_id}: {warning}"
        for record in records
        for warning in record.validation_warnings
    ]
    if args.json:
        payload = {
            "schema_version": SESSION_LIST_SCHEMA_VERSION,
            "sessions_root": str(args.sessions_root),
            "processed_root": str(args.processed_root),
            "state_root": str(args.state_root),
            "sessions": [record.as_json_dict() for record in records],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        _print_session_table(records)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)


def _run_process_session_id(args: argparse.Namespace) -> None:
    result = process_managed_session(
        args.session_id,
        sessions_root=args.sessions_root,
        processed_root=args.processed_root,
        state_root=args.state_root,
        reference_csv=args.reference,
        vehicle_catalog_dir=args.vehicle_catalog_dir,
        force=args.force,
    )
    summary = result.summary
    vehicle = summary.get("vehicle") if isinstance(summary.get("vehicle"), dict) else {}
    lap = summary.get("completed_lap") if isinstance(summary.get("completed_lap"), dict) else {}
    rewinds = summary.get("rewind_summary") if isinstance(summary.get("rewind_summary"), dict) else {}
    print(f"processed managed session {result.session_id}")
    print(f"vehicle: {vehicle.get('display_name', 'Unknown vehicle')}")
    lap_time = lap.get("completed_lap_time_s")
    print(f"lap time: {_format_seconds(float(lap_time)) if isinstance(lap_time, (int, float)) else '-'}")
    print(f"rewinds: {rewinds.get('rewind_event_count', rewinds.get('event_count', '-'))}")
    print(f"final directory: {result.final_dir}")
    outputs = summary.get("outputs")
    if isinstance(outputs, dict):
        for output_path in outputs.values():
            print(f"wrote {output_path}")


def _run_ignore_session(args: argparse.Namespace) -> None:
    session_id = validate_session_id(args.session_id)
    session_dir = args.sessions_root / session_id
    if not session_dir.exists() or not session_dir.is_dir():
        raise ValueError(f"session not found: {session_id}")
    path = write_ignored_state(args.state_root, session_id, args.reason)
    print(f"ignored {session_id}")
    print(f"wrote {path}")


def _run_unignore_session(args: argparse.Namespace) -> None:
    session_id = validate_session_id(args.session_id)
    path, removed = remove_ignored_state(args.state_root, session_id)
    if removed:
        print(f"unignored {session_id}")
        print(f"removed {path}")
    else:
        print(f"session {session_id} was not ignored")


def _print_processed_summary(summary: dict[str, object]) -> None:
    lap = summary["completed_lap"]  # type: ignore[index]
    projection = summary["projection_summary"]  # type: ignore[index]
    outputs = summary["outputs"]  # type: ignore[index]
    vehicle = summary["vehicle"]  # type: ignore[index]
    print(
        "processed "
        f"{summary['session_id']}: "  # type: ignore[index]
        f"vehicle={vehicle['display_name']}, "  # type: ignore[index]
        f"lap={lap['completed_lap_time_s']:.3f}s, "  # type: ignore[index]
        f"markers={summary['handbrake_marker_count']}, "  # type: ignore[index]
        f"mean_error={projection['mean_error_m']:.3f}m, "  # type: ignore[index]
        f"max_error={projection['max_error_m']:.3f}m"
    )
    for output_path in outputs.values():  # type: ignore[union-attr]
        print(f"wrote {output_path}")


def _print_session_table(records: list[SessionRecord]) -> None:
    headers = ["SESSION ID", "STARTED", "VEHICLE", "PI", "DURATION", "PACKETS", "SOURCE", "PROCESS"]
    rows = [
        [
            record.session_id,
            _format_started(record.started_at),
            _truncate(record.vehicle.display_name, 32),
            str(record.vehicle.car_performance_index) if record.vehicle.car_performance_index else "-",
            _format_duration(record.duration_s),
            str(record.saved_packets) if record.saved_packets is not None else "-",
            record.source_status,
            record.process_status,
        ]
        for record in records
    ]
    widths = [len(header) for header in headers]
    for row in rows:
        widths = [max(width, len(value)) for width, value in zip(widths, row)]
    print("  ".join(header.ljust(width) for header, width in zip(headers, widths)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(value.ljust(width) for value, width in zip(row, widths)))


def _format_started(value: str | None) -> str:
    if not value:
        return "-"
    return value.replace("T", " ")[:19]


def _format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    total = int(round(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


def _format_seconds(seconds: float) -> str:
    minutes = int(seconds // 60)
    return f"{minutes}:{seconds - minutes * 60:06.3f}"


def _truncate(value: str, width: int) -> str:
    if len(value) <= width:
        return value
    return value[: max(0, width - 1)] + "…"


if __name__ == "__main__":
    main()