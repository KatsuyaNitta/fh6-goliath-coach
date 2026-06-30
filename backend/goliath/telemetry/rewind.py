from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import asdict, dataclass, field
import math
from statistics import mean
from typing import Iterable

from goliath.telemetry.model import ProjectedSample, TelemetryRow

G_MPS2 = 9.80665
REWIND_TIMER_DROP_THRESHOLD_S = 0.25
TIMER_JITTER_IGNORE_S = 0.10
TARGET_TIME_TOLERANCE_S = 1.25
TARGET_SPATIAL_TOLERANCE_M = 90.0
TARGET_SEARCH_PAD_ROWS = 90
CLUSTER_DISTANCE_THRESHOLD_M = 150.0
CLASSIFIER_WINDOW_S = 2.0
EXTERNAL_LATERAL_IMPULSE_G = 1.7
EXTERNAL_LONGITUDINAL_IMPULSE_G = 1.2
EXTERNAL_SPEED_CHANGE_KMH = 12.0
DRIVING_YAW_RATE_THRESHOLD = 1.35
DRIVING_STEER_THRESHOLD = 0.62

CLASSIFICATIONS = {"external_impact_suspected", "driving_error_suspected", "undetermined"}
CONFIDENCES = {"high", "medium", "low"}
IMPACT_DIRECTIONS = {"rear", "front", "left", "right", "unknown"}


@dataclass(frozen=True)
class RewindConfig:
    lap_time_drop_threshold_s: float = REWIND_TIMER_DROP_THRESHOLD_S
    race_time_drop_threshold_s: float = REWIND_TIMER_DROP_THRESHOLD_S
    timer_jitter_ignore_s: float = TIMER_JITTER_IGNORE_S
    target_time_tolerance_s: float = TARGET_TIME_TOLERANCE_S
    target_spatial_tolerance_m: float = TARGET_SPATIAL_TOLERANCE_M
    target_search_pad_rows: int = TARGET_SEARCH_PAD_ROWS
    cluster_distance_threshold_m: float = CLUSTER_DISTANCE_THRESHOLD_M
    classifier_window_s: float = CLASSIFIER_WINDOW_S


@dataclass
class RewindEvent:
    event_id: str
    pre_rewind_source_row_index: int
    resume_source_row_index: int
    target_source_row_index: int
    pre_rewind_lap_time_s: float
    resume_lap_time_s: float
    rewound_time_s: float
    pre_rewind_race_time_s: float
    resume_race_time_s: float
    missing_packet_count: int
    incident_position_x: float
    incident_position_y: float
    incident_position_z: float
    target_position_x: float
    target_position_y: float
    target_position_z: float
    incident_course_distance_m: float = 0.0
    target_course_distance_m: float = 0.0
    rewound_course_distance_m: float = 0.0
    section_id: str = ""
    classification: str = "undetermined"
    confidence: str = "low"
    impact_direction: str = "unknown"
    impact_source: str = "unknown"
    evidence: dict[str, object] = field(default_factory=dict)
    cluster_id: str = ""
    target_match_confidence: str = "low"
    target_match_distance_m: float = 0.0
    target_match_time_delta_s: float = 0.0


@dataclass(frozen=True)
class RewindCluster:
    cluster_id: str
    section_id: str
    representative_course_distance_m: float
    event_count: int
    external_impact_suspected_count: int
    driving_error_suspected_count: int
    undetermined_count: int
    event_ids: list[str]


@dataclass(frozen=True)
class RewindNormalizationResult:
    events: list[RewindEvent]
    effective_rows: list[TelemetryRow]
    is_effective_by_source_row: dict[int, bool]
    superseded_by_source_row: dict[int, str]
    initial_lap_timer_reset_count: int
    race_initialization_reset_count: int
    ordinary_gap_count: int
    small_jitter_count: int
    target_time_only_fallback_count: int


@dataclass(frozen=True)
class ClassificationResult:
    classification: str
    confidence: str
    impact_direction: str
    impact_source: str
    evidence: dict[str, object]


def normalize_rewinds(rows: list[TelemetryRow], config: RewindConfig = RewindConfig()) -> RewindNormalizationResult:
    if not rows:
        return RewindNormalizationResult([], [], {}, {}, 0, 0, 0, 0, 0)

    effective_rows: list[TelemetryRow] = []
    effective_times: list[float] = []
    is_effective: dict[int, bool] = {}
    superseded_by: dict[int, str] = {}
    events: list[RewindEvent] = []
    initial_lap_timer_reset_count = 0
    race_initialization_reset_count = 0
    ordinary_gap_count = 0
    small_jitter_count = 0
    target_time_only_fallback_count = 0

    previous_raw: TelemetryRow | None = None
    for row in rows:
        if previous_raw is not None:
            transition = classify_timer_transition(previous_raw, row, config)
            if transition == "rewind":
                event_id = f"RW{len(events) + 1:03d}"
                target_index, target_confidence, target_distance_m, target_time_delta_s = find_rewind_target(
                    effective_rows,
                    effective_times,
                    row,
                    config,
                )
                if target_confidence == "low":
                    target_time_only_fallback_count += 1
                target_row = effective_rows[target_index] if effective_rows else previous_raw
                for superseded in effective_rows[target_index + 1:]:
                    is_effective[superseded.source_row_index] = False
                    superseded_by[superseded.source_row_index] = event_id
                effective_rows = effective_rows[: target_index + 1]
                effective_times = effective_times[: target_index + 1]
                missing_packet_count = max(0, row.packet_index - previous_raw.packet_index - 1)
                events.append(
                    RewindEvent(
                        event_id=event_id,
                        pre_rewind_source_row_index=previous_raw.source_row_index,
                        resume_source_row_index=row.source_row_index,
                        target_source_row_index=target_row.source_row_index,
                        pre_rewind_lap_time_s=previous_raw.lap_time_s,
                        resume_lap_time_s=row.lap_time_s,
                        rewound_time_s=previous_raw.lap_time_s - row.lap_time_s,
                        pre_rewind_race_time_s=previous_raw.current_race_time_s,
                        resume_race_time_s=row.current_race_time_s,
                        missing_packet_count=missing_packet_count,
                        incident_position_x=previous_raw.position_x,
                        incident_position_y=previous_raw.position_y,
                        incident_position_z=previous_raw.position_z,
                        target_position_x=target_row.position_x,
                        target_position_y=target_row.position_y,
                        target_position_z=target_row.position_z,
                        target_match_confidence=target_confidence,
                        target_match_distance_m=target_distance_m,
                        target_match_time_delta_s=target_time_delta_s,
                    )
                )
            elif transition == "initial_lap_timer_reset":
                initial_lap_timer_reset_count += 1
                for superseded in effective_rows:
                    is_effective[superseded.source_row_index] = False
                    superseded_by.setdefault(superseded.source_row_index, "initial_lap_timer_reset")
                effective_rows = []
                effective_times = []
            elif transition == "race_initialization_reset":
                race_initialization_reset_count += 1
                for superseded in effective_rows:
                    is_effective[superseded.source_row_index] = False
                    superseded_by.setdefault(superseded.source_row_index, "race_initialization_reset")
                effective_rows = []
                effective_times = []
            elif transition == "small_jitter":
                small_jitter_count += 1
            elif transition == "ordinary_gap":
                ordinary_gap_count += 1

        effective_rows.append(row)
        effective_times.append(row.lap_time_s)
        is_effective[row.source_row_index] = True
        previous_raw = row

    effective_ids = {row.source_row_index for row in effective_rows}
    for row in rows:
        is_effective[row.source_row_index] = row.source_row_index in effective_ids

    return RewindNormalizationResult(
        events=events,
        effective_rows=effective_rows,
        is_effective_by_source_row=is_effective,
        superseded_by_source_row=superseded_by,
        initial_lap_timer_reset_count=initial_lap_timer_reset_count,
        race_initialization_reset_count=race_initialization_reset_count,
        ordinary_gap_count=ordinary_gap_count,
        small_jitter_count=small_jitter_count,
        target_time_only_fallback_count=target_time_only_fallback_count,
    )


def classify_timer_transition(previous: TelemetryRow, current: TelemetryRow, config: RewindConfig = RewindConfig()) -> str:
    lap_drop = previous.lap_time_s - current.lap_time_s
    race_drop = previous.current_race_time_s - current.current_race_time_s
    missing_packet_count = max(0, current.packet_index - previous.packet_index - 1)

    if lap_drop >= config.lap_time_drop_threshold_s and race_drop >= config.race_time_drop_threshold_s:
        return "rewind"
    if lap_drop >= config.lap_time_drop_threshold_s and race_drop <= -config.timer_jitter_ignore_s:
        return "initial_lap_timer_reset"
    if race_drop >= config.race_time_drop_threshold_s and abs(previous.lap_time_s) <= config.timer_jitter_ignore_s and abs(current.lap_time_s) <= config.timer_jitter_ignore_s:
        return "race_initialization_reset"
    if 0 < lap_drop < config.lap_time_drop_threshold_s or 0 < race_drop < config.race_time_drop_threshold_s:
        return "small_jitter"
    if missing_packet_count > 0:
        return "ordinary_gap"
    return "forward"


def find_rewind_target(
    effective_rows: list[TelemetryRow],
    effective_times: list[float],
    resume_row: TelemetryRow,
    config: RewindConfig,
) -> tuple[int, str, float, float]:
    if not effective_rows:
        return 0, "low", math.inf, math.inf

    left = bisect_left(effective_times, resume_row.lap_time_s - config.target_time_tolerance_s)
    right = bisect_right(effective_times, resume_row.lap_time_s + config.target_time_tolerance_s)
    left = max(0, left - config.target_search_pad_rows)
    right = min(len(effective_rows), right + config.target_search_pad_rows)
    if left >= right:
        nearest = min(range(len(effective_rows)), key=lambda idx: abs(effective_rows[idx].lap_time_s - resume_row.lap_time_s))
        target = effective_rows[nearest]
        return nearest, "low", xyz_distance(target, resume_row), abs(target.lap_time_s - resume_row.lap_time_s)

    best_index = left
    best_score = math.inf
    best_distance = math.inf
    best_time_delta = math.inf
    for index in range(left, right):
        candidate = effective_rows[index]
        time_delta = abs(candidate.lap_time_s - resume_row.lap_time_s)
        distance = xyz_distance(candidate, resume_row)
        score = distance + time_delta * 35.0
        if score < best_score:
            best_index = index
            best_score = score
            best_distance = distance
            best_time_delta = time_delta

    confidence = "high" if best_distance <= config.target_spatial_tolerance_m and best_time_delta <= config.target_time_tolerance_s else "low"
    if confidence == "high" and (best_distance > config.target_spatial_tolerance_m * 0.5 or best_time_delta > config.target_time_tolerance_s * 0.5):
        confidence = "medium"
    return best_index, confidence, best_distance, best_time_delta


def xyz_distance(left: TelemetryRow, right: TelemetryRow) -> float:
    return math.sqrt(
        (left.position_x - right.position_x) ** 2
        + (left.position_y - right.position_y) ** 2
        + (left.position_z - right.position_z) ** 2
    )


def validate_effective_lap_time(rows: Iterable[TelemetryRow], tolerance_s: float = 0.05) -> None:
    previous: TelemetryRow | None = None
    for row in rows:
        if previous is not None and row.lap_time_s < previous.lap_time_s - tolerance_s:
            raise ValueError(
                "effective current_lap_time is not monotonic: "
                f"row {row.source_row_index} has {row.lap_time_s} after {previous.lap_time_s}"
            )
        previous = row


def classify_rewind_event(event: RewindEvent, rows_by_source: dict[int, TelemetryRow]) -> ClassificationResult:
    incident = rows_by_source[event.pre_rewind_source_row_index]
    window_start_time = incident.lap_time_s - CLASSIFIER_WINDOW_S
    window = [
        row for row in rows_by_source.values()
        if window_start_time <= row.lap_time_s <= incident.lap_time_s and row.source_row_index <= incident.source_row_index
    ]
    window = sorted(window, key=lambda row: row.source_row_index)
    if not window:
        window = [incident]

    max_lateral = max(window, key=lambda row: abs(row.accel_x))
    max_forward = max(window, key=lambda row: abs(row.accel_z))
    max_yaw = max(abs(row.angular_velocity_y) for row in window)
    max_steer = max(abs(row.steer_norm) for row in window)
    speed_change = window[-1].speed_kmh - window[0].speed_kmh
    forward_velocity_change = window[-1].velocity_z - window[0].velocity_z
    lateral_velocity_change = window[-1].velocity_x - window[0].velocity_x

    lateral_g = abs(max_lateral.accel_x) / G_MPS2
    forward_g = max_forward.accel_z / G_MPS2
    braking_g = min(row.accel_z for row in window) / G_MPS2
    reason_codes: list[str] = []

    peak_row = max(window, key=lambda row: max(abs(row.accel_x), abs(row.accel_z)))
    impact_direction = infer_impact_direction(peak_row)
    classification = "undetermined"
    confidence = "low"

    external_impulse = False
    if lateral_g >= EXTERNAL_LATERAL_IMPULSE_G:
        reason_codes.append("large_lateral_impulse")
        external_impulse = True
    if abs(forward_g) >= EXTERNAL_LONGITUDINAL_IMPULSE_G:
        reason_codes.append("large_longitudinal_impulse")
        external_impulse = True
    if abs(speed_change) >= EXTERNAL_SPEED_CHANGE_KMH and max(abs(row.accel_pct) for row in window) < 35:
        reason_codes.append("abrupt_speed_change_with_low_throttle")
        external_impulse = True
    if external_impulse and (peak_row.accel_pct < 35 or peak_row.brake_pct > 5):
        classification = "external_impact_suspected"
        confidence = "high" if len(reason_codes) >= 2 else "medium"
    elif max_yaw >= DRIVING_YAW_RATE_THRESHOLD and max_steer >= DRIVING_STEER_THRESHOLD:
        classification = "driving_error_suspected"
        confidence = "medium"
        reason_codes.append("sustained_yaw_with_large_steering")

    evidence = {
        "window_start_source_row_index": window[0].source_row_index,
        "window_end_source_row_index": window[-1].source_row_index,
        "max_abs_lateral_accel_g": lateral_g,
        "max_forward_accel_g": max(forward_g, 0.0),
        "max_braking_accel_g": abs(min(braking_g, 0.0)),
        "max_abs_yaw_rate": max_yaw,
        "max_abs_steer_norm": max_steer,
        "speed_change_kmh": speed_change,
        "forward_velocity_change_mps": forward_velocity_change,
        "lateral_velocity_change_mps": lateral_velocity_change,
        "throttle_at_peak_pct": peak_row.accel_pct,
        "brake_at_peak_pct": peak_row.brake_pct,
        "reason_codes": reason_codes,
    }
    return ClassificationResult(classification, confidence, impact_direction, "unknown", evidence)


def infer_impact_direction(row: TelemetryRow) -> str:
    if abs(row.accel_x) > abs(row.accel_z):
        return "right" if row.accel_x > 0 else "left"
    if abs(row.accel_z) > 0:
        return "rear" if row.accel_z > 0 else "front"
    return "unknown"


def enrich_events_with_projection_and_classification(
    events: list[RewindEvent],
    projected_by_source: dict[int, ProjectedSample],
    rows_by_source: dict[int, TelemetryRow],
) -> None:
    for event in events:
        incident = projected_by_source.get(event.pre_rewind_source_row_index)
        target = projected_by_source.get(event.target_source_row_index)
        if incident:
            event.incident_course_distance_m = incident.course_distance_m
            event.section_id = incident.section_id
        if target:
            event.target_course_distance_m = target.course_distance_m
        event.rewound_course_distance_m = max(0.0, event.incident_course_distance_m - event.target_course_distance_m)
        result = classify_rewind_event(event, rows_by_source)
        event.classification = result.classification
        event.confidence = result.confidence
        event.impact_direction = result.impact_direction
        event.impact_source = result.impact_source
        event.evidence = result.evidence


def build_rewind_clusters(events: list[RewindEvent], threshold_m: float = CLUSTER_DISTANCE_THRESHOLD_M) -> list[RewindCluster]:
    clusters: list[list[RewindEvent]] = []
    for event in sorted(events, key=lambda item: (item.section_id, item.incident_course_distance_m)):
        target_cluster = None
        for cluster in clusters:
            representative = mean(item.incident_course_distance_m for item in cluster)
            if cluster[0].section_id == event.section_id and abs(representative - event.incident_course_distance_m) <= threshold_m:
                target_cluster = cluster
                break
        if target_cluster is None:
            clusters.append([event])
        else:
            target_cluster.append(event)

    result: list[RewindCluster] = []
    for index, cluster in enumerate(clusters, start=1):
        cluster_id = f"RC{index:03d}"
        for event in cluster:
            event.cluster_id = cluster_id
        result.append(
            RewindCluster(
                cluster_id=cluster_id,
                section_id=cluster[0].section_id,
                representative_course_distance_m=mean(event.incident_course_distance_m for event in cluster),
                event_count=len(cluster),
                external_impact_suspected_count=sum(1 for event in cluster if event.classification == "external_impact_suspected"),
                driving_error_suspected_count=sum(1 for event in cluster if event.classification == "driving_error_suspected"),
                undetermined_count=sum(1 for event in cluster if event.classification == "undetermined"),
                event_ids=[event.event_id for event in cluster],
            )
        )
    return result


def build_rewind_analysis_payload(
    *,
    session_id: str,
    events: list[RewindEvent],
    clusters: list[RewindCluster],
    section_ids: list[str],
    normalization: RewindNormalizationResult,
) -> dict[str, object]:
    classification_counts = count_by([event.classification for event in events])
    confidence_counts = count_by([event.confidence for event in events])
    section_summaries = []
    for section_id in section_ids:
        section_events = [event for event in events if event.section_id == section_id]
        section_summaries.append(
            {
                "section_id": section_id,
                "rewind_count": len(section_events),
                "external_impact_suspected_count": sum(1 for event in section_events if event.classification == "external_impact_suspected"),
                "driving_error_suspected_count": sum(1 for event in section_events if event.classification == "driving_error_suspected"),
                "undetermined_count": sum(1 for event in section_events if event.classification == "undetermined"),
            }
        )
    focus = [
        asdict(cluster) for cluster in clusters
        if cluster.driving_error_suspected_count > 0
    ][:3]
    return {
        "schema_version": "goliath-rewind-analysis-v1",
        "session_id": session_id,
        "detection_rule": {
            "lap_time_drop_s_min": REWIND_TIMER_DROP_THRESHOLD_S,
            "race_time_drop_s_min": REWIND_TIMER_DROP_THRESHOLD_S,
            "packet_gap_is_corrobating_only": True,
        },
        "summary": {
            "rewind_count": len(events),
            "external_impact_suspected_count": classification_counts.get("external_impact_suspected", 0),
            "driving_error_suspected_count": classification_counts.get("driving_error_suspected", 0),
            "undetermined_count": classification_counts.get("undetermined", 0),
            "confidence_counts": confidence_counts,
            "total_rewound_time_s": sum(event.rewound_time_s for event in events),
            "total_rewound_course_distance_m": sum(event.rewound_course_distance_m for event in events),
            "initial_lap_timer_reset_count": normalization.initial_lap_timer_reset_count,
            "race_initialization_reset_count": normalization.race_initialization_reset_count,
            "ordinary_packet_gap_count": normalization.ordinary_gap_count,
            "small_timer_jitter_count": normalization.small_jitter_count,
            "target_time_only_fallback_count": normalization.target_time_only_fallback_count,
            "effective_row_count": len(normalization.effective_rows),
            "superseded_row_count": sum(1 for value in normalization.is_effective_by_source_row.values() if not value),
            "cluster_count": len(clusters),
        },
        "section_summaries": section_summaries,
        "clusters": [asdict(cluster) for cluster in clusters],
        "practice_focus": focus,
        "events": [asdict(event) for event in events],
        "language_note": {
            "ja": "外的要因の疑いは、急激な衝撃や不自然な速度変化からの推定です。AI車、壁、地形のどれが原因かは断定できません。",
            "en": "External-impact suspected is inferred from abrupt impulse or speed-change evidence. The source is not identified as AI, wall, or terrain in v1.",
        },
    }


def count_by(values: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts