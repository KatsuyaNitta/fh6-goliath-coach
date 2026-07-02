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

  const directory = join(tmpdir(), `fh6-vehicle-autofill-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const vehicleTuneSource = await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8");
  await writeFile(
    join(directory, "vehicleTune.mjs"),
    ts.transpileModule(vehicleTuneSource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf-8",
  );
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled.replace('from "./vehicleTune"', 'from "./vehicleTune.mjs"'), "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const autofill = await compileModule(new URL("../src/lib/vehicleAutofill.ts", import.meta.url), "vehicleAutofill.mjs");
const vehicleTune = await compileModule(new URL("../src/lib/vehicleTune.ts", import.meta.url), "vehicleTuneMain.mjs");
const panelSource = await readFile(new URL("../src/components/VehicleTunePanel.tsx", import.meta.url), "utf-8");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
const sessionPanelSource = await readFile(new URL("../src/components/SessionBrowserPanel.tsx", import.meta.url), "utf-8");

assert.deepEqual(autofill.parseVehicleDisplayName("2019 Ferrari Monza SP2"), {
  year: 2019,
  name: "Ferrari Monza SP2",
});
assert.deepEqual(autofill.parseVehicleDisplayName("1995 Porsche 911 GT2"), {
  year: 1995,
  name: "Porsche 911 GT2",
});
assert.deepEqual(autofill.parseVehicleDisplayName("2023 Porsche 911 GT3 RS"), {
  year: 2023,
  name: "Porsche 911 GT3 RS",
});
assert.deepEqual(autofill.parseVehicleDisplayName("Ferrari 512 TR"), { year: null, name: "Ferrari 512 TR" });
assert.equal(autofill.parseVehicleDisplayName(""), null);
assert.deepEqual(autofill.parseVehicleDisplayName("  2019 Ferrari Monza SP2  "), {
  year: 2019,
  name: "Ferrari Monza SP2",
});
assert.deepEqual(autofill.parseVehicleDisplayName("2020 Ford GT 40 Tribute"), {
  year: 2020,
  name: "Ford GT 40 Tribute",
});
assert.deepEqual(autofill.parseVehicleDisplayName("999 Porsche"), { year: null, name: "999 Porsche" });
assert.deepEqual(autofill.parseVehicleDisplayName("20199 Porsche"), { year: null, name: "20199 Porsche" });

let document = vehicleTune.createEmptyVehicleTune();
let sources = { name: "empty", year: "empty" };
let result = autofill.applyTelemetryVehicleDefaults(document, sources, "2019 Ferrari Monza SP2");
assert.equal(result.document.vehicle.name, "Ferrari Monza SP2");
assert.equal(result.document.vehicle.year, 2019);
assert.equal(result.document.vehicle.drivetrain, null);
assert.equal(result.document.tune.differential, null);
assert.deepEqual(result.sources, { name: "telemetry", year: "telemetry" });

result.document.vehicle.name = "Manual Name";
sources = { ...result.sources, name: "manual" };
result = autofill.applyTelemetryVehicleDefaults(result.document, sources, "1995 Porsche 911 GT2");
assert.equal(result.document.vehicle.name, "Manual Name");
assert.equal(result.document.vehicle.year, 1995);
assert.equal(result.document.vehicle.drivetrain, null);
assert.deepEqual(result.sources, { name: "manual", year: "telemetry" });

result.document.vehicle.year = 2001;
sources = { ...result.sources, year: "manual" };
result = autofill.applyTelemetryVehicleDefaults(result.document, sources, "2023 Porsche 911 GT3 RS");
assert.equal(result.document.vehicle.name, "Manual Name");
assert.equal(result.document.vehicle.year, 2001);

document = vehicleTune.createEmptyVehicleTune("RWD");
document.vehicle.name = "JSON Name";
document.vehicle.year = 1987;
result = autofill.applyTelemetryVehicleDefaults(document, { name: "json", year: "json" }, "2019 Ferrari Monza SP2");
assert.equal(result.document.vehicle.name, "JSON Name");
assert.equal(result.document.vehicle.year, 1987);
assert.equal(result.document.vehicle.drivetrain, "RWD");

document = vehicleTune.createEmptyVehicleTune("RWD");
document.vehicle.name = "";
result = autofill.applyTelemetryVehicleDefaults(document, { name: "manual", year: "empty" }, "2019 Ferrari Monza SP2");
assert.equal(result.document.vehicle.name, "");
assert.equal(result.document.vehicle.year, 2019);

assert.equal(vehicleTune.TUNING_UNITS.unitlessGameValue, "");
assert.equal(vehicleTune.TUNING_UNITS.angle, "");
assert.equal(vehicleTune.TUNING_UNITS.power, "PS");
assert.equal(vehicleTune.TUNING_UNITS.torque, "NM");
assert.equal(vehicleTune.TUNING_UNITS.weight, "KG");
assert.equal(vehicleTune.TUNING_UNITS.springRate, "KGF/MM");
assert.equal(vehicleTune.TUNING_UNITS.rideHeight, "cm");
assert.equal(vehicleTune.TUNING_UNITS.tirePressure, "bar");
assert.equal(vehicleTune.TUNING_UNITS.weightDistribution, "%");
assert.equal(vehicleTune.TUNING_UNITS.aeroDownforce, "kgf");
assert.equal(vehicleTune.TUNING_UNITS.percent, "%");

assert.doesNotMatch(panelSource, /unit=\{TUNING_UNITS\.unitlessGameValue\}/);
assert.doesNotMatch(panelSource, /unit=\{TUNING_UNITS\.angle\}/);
assert.match(panelSource, /<NumberField\s+label=\{TUNE_TEXT\.finalDrive\}\s+value=/s);
assert.match(panelSource, /label=\{gear\.replace\("_", " "\)\.toUpperCase\(\)\}\s+value=/s);
assert.match(panelSource, /<AxleSection title=\{TUNE_TEXT\.antiRollBars\} value=/);
assert.match(panelSource, /label=\{TUNE_TEXT\.frontRebound\} value=/);
assert.match(panelSource, /unit\?: string/);
assert.match(panelSource, /\{unit \? <em>\{unit\}<\/em> : null\}/);

for (const key of [
  "front_camber_degrees",
  "rear_camber_degrees",
  "front_toe_degrees",
  "rear_toe_degrees",
  "front_caster_degrees",
  "final_drive",
  "gear_ratios",
  "anti_roll_bars",
  "damping",
]) {
  assert.ok(JSON.stringify(vehicleTune).includes(key) || panelSource.includes(key), `missing persisted key: ${key}`);
}

assert.match(sessionPanelSource, /onLoadProjectedLap\(parsed, sessionId, \{/);
assert.match(sessionPanelSource, /displayName: session\.vehicle\.display_name/);
assert.match(sessionPanelSource, /carOrdinal: session\.vehicle\.car_ordinal/);
assert.match(sessionPanelSource, /async function processAndLoad\(session: SessionRecord\)/);
assert.match(sessionPanelSource, /await loadProcessedSession\(session\)/);
assert.match(sessionPanelSource, /onClick=\{\(\) => setSelectedSessionId\(session\.session_id\)\}/);
assert.doesNotMatch(sessionPanelSource, /setSelectedSessionId\(session\.session_id\)[\s\S]{0,120}onLoadProjectedLap/);
assert.match(appSource, /loadedVehicleMetadata/);
assert.match(appSource, /applyProjectedLap\(parsed, parsed\.sessionId\)/);
assert.doesNotMatch(appSource, /handleProjectedLapFile[\s\S]*setLoadedVehicleMetadata/);

console.log("vehicle autofill smoke test passed");
