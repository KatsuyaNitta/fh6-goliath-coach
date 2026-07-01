from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from goliath.sessions.discovery import inspect_process_state
from goliath.sessions.model import (
    DEFAULT_PROCESSED_ROOT,
    DEFAULT_SESSIONS_ROOT,
    DEFAULT_STATE_ROOT,
    SessionNotFoundError,
    SessionUserError,
)
from goliath.sessions.state import validate_session_id

TrashSender = Callable[[str], None]

FILE_ATTRIBUTE_REPARSE_POINT = 0x400


class SessionTrashError(SessionUserError):
    code = "session_trash_error"


class UnsafeSessionPathError(SessionTrashError):
    code = "unsafe_session_path"


class SessionNotTrashableError(SessionTrashError):
    code = "session_not_trashable"


class RecycleBinUnavailableError(SessionTrashError):
    code = "recycle_bin_unavailable"


class RecycleBinFailedError(SessionTrashError):
    code = "recycle_bin_failed"


class PartialRecycleBinFailureError(SessionTrashError):
    code = "partial_recycle_bin_failure"

    def __init__(self, message: str, *, trashed_items: list[str], failed_item: str) -> None:
        super().__init__(message)
        self.trashed_items = list(trashed_items)
        self.failed_item = failed_item


@dataclass(frozen=True)
class TrashManagedSessionResult:
    session_id: str
    trashed_items: list[str] = field(default_factory=list)


def trash_managed_session(
    session_id: str,
    *,
    sessions_root: Path = DEFAULT_SESSIONS_ROOT,
    processed_root: Path = DEFAULT_PROCESSED_ROOT,
    state_root: Path = DEFAULT_STATE_ROOT,
    trash_sender: TrashSender | None = None,
) -> TrashManagedSessionResult:
    session_id = validate_session_id(session_id)
    roots = _ResolvedRoots(
        sessions=Path(sessions_root).resolve(),
        processed=Path(processed_root).resolve(),
        state=Path(state_root).resolve(),
    )
    source_dir = roots.sessions / session_id
    _validate_direct_child(source_dir, roots.sessions, "session")
    _validate_trashable_source_dir(source_dir)

    process_state = inspect_process_state(roots.processed, session_id)
    if process_state.status == "processed":
        raise SessionNotTrashableError(f"processed sessions cannot be moved to the Recycle Bin: {session_id}")
    if process_state.status == "partial":
        raise SessionNotTrashableError(f"partial processed output must be inspected before trashing: {session_id}")

    state_file = roots.state / f"{session_id}.json"
    state_exists = state_file.exists()
    if state_exists:
        _validate_direct_child(state_file, roots.state, "state")
        _reject_symlink_or_reparse(state_file, "state")
        if not state_file.is_file():
            raise UnsafeSessionPathError(f"state path is not a file: {state_file}")

    sender = trash_sender or _load_send2trash()
    trashed_items: list[str] = []
    try:
        sender(str(source_dir))
        trashed_items.append("session")
    except Exception as exc:
        raise RecycleBinFailedError(f"could not move session to the Windows Recycle Bin: {exc}") from exc

    if state_exists:
        try:
            sender(str(state_file))
            trashed_items.append("state")
        except Exception as exc:
            raise PartialRecycleBinFailureError(
                f"session was moved to the Recycle Bin, but ignored-state file was not: {exc}",
                trashed_items=trashed_items,
                failed_item="state",
            ) from exc

    return TrashManagedSessionResult(session_id=session_id, trashed_items=trashed_items)


@dataclass(frozen=True)
class _ResolvedRoots:
    sessions: Path
    processed: Path
    state: Path


def _load_send2trash() -> TrashSender:
    try:
        from send2trash import send2trash
    except ImportError as exc:
        raise RecycleBinUnavailableError("Send2Trash is not installed; Recycle Bin support is unavailable.") from exc
    return send2trash


def _validate_direct_child(path: Path, parent: Path, label: str) -> None:
    resolved_parent = parent.resolve()
    resolved_path = path.resolve()
    if resolved_path.parent != resolved_parent or resolved_path.name != path.name:
        raise UnsafeSessionPathError(f"{label} path is not a direct child of its configured root: {path}")


def _validate_trashable_source_dir(path: Path) -> None:
    if not path.exists():
        raise SessionNotFoundError(f"session not found: {path.name}")
    _reject_symlink_or_reparse(path, "session")
    if not path.is_dir():
        raise UnsafeSessionPathError(f"session path is not a directory: {path}")


def _reject_symlink_or_reparse(path: Path, label: str) -> None:
    if path.is_symlink():
        raise UnsafeSessionPathError(f"{label} path must not be a symlink: {path}")
    try:
        stat = path.stat()
    except OSError as exc:
        raise UnsafeSessionPathError(f"could not inspect {label} path: {path}: {exc}") from exc
    attributes = getattr(stat, "st_file_attributes", 0)
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT:
        raise UnsafeSessionPathError(f"{label} path must not be a reparse point or junction: {path}")
