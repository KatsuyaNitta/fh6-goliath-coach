import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  const source = await readFile(sourceUrl, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const directory = join(tmpdir(), `fh6-session-api-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const api = await compileModule(new URL("../src/lib/sessionApi.ts", import.meta.url), "sessionApi.mjs");
const sampleSessions = [
  {
    session_id: "20260630_200504",
    source_status: "completed",
    process_status: "processed",
    recording_complete: true,
    recording_state: "completed",
    started_at: "2026-06-30T20:05:04+09:00",
    ended_at: "2026-06-30T20:06:54+09:00",
    duration_s: 110,
    received_packets: 12,
    saved_packets: 10,
    ignored_off_packets: 0,
    vehicle: { display_name: "Car A", car_ordinal: 1, car_class: null, car_performance_index: 900, drive_train: null, car_group: null, num_cylinders: null, identification_source: "fixture", catalog_sha256: null },
    ignored_reason: null,
    warnings: [],
    errors: [],
  },
  {
    session_id: "20260630_005550",
    source_status: "legacy-ready",
    process_status: "unprocessed",
    recording_complete: null,
    recording_state: null,
    started_at: null,
    ended_at: null,
    duration_s: null,
    received_packets: null,
    saved_packets: 8,
    ignored_off_packets: null,
    vehicle: { display_name: "Car B", car_ordinal: 2, car_class: null, car_performance_index: 998, drive_train: null, car_group: null, num_cylinders: null, identification_source: "fixture", catalog_sha256: null },
    ignored_reason: null,
    warnings: [],
    errors: [],
  },
];

let requestedUrl = "";
globalThis.fetch = async (url, init) => {
  requestedUrl = String(url);
  assert.equal(init?.headers?.Accept, "application/json");
  return jsonResponse({
    schema_version: "goliath-session-list-v1",
    sessions_root: "data/local/sessions",
    processed_root: "data/local/processed",
    state_root: "data/local/session-state",
    sessions: sampleSessions,
  });
};
const list = await api.fetchSessions({ includeIgnored: true });
assert.equal(requestedUrl, "/api/sessions?include_ignored=true");
assert.equal(list.sessions[0].session_id, "20260630_200504", "backend order should be preserved");
assert.equal(list.sessions.length, 2);

globalThis.fetch = async () => jsonResponse({ schema_version: "wrong", sessions: [] });
await assert.rejects(api.fetchSessions(), /Invalid session-list response schema/);

globalThis.fetch = async () => jsonResponse({ schema_version: "goliath-local-web-error-v1", error: { code: "already_processed", message: "Already done" } }, 409);
await assert.rejects(api.processSession("20260630_200504"), /Already done/);

globalThis.fetch = async () => new Response("plain failure", { status: 500, headers: { "Content-Type": "text/plain" } });
await assert.rejects(api.fetchProjectedLapCsv("20260630_200504"), /plain failure/);

globalThis.fetch = async (url) => {
  requestedUrl = String(url);
  return new Response("source_row_index\n", {
    status: 200,
    headers: { "Content-Type": "text/csv", "X-Goliath-Filename": "20260630_200504_projected-lap.csv" },
  });
};
const csv = await api.fetchProjectedLapCsv("20260630_200504");
assert.equal(requestedUrl, "/api/sessions/20260630_200504/projected-lap");
assert.equal(csv.fileName, "20260630_200504_projected-lap.csv");

globalThis.fetch = async (url) => {
  requestedUrl = String(url);
  return new Response("source_row_index\n", { status: 200, headers: { "Content-Type": "text/csv" } });
};
const fallbackCsv = await api.fetchProjectedLapCsv("20260630_200504");
assert.equal(fallbackCsv.fileName, "20260630_200504_projected-lap.csv");
await api.fetchProjectedLapCsv("20260630_200504 extra");
assert.equal(requestedUrl, "/api/sessions/20260630_200504%20extra/projected-lap");

const componentSource = await readFile(new URL("../src/components/SessionBrowserPanel.tsx", import.meta.url), "utf-8");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.match(componentSource, /Process & Load/, "browser panel should expose Process & Load");
assert.match(componentSource, /"Load"/, "browser panel should expose Load for processed sessions");
assert.match(appSource, /Load CSV manually/, "manual CSV loading should remain available");
assert.match(componentSource, /Local session service unavailable\./, "service unavailable should be nonfatal and visible");
assert.match(componentSource, /loadedSessionId/, "selected and loaded session state should be separate");
assert.match(componentSource, /parseProjectedLapCsv/, "API-loaded CSV should use the existing parser");
assert.match(componentSource, /catch \(error\)[\s\S]*setErrorText[\s\S]*finally/, "API failure should report an error without clearing parent telemetry");
assert.match(appSource, /const \[elevationScale, setElevationScale\] = useState\(5\)/, "default elevation should remain 5x");
console.log("session API smoke test passed");