from __future__ import annotations

from goliath.telemetry.model import MarkerEvent, TelemetryRow


def detect_handbrake_markers(
    rows: list[TelemetryRow],
    *,
    before_s: float = 1.0,
    after_s: float = 2.0,
) -> list[MarkerEvent]:
    events: list[list[TelemetryRow]] = []
    current: list[TelemetryRow] = []

    for row in rows:
        if row.handbrake_active:
            current.append(row)
        elif current:
            events.append(current)
            current = []
    if current:
        events.append(current)

    return [
        _build_marker_event(index=index, rows=event_rows, before_s=before_s, after_s=after_s)
        for index, event_rows in enumerate(events, start=1)
    ]


def _build_marker_event(
    *,
    index: int,
    rows: list[TelemetryRow],
    before_s: float,
    after_s: float,
) -> MarkerEvent:
    first = rows[0]
    last = rows[-1]
    midpoint_time = (first.lap_time_s + last.lap_time_s) / 2
    midpoint = min(rows, key=lambda row: abs(row.lap_time_s - midpoint_time))
    return MarkerEvent(
        id=f"P{index}",
        tag="manual_section_marker",
        exclude_from_driving_analysis=True,
        start_time_s=first.lap_time_s,
        end_time_s=last.lap_time_s,
        duration_s=last.lap_time_s - first.lap_time_s,
        midpoint_time_s=midpoint_time,
        start_timestamp_s=first.timestamp_s,
        end_timestamp_s=last.timestamp_s,
        midpoint_timestamp_s=midpoint.timestamp_s,
        start_source_row_index=first.source_row_index,
        end_source_row_index=last.source_row_index,
        midpoint_source_row_index=midpoint.source_row_index,
        position_x=midpoint.position_x,
        position_y=midpoint.position_y,
        position_z=midpoint.position_z,
        speed_kmh=midpoint.speed_kmh,
        exclusion_window={
            "start_time_s": max(0.0, midpoint_time - before_s),
            "end_time_s": midpoint_time + after_s,
            "before_s": before_s,
            "after_s": after_s,
        },
    )

