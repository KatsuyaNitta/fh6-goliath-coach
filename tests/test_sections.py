from __future__ import annotations

import unittest

from goliath.config.sections import (
    SECTIONS,
    assign_section_id,
    boundary_markers,
    build_sections,
)


class SectionTests(unittest.TestCase):
    def test_section_boundaries_are_contiguous(self) -> None:
        for previous, current in zip(SECTIONS, SECTIONS[1:]):
            self.assertEqual(previous.end_distance_m, current.start_distance_m)

    def test_assign_section_id(self) -> None:
        cases = [
            (0.0, "S1"),
            (17630.241, "S1"),
            (17630.242, "S2"),
            (31659.142, "S3"),
            (42581.232, "S4"),
            (60737.384, "S5"),
            (74188.316, "S6"),
            (84677.151, "S6"),
        ]
        for distance_m, section_id in cases:
            with self.subTest(distance_m=distance_m):
                self.assertEqual(assign_section_id(distance_m), section_id)

    def test_complete_section_coverage_has_no_gaps(self) -> None:
        sections = build_sections(84677.15121230017)
        self.assertEqual(sections[0].start_distance_m, 0.0)
        self.assertEqual(sections[-1].end_distance_m, 84677.15121230017)
        for previous, current in zip(sections, sections[1:]):
            self.assertEqual(previous.end_distance_m, current.start_distance_m)
            self.assertGreater(previous.end_distance_m, previous.start_distance_m)
        self.assertGreater(sections[-1].end_distance_m, sections[-1].start_distance_m)

    def test_boundary_markers_match_confirmed_section_starts(self) -> None:
        markers = boundary_markers()
        self.assertEqual([marker["id"] for marker in markers], ["P1", "P2", "P3", "P4", "P5"])
        self.assertEqual(
            [marker["course_distance_m"] for marker in markers],
            [17630.242, 31659.142, 42581.232, 60737.384, 74188.316],
        )


if __name__ == "__main__":
    unittest.main()
