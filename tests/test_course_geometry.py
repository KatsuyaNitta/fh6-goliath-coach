from __future__ import annotations

import csv
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from goliath.cli import main as cli_main
from goliath.reference.geometry import (
    POINT_COLUMNS,
    GeometrySettings,
    build_course_geometry_json,
    build_course_geometry_payload,
)

SYNTHETIC_START_M = 74200.0


class CourseGeometryTests(unittest.TestCase):
    def test_straight_uphill_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "straight.csv"
            _write_points(
                csv_path,
                [(SYNTHETIC_START_M + s, 0.0, s * 0.02, float(s)) for s in range(40)],
            )

            payload = build_course_geometry_payload(
                csv_path,
                GeometrySettings(straight_curvature_threshold_1pm=0.0005),
            )

        self.assertEqual(payload["schema_version"], "goliath-course-geometry-v1")
        self.assertEqual(payload["point_columns"], POINT_COLUMNS)
        point = payload["points"][20]
        self.assertAlmostEqual(point[5], 0.0, places=3)
        self.assertAlmostEqual(point[7], 2.0, places=3)
        self.assertEqual(point[11], "straight")
        self.assertEqual(point[12], "uphill")
        self.assertEqual(point[13], [])

    def test_left_and_right_turn_signs(self) -> None:
        left_payload = _payload_for_arc(left=True)
        right_payload = _payload_for_arc(left=False)

        left_mid = left_payload["points"][30]
        right_mid = right_payload["points"][30]
        self.assertGreater(left_mid[9], 0)
        self.assertEqual(left_mid[11], "left")
        self.assertLess(right_mid[9], 0)
        self.assertEqual(right_mid[11], "right")

    def test_invalidates_gap_and_source_discontinuity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            gap_csv = Path(tmp) / "gap.csv"
            _write_points(
                gap_csv,
                [(SYNTHETIC_START_M + s, 0.0, 0.0, float(s)) for s in list(range(20)) + list(range(30, 50))],
            )
            gap_payload = build_course_geometry_payload(gap_csv, GeometrySettings())
            self.assertIn("distance_gap", gap_payload["points"][18][13])
            self.assertIsNone(gap_payload["points"][18][5])

            jump_csv = Path(tmp) / "jump.csv"
            rows = [(SYNTHETIC_START_M + s, 0.0, 0.0, float(s)) for s in range(50)]
            rows[25] = (SYNTHETIC_START_M + 25.0, 100.0, 0.0, 25.0)
            _write_points(jump_csv, rows)
            jump_payload = build_course_geometry_payload(jump_csv, GeometrySettings())
            self.assertIn("source_discontinuity", jump_payload["points"][24][13])

    def test_cli_writes_default_shaped_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            csv_path = tmp_path / "straight.csv"
            output_path = tmp_path / "viewer" / "public" / "reference" / "goliath_course_geometry.json"
            _write_points(csv_path, [(SYNTHETIC_START_M + s, 0.0, 0.0, float(s)) for s in range(40)])

            with patch(
                "sys.argv",
                [
                    "goliath",
                    "build-course-geometry",
                    str(csv_path),
                    "--output",
                    str(output_path),
                    "--half-window-m",
                    "12",
                    "--stability-half-window-m",
                    "20",
                ],
            ):
                cli_main()

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["algorithm"]["half_window_m"], 12.0)
        self.assertEqual(payload["algorithm"]["stability_half_window_m"], 20.0)
        self.assertEqual(payload["source"]["point_count"], 40)

    def test_rejects_invalid_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "straight.csv"
            _write_points(csv_path, [(SYNTHETIC_START_M + s, 0.0, 0.0, float(s)) for s in range(40)])
            with self.assertRaisesRegex(ValueError, "stability-half-window"):
                build_course_geometry_json(
                    csv_path,
                    Path(tmp) / "out.json",
                    GeometrySettings(half_window_m=15, stability_half_window_m=15),
                )


def _payload_for_arc(left: bool) -> dict[str, object]:
    radius = 120.0
    rows = []
    for index in range(61):
        theta = index / radius
        if left:
            x = radius * (math.cos(theta) - 1.0)
        else:
            x = radius * (1.0 - math.cos(theta))
        z = radius * math.sin(theta)
        rows.append((SYNTHETIC_START_M + index, x, 0.0, z))
    with tempfile.TemporaryDirectory() as tmp:
        csv_path = Path(tmp) / "arc.csv"
        _write_points(csv_path, rows)
        return build_course_geometry_payload(csv_path, GeometrySettings())


def _write_points(path: Path, rows: list[tuple[float, float, float, float]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "current_lap_time",
                "course_distance_m",
                "course_distance_km",
                "position_x",
                "position_y",
                "position_z",
                "speed_kmh",
            ],
        )
        writer.writeheader()
        for lap_time, x, y, z in rows:
            writer.writerow(
                {
                    "current_lap_time": lap_time,
                    "course_distance_m": lap_time,
                    "course_distance_km": lap_time / 1000.0,
                    "position_x": x,
                    "position_y": y,
                    "position_z": z,
                    "speed_kmh": 120,
                }
            )


if __name__ == "__main__":
    unittest.main()
