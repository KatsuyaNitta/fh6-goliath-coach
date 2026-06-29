from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from goliath.reference.loader import load_reference_csv
from goliath.telemetry.importer import load_telemetry_session
from goliath.telemetry.lap import extract_completed_lap
from goliath.telemetry.markers import detect_handbrake_markers
from goliath.telemetry.processor import process_session
from goliath.telemetry.projection import project_lap_to_reference
from goliath.telemetry.summary import build_section_summary


FIXTURE_SESSION = Path("tests/fixtures/b1_session")
REFERENCE_CSV = Path("data/reference/goliath_reference_1m.csv")


class TelemetryB1Tests(unittest.TestCase):
    def load_fixture_pipeline(self):
        session = load_telemetry_session(FIXTURE_SESSION)
        lap = extract_completed_lap(session.rows)
        markers = detect_handbrake_markers(lap.rows)
        reference_points, origin = load_reference_csv(REFERENCE_CSV)
        projected, projection_summary = project_lap_to_reference(lap.rows, reference_points, origin)
        sections = build_section_summary(projected)
        return session, lap, markers, projected, projection_summary, sections

    def test_completed_lap_is_separated_from_post_finish_samples(self) -> None:
        session = load_telemetry_session(FIXTURE_SESSION)
        lap = extract_completed_lap(session.rows)

        self.assertEqual(lap.rows[0].lap_number, 0)
        self.assertEqual(lap.rows[-1].lap_number, 0)
        self.assertLess(lap.end_source_row_index, session.rows[-1].source_row_index)
        self.assertAlmostEqual(lap.completed_lap_time_s, 1686.8)
        self.assertFalse(lap.incomplete)

    def test_exactly_five_handbrake_events_are_detected(self) -> None:
        _session, lap, markers, _projected, _projection_summary, _sections = self.load_fixture_pipeline()

        self.assertEqual(len(markers), 5)

    def test_marker_order_is_p1_through_p5(self) -> None:
        _session, _lap, markers, _projected, _projection_summary, _sections = self.load_fixture_pipeline()

        self.assertEqual([marker.id for marker in markers], ["P1", "P2", "P3", "P4", "P5"])
        self.assertEqual([marker.tag for marker in markers], ["manual_section_marker"] * 5)
        self.assertTrue(all(marker.exclude_from_driving_analysis for marker in markers))

    def test_every_projected_sample_receives_one_section_id(self) -> None:
        _session, _lap, _markers, projected, _projection_summary, _sections = self.load_fixture_pipeline()

        self.assertTrue(all(sample.section_id in {"S1", "S2", "S3", "S4", "S5", "S6"} for sample in projected))

    def test_projected_course_distance_remains_temporally_plausible(self) -> None:
        _session, _lap, _markers, projected, _projection_summary, _sections = self.load_fixture_pipeline()

        backward_jumps = [
            current.course_distance_m - previous.course_distance_m
            for previous, current in zip(projected, projected[1:])
            if current.course_distance_m < previous.course_distance_m - 12
        ]
        self.assertEqual(backward_jumps, [])

    def test_loop_bridge_samples_do_not_jump_to_wrong_branch(self) -> None:
        _session, _lap, _markers, projected, _projection_summary, _sections = self.load_fixture_pipeline()

        loop_samples = [
            sample for sample in projected
            if 60000 <= sample.course_distance_m <= 75000
        ]
        self.assertGreaterEqual(len(loop_samples), 4)
        self.assertTrue({sample.section_id for sample in loop_samples}.issubset({"S4", "S5", "S6"}))
        self.assertLess(
            max(sample.projection_error_m for sample in loop_samples),
            5.0,
        )

    def test_marker_exclusion_windows_are_created(self) -> None:
        _session, _lap, markers, _projected, _projection_summary, _sections = self.load_fixture_pipeline()

        for marker in markers:
            self.assertAlmostEqual(
                marker.exclusion_window["start_time_s"],
                max(0.0, marker.midpoint_time_s - 1.0),
            )
            self.assertAlmostEqual(
                marker.exclusion_window["end_time_s"],
                marker.midpoint_time_s + 2.0,
            )

    def test_six_section_summaries_are_produced(self) -> None:
        _session, _lap, _markers, _projected, _projection_summary, sections = self.load_fixture_pipeline()

        self.assertEqual([section["section_id"] for section in sections], ["S1", "S2", "S3", "S4", "S5", "S6"])
        self.assertTrue(all(section["sample_count"] > 0 for section in sections))

    def test_process_session_writes_expected_outputs_with_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            summary = process_session(
                FIXTURE_SESSION,
                reference_csv=REFERENCE_CSV,
                output_root=Path(directory),
            )

            outputs = summary["outputs"]  # type: ignore[index]
            for output_path in outputs.values():  # type: ignore[union-attr]
                self.assertTrue(Path(output_path).exists())
            self.assertEqual(summary["handbrake_marker_count"], 5)

    def test_real_local_integration_dataset_passes_when_present(self) -> None:
        candidates = [
            Path("data/local/sessions/20260629_184938"),
            Path("G:/github/fh6-goliath-coach/data/local/sessions/20260629_184938"),
        ]
        session_dir = next((candidate for candidate in candidates if candidate.exists()), None)
        if session_dir is None:
            self.skipTest("real local integration dataset is not present")

        with tempfile.TemporaryDirectory() as directory:
            summary = process_session(
                session_dir,
                reference_csv=REFERENCE_CSV,
                output_root=Path(directory),
            )

        self.assertEqual(summary["handbrake_marker_count"], 5)
        self.assertFalse(summary["completed_lap"]["incomplete"])  # type: ignore[index]
        self.assertLess(summary["projection_summary"]["uncertain_mapping_count"], 1)  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
