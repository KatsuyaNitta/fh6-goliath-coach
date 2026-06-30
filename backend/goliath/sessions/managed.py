from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from goliath.telemetry.processor import process_session
from goliath.vehicle.catalog import DEFAULT_CATALOG_DIR
from goliath.sessions.discovery import find_session, inspect_process_state
from goliath.sessions.model import (
    DEFAULT_PROCESSED_ROOT,
    DEFAULT_SESSIONS_ROOT,
    DEFAULT_STATE_ROOT,
    ManagedFinalizationError,
    ManagedProcessingError,
    SessionAlreadyProcessedError,
    SessionIgnoredError,
    SessionNotFoundError,
    SessionNotProcessableError,
    SessionRecord,
)
from goliath.sessions.state import validate_session_id


@dataclass(frozen=True)
class ManagedProcessResult:
    session_id: str
    summary: dict[str, object]
    final_dir: Path
    staging_dir: Path
    replaced_dir_backup: Path | None = None


def process_managed_session(
    session_id: str,
    *,
    sessions_root: Path = DEFAULT_SESSIONS_ROOT,
    processed_root: Path = DEFAULT_PROCESSED_ROOT,
    state_root: Path = DEFAULT_STATE_ROOT,
    reference_csv: Path = Path("data/reference/goliath_reference_1m.csv"),
    vehicle_catalog_dir: Path = DEFAULT_CATALOG_DIR,
    force: bool = False,
) -> ManagedProcessResult:
    session_id = validate_session_id(session_id)
    record = find_session(
        session_id,
        sessions_root,
        processed_root=processed_root,
        state_root=state_root,
        vehicle_catalog_dir=vehicle_catalog_dir,
    )
    if record is None:
        raise SessionNotFoundError(f"session not found: {session_id}")
    _validate_record_for_processing(record, force=force)

    processed_root = Path(processed_root)
    run_id = uuid.uuid4().hex[:12]
    staging_root = processed_root / ".staging" / f"{session_id}_{run_id}"
    staging_root.mkdir(parents=True, exist_ok=False)
    try:
        summary = process_session(
            record.session_dir,
            reference_csv=reference_csv,
            output_root=staging_root,
            vehicle_catalog_dir=vehicle_catalog_dir,
        )
    except Exception as exc:
        raise ManagedProcessingError(
            f"processing failed for {session_id}; staging preserved at {staging_root}: {exc}"
        ) from exc

    staging_session_dir = staging_root / session_id
    staging_state = inspect_process_state(staging_root, session_id)
    if staging_state.status != "processed":
        raise ManagedProcessingError(
            f"processing output did not validate for {session_id}; staging preserved at {staging_root}: "
            + "; ".join(staging_state.errors or ["unknown validation error"])
        )

    final_dir = processed_root / session_id
    backup_dir: Path | None = None
    processed_root.mkdir(parents=True, exist_ok=True)
    if final_dir.exists():
        if not force:
            raise SessionAlreadyProcessedError(f"processed output already exists for {session_id}: {final_dir}")
        backup_dir = processed_root / ".managed-backups" / f"{session_id}_{run_id}"
        backup_dir.parent.mkdir(parents=True, exist_ok=True)
        try:
            final_dir.rename(backup_dir)
        except OSError as exc:
            raise ManagedFinalizationError(f"could not move existing output to backup {backup_dir}: {exc}") from exc

    try:
        staging_session_dir.rename(final_dir)
    except OSError as exc:
        if backup_dir and backup_dir.exists() and not final_dir.exists():
            try:
                backup_dir.rename(final_dir)
            except OSError as restore_exc:
                raise ManagedFinalizationError(
                    f"could not install new output and could not restore backup {backup_dir}: {restore_exc}"
                ) from restore_exc
        raise ManagedFinalizationError(f"could not move staged output to final location {final_dir}: {exc}") from exc

    summary = _rewrite_summary_output_paths(final_dir, staging_session_dir)
    final_state = inspect_process_state(processed_root, session_id)
    if final_state.status != "processed":
        if backup_dir and backup_dir.exists():
            if final_dir.exists():
                shutil.rmtree(final_dir)
            backup_dir.rename(final_dir)
        raise ManagedFinalizationError(
            f"final output did not validate for {session_id}: "
            + "; ".join(final_state.errors or ["unknown validation error"])
        )

    if backup_dir and backup_dir.exists():
        shutil.rmtree(backup_dir)
    _remove_empty_created_dirs(staging_root)
    return ManagedProcessResult(
        session_id=session_id,
        summary=summary,
        final_dir=final_dir,
        staging_dir=staging_root,
        replaced_dir_backup=backup_dir,
    )


def _rewrite_summary_output_paths(final_dir: Path, staging_session_dir: Path) -> dict[str, object]:
    summaries = sorted(final_dir.glob("*_session-summary.json"))
    if len(summaries) != 1:
        return {}
    summary_path = summaries[0]
    summary = json.loads(summary_path.read_text(encoding="utf-8-sig"))
    if not isinstance(summary, dict):
        return {}
    outputs = summary.get("outputs")
    if isinstance(outputs, dict):
        rewritten: dict[str, object] = {}
        for key, value in outputs.items():
            if isinstance(value, str) and value:
                rewritten[key] = str(final_dir / Path(value).name)
            else:
                rewritten[key] = value
        rewritten["session_summary_json"] = str(final_dir / summary_path.name)
        summary["outputs"] = rewritten
    _atomic_write_json(summary_path, summary)
    return summary


def _atomic_write_json(path: Path, payload: object) -> None:
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _validate_record_for_processing(record: SessionRecord, *, force: bool) -> None:
    if record.is_ignored:
        reason = f": {record.ignored_reason}" if record.ignored_reason else ""
        raise SessionIgnoredError(f"session {record.session_id} is ignored{reason}")
    if not record.is_source_processable:
        details = "; ".join(record.validation_errors) if record.validation_errors else record.source_status
        raise SessionNotProcessableError(f"session {record.session_id} is not processable: {details}")
    if record.process_status == "processed" and not force:
        raise SessionAlreadyProcessedError(f"session {record.session_id} is already processed: {record.processed_dir}")
    if record.process_status == "partial" and not force:
        raise SessionAlreadyProcessedError(
            f"partial processed output exists for {record.session_id}; use --force after inspecting {record.processed_dir}"
        )


def _remove_empty_created_dirs(staging_root: Path) -> None:
    current = staging_root
    for _ in range(2):
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent