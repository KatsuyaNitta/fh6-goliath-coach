from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path

from goliath.sessions.discovery import discover_sessions, inspect_process_state
from goliath.sessions.managed import process_managed_session
from goliath.sessions.model import (
    DEFAULT_PROCESSED_ROOT,
    DEFAULT_SESSIONS_ROOT,
    DEFAULT_STATE_ROOT,
    SESSION_LIST_SCHEMA_VERSION,
    ManagedFinalizationError,
    ManagedProcessingError,
    SessionAlreadyProcessedError,
    SessionIgnoredError,
    SessionNotFoundError,
    SessionNotProcessableError,
)
from goliath.sessions.state import validate_session_id
from goliath.sessions.trash import (
    PartialRecycleBinFailureError,
    RecycleBinFailedError,
    RecycleBinUnavailableError,
    SessionNotTrashableError,
    TrashSender,
    UnsafeSessionPathError,
    trash_managed_session,
)
from goliath.vehicle.catalog import DEFAULT_CATALOG_DIR

HEALTH_SCHEMA_VERSION = "goliath-local-web-health-v1"
ERROR_SCHEMA_VERSION = "goliath-local-web-error-v1"
ACTION_SCHEMA_VERSION = "goliath-session-action-v1"
MAX_JSON_BODY_BYTES = 16 * 1024


@dataclass(frozen=True)
class WebConfig:
    sessions_root: Path = DEFAULT_SESSIONS_ROOT
    processed_root: Path = DEFAULT_PROCESSED_ROOT
    state_root: Path = DEFAULT_STATE_ROOT
    vehicle_catalog_dir: Path = DEFAULT_CATALOG_DIR
    reference_csv: Path = Path("data/reference/goliath_reference_1m.csv")
    viewer_root: Path = Path("viewer/dist")
    api_only: bool = False


class ApiError(RuntimeError):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ProcessingBusyError(ApiError):
    def __init__(self) -> None:
        super().__init__(409, "processing_busy", "Another session operation is already in progress.")


class SessionLoadedError(ApiError):
    def __init__(self, session_id: str) -> None:
        super().__init__(409, "session_loaded", f"Loaded session cannot be moved to the Recycle Bin: {session_id}.")


class LocalWebApp:
    def __init__(self, config: WebConfig) -> None:
        self.config = config
        self._session_mutation_lock = threading.Lock()
        self._processing_lock = self._session_mutation_lock
        self._loaded_session_id = ""
        self.trash_sender: TrashSender | None = None

    def health_payload(self) -> dict[str, object]:
        return {
            "schema_version": HEALTH_SCHEMA_VERSION,
            "status": "ok",
            "session_list_schema_version": SESSION_LIST_SCHEMA_VERSION,
        }

    def list_sessions_payload(self, *, include_incomplete: bool = False, include_invalid: bool = False, include_ignored: bool = False) -> dict[str, object]:
        records = discover_sessions(
            self.config.sessions_root,
            processed_root=self.config.processed_root,
            state_root=self.config.state_root,
            vehicle_catalog_dir=self.config.vehicle_catalog_dir,
            include_incomplete=include_incomplete,
            include_invalid=include_invalid,
            include_ignored=include_ignored,
        )
        return {
            "schema_version": SESSION_LIST_SCHEMA_VERSION,
            "sessions_root": str(self.config.sessions_root),
            "processed_root": str(self.config.processed_root),
            "state_root": str(self.config.state_root),
            "sessions": [record.as_json_dict() for record in records],
        }

    def process_session_payload(self, session_id: str) -> dict[str, object]:
        session_id = validate_session_id(session_id)
        if not self._session_mutation_lock.acquire(blocking=False):
            raise ProcessingBusyError()
        try:
            result = process_managed_session(
                session_id,
                sessions_root=self.config.sessions_root,
                processed_root=self.config.processed_root,
                state_root=self.config.state_root,
                reference_csv=self.config.reference_csv,
                vehicle_catalog_dir=self.config.vehicle_catalog_dir,
                force=False,
            )
            refreshed = self._find_processed_record(session_id)
            summary = result.summary
            return {
                "schema_version": ACTION_SCHEMA_VERSION,
                "session_id": session_id,
                "status": "processed",
                "session": refreshed.as_json_dict() if refreshed else None,
                "summary": _compact_summary(summary),
            }
        except Exception as exc:
            raise map_processing_exception(exc) from exc
        finally:
            self._session_mutation_lock.release()

    def trash_session_payload(self, session_id: str) -> dict[str, object]:
        try:
            session_id = validate_session_id(session_id)
        except ValueError as exc:
            raise ApiError(400, "invalid_session_id", str(exc)) from exc
        if session_id == self._loaded_session_id:
            raise SessionLoadedError(session_id)
        if not self._session_mutation_lock.acquire(blocking=False):
            raise ProcessingBusyError()
        try:
            result = trash_managed_session(
                session_id,
                sessions_root=self.config.sessions_root,
                processed_root=self.config.processed_root,
                state_root=self.config.state_root,
                trash_sender=self.trash_sender,
            )
            return {
                "schema_version": ACTION_SCHEMA_VERSION,
                "session_id": session_id,
                "status": "trashed",
                "trashed_items": result.trashed_items,
            }
        except Exception as exc:
            raise map_trash_exception(exc) from exc
        finally:
            self._session_mutation_lock.release()

    def projected_lap_path(self, session_id: str) -> Path:
        session_id = validate_session_id(session_id)
        state = inspect_process_state(self.config.processed_root, session_id)
        if state.status != "processed" or state.session_summary_path is None:
            raise ApiError(404, "projected_lap_not_found", f"No processed projected lap is available for {session_id}.")
        summary = _read_json_object(state.session_summary_path)
        outputs = summary.get("outputs")
        if not isinstance(outputs, dict):
            raise ApiError(404, "projected_lap_not_found", f"Processed summary for {session_id} has no outputs.")
        raw_projected = outputs.get("projected_lap_csv")
        if not isinstance(raw_projected, str) or not raw_projected:
            raise ApiError(404, "projected_lap_not_found", f"Processed summary for {session_id} has no projected lap.")
        filename = Path(raw_projected).name
        candidate = (Path(self.config.processed_root) / session_id / filename).resolve()
        processed_dir = (Path(self.config.processed_root) / session_id).resolve()
        if not _is_relative_to(candidate, processed_dir) or not candidate.is_file():
            raise ApiError(404, "projected_lap_not_found", f"Projected lap file is missing for {session_id}.")
        if not filename.endswith("_projected-lap.csv"):
            raise ApiError(404, "projected_lap_not_found", f"Processed output is not a projected-lap CSV for {session_id}.")
        self._loaded_session_id = session_id
        return candidate

    def _find_processed_record(self, session_id: str):
        records = discover_sessions(
            self.config.sessions_root,
            processed_root=self.config.processed_root,
            state_root=self.config.state_root,
            vehicle_catalog_dir=self.config.vehicle_catalog_dir,
            include_incomplete=True,
            include_invalid=True,
            include_ignored=True,
        )
        return next((record for record in records if record.session_id == session_id), None)


def parse_bool_query(raw: str, name: str) -> bool:
    value = raw.strip().lower()
    if value in {"true", "1"}:
        return True
    if value in {"false", "0"}:
        return False
    raise ApiError(400, "invalid_query", f"Query parameter {name} must be true, false, 1, or 0.")


def parse_json_body(raw: bytes, content_type: str | None) -> dict[str, object]:
    if len(raw) > MAX_JSON_BODY_BYTES:
        raise ApiError(400, "body_too_large", "Request body is too large.")
    if not raw:
        return {}
    if content_type and "application/json" not in content_type.lower():
        raise ApiError(400, "unsupported_content_type", "Only application/json request bodies are supported.")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(400, "malformed_json", f"Malformed JSON request body: {exc}") from exc
    if parsed is None:
        return {}
    if not isinstance(parsed, dict):
        raise ApiError(400, "invalid_request", "Request body must be a JSON object.")
    allowed_keys: set[str] = set()
    unexpected = sorted(set(parsed) - allowed_keys)
    if unexpected:
        raise ApiError(400, "invalid_request", "Session process request does not accept body fields.")
    return parsed


def parse_trash_json_body(raw: bytes, content_type: str | None, session_id: str) -> dict[str, object]:
    if len(raw) > MAX_JSON_BODY_BYTES:
        raise ApiError(400, "body_too_large", "Request body is too large.")
    if not raw:
        raise ApiError(400, "confirmation_required", "Trash request requires confirm_session_id.")
    if not content_type or "application/json" not in content_type.lower():
        raise ApiError(400, "unsupported_content_type", "Only application/json request bodies are supported.")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(400, "malformed_json", f"Malformed JSON request body: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ApiError(400, "invalid_request", "Request body must be a JSON object.")
    allowed_keys = {"confirm_session_id"}
    unexpected = sorted(set(parsed) - allowed_keys)
    if unexpected:
        raise ApiError(400, "invalid_request", f"Unexpected trash request field: {', '.join(unexpected)}.")
    confirm_session_id = parsed.get("confirm_session_id")
    if not isinstance(confirm_session_id, str) or not confirm_session_id:
        raise ApiError(400, "confirmation_required", "Trash request requires confirm_session_id.")
    if confirm_session_id != session_id:
        raise ApiError(400, "confirmation_mismatch", "Trash confirmation does not match URL session ID.")
    return parsed


def error_payload(code: str, message: str) -> dict[str, object]:
    return {
        "schema_version": ERROR_SCHEMA_VERSION,
        "error": {
            "code": code,
            "message": message,
        },
    }


def map_processing_exception(exc: Exception) -> ApiError:
    if isinstance(exc, ApiError):
        return exc
    if isinstance(exc, SessionNotFoundError):
        return ApiError(404, "session_not_found", str(exc))
    if isinstance(exc, SessionIgnoredError):
        return ApiError(409, "ignored", str(exc))
    if isinstance(exc, SessionAlreadyProcessedError):
        return ApiError(409, "already_processed", str(exc))
    if isinstance(exc, SessionNotProcessableError):
        return ApiError(422, "not_processable", str(exc))
    if isinstance(exc, (ManagedProcessingError, ManagedFinalizationError)):
        return ApiError(422, "processing_failed", str(exc))
    if isinstance(exc, ValueError):
        return ApiError(400, "invalid_request", str(exc))
    return ApiError(500, "internal_error", "Unexpected internal error.")


def map_trash_exception(exc: Exception) -> ApiError:
    if isinstance(exc, ApiError):
        return exc
    if isinstance(exc, SessionNotFoundError):
        return ApiError(404, "session_not_found", str(exc))
    if isinstance(exc, UnsafeSessionPathError):
        return ApiError(400, "unsafe_session_path", str(exc))
    if isinstance(exc, SessionNotTrashableError):
        message = str(exc)
        code = "partial_output_not_trashable" if "partial" in message.lower() else "processed_session_not_trashable"
        return ApiError(409, code, message)
    if isinstance(exc, RecycleBinUnavailableError):
        return ApiError(500, "recycle_bin_unavailable", str(exc))
    if isinstance(exc, PartialRecycleBinFailureError):
        return ApiError(500, "partial_recycle_bin_failure", str(exc))
    if isinstance(exc, RecycleBinFailedError):
        return ApiError(500, "recycle_bin_failed", str(exc))
    if isinstance(exc, ValueError):
        return ApiError(400, "invalid_session_id", str(exc))
    return ApiError(500, "internal_error", "Unexpected internal error.")


def _compact_summary(summary: dict[str, object]) -> dict[str, object]:
    compact: dict[str, object] = {}
    for key in ("vehicle", "completed_lap", "rewind_summary", "outputs"):
        value = summary.get(key)
        if isinstance(value, dict):
            compact[key] = value
    return compact


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ApiError(500, "invalid_processed_summary", f"Processed summary is not an object: {path}")
    return payload


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True
