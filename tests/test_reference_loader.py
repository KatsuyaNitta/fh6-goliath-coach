from __future__ import annotations

from pathlib import Path
import unittest

from goliath.reference.loader import load_reference_csv


class ReferenceLoaderTests(unittest.TestCase):
    def test_reference_loader_normalizes_coordinates(self) -> None:
        csv_path = Path(self._testMethodName).with_suffix(".csv")
        self.addCleanup(csv_path.unlink, missing_ok=True)
        csv_path.write_text(
            "\n".join(
                [
                    "current_lap_time,course_distance_m,course_distance_km,position_x,position_y,position_z,speed_kmh",
                    "0.0,0.0,0.0,100.0,20.0,-50.0,80.0",
                    "0.1,1.0,0.001,101.5,21.0,-48.0,81.0",
                ]
            ),
            encoding="utf-8",
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


if __name__ == "__main__":
    unittest.main()
