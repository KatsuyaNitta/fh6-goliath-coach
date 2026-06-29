from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from goliath.reference.loader import load_reference_csv


class ReferenceLoaderTests(unittest.TestCase):
    def write_reference(self, rows: list[str]) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        csv_path = Path(directory.name) / "reference.csv"
        csv_path.write_text(
            "\n".join(
                [
                    "current_lap_time,course_distance_m,course_distance_km,position_x,position_y,position_z,speed_kmh",
                    *rows,
                ]
            ),
            encoding="utf-8",
        )
        return csv_path

    def test_required_column_validation(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        csv_path = Path(directory.name) / "bad.csv"
        csv_path.write_text(
            "current_lap_time,course_distance_m,position_x,position_y,position_z,speed_kmh\n"
            "0.0,0.0,100.0,20.0,-50.0,80.0\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "missing required columns"):
            load_reference_csv(csv_path)

    def test_rejects_non_finite_values(self) -> None:
        csv_path = self.write_reference(
            [
                "0.0,0.0,0.0,100.0,20.0,-50.0,80.0",
                "0.1,1.0,0.001,inf,21.0,-48.0,81.0",
            ]
        )

        with self.assertRaisesRegex(ValueError, "non-finite position_x"):
            load_reference_csv(csv_path)

    def test_monotonic_course_distance_validation(self) -> None:
        csv_path = self.write_reference(
            [
                "0.0,0.0,0.0,100.0,20.0,-50.0,80.0",
                "0.1,0.0,0.0,101.5,21.0,-48.0,81.0",
            ]
        )

        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            load_reference_csv(csv_path)

    def test_reference_loader_normalizes_coordinates(self) -> None:
        csv_path = self.write_reference(
            [
                "0.0,0.0,0.0,100.0,20.0,-50.0,80.0",
                "0.1,84677.15121230017,84.67715121230017,101.5,21.0,-48.0,81.0",
            ]
        )

        points, origin = load_reference_csv(csv_path)

        self.assertEqual(origin.position_x, 100.0)
        self.assertEqual(origin.position_y, 20.0)
        self.assertEqual(origin.position_z, -50.0)
        self.assertEqual(points[0].display_x, 0.0)
        self.assertEqual(points[0].display_y, 0.0)
        self.assertEqual(points[0].display_z, 0.0)
        self.assertEqual(points[1].display_x, 1.5)
        self.assertEqual(points[1].display_y, 1.0)
        self.assertEqual(points[1].display_z, 2.0)
        self.assertEqual(points[1].position_x, 101.5)

    def test_real_reference_file_loads_successfully(self) -> None:
        points, origin = load_reference_csv(Path("data/reference/goliath_reference_1m.csv"))

        self.assertEqual(len(points), 84678)
        self.assertAlmostEqual(points[-1].course_distance_m, 84677.15121230017)
        self.assertEqual(points[0].display_x, 0.0)
        self.assertEqual(points[0].display_y, 0.0)
        self.assertEqual(points[0].display_z, 0.0)
        self.assertEqual(origin.position_x, points[0].position_x)
        self.assertEqual({point.section_id for point in points}, {"S1", "S2", "S3", "S4", "S5", "S6"})


if __name__ == "__main__":
    unittest.main()
