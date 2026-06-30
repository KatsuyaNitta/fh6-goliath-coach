export interface ApiErrorPayload {
  schema_version: "goliath-local-web-error-v1";
  error: {
    code: string;
    message: string;
  };
}

export interface SessionVehicle {
  display_name: string;
  car_ordinal: number | null;
  car_class: number | null;
  car_performance_index: number | null;
  drive_train: number | null;
  car_group: number | null;
  num_cylinders: number | null;
  identification_source: string | null;
  catalog_sha256: string | null;
}

export interface SessionRecord {
  session_id: string;
  source_status: string;
  process_status: string;
  recording_complete: boolean | null;
  recording_state: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  received_packets: number | null;
  saved_packets: number | null;
  ignored_off_packets: number | null;
  vehicle: SessionVehicle;
  ignored_reason: string | null;
  warnings: string[];
  errors: string[];
}

export interface SessionListPayload {
  schema_version: "goliath-session-list-v1";
  sessions_root: string;
  processed_root: string;
  state_root: string;
  sessions: SessionRecord[];
}

export interface ProcessSessionResult {
  schema_version: "goliath-session-action-v1";
  session_id: string;
  status: "processed";
  session: SessionRecord | null;
  summary: Record<string, unknown>;
}

export interface FetchSessionsOptions {
  includeIgnored?: boolean;
  includeIncomplete?: boolean;
  includeInvalid?: boolean;
}

export interface ProjectedLapCsvResponse {
  text: string;
  fileName: string;
}

export class SessionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "SessionApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchSessions(options: FetchSessionsOptions = {}): Promise<SessionListPayload> {
  const params = new URLSearchParams();
  if (options.includeIgnored) {
    params.set("include_ignored", "true");
  }
  if (options.includeIncomplete) {
    params.set("include_incomplete", "true");
  }
  if (options.includeInvalid) {
    params.set("include_invalid", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const payload = await fetchJson(`/api/sessions${suffix}`);
  return assertSessionListPayload(payload);
}

export async function processSession(sessionId: string): Promise<ProcessSessionResult> {
  const payload = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return assertProcessSessionResult(payload);
}

export async function fetchProjectedLapCsv(sessionId: string): Promise<ProjectedLapCsvResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/projected-lap`, {
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const text = await response.text();
  return {
    text,
    fileName: projectedLapFileName(response.headers, sessionId),
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return parseJsonResponse(response);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new SessionApiError(`Expected JSON response, received ${contentType || "unknown content type"}.`, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new SessionApiError(error instanceof Error ? error.message : "Failed to parse JSON response.", response.status);
  }
}

async function errorFromResponse(response: Response): Promise<SessionApiError> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = assertApiErrorPayload(await response.json());
      return new SessionApiError(payload.error.message, response.status, payload.error.code);
    } catch (error) {
      if (error instanceof SessionApiError) {
        return error;
      }
      return new SessionApiError(error instanceof Error ? error.message : "API request failed.", response.status);
    }
  }
  const text = await response.text().catch(() => "");
  return new SessionApiError(text.trim() || `API request failed with HTTP ${response.status}.`, response.status);
}

function assertSessionListPayload(payload: unknown): SessionListPayload {
  if (!isRecord(payload) || payload.schema_version !== "goliath-session-list-v1" || !Array.isArray(payload.sessions)) {
    throw new SessionApiError("Invalid session-list response schema.", 200, "invalid_schema");
  }
  return payload as unknown as SessionListPayload;
}

function assertProcessSessionResult(payload: unknown): ProcessSessionResult {
  if (!isRecord(payload) || payload.schema_version !== "goliath-session-action-v1" || payload.status !== "processed" || typeof payload.session_id !== "string") {
    throw new SessionApiError("Invalid process-session response schema.", 200, "invalid_schema");
  }
  return payload as unknown as ProcessSessionResult;
}

function assertApiErrorPayload(payload: unknown): ApiErrorPayload {
  if (!isRecord(payload) || payload.schema_version !== "goliath-local-web-error-v1" || !isRecord(payload.error)) {
    throw new SessionApiError("Invalid error response schema.", 500, "invalid_error_schema");
  }
  const code = payload.error.code;
  const message = payload.error.message;
  if (typeof code !== "string" || typeof message !== "string") {
    throw new SessionApiError("Invalid error response schema.", 500, "invalid_error_schema");
  }
  return payload as unknown as ApiErrorPayload;
}

function projectedLapFileName(headers: Headers, sessionId: string): string {
  const explicit = safeFileName(headers.get("X-Goliath-Filename"));
  if (explicit) {
    return explicit;
  }
  const disposition = headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fromDisposition = safeFileName(match?.[1]);
  return fromDisposition || `${sessionId}_projected-lap.csv`;
}

function safeFileName(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  return trimmed.endsWith(".csv") ? trimmed : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
