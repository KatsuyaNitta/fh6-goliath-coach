from __future__ import annotations

import csv
import json
import threading
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from goliath.sessions.model import ManagedProcessingError
from goliath.telemetry.importer import REQUIRED_COLUMNS
from goliath.web.app import ApiError, LocalWebApp, WebConfig
from goliath.web.server import create_server, validate_bind_host


class WebFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.sessions = root / "sessions"
        self.processed = root / "processed"
        self.state = root / "state"
        self.viewer = root / "viewer"
        self.sessions.mkdir()
        self.processed.mkdir()
        self.state.mkdir()
        self.viewer.mkdir()

    def config(self, *, api_only: bool = True) -> WebConfig:
        return WebConfig(
            sessions_root=self.sessions,
            processed_root=self.processed,
            state_root=self.state,
            vehicle_catalog_dir=self.root / "catalog",
            reference_csv=self.root / "reference.csv",
            viewer_root=self.viewer,
            api_only=api_only,
        )

    def write_session(self, session_id: str = "20260630_200504", *, complete: bool = True, ignored: bool = False) -> Path:
        session_dir = self.sessions / session_id
        session_dir.mkdir()
        self._write_csv(session_dir / f"{session_id}_telemetry.csv")
        metadata = {
            "session_id": session_id,
            "recording_complete": complete,
            "recording_state": "completed" if complete else "recording",
            "started_at": "2026-06-30T20:05:04+09:00",
            "ended_at": "2026-06-30T20:06:54+09:00",
            "saved_packets": 1,
            "vehicle": {"car_ordinal": 2363, "car_performance_index": 900},
        }
        (session_dir / f"{session_id}_session.json").write_text(json.dumps(metadata), encoding="utf-8")
        if ignored:
            self.state.mkdir(exist_ok=True)
            (self.state / f"{session_id}.json").write_text(
                json.dumps({"schema_version": "goliath-session-state-v1", "session_id": session_id, "status": "ignored"}),
                encoding="utf-8",
            )
        return session_dir

    def write_processed(self, session_id: str = "20260630_200504", *, malicious: bool = False) -> Path:
        output_dir = self.processed / session_id
        output_dir.mkdir(parents=True, exist_ok=True)
        projected = output_dir / f"{session_id}_projected-lap.csv"
        rewind = output_dir / f"{session_id}_rewind-analysis.json"
        summary = output_dir / f"{session_id}_session-summary.json"
        projected.write_text("source_row_index,timestamp_s,lap_time_s,course_distance_m,section_id,projection_error_m,telemetry_display_x,telemetry_display_y,telemetry_display_z,speed_kmh,manual_marker_id,exclude_from_driving_analysis\n2,0,0,0,S1,0,0,0,0,100,,False\n", encoding="utf-8")
        rewind.write_text("{}", encoding="utf-8")
        outside = self.root / "outside_projected-lap.csv"
        outside.write_text("outside", encoding="utf-8")
        payload = {
            "schema_version": "goliath-processed-session-v1",
            "session_id": session_id,
            "outputs": {
                "session_summary_json": str(summary),
                "projected_lap_csv": str(outside if malicious else projected),
                "rewind_analysis_json": str(rewind),
            },
        }
        summary.write_text(json.dumps(payload), encoding="utf-8")
        return output_dir

    def write_viewer(self) -> None:
        (self.viewer / "index.html").write_text("<html><script src='/assets/app.js'></script></html>", encoding="utf-8")
        assets = self.viewer / "assets"
        assets.mkdir()
        (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")

    def _write_csv(self, path: Path) -> None:
        fieldnames = [*REQUIRED_COLUMNS, "car_ordinal", "car_performance_index"]
        row = {column: 1 for column in REQUIRED_COLUMNS}
        row.update({"lap_number": 1, "handbrake_raw": 0, "handbrake_pct": 0, "car_ordinal": 2363, "car_performance_index": 900})
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerow(row)


def fake_processed_summary(output_root: Path, session_id: str) -> dict[str, object]:
    output_dir = output_root / session_id
    output_dir.mkdir(parents=True, exist_ok=True)
    projected = output_dir / f"{session_id}_projected-lap.csv"
    rewind = output_dir / f"{session_id}_rewind-analysis.json"
    summary = output_dir / f"{session_id}_session-summary.json"
    projected.write_text("source_row_index\n", encoding="utf-8")
    rewind.write_text("{}", encoding="utf-8")
    payload = {
        "schema_version": "goliath-processed-session-v1",
        "session_id": session_id,
        "vehicle": {"display_name": "Car 2363"},
        "completed_lap": {"completed_lap_time_s": 1.0},
        "rewind_summary": {"rewind_event_count": 0},
        "outputs": {
            "session_summary_json": str(summary),
            "projected_lap_csv": str(projected),
            "rewind_analysis_json": str(rewind),
        },
    }
    summary.write_text(json.dumps(payload), encoding="utf-8")
    return payload


class RunningServer:
    def __init__(self, config: WebConfig):
        self.server = create_server(config, host="127.0.0.1", port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, path: str, *, method: str = "GET", body: bytes | None = None, headers: dict[str, str] | None = None):
        request = Request(self.base_url + path, data=body, method=method, headers=headers or {})
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, dict(response.headers), response.read()
        except HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()


class LocalWebAppTests(unittest.TestCase):
    def test_health_and_session_list_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session()
            app = LocalWebApp(fixture.config())
            self.assertEqual(app.health_payload()["status"], "ok")
            payload = app.list_sessions_payload()
            self.assertEqual(payload["schema_version"], "goliath-session-list-v1")
            self.assertEqual(len(payload["sessions"]), 1)

    def test_filtering_and_include_flags(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session("20260630_200500", complete=False)
            fixture.write_session("20260630_200501", ignored=True)
            app = LocalWebApp(fixture.config())
            self.assertEqual(app.list_sessions_payload()["sessions"], [])
            self.assertEqual(len(app.list_sessions_payload(include_incomplete=True, include_ignored=True)["sessions"]), 2)

    def test_projected_lap_path_requires_processed_state_and_stays_confined(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            app = LocalWebApp(fixture.config())
            with self.assertRaises(ApiError):
                app.projected_lap_path("20260630_200504")
            fixture.write_processed()
            self.assertTrue(app.projected_lap_path("20260630_200504").name.endswith("_projected-lap.csv"))
            fixture.write_processed("20260630_200505", malicious=True)
            with self.assertRaises(ApiError):
                app.projected_lap_path("20260630_200505")


class LocalWebHttpTests(unittest.TestCase):
    def test_health_endpoint_and_json_headers(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            server = RunningServer(fixture.config())
            try:
                status, headers, raw = server.request("/api/health")
            finally:
                server.close()
            self.assertEqual(status, 200)
            self.assertIn("application/json", headers["Content-Type"])
            self.assertEqual(json.loads(raw)["schema_version"], "goliath-local-web-health-v1")
            self.assertEqual(headers["Cache-Control"], "no-store")

    def test_sessions_endpoint_query_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session(complete=False)
            server = RunningServer(fixture.config())
            try:
                self.assertEqual(json.loads(server.request("/api/sessions")[2])["sessions"], [])
                self.assertEqual(len(json.loads(server.request("/api/sessions?include_incomplete=true")[2])["sessions"]), 1)
                status, _headers, raw = server.request("/api/sessions?include_incomplete=maybe")
            finally:
                server.close()
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(raw)["error"]["code"], "invalid_query")

    def test_projected_lap_streams_csv_and_rejects_bad_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_processed()
            server = RunningServer(fixture.config())
            try:
                status, headers, raw = server.request("/api/sessions/20260630_200504/projected-lap")
                bad_status, _bad_headers, bad_raw = server.request("/api/sessions/..%5Cbad/projected-lap")
            finally:
                server.close()
            self.assertEqual(status, 200)
            self.assertIn("text/csv", headers["Content-Type"])
            self.assertIn("X-Goliath-Filename", headers)
            self.assertIn(b"source_row_index", raw)
            self.assertEqual(bad_status, 400)
            self.assertEqual(json.loads(bad_raw)["error"]["code"], "invalid_request")

    def test_process_endpoint_success_errors_and_lock_release(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session()
            server = RunningServer(fixture.config())

            def fake_process(session_id, **kwargs):
                summary = fake_processed_summary(Path(kwargs["processed_root"]) / ".staging" / "run", session_id)
                final = Path(kwargs["processed_root"]) / session_id
                source = Path(kwargs["processed_root"]) / ".staging" / "run" / session_id
                final.parent.mkdir(parents=True, exist_ok=True)
                source.rename(final)
                return type("Result", (), {"session_id": session_id, "summary": summary, "final_dir": final, "staging_dir": source})()

            try:
                with patch("goliath.web.app.process_managed_session", side_effect=fake_process):
                    status, _headers, raw = server.request("/api/sessions/20260630_200504/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(raw)["status"], "processed")
                server.server.app._processing_lock.acquire()
                busy_status, _busy_headers, busy_raw = server.request("/api/sessions/20260630_200504/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                server.server.app._processing_lock.release()
                self.assertEqual(busy_status, 409)
                self.assertEqual(json.loads(busy_raw)["error"]["code"], "processing_busy")
            finally:
                server.close()

    def test_process_endpoint_body_errors_and_expected_mappings(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session("20260630_200500", complete=False)
            fixture.write_session("20260630_200501", ignored=True)
            fixture.write_processed("20260630_200502")
            fixture.write_session("20260630_200502")
            server = RunningServer(fixture.config())
            try:
                too_large = server.request("/api/sessions/20260630_200500/process", method="POST", body=b"{" + (b"x" * 17000), headers={"Content-Type": "application/json"})
                malformed = server.request("/api/sessions/20260630_200500/process", method="POST", body=b"{bad", headers={"Content-Type": "application/json"})
                unsupported = server.request("/api/sessions/20260630_200500/process", method="POST", body=b"{}", headers={"Content-Type": "text/plain"})
                ignored = server.request("/api/sessions/20260630_200501/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                not_processable = server.request("/api/sessions/20260630_200500/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                already = server.request("/api/sessions/20260630_200502/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                missing = server.request("/api/sessions/20260630_999999/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
            finally:
                server.close()
            self.assertEqual(too_large[0], 400)
            self.assertEqual(malformed[0], 400)
            self.assertEqual(unsupported[0], 400)
            self.assertEqual(ignored[0], 409)
            self.assertEqual(not_processable[0], 422)
            self.assertEqual(already[0], 409)
            self.assertEqual(missing[0], 404)

    def test_processing_lock_releases_after_exception(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_session()
            server = RunningServer(fixture.config())
            try:
                with patch("goliath.web.app.process_managed_session", side_effect=ManagedProcessingError("boom")):
                    status, _headers, _raw = server.request("/api/sessions/20260630_200504/process", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
                self.assertEqual(status, 422)
                self.assertFalse(server.server.app._processing_lock.locked())
            finally:
                server.close()

    def test_unsupported_method_unknown_api_and_static_serving(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            fixture.write_viewer()
            server = RunningServer(fixture.config(api_only=False))
            try:
                home = server.request("/")
                asset = server.request("/assets/app.js")
                route = server.request("/some/frontend/route")
                traversal = server.request("/../data/local/file")
                data_path = server.request("/data/local/sessions/20260630_200504/source.csv")
                api_missing = server.request("/api/nope")
                put_status, _put_headers, put_raw = server.request("/api/health", method="PUT")
            finally:
                server.close()
            self.assertEqual(home[0], 200)
            self.assertEqual(asset[0], 200)
            self.assertEqual(route[0], 200)
            self.assertEqual(traversal[0], 404)
            self.assertEqual(data_path[0], 404)
            self.assertEqual(api_missing[0], 404)
            self.assertEqual(put_status, 405)
            self.assertEqual(json.loads(put_raw)["error"]["code"], "method_not_allowed")

    def test_api_only_static_disabled_and_bind_host_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = WebFixture(Path(temp))
            server = RunningServer(fixture.config(api_only=True))
            try:
                status, _headers, _raw = server.request("/")
            finally:
                server.close()
            self.assertEqual(status, 404)
            validate_bind_host("127.0.0.1", allow_remote=False)
            with self.assertRaises(ValueError):
                validate_bind_host("0.0.0.0", allow_remote=False)
            validate_bind_host("0.0.0.0", allow_remote=True)


if __name__ == "__main__":
    unittest.main()