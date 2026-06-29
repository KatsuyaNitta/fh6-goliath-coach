from __future__ import annotations

import argparse
from pathlib import Path

from goliath.reference.exporter import build_reference_json


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

    args = parser.parse_args()
    if args.command == "build-reference":
        payload = build_reference_json(args.input_csv, args.output)
        point_count = len(payload["points"])  # type: ignore[arg-type]
        finish_m = payload["start_finish"]["finish_course_distance_m"]  # type: ignore[index]
        print(f"wrote {args.output} with {point_count} points; finish={finish_m:.3f} m")


if __name__ == "__main__":
    main()
