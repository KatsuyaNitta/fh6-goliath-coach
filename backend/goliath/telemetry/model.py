from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TelemetryRow:
    source_row_index: int
    source: dict[str, str]
    timestamp_s: float
    lap_time_s: float
    lap_number: int
    position_x: float
    position_y: float
    position_z: float
    speed_kmh: float
    handbrake_raw: float
    handbrake_pct: float

    @property
    def handbrake_active(self) -> bool:
        return self.handbrake_raw > 0 or self.handbrake_pct > 0


@dataclass(frozen=True)
class SampleStats:
    sample_count: int
    session_duration_s: float
    median_sample_interval_s: float
    min_sample_interval_s: float
    max_sample_interval_s: float
    large_sampling_gaps: list[dict[str, float | int]]


@dataclass(frozen=True)
class TelemetrySession:
    session_id: str
    csv_path: str
    session_json_path: str
    source_columns: list[str]
    session_metadata: dict[str, object]
    rows: list[TelemetryRow]
    sample_stats: SampleStats


@dataclass(frozen=True)
class LapSelection:
    rows: list[TelemetryRow]
    start_source_row_index: int
    end_source_row_index: int
    start_timestamp_s: float
    end_timestamp_s: float
    start_lap_time_s: float
    end_lap_time_s: float
    completed_lap_time_s: float
    ambiguous: bool = False
    incomplete: bool = False
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class MarkerEvent:
    id: str
    tag: str
    exclude_from_driving_analysis: bool
    start_time_s: float
    end_time_s: float
    duration_s: float
    midpoint_time_s: float
    start_timestamp_s: float
    end_timestamp_s: float
    midpoint_timestamp_s: float
    start_source_row_index: int
    end_source_row_index: int
    midpoint_source_row_index: int
    position_x: float
    position_y: float
    position_z: float
    speed_kmh: float
    exclusion_window: dict[str, float]


@dataclass(frozen=True)
class ProjectedSample:
    row: TelemetryRow
    reference_index: int
    course_distance_m: float
    projection_error_m: float
    section_id: str
    uncertain_mapping: bool
    telemetry_display_x: float
    telemetry_display_y: float
    telemetry_display_z: float
    marker_id: str = ""
    exclude_from_driving_analysis: bool = False


@dataclass(frozen=True)
class ProjectionSummary:
    mean_error_m: float
    median_error_m: float
    max_error_m: float
    uncertain_mapping_count: int

