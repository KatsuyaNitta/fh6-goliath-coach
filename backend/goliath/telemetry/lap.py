from __future__ import annotations

from dataclasses import dataclass

from goliath.telemetry.model import LapSelection, TelemetryRow


@dataclass(frozen=True)
class _LapSegment:
    rows: list[TelemetryRow]
    followed_by_new_lap: bool = False

    @property
    def duration_s(self) -> float:
        return self.rows[-1].lap_time_s - self.rows[0].lap_time_s


def extract_completed_lap(rows: list[TelemetryRow]) -> LapSelection:
    if not rows:
        raise ValueError("cannot extract a lap from an empty telemetry session")

    segments = _split_lap_segments(rows)
    completed_candidates = [
        segment for segment in segments if segment.followed_by_new_lap and segment.duration_s > 0
    ]
    notes: list[str] = []
    incomplete = False
    if completed_candidates:
        selected = max(completed_candidates, key=lambda segment: segment.duration_s)
    else:
        selected = max(segments, key=lambda segment: segment.duration_s)
        incomplete = True
        notes.append("No lap-number transition after the selected segment; selected longest segment.")

    ambiguous = False
    if len(completed_candidates) > 1:
        ordered = sorted(completed_candidates, key=lambda segment: segment.duration_s, reverse=True)
        ambiguous = ordered[0].duration_s - ordered[1].duration_s < 5.0
        if ambiguous:
            notes.append("Multiple completed lap candidates have similar durations.")

    first = selected.rows[0]
    last = selected.rows[-1]
    return LapSelection(
        rows=selected.rows,
        start_source_row_index=first.source_row_index,
        end_source_row_index=last.source_row_index,
        start_timestamp_s=first.timestamp_s,
        end_timestamp_s=last.timestamp_s,
        start_lap_time_s=first.lap_time_s,
        end_lap_time_s=last.lap_time_s,
        completed_lap_time_s=last.lap_time_s - first.lap_time_s,
        ambiguous=ambiguous,
        incomplete=incomplete,
        notes=notes,
    )


def _split_lap_segments(rows: list[TelemetryRow]) -> list[_LapSegment]:
    segments: list[_LapSegment] = []
    current: list[TelemetryRow] = [rows[0]]

    for previous, row in zip(rows, rows[1:]):
        lap_number_changed = row.lap_number != previous.lap_number
        lap_timer_reset = row.lap_time_s < previous.lap_time_s - 1.0
        if lap_number_changed or lap_timer_reset:
            segments.append(_LapSegment(current, followed_by_new_lap=lap_number_changed))
            current = [row]
        else:
            current.append(row)

    segments.append(_LapSegment(current, followed_by_new_lap=False))
    return segments

