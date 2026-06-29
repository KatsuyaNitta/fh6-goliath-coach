from __future__ import annotations

import unittest

from goliath.config.sections import SECTIONS, assign_section_id, boundary_markers


class SectionTests(unittest.TestCase):
    def test_section_boundaries_are_contiguous(self) -> None:
        for previous, current in zip(SECTIONS, SECTIONS[1:]):
            self.assertEqual(previous.end_distance_m, current.start_distance_m)

    def test_assign_section_id(self) -> None:
        cases = [
            (0.0, "S1"),
            (17629.999, "S1"),
            (17630.0, "S2"),
            (31659.0, "S3"),
            (42581.0, "S4"),
            (60737.0, "S5"),
            (74188.0, "S6"),
            (84677.151, "S6"),
        ]
        for distance_m, section_id in cases:
            with self.subTest(distance_m=distance_m):
                self.assertEqual(assign_section_id(distance_m), section_id)

    def test_boundary_markers_match_confirmed_section_starts(self) -> None:
        markers = boundary_markers()
        self.assertEqual([marker["id"] for marker in markers], ["P1", "P2", "P3", "P4", "P5"])
        self.assertEqual(
            [marker["course_distance_m"] for marker in markers],
            [17630.0, 31659.0, 42581.0, 60737.0, 74188.0],
        )


if __name__ == "__main__":
    unittest.main()
