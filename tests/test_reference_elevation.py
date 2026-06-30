from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from goliath.reference.exporter import build_reference_json
from goliath.reference.loader import load_reference_csv


REFERENCE_CSV = Path("data/reference/goliath_reference_1m.csv")


class ReferenceElevationMetadataTests(unittest.TestCase):
    def test_exported_relative_elevation_metadata_matches_canonical_reference(self) -> None:
        points, _origin = load_reference_csv(REFERENCE_CSV)
        minimum_point = min(points, key=lambda point: point.position_y)
        maximum_point = max(points, key=lambda point: point.position_y)

        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "goliath_reference.json"
            payload = build_reference_json(REFERENCE_CSV, output_path)

        metadata = payload["coordinate_system"]["relative_elevation"]  # type: ignore[index]

        self.assertEqual(metadata["datum"], "reference_path_min_position_y")
        self.assertEqual(metadata["units"], "m")
        self.assertIs(metadata["is_sea_level_altitude"], False)
        self.assertAlmostEqual(metadata["baseline_position_y"], minimum_point.position_y)
        self.assertAlmostEqual(metadata["baseline_display_y"], minimum_point.display_y)
        self.assertAlmostEqual(metadata["minimum_course_distance_m"], minimum_point.course_distance_m)
        self.assertAlmostEqual(min(point.position_y - metadata["baseline_position_y"] for point in points), 0.0)
        self.assertAlmostEqual(metadata["maximum_position_y"], maximum_point.position_y)
        self.assertAlmostEqual(metadata["maximum_display_y"], maximum_point.display_y)
        self.assertAlmostEqual(metadata["maximum_course_distance_m"], maximum_point.course_distance_m)
        self.assertAlmostEqual(metadata["range_m"], maximum_point.position_y - minimum_point.position_y)
        self.assertAlmostEqual(max(point.display_y - metadata["baseline_display_y"] for point in points), metadata["range_m"])
        self.assertAlmostEqual(metadata["start_relative_height_m"], points[0].position_y - minimum_point.position_y)
        self.assertAlmostEqual(metadata["finish_relative_height_m"], points[-1].position_y - minimum_point.position_y)

        columns = payload["point_columns"]
        payload_points = payload["points"]
        position_y_index = columns.index("position_y")
        display_y_index = columns.index("display_y")
        self.assertAlmostEqual(payload_points[0][position_y_index], points[0].position_y)
        self.assertAlmostEqual(payload_points[0][display_y_index], points[0].display_y)
        self.assertAlmostEqual(payload_points[-1][position_y_index], points[-1].position_y)
        self.assertAlmostEqual(payload_points[-1][display_y_index], points[-1].display_y)


if __name__ == "__main__":
    unittest.main()