from __future__ import annotations

import json
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from goliath.sessions.model import SESSION_STATE_SCHEMA_VERSION, IgnoredState

UNSAFE_SESSION_CHARS = re.compile(r"[\\/:\x00-\x1f\x7f]")


def validate_session_id(session_id: str) -> str:
    value = str(session_id).strip()
    if not value:
        raise ValueError("session ID must not be empty")
    if value in {".", ".."}:
        raise ValueError(f"unsafe session ID: {session_id}")
    path = Path(value)
    if path.is_absolute() or path.name != value or UNSAFE_SESSION_CHARS.search(value):
        raise ValueError(f"unsafe session ID: {session_id}")
    return value


def state_path(state_root: Path, session_id: str) -> Path:
    return Path(state_root) / f"{validate_session_id(session_id)}.json"


def load_ignored_state(state_root: Path, session_id: str) -> IgnoredState:
    path = state_path(state_root, session_id)
    if not path.exists():
        return IgnoredState()
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        return IgnoredState(warnings=[f"invalid ignored-state JSON {path}: {exc}"])
    if not isinstance(payload, dict):
        return IgnoredState(warnings=[f"ignored-state JSON {path} must contain an object"])
    if payload.get("status") != "ignored":
        return IgnoredState(warnings=[f"ignored-state JSON {path} has unsupported status"])
    reason = payload.get("reason")
    return IgnoredState(ignored=True, reason=str(reason) if reason is not None else None)


def write_ignored_state(state_root: Path, session_id: str, reason: str = "") -> Path:
    session_id = validate_session_id(session_id)
    path = state_path(state_root, session_id)
    payload = {
        "schema_version": SESSION_STATE_SCHEMA_VERSION,
        "session_id": session_id,
        "status": "ignored",
        "reason": reason,
        "updated_at": datetime.now(UTC).astimezone().isoformat(),
    }
    _atomic_write_json(path, payload)
    return path


def remove_ignored_state(state_root: Path, session_id: str) -> tuple[Path, bool]:
    path = state_path(state_root, session_id)
    if not path.exists():
        return path, False
    path.unlink()
    return path, True


def _atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, newline="") as file:
        file.write(text)
        temp_path = Path(file.name)
    temp_path.replace(path)