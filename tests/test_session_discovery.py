from __future__ import annotations

import csv
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from goliath.cli import main as cli_main
from goliath.sessions.discovery import discover_sessions, inspect_process_state
from goliath.sessions.managed import process_managed_session
from goliath.sessions.model import (
    ManagedFinalizationError,
    ManagedProcessingError,
    ProcessState,
    SessionAlreadyProcessedError,
    SessionIgnoredError,
    SessionNotProcessableError,
)
from goliath.sessions.state import remove_ignored_state, validate_session_id, write_ignored_state
from goliath.telemetry.importer import REQUIRED_COLUMNS


class SessionFixture:
    def __init__(self, root: Path):
        self.root = root
        self.sessions = root / "sessions"
        self.processed = root / "processed"
        self.state = root / "session-state"
        self.catalog = root / "vehicle-catalog"
        self.sessions.mkdir()
        self.processed.mkdir()
        self.state.mkdir()

    def write_session(
        self,
        session_id: str,
        *,
        metadata: dict[str, object] | None = None,
        rows: list[dict[str, object]] | None = None,
        csv_count: int = 1,
        json_count: int = 1,
        raw_count: int = 0,
        headers: list[str] | None = None,
        invalid_json: bool = False,
        nested: bool = False,
    ) -> Path:
        base = self.sessions / ("outer" if nested else session_id)
        session_dir = base / session_id if nested else base
        session_dir.mkdir(parents=True, exist_ok=True)
        if csv_count == 1:
            self._write_csv(session_dir / f"{session_id}_telemetry.csv", headers=headers, rows=rows)
        else:
            for index in range(csv_count):
                self._write_csv(session_dir / f"{session_id}_{index}_telemetry.csv", headers=headers, rows=rows)
        if json_count == 1:
            path = session_dir / f"{session_id}_session.json"
            if invalid_json:
                path.write_text("{not json", encoding="utf-8")
            else:
                payload = metadata if metadata is not None else self.modern_metadata(session_id)
                path.write_text(json.dumps(payload), encoding="utf-8")
        else:
            for index in range(json_count):
                (session_dir / f"{session_id}_{index}_session.json").write_text("{}", encoding="utf-8")
        for index in range(raw_count):
            (session_dir / f"{session_id}_{index}_packets.fh6raw").write_bytes(b"raw")
        return session_dir

    def modern_metadata(self, session_id: str) -> dict[str, object]:
        return {
            "session_id": session_id,
            "recording_complete": True,
            "recording_state": "completed",
            "started_at": "2026-06-30T20:05:04+09:00",
            "ended_at": "2026-06-30T20:06:54+09:00",
            "received_packets": 10,
            "saved_packets": 8,
            "ignored_off_packets": 2,
            "vehicle": {
                "car_ordinal": 2363,
                "car_class": 5,
                "car_performance_index": 900,
                "drive_train": 1,
                "car_group": 11,
                "num_cylinders": 12,
            },
        }

    def _write_csv(
        self,
        path: Path,
        *,
        headers: list[str] | None = None,
        rows: list[dict[str, object]] | None = None,
    ) -> None:
        fieldnames = headers or [*REQUIRED_COLUMNS, "car_ordinal", "car_performance_index"]
        values = rows if rows is not None else [self.default_row()]
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            for row in values:
                writer.writerow({key: row.get(key, "") for key in fieldnames})

    def default_row(self) -> dict[str, object]:
        row = {column: 1 for column in REQUIRED_COLUMNS}
        row.update(
            {
                "current_lap_time": 1.0,
                "last_lap_time": 0.0,
                "lap_number": 1,
                "position_x": 1.0,
                "position_y": 2.0,
                "position_z": 3.0,
                "speed_kmh": 100.0,
                "handbrake_raw": 0,
                "handbrake_pct": 0,
                "car_ordinal": 2363,
                "car_performance_index": 900,
            }
        )
        return row

    def write_processed(self, session_id: str, *, valid: bool = True, mismatch: bool = False) -> Path:
        output_dir = self.processed / session_id
        output_dir.mkdir(parents=True, exist_ok=True)
        projected = output_dir / f"{session_id}_projected-lap.csv"
        rewind = output_dir / f"{session_id}_rewind-analysis.json"
        summary_path = output_dir / f"{session_id}_session-summary.json"
        projected.write_text("source_row_index\n", encoding="utf-8")
        rewind.write_text("{}", encoding="utf-8")
        summary = {
            "schema_version": "goliath-processed-session-v1",
            "session_id": "other" if mismatch else session_id,
            "outputs": {
                "session_summary_json": str(summary_path),
                "projected_lap_csv": str(projected if valid else output_dir / "missing.csv"),
                "rewind_analysis_json": str(rewind),
            },
        }
        summary_path.write_text(json.dumps(summary), encoding="utf-8")
        return output_dir


def write_fake_processed_output(output_root: Path, session_id: str) -> dict[str, object]:
    output_dir = output_root / session_id
    output_dir.mkdir(parents=True, exist_ok=True)
    projected = output_dir / f"{session_id}_projected-lap.csv"
    rewind = output_dir / f"{session_id}_rewind-analysis.json"
    projected.write_text("source_row_index\n", encoding="utf-8")
    rewind.write_text(json.dumps({"summary": {"rewind_event_count": 0}}), encoding="utf-8")
    summary_path = output_dir / f"{session_id}_session-summary.json"
    summary = {
        "schema_version": "goliath-processed-session-v1",
        "session_id": session_id,
        "vehicle": {"display_name": "Car 2363"},
        "completed_lap": {"completed_lap_time_s": 110.5},
        "rewind_summary": {"rewind_event_count": 0},
        "outputs": {
            "session_summary_json": str(summary_path),
            "projected_lap_csv": str(projected),
            "rewind_analysis_json": str(rewind),
        },
    }
    summary_path.write_text(json.dumps(summary), encoding="utf-8")
    return summary


class SessionDiscoveryTests(unittest.TestCase):
    def test_modern_completed_session_is_discovered(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            records = discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)
            self.assertEqual([record.session_id for record in records], ["20260630_200504"])
            record = records[0]
            self.assertEqual(record.source_status, "completed")
            self.assertTrue(record.recording_complete)
            self.assertEqual(record.recording_state, "completed")
            self.assertEqual(record.saved_packets, 8)
            self.assertEqual(record.vehicle.car_ordinal, 2363)
            self.assertEqual(record.vehicle.car_performance_index, 900)
            self.assertEqual(record.duration_s, 110.0)

    def test_incomplete_and_invalid_sessions_are_hidden_by_default(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            incomplete = fixture.modern_metadata("20260630_200504")
            incomplete.update({"recording_complete": False, "recording_state": "recording"})
            fixture.write_session("20260630_200504", metadata=incomplete)
            failed = fixture.modern_metadata("20260630_200505")
            failed.update({"recording_complete": True, "recording_state": "failed"})
            fixture.write_session("20260630_200505", metadata=failed)

            self.assertEqual(discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state), [])
            shown = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                include_incomplete=True,
                include_invalid=True,
            )
            statuses = {record.session_id: record.source_status for record in shown}
            self.assertEqual(statuses["20260630_200504"], "incomplete")
            self.assertEqual(statuses["20260630_200505"], "invalid")

    def test_legacy_session_without_completion_fields_is_ready_with_warning(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_005550", metadata={"started_at": "2026-06-30T00:55:50+09:00"})
            record = discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)[0]
            self.assertEqual(record.source_status, "legacy-ready")
            self.assertIn("legacy session JSON has no session_id", record.validation_warnings)

    def test_layout_and_metadata_validation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200500", csv_count=0)
            fixture.write_session("20260630_200501", csv_count=2)
            fixture.write_session("20260630_200502", json_count=0)
            fixture.write_session("20260630_200503", invalid_json=True)
            fixture.write_session("20260630_200504", rows=[])
            fixture.write_session("20260630_200505", headers=["game_elapsed_s"])
            mismatch = fixture.modern_metadata("other")
            fixture.write_session("20260630_200506", metadata=mismatch)
            records = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                include_invalid=True,
            )
            self.assertTrue(all(record.source_status == "invalid" for record in records))

    def test_direct_children_only_and_newest_first(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_100000")
            fixture.write_session("20260630_110000")
            fixture.write_session("20260630_120000", nested=True)
            records = discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)
            self.assertEqual([record.session_id for record in records], ["20260630_110000", "20260630_100000"])

    def test_invalid_session_id_path_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_session_id("..\\bad")
        with self.assertRaises(ValueError):
            validate_session_id("../bad")
        with self.assertRaises(ValueError):
            validate_session_id("C:\\bad")

    def test_legacy_csv_vehicle_probe_and_unknown_fallbacks(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504", metadata={})
            record = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                vehicle_catalog_dir=fixture.catalog,
            )[0]
            self.assertEqual(record.vehicle.display_name, "Car 2363")

            fixture.write_session(
                "20260630_200505",
                metadata={},
                rows=[{**fixture.default_row(), "car_ordinal": "", "car_performance_index": ""}],
            )
            records = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                vehicle_catalog_dir=fixture.catalog,
            )
            missing = next(record for record in records if record.session_id == "20260630_200505")
            self.assertEqual(missing.vehicle.display_name, "Unknown vehicle")

    def test_catalog_resolution_and_json_keeps_full_vehicle_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            catalog_dir = fixture.catalog / "normalized"
            catalog_dir.mkdir(parents=True)
            long_name = "2026 Extremely Long Manufacturer Name With A Very Long Model Name Track Edition"
            (catalog_dir / "fh6-vehicle-catalog.json").write_text(
                json.dumps(
                    {
                        "schema_version": "goliath-fh6-vehicle-catalog-v1",
                        "vehicles": {"2363": {"display_name": long_name, "filename_slug": "long-car"}},
                    }
                ),
                encoding="utf-8",
            )
            fixture.write_session("20260630_200504")
            record = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                vehicle_catalog_dir=fixture.catalog,
            )[0]
            self.assertEqual(record.vehicle.display_name, long_name)
            self.assertEqual(record.as_json_dict()["vehicle"]["display_name"], long_name)


class ProcessStateAndIgnoreTests(unittest.TestCase):
    def test_processed_output_paths_accept_repo_relative_staging_paths(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd() / "data" / "local") as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            session_id = "20260630_200500"
            output_dir = fixture.processed / ".staging" / "20260630_200500_run" / session_id
            output_dir.mkdir(parents=True)
            projected = output_dir / f"{session_id}_projected-lap.csv"
            rewind = output_dir / f"{session_id}_rewind-analysis.json"
            summary = output_dir / f"{session_id}_session-summary.json"
            projected.write_text("source_row_index\n", encoding="utf-8")
            rewind.write_text("{}", encoding="utf-8")
            payload = {
                "schema_version": "goliath-processed-session-v1",
                "session_id": session_id,
                "outputs": {
                    "session_summary_json": os.path.relpath(summary, Path.cwd()),
                    "projected_lap_csv": os.path.relpath(projected, Path.cwd()),
                    "rewind_analysis_json": os.path.relpath(rewind, Path.cwd()),
                },
            }
            summary.write_text(json.dumps(payload), encoding="utf-8")
            state = inspect_process_state(output_dir.parent, session_id)
            self.assertEqual(state.status, "processed")

    def test_processed_output_paths_do_not_double_join_session_directory(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd() / "data" / "local") as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            session_id = "20260630_200500"
            output_dir = fixture.write_processed(session_id)
            summary = output_dir / f"{session_id}_session-summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["outputs"]["projected_lap_csv"] = os.path.relpath(output_dir / f"{session_id}_projected-lap.csv", Path.cwd())
            payload["outputs"]["rewind_analysis_json"] = os.path.relpath(output_dir / f"{session_id}_rewind-analysis.json", Path.cwd())
            payload["outputs"]["session_summary_json"] = os.path.relpath(summary, Path.cwd())
            summary.write_text(json.dumps(payload), encoding="utf-8")
            nested = output_dir / os.path.relpath(output_dir / f"{session_id}_projected-lap.csv", Path.cwd())
            self.assertFalse(nested.exists())
            self.assertEqual(inspect_process_state(fixture.processed, session_id).status, "processed")

    def test_processed_output_paths_accept_absolute_paths_inside_session_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_processed("20260630_200500")
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200500").status, "processed")

    def test_processed_output_paths_use_basename_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            session_id = "20260630_200500"
            output_dir = fixture.write_processed(session_id)
            summary = output_dir / f"{session_id}_session-summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["outputs"] = {
                "session_summary_json": f"missing-prefix/{summary.name}",
                "projected_lap_csv": f"missing-prefix/{session_id}_projected-lap.csv",
                "rewind_analysis_json": f"missing-prefix/{session_id}_rewind-analysis.json",
            }
            summary.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(inspect_process_state(fixture.processed, session_id).status, "processed")

    def test_processed_output_paths_reject_existing_external_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            session_id = "20260630_200500"
            output_dir = fixture.write_processed(session_id)
            external = fixture.root / f"{session_id}_projected-lap.csv"
            external.write_text("outside\n", encoding="utf-8")
            summary = output_dir / f"{session_id}_session-summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["outputs"]["projected_lap_csv"] = str(external)
            summary.write_text(json.dumps(payload), encoding="utf-8")
            state = inspect_process_state(fixture.processed, session_id)
            self.assertEqual(state.status, "partial")
            self.assertIn("outside processed session directory", state.errors[0])

    def test_processed_state_is_partial_only_when_required_file_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            session_id = "20260630_200500"
            output_dir = fixture.write_processed(session_id)
            (output_dir / f"{session_id}_rewind-analysis.json").unlink()
            state = inspect_process_state(fixture.processed, session_id)
            self.assertEqual(state.status, "partial")
            self.assertIn("rewind_analysis_json", state.errors[0])

    def test_processed_partial_and_mismatched_state_detection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_processed("20260630_200500")
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200500").status, "processed")
            (fixture.processed / "20260630_200501").mkdir()
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200501").status, "partial")
            fixture.write_processed("20260630_200502", mismatch=True)
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200502").status, "partial")
            fixture.write_processed("20260630_200503", valid=False)
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200503").status, "partial")

    def test_ignored_state_hides_by_default_and_unignore_is_safe(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            path = write_ignored_state(fixture.state, "20260630_200504", "test run")
            self.assertTrue(path.exists())
            self.assertEqual(discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state), [])
            shown = discover_sessions(
                fixture.sessions,
                processed_root=fixture.processed,
                state_root=fixture.state,
                include_ignored=True,
            )
            self.assertEqual(shown[0].process_status, "ignored")
            self.assertEqual(shown[0].ignored_reason, "test run")
            removed_path, removed = remove_ignored_state(fixture.state, "20260630_200504")
            self.assertTrue(removed)
            self.assertEqual(removed_path, path)
            _, removed_again = remove_ignored_state(fixture.state, "20260630_200504")
            self.assertFalse(removed_again)

    def test_invalid_ignored_state_json_warns_without_crash(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            (fixture.state / "20260630_200504.json").write_text("{bad", encoding="utf-8")
            record = discover_sessions(fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)[0]
            self.assertTrue(any("invalid ignored-state JSON" in warning for warning in record.validation_warnings))


class ManagedProcessingTests(unittest.TestCase):
    def test_process_by_id_uses_staging_and_finalizes_after_validation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")

            def fake_process(session_dir, *, reference_csv, output_root, vehicle_catalog_dir):
                self.assertEqual(Path(session_dir).name, "20260630_200504")
                self.assertIn(".staging", str(output_root))
                return write_fake_processed_output(Path(output_root), "20260630_200504")

            with patch("goliath.sessions.managed.process_session", side_effect=fake_process):
                result = process_managed_session(
                    "20260630_200504",
                    sessions_root=fixture.sessions,
                    processed_root=fixture.processed,
                    state_root=fixture.state,
                )
            self.assertTrue((fixture.processed / "20260630_200504").exists())
            self.assertFalse((fixture.sessions / "20260630_200504").joinpath("moved").exists())
            self.assertEqual(result.final_dir, fixture.processed / "20260630_200504")

    def test_managed_processing_refuses_incomplete_invalid_ignored_and_processed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            incomplete = fixture.modern_metadata("20260630_200500")
            incomplete.update({"recording_complete": False, "recording_state": "recording"})
            fixture.write_session("20260630_200500", metadata=incomplete)
            with self.assertRaises(SessionNotProcessableError):
                process_managed_session("20260630_200500", sessions_root=fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)

            fixture.write_session("20260630_200501", csv_count=0)
            with self.assertRaises(SessionNotProcessableError):
                process_managed_session("20260630_200501", sessions_root=fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)

            fixture.write_session("20260630_200502")
            write_ignored_state(fixture.state, "20260630_200502", "not Goliath")
            with self.assertRaises(SessionIgnoredError):
                process_managed_session("20260630_200502", sessions_root=fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)

            fixture.write_session("20260630_200503")
            fixture.write_processed("20260630_200503")
            with self.assertRaises(SessionAlreadyProcessedError):
                process_managed_session("20260630_200503", sessions_root=fixture.sessions, processed_root=fixture.processed, state_root=fixture.state)

    def test_failed_processing_leaves_existing_final_output_unchanged(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            existing = fixture.write_processed("20260630_200504")
            marker = existing / "keep.txt"
            marker.write_text("old", encoding="utf-8")

            def fail_process(*_args, **_kwargs):
                raise RuntimeError("boom")

            with patch("goliath.sessions.managed.process_session", side_effect=fail_process):
                with self.assertRaises(ManagedProcessingError):
                    process_managed_session(
                        "20260630_200504",
                        sessions_root=fixture.sessions,
                        processed_root=fixture.processed,
                        state_root=fixture.state,
                        force=True,
                    )
            self.assertEqual(marker.read_text(encoding="utf-8"), "old")

    def test_force_replacement_restores_backup_when_final_validation_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            existing = fixture.write_processed("20260630_200504")
            old_marker = existing / "old.txt"
            old_marker.write_text("old", encoding="utf-8")

            def fake_process(session_dir, *, reference_csv, output_root, vehicle_catalog_dir):
                return write_fake_processed_output(Path(output_root), "20260630_200504")

            with patch("goliath.sessions.managed.process_session", side_effect=fake_process), patch(
                "goliath.sessions.managed.inspect_process_state",
                side_effect=[
                    ProcessState("processed", fixture.processed / ".staging" / "run" / "20260630_200504"),
                    ProcessState("partial", fixture.processed / "20260630_200504", errors=["forced final failure"]),
                ],
            ):
                with self.assertRaises(ManagedFinalizationError):
                    process_managed_session(
                        "20260630_200504",
                        sessions_root=fixture.sessions,
                        processed_root=fixture.processed,
                        state_root=fixture.state,
                        force=True,
                    )
            self.assertTrue(old_marker.exists())
            self.assertEqual(old_marker.read_text(encoding="utf-8"), "old")
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200504").status, "processed")
    def test_force_replacement_validates_new_output_before_replacing_old(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            existing = fixture.write_processed("20260630_200504")
            old_marker = existing / "old.txt"
            old_marker.write_text("old", encoding="utf-8")

            def fake_process(session_dir, *, reference_csv, output_root, vehicle_catalog_dir):
                return write_fake_processed_output(Path(output_root), "20260630_200504")

            with patch("goliath.sessions.managed.process_session", side_effect=fake_process):
                process_managed_session(
                    "20260630_200504",
                    sessions_root=fixture.sessions,
                    processed_root=fixture.processed,
                    state_root=fixture.state,
                    force=True,
                )
            self.assertFalse(old_marker.exists())
            final_dir = fixture.processed / "20260630_200504"
            summary_path = final_dir / "20260630_200504_session-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            for value in summary["outputs"].values():
                self.assertTrue(str(value).startswith(str(final_dir)))
            self.assertEqual(summary["outputs"]["session_summary_json"], str(summary_path))
            self.assertEqual(inspect_process_state(fixture.processed, "20260630_200504").status, "processed")


class CliSessionCommandTests(unittest.TestCase):
    def run_cli(self, argv: list[str]) -> tuple[int, str, str]:
        stdout = StringIO()
        stderr = StringIO()
        with patch.object(__import__("sys"), "argv", ["goliath", *argv]):
            try:
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    cli_main()
                code = 0
            except SystemExit as exc:
                code = int(exc.code or 0)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_table_listing_succeeds_with_no_sessions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sessions = root / "sessions"
            sessions.mkdir()
            code, stdout, stderr = self.run_cli(["list-sessions", "--sessions-root", str(sessions), "--processed-root", str(root / "processed"), "--state-root", str(root / "state")])
            self.assertEqual(code, 0)
            self.assertIn("SESSION ID", stdout)
            self.assertEqual(stderr, "")

    def test_json_listing_emits_parseable_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = SessionFixture(Path(temp_dir))
            fixture.write_session("20260630_200504")
            code, stdout, stderr = self.run_cli([
                "list-sessions",
                "--json",
                "--sessions-root", str(fixture.sessions),
                "--processed-root", str(fixture.processed),
                "--state-root", str(fixture.state),
            ])
            self.assertEqual(code, 0)
            payload = json.loads(stdout)
            self.assertEqual(payload["schema_version"], "goliath-session-list-v1")
            self.assertEqual(payload["sessions"][0]["session_id"], "20260630_200504")

    def test_expected_user_errors_return_nonzero_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "sessions").mkdir()
            code, stdout, stderr = self.run_cli([
                "process-session-id", "missing",
                "--sessions-root", str(root / "sessions"),
                "--processed-root", str(root / "processed"),
                "--state-root", str(root / "state"),
            ])
            self.assertNotEqual(code, 0)
            self.assertIn("error:", stderr)
            self.assertNotIn("Traceback", stderr)
            self.assertEqual(stdout, "")

    def test_existing_cli_commands_continue_to_parse(self):
        code, stdout, stderr = self.run_cli(["build-reference", "--help"])
        self.assertEqual(code, 0)
        self.assertIn("input_csv", stdout)
        code, stdout, stderr = self.run_cli(["process-session", "--help"])
        self.assertEqual(code, 0)
        self.assertIn("session_dir", stdout)


if __name__ == "__main__":
    unittest.main()