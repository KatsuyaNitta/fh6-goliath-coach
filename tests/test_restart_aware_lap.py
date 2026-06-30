from __future__ import annotations

from types import SimpleNamespace
import unittest

from goliath.telemetry.attempt import detect_hard_timer_resets, select_restart_aware_attempt
from goliath.telemetry.model import ProjectedSample, TelemetryRow
from goliath.telemetry.processor import _validate_completed_lap_quality
from goliath.telemetry.rewind import normalize_rewinds


def row(index: int, lap_time: float, race_time: float | None = None) -> TelemetryRow:
    return TelemetryRow(
        source_row_index=index,
        source={"current_lap_time": str(lap_time)},
        timestamp_s=float(index),
        lap_time_s=lap_time,
        lap_number=0,
        position_x=float(index),
        position_y=0.0,
        position_z=0.0,
        speed_kmh=100.0,
        handbrake_raw=0.0,
        handbrake_pct=0.0,
        packet_index=index,
        current_race_time_s=lap_time if race_time is None else race_time,
    )


def projected_sample(index: int, lap_time: float, distance_m: float, section_id: str = "S1") -> ProjectedSample:
    return ProjectedSample(
        row=row(index, lap_time),
        reference_index=index,
        course_distance_m=distance_m,
        projection_error_m=0.0,
        section_id=section_id,
        uncertain_mapping=False,
        telemetry_display_x=0.0,
        telemetry_display_y=0.0,
        telemetry_display_z=0.0,
    )


class RestartAwareLapExtractionTests(unittest.TestCase):
    def test_restart_near_start_selects_attempt_before_finish_reset_and_keeps_internal_rewinds(self) -> None:
        rows = [
            row(2, 0.0),
            row(3, 4.4),
            row(4, 0.0),
            row(5, 0.1),
            row(6, 100.0),
            row(7, 200.0),
            row(8, 196.0),
            row(9, 250.0),
            row(10, 500.0),
            row(11, 495.0),
            row(12, 700.0),
            row(13, 1485.0),
            row(14, 0.0, race_time=1500.0),
            row(15, 0.2, race_time=1500.2),
        ]

        selection = select_restart_aware_attempt(rows)
        normalization = normalize_rewinds(selection.selected_attempt.rows)

        self.assertEqual(selection.selected_attempt.start_source_row_index, 4)
        self.assertEqual(selection.selected_attempt.end_source_row_index, 13)
        self.assertEqual(selection.selected_attempt.end_reason, "final_hard_timer_reset")
        self.assertEqual(len(selection.hard_resets), 2)
        self.assertEqual(len(normalization.events), 2)
        self.assertEqual([event.pre_rewind_source_row_index for event in normalization.events], [7, 10])
        self.assertNotIn(3, normalization.superseded_by_source_row)
        self.assertNotIn(14, normalization.superseded_by_source_row)

    def test_mid_session_restart_chooses_finish_reset_attempt_not_longest_abandoned_attempt(self) -> None:
        rows = [
            row(2, 0.0),
            row(3, 100.0),
            row(4, 200.0),
            row(5, 300.0),
            row(6, 400.0),
            row(7, 0.0),
            row(8, 0.1),
            row(9, 100.0),
            row(10, 200.0),
            row(11, 300.0),
            row(12, 0.0, race_time=500.0),
            row(13, 0.1, race_time=500.1),
        ]

        selection = select_restart_aware_attempt(rows)

        self.assertEqual(selection.selected_attempt.start_source_row_index, 7)
        self.assertEqual(selection.selected_attempt.end_source_row_index, 11)
        self.assertLess(selection.selected_attempt.duration_s, selection.attempts[0].duration_s)
        self.assertEqual(selection.selection_reason, "attempt_before_final_hard_reset")

    def test_multiple_restarts_selects_last_attempt_before_finish_reset(self) -> None:
        rows = [
            row(2, 0.0),
            row(3, 10.0),
            row(4, 0.0),
            row(5, 0.1),
            row(6, 20.0),
            row(7, 0.0),
            row(8, 0.1),
            row(9, 100.0),
            row(10, 200.0),
            row(11, 0.0, race_time=250.0),
            row(12, 0.2, race_time=250.2),
        ]

        selection = select_restart_aware_attempt(rows)

        self.assertEqual(len(selection.hard_resets), 3)
        self.assertEqual(selection.selected_attempt.start_source_row_index, 7)
        self.assertEqual(selection.selected_attempt.end_source_row_index, 10)
        self.assertEqual([attempt.selected for attempt in selection.attempts], [False, False, True, False])

    def test_moderate_timer_drop_is_not_a_hard_reset(self) -> None:
        rows = [row(2, 100.0), row(3, 96.5), row(4, 110.0)]

        self.assertEqual(detect_hard_timer_resets(rows), [])
        normalization = normalize_rewinds(rows)
        self.assertEqual(len(normalization.events), 1)

    def test_pause_like_flat_timer_and_packet_gap_do_not_split_attempts(self) -> None:
        rows = [row(2, 0.0), row(3, 100.0), row(200, 100.0), row(201, 101.0), row(202, 0.0, race_time=300.0)]

        selection = select_restart_aware_attempt(rows)

        self.assertEqual(len(selection.hard_resets), 1)
        self.assertEqual(selection.selected_attempt.start_source_row_index, 2)
        self.assertEqual(selection.selected_attempt.end_source_row_index, 201)

    def test_missing_finish_reset_is_unsupported(self) -> None:
        with self.assertRaisesRegex(ValueError, "no final hard timer reset"):
            select_restart_aware_attempt([row(2, 0.0), row(3, 100.0), row(4, 200.0)])

    def test_invalid_short_tail_is_rejected_by_final_validation(self) -> None:
        projected = [projected_sample(index, 0.0, float(index), "S1") for index in range(18)]
        reference = [SimpleNamespace(course_distance_m=0.0), SimpleNamespace(course_distance_m=84677.151)]
        lap = SimpleNamespace(
            incomplete=False,
            completed_lap_time_s=0.0,
            start_lap_time_s=0.0,
            end_lap_time_s=0.0,
        )

        with self.assertRaisesRegex(ValueError, "completed lap time must be positive"):
            _validate_completed_lap_quality(lap, projected, reference, 163_853)


if __name__ == "__main__":
    unittest.main()