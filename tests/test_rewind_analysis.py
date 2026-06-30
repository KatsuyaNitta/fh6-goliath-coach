from __future__ import annotations

import unittest

from goliath.telemetry.model import ProjectedSample, TelemetryRow
from goliath.telemetry.rewind import (
    build_rewind_clusters,
    classify_rewind_event,
    classify_timer_transition,
    enrich_events_with_projection_and_classification,
    normalize_rewinds,
    validate_effective_lap_time,
)


def row(
    source: int,
    lap: float,
    race: float | None = None,
    packet: int | None = None,
    x: float | None = None,
    z: float = 0.0,
    accel_x: float = 0.0,
    accel_z: float = 0.0,
    yaw_rate: float = 0.0,
    steer: float = 0.0,
    throttle: float = 0.0,
    brake: float = 0.0,
    speed: float = 100.0,
) -> TelemetryRow:
    return TelemetryRow(
        source_row_index=source,
        source={},
        timestamp_s=lap,
        lap_time_s=lap,
        lap_number=0,
        position_x=lap if x is None else x,
        position_y=0.0,
        position_z=z,
        speed_kmh=speed,
        handbrake_raw=0.0,
        handbrake_pct=0.0,
        packet_index=source if packet is None else packet,
        kept_index=source,
        game_elapsed_s=lap,
        session_elapsed_s=lap,
        current_race_time_s=lap if race is None else race,
        accel_x=accel_x,
        accel_z=accel_z,
        angular_velocity_y=yaw_rate,
        steer_norm=steer,
        accel_pct=throttle,
        brake_pct=brake,
        velocity_x=0.0,
        velocity_z=speed / 3.6,
    )


def sample(source_row: TelemetryRow, distance: float, section: str = "S1") -> ProjectedSample:
    return ProjectedSample(
        row=source_row,
        reference_index=int(distance),
        course_distance_m=distance,
        projection_error_m=1.0,
        section_id=section,
        uncertain_mapping=False,
        telemetry_display_x=source_row.position_x,
        telemetry_display_y=source_row.position_y,
        telemetry_display_z=source_row.position_z,
    )


class RewindAnalysisTests(unittest.TestCase):
    def test_synchronized_lap_and_race_rollback_is_detected(self) -> None:
        previous = row(10, 20.0, 120.0)
        current = row(11, 14.0, 114.0)
        self.assertEqual(classify_timer_transition(previous, current), "rewind")

    def test_initial_lap_timer_reset_is_not_detected(self) -> None:
        previous = row(10, 4.1, 20.0)
        current = row(11, 0.0, 20.1)
        self.assertEqual(classify_timer_transition(previous, current), "initial_lap_timer_reset")

    def test_race_initialization_is_not_detected(self) -> None:
        previous = row(10, 0.0, 5.0)
        current = row(11, 0.0, 0.0)
        self.assertEqual(classify_timer_transition(previous, current), "race_initialization_reset")

    def test_packet_gap_without_timer_rollback_is_not_detected(self) -> None:
        previous = row(10, 10.0, 10.0, packet=100)
        current = row(11, 10.1, 10.1, packet=130)
        self.assertEqual(classify_timer_transition(previous, current), "ordinary_gap")

    def test_small_timer_jitter_is_not_detected(self) -> None:
        previous = row(10, 10.0, 10.0)
        current = row(11, 9.93, 9.95)
        self.assertEqual(classify_timer_transition(previous, current), "small_jitter")

    def test_repeated_rewinds_are_detected_separately(self) -> None:
        rows = [row(2, 0), row(3, 1), row(4, 2), row(5, 3), row(6, 1.1), row(7, 2), row(8, 3), row(9, 1.2)]
        result = normalize_rewinds(rows)
        self.assertEqual([event.event_id for event in result.events], ["RW001", "RW002"])

    def test_overlapping_rewind_branches_normalize_effective_timeline(self) -> None:
        rows = [row(2, 0), row(3, 1), row(4, 2), row(5, 3), row(6, 1.1), row(7, 2.1), row(8, 1.2), row(9, 2.2)]
        result = normalize_rewinds(rows)
        validate_effective_lap_time(result.effective_rows)
        self.assertEqual(len(result.events), 2)
        self.assertTrue(any(not value for value in result.is_effective_by_source_row.values()))

    def test_superseded_rows_are_marked(self) -> None:
        rows = [row(2, 0), row(3, 1), row(4, 2), row(5, 3), row(6, 1.1)]
        result = normalize_rewinds(rows)
        self.assertFalse(result.is_effective_by_source_row[4])
        self.assertFalse(result.is_effective_by_source_row[5])
        self.assertEqual(result.superseded_by_source_row[4], "RW001")

    def test_target_matching_uses_time_and_space(self) -> None:
        rows = [row(2, 0, x=0), row(3, 1, x=10), row(4, 1.05, x=500), row(5, 2, x=20), row(6, 1.02, x=12)]
        result = normalize_rewinds(rows)
        self.assertEqual(result.events[0].target_source_row_index, 3)
        self.assertIn(result.events[0].target_match_confidence, {"high", "medium"})

    def test_time_only_target_fallback_lowers_confidence(self) -> None:
        rows = [row(2, 0, x=0), row(3, 1, x=10), row(4, 2, x=20), row(5, 1.0, x=10000)]
        result = normalize_rewinds(rows)
        self.assertEqual(result.events[0].target_match_confidence, "low")
        self.assertEqual(result.target_time_only_fallback_count, 1)

    def test_cluster_grouping_and_section_separation(self) -> None:
        rows = [row(2, 0), row(3, 1), row(4, 2), row(5, 0.5), row(6, 2)]
        result = normalize_rewinds(rows)
        event_a = result.events[0]
        event_b = row_event_copy(event_a, "RW002", 120.0, "S1")
        event_c = row_event_copy(event_a, "RW003", 130.0, "S2")
        event_a.incident_course_distance_m = 100.0
        event_a.section_id = "S1"
        clusters = build_rewind_clusters([event_a, event_b, event_c])
        self.assertEqual(len(clusters), 2)
        self.assertEqual(clusters[0].event_count, 2)

    def test_external_impact_classifier_detects_synthetic_impulse(self) -> None:
        rows = {
            2: row(2, 8.0, accel_z=0.0, throttle=0, brake=30, speed=100),
            3: row(3, 9.0, accel_z=18.0, throttle=0, brake=30, speed=118),
        }
        result = normalize_rewinds([rows[2], rows[3], row(4, 7.0, race=7.0)])
        classified = classify_rewind_event(result.events[0], {**rows, 4: row(4, 7.0, race=7.0)})
        self.assertEqual(classified.classification, "external_impact_suspected")
        self.assertEqual(classified.impact_source, "unknown")

    def test_ordinary_cornering_does_not_become_impact(self) -> None:
        rows = {
            2: row(2, 8.0, accel_x=3.0, yaw_rate=0.5, steer=0.4, throttle=55),
            3: row(3, 9.0, accel_x=3.5, yaw_rate=0.6, steer=0.5, throttle=50),
        }
        result = normalize_rewinds([rows[2], rows[3], row(4, 7.0, race=7.0)])
        classified = classify_rewind_event(result.events[0], {**rows, 4: row(4, 7.0, race=7.0)})
        self.assertNotEqual(classified.classification, "external_impact_suspected")

    def test_ambiguous_cases_return_undetermined(self) -> None:
        rows = {2: row(2, 8.0), 3: row(3, 9.0), 4: row(4, 7.0, race=7.0)}
        result = normalize_rewinds([rows[2], rows[3], rows[4]])
        classified = classify_rewind_event(result.events[0], rows)
        self.assertEqual(classified.classification, "undetermined")

    def test_classifier_never_claims_specific_external_source(self) -> None:
        rows = {2: row(2, 8.0, accel_x=20.0, brake=40), 3: row(3, 9.0), 4: row(4, 7.0, race=7.0)}
        result = normalize_rewinds([rows[2], rows[3], rows[4]])
        classified = classify_rewind_event(result.events[0], rows)
        self.assertEqual(classified.impact_source, "unknown")

    def test_projection_enrichment_sets_event_location(self) -> None:
        rows = [row(2, 0), row(3, 1), row(4, 2), row(5, 0.5)]
        result = normalize_rewinds(rows)
        projected = {item.source_row_index: sample(item, item.lap_time_s * 1000, "S1") for item in rows}
        enrich_events_with_projection_and_classification(result.events, projected, {item.source_row_index: item for item in rows})
        self.assertEqual(result.events[0].section_id, "S1")
        self.assertGreater(result.events[0].rewound_course_distance_m, 0)


def row_event_copy(event, event_id: str, distance: float, section: str):
    copied = type(event)(**{**event.__dict__, "event_id": event_id})
    copied.incident_course_distance_m = distance
    copied.section_id = section
    return copied


if __name__ == "__main__":
    unittest.main()