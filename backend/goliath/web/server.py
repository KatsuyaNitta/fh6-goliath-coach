from __future__ import annotations

import ipaddress
import json
import mimetypes
import socket
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from goliath.sessions.state import validate_session_id
from goliath.web.app import ApiError, LocalWebApp, WebConfig, error_payload, parse_bool_query, parse_json_body


class LocalGoliathServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, server_address, RequestHandlerClass, app: LocalWebApp):
        super().__init__(server_address, RequestHandlerClass)
        self.app = app


def build_handler(app: LocalWebApp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "GoliathLocalWeb/1.0"

        def do_GET(self) -> None:
            self._handle_get()

        def do_POST(self) -> None:
            self._handle_post()

        def do_PUT(self) -> None:
            self._json_error(405, "method_not_allowed", "Unsupported method.")

        def do_DELETE(self) -> None:
            self._json_error(405, "method_not_allowed", "Unsupported method.")

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            return

        def _handle_get(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self._handle_api_get(parsed.path, parsed.query)
                return
            self._serve_static(parsed.path)

        def _handle_post(self) -> None:
            parsed = urlparse(self.path)
            if not parsed.path.startswith("/api/"):
                self._json_error(404, "not_found", "Endpoint not found.")
                return
            try:
                body_length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                self._json_error(400, "invalid_request", "Invalid Content-Length.")
                return
            if body_length > 16 * 1024:
                self._json_error(400, "body_too_large", "Request body is too large.")
                return
            body = self.rfile.read(body_length) if body_length else b""
            try:
                parse_json_body(body, self.headers.get("Content-Type"))
                session_id = self._extract_session_action(parsed.path, "process")
                payload = app.process_session_payload(session_id)
            except ApiError as exc:
                self._json_error(exc.status, exc.code, exc.message)
                return
            self._json_response(200, payload)

        def _handle_api_get(self, path: str, query: str) -> None:
            try:
                if path == "/api/health":
                    self._json_response(200, app.health_payload())
                    return
                if path == "/api/sessions":
                    options = _parse_session_query(query)
                    self._json_response(200, app.list_sessions_payload(**options))
                    return
                if path.endswith("/projected-lap"):
                    session_id = self._extract_session_action(path, "projected-lap")
                    self._send_projected_lap(session_id)
                    return
                self._json_error(404, "not_found", "API endpoint not found.")
            except ApiError as exc:
                self._json_error(exc.status, exc.code, exc.message)
            except ValueError as exc:
                self._json_error(400, "invalid_request", str(exc))
            except Exception:
                self._json_error(500, "internal_error", "Unexpected internal error.")

        def _extract_session_action(self, path: str, action: str) -> str:
            prefix = "/api/sessions/"
            suffix = f"/{action}"
            if not path.startswith(prefix) or not path.endswith(suffix):
                raise ApiError(404, "not_found", "API endpoint not found.")
            encoded = path[len(prefix):-len(suffix)]
            if not encoded:
                raise ApiError(400, "invalid_session_id", "Missing session ID.")
            return validate_session_id(unquote(encoded))

        def _send_projected_lap(self, session_id: str) -> None:
            path = app.projected_lap_path(session_id)
            filename = path.name
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'inline; filename="{filename}"')
            self.send_header("X-Goliath-Filename", filename)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.end_headers()
            with path.open("rb") as file:
                while True:
                    chunk = file.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        def _serve_static(self, raw_path: str) -> None:
            if app.config.api_only:
                self._json_error(404, "not_found", "Static viewer serving is disabled in api-only mode.")
                return
            viewer_root = app.config.viewer_root.resolve()
            safe_path = _resolve_static_path(viewer_root, raw_path)
            if safe_path is None:
                self._json_error(404, "not_found", "Static path not found.")
                return
            content_type = mimetypes.guess_type(str(safe_path))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(safe_path.stat().st_size))
            self.end_headers()
            with safe_path.open("rb") as file:
                self.wfile.write(file.read())

        def _json_response(self, status: int, payload: object) -> None:
            raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _json_error(self, status: int, code: str, message: str) -> None:
            self._json_response(status, error_payload(code, message))

    return Handler


def create_server(config: WebConfig, *, host: str = "127.0.0.1", port: int = 8765, allow_remote: bool = False) -> LocalGoliathServer:
    validate_bind_host(host, allow_remote=allow_remote)
    app = LocalWebApp(config)
    handler = build_handler(app)
    return LocalGoliathServer((host, port), handler, app)


def serve(config: WebConfig, *, host: str = "127.0.0.1", port: int = 8765, allow_remote: bool = False, open_browser: bool = False) -> None:
    if not config.api_only:
        index = Path(config.viewer_root) / "index.html"
        if not index.exists():
            raise SystemExit(f"viewer build not found at {index}. Run: Set-Location viewer; pnpm run build")
    server = create_server(config, host=host, port=port, allow_remote=allow_remote)
    url = f"http://{server.server_address[0]}:{server.server_address[1]}/"
    if allow_remote:
        print("WARNING: remote binding is enabled. Only use this on trusted networks.")
    print(f"Goliath local web service: {url}")
    print(f"sessions root: {config.sessions_root}")
    print(f"processed root: {config.processed_root}")
    print(f"state root: {config.state_root}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Goliath local web service.")
    finally:
        server.server_close()


def validate_bind_host(host: str, *, allow_remote: bool) -> None:
    if allow_remote:
        return
    if host in {"localhost", "127.0.0.1", "::1"}:
        return
    try:
        addresses = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve host {host!r}: {exc}") from exc
    for family, _type, _proto, _canon, sockaddr in addresses:
        address = sockaddr[0]
        try:
            if not ipaddress.ip_address(address).is_loopback:
                raise ValueError(f"Refusing non-loopback host {host!r}; pass --allow-remote explicitly to bind remotely.")
        except ValueError as exc:
            if "Refusing" in str(exc):
                raise
            raise ValueError(f"Could not validate host {host!r}: {exc}") from exc


def _parse_session_query(query: str) -> dict[str, bool]:
    parsed = parse_qs(query, keep_blank_values=True)
    allowed = {"include_incomplete", "include_invalid", "include_ignored"}
    options = {"include_incomplete": False, "include_invalid": False, "include_ignored": False}
    for key, values in parsed.items():
        if key not in allowed:
            raise ApiError(400, "invalid_query", f"Unsupported query parameter: {key}")
        if len(values) != 1:
            raise ApiError(400, "invalid_query", f"Query parameter {key} must appear once.")
        options[key] = parse_bool_query(values[0], key)
    return options


def _resolve_static_path(viewer_root: Path, raw_path: str) -> Path | None:
    if raw_path.startswith("/api/"):
        return None
    decoded = unquote(raw_path.split("?", 1)[0])
    relative = decoded.lstrip("/")
    first_segment = relative.split("/", 1)[0].lower()
    if first_segment in {"data", "backend", "tests", ".git", ".venv"}:
        return None
    if relative == "":
        relative = "index.html"
    candidate = (viewer_root / relative).resolve()
    if not _is_relative_to(candidate, viewer_root) or candidate.is_dir():
        return None
    if candidate.exists():
        return candidate
    fallback = (viewer_root / "index.html").resolve()
    return fallback if fallback.exists() else None


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True