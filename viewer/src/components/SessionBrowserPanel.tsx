import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchProjectedLapCsv,
  fetchSessions,
  processSession,
  SessionApiError,
  trashSession,
  type SessionRecord,
} from "../lib/sessionApi";
import { parseProjectedLapCsv, type ProjectedLapPayload } from "../lib/telemetryLap";
import { SESSION_STATUS_LABELS, SESSION_TEXT, uiText } from "../lib/uiText";
import type { LoadedSessionVehicleMetadata } from "../lib/vehicleAutofill";

interface SessionBrowserPanelProps {
  loadedSessionId: string;
  onLoadProjectedLap: (payload: ProjectedLapPayload, sessionId: string, vehicleMetadata?: LoadedSessionVehicleMetadata) => void;
}

type ActionKind = "load" | "process" | "disabled";
const TRASH_ACTION_LABEL = SESSION_TEXT.trashAction;
const TRASH_CANCEL_LABEL = SESSION_TEXT.trashCancel;
const UNKNOWN_STARTED_LABEL = SESSION_TEXT.unknownStart;

export function SessionBrowserPanel({ loadedSessionId, onLoadProjectedLap }: SessionBrowserPanelProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [actionSessionId, setActionSessionId] = useState("");
  const [trashDialogSessionId, setTrashDialogSessionId] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const selectedSession = useMemo(() => {
    return sessions.find((session) => session.session_id === selectedSessionId);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    void refreshSessions();
  }, [showIgnored]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (trashDialogSessionId) {
      if (!dialog.open) {
        dialog.showModal();
      }
      window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
  }, [trashDialogSessionId]);

  async function refreshSessions(): Promise<void> {
    setLoadingList(true);
    setErrorText("");
    try {
      const payload = await fetchSessions({ includeIgnored: showIgnored });
      setSessions(payload.sessions);
      setStatusText(uiText.foundLocalSessions(payload.sessions.length));
    } catch (error) {
      setErrorText(apiMessage(error, SESSION_TEXT.serviceUnavailable));
      setStatusText("");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadProcessedSession(session: SessionRecord): Promise<void> {
    const sessionId = session.session_id;
    setActionSessionId(sessionId);
    setErrorText("");
    setStatusText(SESSION_TEXT.loadingProjectedLap);
    try {
      const csv = await fetchProjectedLapCsv(sessionId);
      const parsed = parseProjectedLapCsv(csv.text, csv.fileName);
      onLoadProjectedLap(parsed, sessionId, {
        displayName: session.vehicle.display_name,
        carOrdinal: session.vehicle.car_ordinal,
        loadId: Date.now(),
      });
      setStatusText(uiText.loadedSession(sessionId));
    } catch (error) {
      setErrorText(apiMessage(error, SESSION_TEXT.failedLoadProjectedLap));
      setStatusText("");
    } finally {
      setActionSessionId("");
    }
  }

  async function processAndLoad(session: SessionRecord): Promise<void> {
    const sessionId = session.session_id;
    setActionSessionId(sessionId);
    setErrorText("");
    setStatusText(SESSION_TEXT.processing);
    try {
      await processSession(sessionId);
      await refreshSessions();
      await loadProcessedSession(session);
    } catch (error) {
      setErrorText(apiMessage(error, SESSION_TEXT.failedProcess));
      setStatusText("");
      setActionSessionId("");
    }
  }

  async function confirmTrashSession(session: SessionRecord): Promise<void> {
    setActionSessionId(session.session_id);
    setErrorText("");
    setStatusText(SESSION_TEXT.trashProgress);
    try {
      await trashSession(session.session_id);
      setTrashDialogSessionId("");
      setSelectedSessionId("");
      await refreshSessions();
      setStatusText(SESSION_TEXT.trashMoved(session.session_id));
    } catch (error) {
      setErrorText(apiMessage(error, SESSION_TEXT.trashFailed));
      setStatusText("");
    } finally {
      setActionSessionId("");
    }
  }

  const action = selectedSession ? actionForSession(selectedSession) : "disabled";
  const busy = Boolean(actionSessionId);
  const trashAvailable = selectedSession ? canTrashSession(selectedSession, loadedSessionId, busy) : false;
  const trashHelp = selectedSession ? trashAvailabilityText(selectedSession, loadedSessionId, busy) : "";
  const dialogSession = sessions.find((session) => session.session_id === trashDialogSessionId);

  return (
    <section className="session-browser-panel">
      <div className="panel-heading">
        <h2>{SESSION_TEXT.title}</h2>
        <p>{SESSION_TEXT.description}</p>
      </div>
      <div className="session-browser-actions">
        <button className="command-button" disabled={loadingList || busy} type="button" onClick={() => void refreshSessions()}>
          {loadingList ? SESSION_TEXT.refreshing : SESSION_TEXT.refresh}
        </button>
        <label className="context-toggle compact-toggle">
          <input checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} type="checkbox" />
          {SESSION_TEXT.showIgnored}
        </label>
        <button className="command-button" disabled={!statusText && !errorText} type="button" onClick={() => { setStatusText(""); setErrorText(""); }}>
          {SESSION_TEXT.clear}
        </button>
      </div>
      {errorText ? <p className="status-text error-text">{errorText}</p> : null}
      {statusText ? <p className="status-text">{statusText}</p> : null}
      <div className="session-card-list" aria-label={SESSION_TEXT.listLabel}>
        {sessions.length === 0 && !loadingList ? <p className="status-text">{SESSION_TEXT.noSessions}</p> : null}
        {sessions.map((session) => (
          <button
            className={sessionCardClass(session, selectedSessionId, loadedSessionId)}
            key={session.session_id}
            type="button"
            onClick={() => setSelectedSessionId(session.session_id)}
          >
            <span className="session-card-title">{session.vehicle.display_name || SESSION_TEXT.unknownVehicle}</span>
            <span className="session-card-id">{session.session_id}</span>
            <span className="session-card-meta">{formatStarted(session.started_at)} - PI {session.vehicle.car_performance_index ?? "?"}</span>
            <span className="session-card-meta">{formatDuration(session.duration_s)} - {session.saved_packets ?? 0} {SESSION_TEXT.packets}</span>
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
            <button className="command-button" disabled={busy} type="button" onClick={() => void processAndLoad(selectedSession)}>
              {actionSessionId === selectedSession.session_id ? SESSION_TEXT.processing : SESSION_TEXT.processAndLoad}
            </button>
          ) : null}
          {action === "load" ? (
            <button className="command-button" disabled={busy} type="button" onClick={() => void loadProcessedSession(selectedSession)}>
              {actionSessionId === selectedSession.session_id ? SESSION_TEXT.loading : SESSION_TEXT.load}
            </button>
          ) : null}
          {trashHelp ? <p className="status-text">{trashHelp}</p> : null}
          {trashAvailable ? (
            <button className="command-button danger-button" disabled={busy} type="button" onClick={() => setTrashDialogSessionId(selectedSession.session_id)}>
              {TRASH_ACTION_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="trash-session-dialog-title"
        className="danger-dialog"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) {
            setTrashDialogSessionId("");
          }
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current && !busy) {
            setTrashDialogSessionId("");
          }
        }}
      >
        {dialogSession ? (
          <form method="dialog" onSubmit={(event) => event.preventDefault()}>
            <h2 id="trash-session-dialog-title">{SESSION_TEXT.trashTitle}</h2>
            <dl className="dialog-details">
              <div>
                <dt>車両</dt>
                <dd>{dialogSession.vehicle.display_name || SESSION_TEXT.unknownVehicle}</dd>
              </div>
              <div>
                <dt>セッション</dt>
                <dd>{dialogSession.session_id}</dd>
              </div>
              <div>
                <dt>{SESSION_TEXT.started}</dt>
                <dd>{formatStarted(dialogSession.started_at, UNKNOWN_STARTED_LABEL)}</dd>
              </div>
            </dl>
            <p>{SESSION_TEXT.trashConfirm}</p>
            <p className="status-text">{SESSION_TEXT.trashHelp}</p>
            <div className="dialog-actions">
              <button ref={cancelButtonRef} className="command-button" disabled={busy} type="button" onClick={() => setTrashDialogSessionId("")}>
                {TRASH_CANCEL_LABEL}
              </button>
              <button className="command-button danger-button" disabled={busy} type="button" onClick={() => void confirmTrashSession(dialogSession)}>
                {actionSessionId === dialogSession.session_id ? SESSION_TEXT.trashMoving : TRASH_ACTION_LABEL}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
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
    return SESSION_TEXT.actionReady;
  }
  if (session.process_status === "unprocessed" && ["completed", "legacy-ready"].includes(session.source_status)) {
    return SESSION_TEXT.actionProcess;
  }
  if (session.process_status === "partial") {
    return SESSION_TEXT.actionPartial;
  }
  if (session.process_status === "ignored") {
    return session.ignored_reason || SESSION_TEXT.actionIgnored;
  }
  if (session.source_status === "incomplete") {
    return SESSION_TEXT.actionIncomplete;
  }
  if (session.source_status === "invalid") {
    return session.errors[0] || SESSION_TEXT.actionInvalid;
  }
  return SESSION_TEXT.actionUnavailable;
}

function canTrashSession(session: SessionRecord, loadedSessionId: string, busy: boolean): boolean {
  return !busy && session.session_id !== loadedSessionId && ["unprocessed", "ignored"].includes(session.process_status);
}

function trashAvailabilityText(session: SessionRecord, loadedSessionId: string, busy: boolean): string {
  if (busy) {
    return SESSION_TEXT.busy;
  }
  if (session.session_id === loadedSessionId) {
    return SESSION_TEXT.loadedCannotTrash;
  }
  if (session.process_status === "processed") {
    return SESSION_TEXT.processedProtected;
  }
  if (session.process_status === "partial") {
    return SESSION_TEXT.partialTrashBlocked;
  }
  if (["unprocessed", "ignored"].includes(session.process_status)) {
    return SESSION_TEXT.trashEligible;
  }
  return "";
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
  return <span className={`status-badge status-${label.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`}>{SESSION_STATUS_LABELS[label] ?? label}</span>;
}

function formatStarted(value: string | null, fallback = SESSION_TEXT.unknownStart): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return SESSION_TEXT.unknownDuration;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof SessionApiError) {
    return error.message ? `${fallback} Technical details: ${error.message}` : fallback;
  }
  if (error instanceof Error) {
    return `${fallback} Technical details: ${error.message}`;
  }
  return fallback;
}
