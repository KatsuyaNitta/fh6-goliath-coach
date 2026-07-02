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

  const directory = join(tmpdir(), `fh6-ui-text-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const uiTextModule = await compileModule(new URL("../src/lib/uiText.ts", import.meta.url), "uiText.mjs");
const vehicleTuneSource = await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8");
const telemetryLapSource = await readFile(new URL("../src/lib/telemetryLap.ts", import.meta.url), "utf-8");

const {
  CHART_TEXT,
  KEEP_ENGLISH_TEXTS,
  SESSION_STATUS_LABELS,
  TUNE_TEXT,
  UI_TEXT,
  UI_TEXT_CONTRACT,
  uiText,
} = uiTextModule;

assert.equal(UI_TEXT_CONTRACT.length, 157);
assert.equal(new Set(UI_TEXT_CONTRACT.map((entry) => entry.id)).size, 157);
assert.doesNotMatch(JSON.stringify(UI_TEXT_CONTRACT), /Processed output is ready for browser loading|Load a processed projected-lap CSV manually|Load CSV manually|Telemetry Overlay/);

assert.deepEqual([...KEEP_ENGLISH_TEXTS], [
  "FH6 Goliath Coach",
  "3D",
  "2D",
  "Speed",
  "Throttle",
  "Brake",
  "Steering",
  "PI",
  "FWD",
  "RWD",
  "AWD",
]);

for (const english of ["FH6 Goliath Coach", "3D", "2D", "Speed", "Throttle", "Brake", "Steering", "PI", "FWD", "RWD", "AWD"]) {
  const entry = UI_TEXT_CONTRACT.find((candidate) => candidate.english === english);
  assert.equal(entry?.text, english, `${english} must remain English`);
}

assert.equal(SESSION_STATUS_LABELS.partial, "部分出力");
assert.equal(SESSION_STATUS_LABELS.loaded, "読込中");
assert.equal(UI_TEXT.external, "外的要因");
assert.equal(UI_TEXT.driving, "運転ミス");
assert.equal(TUNE_TEXT.pressure, "圧力");
assert.equal(CHART_TEXT.description, "有効走行ラインには置換されていないサンプルを使用します。巻き戻しはイベントマーカーとして残ります。間引きは表示専用で、極値を保持します。");

assert.match(vehicleTuneSource, /power:\s*"PS"/);
assert.match(vehicleTuneSource, /torque:\s*"NM"/);
assert.match(vehicleTuneSource, /weight:\s*"KG"/);
assert.match(vehicleTuneSource, /springRate:\s*"KGF\/MM"/);
assert.match(vehicleTuneSource, /rideHeight:\s*"cm"/);
assert.doesNotMatch(vehicleTuneSource, /N·m|Nm|"kg"|kgf\/mm/);

for (const key of ["power_ps", "torque_nm", "weight_kg", "springs", "ride_height"]) {
  assert.ok(vehicleTuneSource.includes(key), `raw persisted key must remain: ${key}`);
}

const dynamicSession = uiText.loadedSession("20260701_012104");
assert.equal(dynamicSession, "20260701_012104を読込みました。");
assert.equal(uiText.visibleDrawnSamples(1234, 56), "1,234 表示対象サンプル; 56 描画。");
assert.equal(uiText.loadedJson("setup.json"), "setup.jsonを読込みました");

assert.ok(telemetryLapSource.includes("external_impact_suspected"));
assert.ok(telemetryLapSource.includes("driving_error_suspected"));
assert.ok(telemetryLapSource.includes("undetermined"));
assert.ok(telemetryLapSource.includes("UI_TEXT.external"));
assert.ok(telemetryLapSource.includes("UI_TEXT.driving"));

const allUiText = JSON.stringify({
  CHART_TEXT,
  KEEP_ENGLISH_TEXTS,
  SESSION_STATUS_LABELS,
  TUNE_TEXT,
  UI_TEXT,
  UI_TEXT_CONTRACT,
});
assert.doesNotMatch(allUiText, /\uFFFD/);

console.log("ui text smoke test passed");
