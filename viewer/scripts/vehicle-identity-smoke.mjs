import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  const source = await readFile(sourceUrl, "utf-8");
  const directory = join(tmpdir(), `fh6-vehicle-identity-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "vehicleTune.mjs"),
    ts.transpileModule(await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf-8",
  );
  const modulePath = join(directory, filename);
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText.replace('from "./vehicleTune"', 'from "./vehicleTune.mjs"'),
    "utf-8",
  );
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const identity = await compileModule(new URL("../src/lib/vehicleIdentity.ts", import.meta.url), "vehicleIdentity.mjs");
const vehicleTune = await compileModule(new URL("../src/lib/vehicleTune.ts", import.meta.url), "vehicleTuneMain.mjs");
const panelSource = await readFile(new URL("../src/components/VehicleTunePanel.tsx", import.meta.url), "utf-8");
const sessionPanelSource = await readFile(new URL("../src/components/SessionBrowserPanel.tsx", import.meta.url), "utf-8");

assert.equal(identity.normalizeVehicleDisplayName("  2019   Ferrari Monza SP2 "), "2019 ferrari monza sp2");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: 10, displayName: "A" }, { carOrdinal: 10, displayName: "B" }), "same");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: 10, displayName: "Same" }, { carOrdinal: 11, displayName: "Same" }), "different");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: null, displayName: "  2019   Ferrari Monza SP2 " }, { carOrdinal: null, displayName: "2019 ferrari monza sp2" }), "same");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: null, displayName: "2019 Ferrari Monza SP2" }, { carOrdinal: null, displayName: "1995 Porsche 911 GT2" }), "different");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: null, displayName: "" }, { carOrdinal: null, displayName: "1995 Porsche 911 GT2" }), "indeterminate");
assert.equal(identity.compareVehicleIdentities(null, { carOrdinal: 1, displayName: "A" }), "indeterminate");
assert.equal(identity.compareVehicleIdentities({ carOrdinal: null, displayName: "Ferrari Monza SP2" }, { carOrdinal: null, displayName: "Ferrari Monza SP1" }), "different");

const document = vehicleTune.createEmptyVehicleTune();
assert.equal(identity.deriveVehicleIdentityFromTuneDocument(document), null);
document.vehicle.name = "Porsche 911 GT2";
assert.deepEqual(identity.deriveVehicleIdentityFromTuneDocument(document), {
  carOrdinal: null,
  displayName: "Porsche 911 GT2",
});
document.vehicle.year = 1995;
assert.deepEqual(identity.deriveVehicleIdentityFromTuneDocument(document), {
  carOrdinal: null,
  displayName: "1995 Porsche 911 GT2",
});

assert.match(sessionPanelSource, /carOrdinal: session\.vehicle\.car_ordinal/);
assert.match(panelSource, /compareVehicleIdentities/);
assert.match(panelSource, /isProtectedVehicleTune/);
assert.match(panelSource, /vehicleChangedTitle/);
assert.match(panelSource, /resetForLoadedVehicle/);
assert.match(panelSource, /keepCurrentSettings/);
assert.match(panelSource, /vehicleMismatchWarning/);
assert.doesNotMatch(panelSource, /drive_train/);

console.log("vehicle identity smoke test passed");
