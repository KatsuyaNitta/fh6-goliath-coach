import { useEffect, useMemo, useState } from "react";
import { fetchProjectedLapCsv, fetchSessions, processSession, SessionApiError, type SessionRecord } from "../lib/sessionApi";
import { parseProjectedLapCsv, type ProjectedLapPayload } from "../lib/telemetryLap";

interface SessionBrowserPanelProps {
  loadedSessionId: string;
  onLoadProjectedLap: (payload: ProjectedLapPayload, sessionId: string) => void;
}

type ActionKind = "load" | "process" | "disabled";

export function SessionBrowserPanel({ loadedSessionId, onLoadProjectedLap }: SessionBrowserPanelProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [actionSessionId, setActionSessionId] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  const selectedSession = useMemo(() => {
    return sessions.find((session) => session.session_id === selectedSessionId);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    void refreshSessions();
  }, [showIgnored]);

  async function refreshSessions(): Promise<void> {
    setLoadingList(true);
    setErrorText("");
    try {
      const payload = await fetchSessions({ includeIgnored: showIgnored });
      setSessions(payload.sessions);
      setStatusText(`Found ${payload.sessions.length} local session${payload.sessions.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setErrorText(apiMessage(error, "Local session service unavailable."));
      setStatusText("");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadProcessedSession(sessionId: string): Promise<void> {
    setActionSessionId(sessionId);
    setErrorText("");
    setStatusText("Loading projected lap...");
    try {
      const csv = await fetchProjectedLapCsv(sessionId);
      const parsed = parseProjectedLapCsv(csv.text, csv.fileName);
      onLoadProjectedLap(parsed, sessionId);
      setStatusText(`Loaded ${sessionId}.`);
    } catch (error) {
      setErrorText(apiMessage(error, "Failed to load processed projected lap."));
      setStatusText("");
    } finally {
      setActionSessionId("");
    }
  }

  async function processAndLoad(sessionId: string): Promise<void> {
    setActionSessionId(sessionId);
    setErrorText("");
    setStatusText("Processing...");
    try {
      await processSession(sessionId);
      await refreshSessions();
      await loadProcessedSession(sessionId);
    } catch (error) {
      setErrorText(apiMessage(error, "Failed to process selected session."));
      setStatusText("");
      setActionSessionId("");
    }
  }

  const action = selectedSession ? actionForSession(selectedSession) : "disabled";
  const busy = Boolean(actionSessionId);

  return (
    <section className="session-browser-panel">
      <div className="panel-heading">
        <h2>Local Sessions</h2>
        <p>Selecting a session does not replace the loaded telemetry.</p>
      </div>
      <div className="session-browser-actions">
        <button className="command-button" disabled={loadingList || busy} type="button" onClick={() => void refreshSessions()}>
          {loadingList ? "Refreshing..." : "Refresh"}
        </button>
        <label className="context-toggle compact-toggle">
          <input checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} type="checkbox" />
          Show ignored
        </label>
        <button className="command-button" disabled={!statusText && !errorText} type="button" onClick={() => { setStatusText(""); setErrorText(""); }}>
          Clear
        </button>
      </div>
      {errorText ? <p className="status-text error-text">{errorText}</p> : null}
      {statusText ? <p className="status-text">{statusText}</p> : null}
      <div className="session-card-list" aria-label="Local telemetry sessions">
        {sessions.length === 0 && !loadingList ? <p className="status-text">No local sessions found.</p> : null}
        {sessions.map((session) => (
          <button
            className={sessionCardClass(session, selectedSessionId, loadedSessionId)}
            key={session.session_id}
            type="button"
            onClick={() => setSelectedSessionId(session.session_id)}
          >
            <span className="session-card-title">{session.vehicle.display_name || "Unknown vehicle"}</span>
            <span className="session-card-id">{session.session_id}</span>
            <span className="session-card-meta">{formatStarted(session.started_at)} - PI {session.vehicle.car_performance_index ?? "?"}</span>
            <span className="session-card-meta">{formatDuration(session.duration_s)} - {session.saved_packets ?? 0} packets</span>
            <span className="session-badge-row">
              <StatusBadge label={session.source_status} />
              <StatusBadge label={session.process_status} />
              {session.session_id === loadedSessionId ? <StatusBadge label="loaded" /> : null}
            </span>
          </button>
        ))}
      </div>
      {selectedSession ? (
        <div className="session-action-panel">
          <b>{selectedSession.session_id}</b>
          <p className="status-text">{actionHelp(selectedSession)}</p>
          {action === "process" ? (
            <button className="command-button" disabled={busy} type="button" onClick={() => void processAndLoad(selectedSession.session_id)}>
              {actionSessionId === selectedSession.session_id ? "Processing..." : "Process & Load"}
            </button>
          ) : null}
          {action === "load" ? (
            <button className="command-button" disabled={busy} type="button" onClick={() => void loadProcessedSession(selectedSession.session_id)}>
              {actionSessionId === selectedSession.session_id ? "Loading..." : "Load"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function actionForSession(session: SessionRecord): ActionKind {
  if (session.process_status === "processed") {
    return "load";
  }
  if (session.process_status === "unprocessed" && ["completed", "legacy-ready"].includes(session.source_status)) {
    return "process";
  }
  return "disabled";
}

function actionHelp(session: SessionRecord): string {
  if (session.process_status === "processed") {
    return "Processed output is ready for browser loading.";
  }
  if (session.process_status === "unprocessed" && ["completed", "legacy-ready"].includes(session.source_status)) {
    return "This completed local session can be processed and loaded.";
  }
  if (session.process_status === "partial") {
    return "Partial processed output needs CLI inspection before loading.";
  }
  if (session.process_status === "ignored") {
    return session.ignored_reason || "Ignored sessions are not processed from the browser.";
  }
  if (session.source_status === "incomplete") {
    return "Incomplete recordings cannot be processed yet.";
  }
  if (session.source_status === "invalid") {
    return session.errors[0] || "Invalid session source files.";
  }
  return "No browser action is available for this session.";
}

function sessionCardClass(session: SessionRecord, selectedSessionId: string, loadedSessionId: string): string {
  const classes = ["session-card"];
  if (session.session_id === selectedSessionId) {
    classes.push("selected");
  }
  if (session.session_id === loadedSessionId) {
    classes.push("loaded");
  }
  return classes.join(" ");
}

function StatusBadge({ label }: { label: string }) {
  return <span className={`status-badge status-${label.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`}>{label}</span>;
}

function formatStarted(value: string | null): string {
  if (!value) {
    return "Unknown start";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "Unknown duration";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof SessionApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
