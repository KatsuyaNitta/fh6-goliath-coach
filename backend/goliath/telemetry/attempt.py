from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Literal

from goliath.telemetry.model import LapSelection, TelemetryRow

HardResetEndReason = Literal["hard_timer_reset", "final_hard_timer_reset", "session_end"]

NEAR_ZERO_LAP_TIME_S = 1.0
MIN_PRE_RESET_LAP_TIME_S = 2.0
MIN_HARD_RESET_DROP_S = 2.0


@dataclass(frozen=True)
class HardTimerResetBoundary:
    boundary_index: int
    pre_source_row_index: int
    post_source_row_index: int
    pre_lap_time_s: float
    post_lap_time_s: float
    lap_time_drop_s: float
    pre_race_time_s: float
    post_race_time_s: float


@dataclass(frozen=True)
class AttemptCandidate:
    index: int
    rows: list[TelemetryRow]
    start_source_row_index: int
    end_source_row_index: int
    start_lap_time_s: float
    end_lap_time_s: float
    duration_s: float
    end_reason: HardResetEndReason
    selected: bool = False
    rejection_reason: str = ""


@dataclass(frozen=True)
class AttemptSelection:
    hard_resets: list[HardTimerResetBoundary]
    attempts: list[AttemptCandidate]
    selected_attempt: AttemptCandidate
    selected_attempt_index: int
    selection_reason: str

    def diagnostics(self) -> dict[str, object]:
        return {
            "hard_reset_count": len(self.hard_resets),
            "hard_resets": [asdict(reset) for reset in self.hard_resets],
            "selected_attempt_index": self.selected_attempt_index,
            "selection_reason": self.selection_reason,
            "attempts": [
                {
                    "index": attempt.index,
                    "start_source_row_index": attempt.start_source_row_index,
                    "end_source_row_index": attempt.end_source_row_index,
                    "start_lap_time_s": attempt.start_lap_time_s,
                    "end_lap_time_s": attempt.end_lap_time_s,
                    "duration_s": attempt.duration_s,
                    "row_count": len(attempt.rows),
                    "end_reason": attempt.end_reason,
                    "selected": attempt.selected,
                    "rejection_reason": attempt.rejection_reason,
                }
                for attempt in self.attempts
            ],
        }


def select_restart_aware_attempt(rows: list[TelemetryRow]) -> AttemptSelection:
    if not rows:
        raise ValueError("cannot select an attempt from an empty telemetry session")

    hard_resets = detect_hard_timer_resets(rows)
    if not hard_resets:
        raise ValueError("unsupported recording: no final hard timer reset was detected")

    attempts = split_attempts(rows, hard_resets)
    selected_index = len(hard_resets) - 1
    if selected_index >= len(attempts):
        raise ValueError("unsupported recording: final hard timer reset did not leave a preceding attempt")

    selected = attempts[selected_index]
    if not selected.rows:
        raise ValueError("unsupported recording: selected attempt is empty")

    marked_attempts: list[AttemptCandidate] = []
    for attempt in attempts:
        if attempt.index == selected.index:
            marked_attempts.append(_replace_attempt(attempt, selected=True, rejection_reason=""))
        else:
            reason = "after_final_hard_reset_tail" if attempt.index > selected.index else "before_selected_attempt"
            marked_attempts.append(_replace_attempt(attempt, selected=False, rejection_reason=reason))

    selected_marked = marked_attempts[selected_index]
    return AttemptSelection(
        hard_resets=hard_resets,
        attempts=marked_attempts,
        selected_attempt=selected_marked,
        selected_attempt_index=selected_marked.index,
        selection_reason="attempt_before_final_hard_reset",
    )


def detect_hard_timer_resets(rows: list[TelemetryRow]) -> list[HardTimerResetBoundary]:
    resets: list[HardTimerResetBoundary] = []
    for index, (previous, current) in enumerate(zip(rows, rows[1:])):
        if is_hard_timer_reset(previous, current):
            resets.append(
                HardTimerResetBoundary(
                    boundary_index=index,
                    pre_source_row_index=previous.source_row_index,
                    post_source_row_index=current.source_row_index,
                    pre_lap_time_s=previous.lap_time_s,
                    post_lap_time_s=current.lap_time_s,
                    lap_time_drop_s=previous.lap_time_s - current.lap_time_s,
                    pre_race_time_s=previous.current_race_time_s,
                    post_race_time_s=current.current_race_time_s,
                )
            )
    return resets


def is_hard_timer_reset(previous: TelemetryRow, current: TelemetryRow) -> bool:
    if not all(math.isfinite(value) for value in (previous.lap_time_s, current.lap_time_s)):
        return False
    lap_drop = previous.lap_time_s - current.lap_time_s
    return (
        previous.lap_time_s >= MIN_PRE_RESET_LAP_TIME_S
        and abs(current.lap_time_s) <= NEAR_ZERO_LAP_TIME_S
        and lap_drop >= MIN_HARD_RESET_DROP_S
    )


def split_attempts(rows: list[TelemetryRow], hard_resets: list[HardTimerResetBoundary]) -> list[AttemptCandidate]:
    attempts: list[AttemptCandidate] = []
    start_index = 0
    reset_by_boundary_index = {reset.boundary_index: reset for reset in hard_resets}
    final_boundary_index = hard_resets[-1].boundary_index if hard_resets else -1

    for boundary_index, (_previous, _current) in enumerate(zip(rows, rows[1:])):
        reset = reset_by_boundary_index.get(boundary_index)
        if reset is None:
            continue
        end_index = boundary_index
        attempt_rows = rows[start_index : end_index + 1]
        reason: HardResetEndReason = "final_hard_timer_reset" if boundary_index == final_boundary_index else "hard_timer_reset"
        attempts.append(_make_attempt(len(attempts), attempt_rows, reason))
        start_index = boundary_index + 1

    if start_index < len(rows):
        attempts.append(_make_attempt(len(attempts), rows[start_index:], "session_end"))
    return attempts


def build_lap_selection_from_effective_attempt(rows: list[TelemetryRow], *, notes: list[str] | None = None) -> LapSelection:
    if not rows:
        raise ValueError("selected attempt has no effective telemetry rows")
    first = rows[0]
    last = rows[-1]
    completed_lap_time_s = last.lap_time_s - first.lap_time_s
    return LapSelection(
        rows=rows,
        start_source_row_index=first.source_row_index,
        end_source_row_index=last.source_row_index,
        start_timestamp_s=first.timestamp_s,
        end_timestamp_s=last.timestamp_s,
        start_lap_time_s=first.lap_time_s,
        end_lap_time_s=last.lap_time_s,
        completed_lap_time_s=completed_lap_time_s,
        ambiguous=False,
        incomplete=False,
        notes=notes or [],
    )


def _make_attempt(index: int, rows: list[TelemetryRow], end_reason: HardResetEndReason) -> AttemptCandidate:
    if not rows:
        raise ValueError("attempt cannot be empty")
    first = rows[0]
    last = rows[-1]
    return AttemptCandidate(
        index=index,
        rows=rows,
        start_source_row_index=first.source_row_index,
        end_source_row_index=last.source_row_index,
        start_lap_time_s=first.lap_time_s,
        end_lap_time_s=last.lap_time_s,
        duration_s=last.lap_time_s - first.lap_time_s,
        end_reason=end_reason,
    )


def _replace_attempt(
    attempt: AttemptCandidate,
    *,
    selected: bool,
    rejection_reason: str,
) -> AttemptCandidate:
    return AttemptCandidate(
        index=attempt.index,
        rows=attempt.rows,
        start_source_row_index=attempt.start_source_row_index,
        end_source_row_index=attempt.end_source_row_index,
        start_lap_time_s=attempt.start_lap_time_s,
        end_lap_time_s=attempt.end_lap_time_s,
        duration_s=attempt.duration_s,
        end_reason=attempt.end_reason,
        selected=selected,
        rejection_reason=rejection_reason,
    )