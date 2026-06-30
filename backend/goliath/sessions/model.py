from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_SESSIONS_ROOT = Path("data/local/sessions")
DEFAULT_PROCESSED_ROOT = Path("data/local/processed")
DEFAULT_STATE_ROOT = Path("data/local/session-state")
SESSION_LIST_SCHEMA_VERSION = "goliath-session-list-v1"
SESSION_STATE_SCHEMA_VERSION = "goliath-session-state-v1"
PROCESSED_SCHEMA_VERSION = "goliath-processed-session-v1"


class SessionUserError(RuntimeError):
    exit_code = 2


class SessionNotFoundError(SessionUserError):
    exit_code = 10


class SessionNotProcessableError(SessionUserError):
    exit_code = 11


class SessionIgnoredError(SessionUserError):
    exit_code = 12


class SessionAlreadyProcessedError(SessionUserError):
    exit_code = 13


class ManagedProcessingError(SessionUserError):
    exit_code = 14


class ManagedFinalizationError(SessionUserError):
    exit_code = 15


@dataclass(frozen=True)
class SessionVehicle:
    display_name: str
    car_ordinal: int | None = None
    car_class: int | None = None
    car_performance_index: int | None = None
    drive_train: int | None = None
    car_group: int | None = None
    num_cylinders: int | None = None
    identification_source: str | None = None
    catalog_sha256: str | None = None

    def as_dict(self) -> dict[str, object | None]:
        return asdict(self)


@dataclass(frozen=True)
class ProcessState:
    status: str
    processed_dir: Path
    session_summary_path: Path | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class IgnoredState:
    ignored: bool = False
    reason: str | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    session_dir: Path
    telemetry_csv_path: Path | None
    session_json_path: Path | None
    raw_packets_path: Path | None
    source_status: str
    process_status: str
    validation_errors: list[str]
    validation_warnings: list[str]
    recording_complete: bool | None
    recording_state: str | None
    started_at: str | None
    ended_at: str | None
    duration_s: float | None
    received_packets: int | None
    saved_packets: int | None
    ignored_off_packets: int | None
    vehicle: SessionVehicle
    processed_dir: Path
    session_summary_path: Path | None
    ignored_reason: str | None = None
    session_metadata: dict[str, object] = field(default_factory=dict, repr=False, compare=False)

    @property
    def is_source_processable(self) -> bool:
        return self.source_status in {"completed", "legacy-ready"}

    @property
    def is_ignored(self) -> bool:
        return self.process_status == "ignored" or self.ignored_reason is not None

    def as_json_dict(self) -> dict[str, object | None]:
        return {
            "session_id": self.session_id,
            "session_dir": str(self.session_dir),
            "telemetry_csv_path": str(self.telemetry_csv_path) if self.telemetry_csv_path else None,
            "session_json_path": str(self.session_json_path) if self.session_json_path else None,
            "raw_packets_path": str(self.raw_packets_path) if self.raw_packets_path else None,
            "source_status": self.source_status,
            "process_status": self.process_status,
            "recording_complete": self.recording_complete,
            "recording_state": self.recording_state,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "duration_s": self.duration_s,
            "received_packets": self.received_packets,
            "saved_packets": self.saved_packets,
            "ignored_off_packets": self.ignored_off_packets,
            "vehicle": self.vehicle.as_dict(),
            "processed_dir": str(self.processed_dir),
            "session_summary_path": str(self.session_summary_path) if self.session_summary_path else None,
            "ignored_reason": self.ignored_reason,
            "warnings": list(self.validation_warnings),
            "errors": list(self.validation_errors),
        }