from __future__ import annotations

import argparse
from pathlib import Path

from goliath.reference.exporter import build_reference_json
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

    args = parser.parse_args()
    if args.command == "build-reference":
        payload = build_reference_json(args.input_csv, args.output)
        point_count = len(payload["points"])  # type: ignore[arg-type]
        finish_m = payload["start_finish"]["finish_course_distance_m"]  # type: ignore[index]
        print(f"wrote {args.output} with {point_count} points; finish={finish_m:.3f} m")
    elif args.command == "update-vehicle-catalog":
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
    elif args.command == "process-session":
        summary = process_session(
            args.session_dir,
            reference_csv=args.reference,
            output_root=args.output_root,
            vehicle_catalog_dir=args.vehicle_catalog_dir,
        )
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


if __name__ == "__main__":
    main()