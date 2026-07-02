import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileVehicleTune() {
  const source = await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8");
  const directory = join(tmpdir(), `fh6-vehicle-tune-schema-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, "vehicleTune.mjs");
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf-8",
  );
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const vehicleTune = await compileVehicleTune();
const panelSource = await readFile(new URL("../src/components/VehicleTunePanel.tsx", import.meta.url), "utf-8");
const uiTextSource = await readFile(new URL("../src/lib/uiText.ts", import.meta.url), "utf-8");

const fresh = vehicleTune.createEmptyVehicleTune();
assert.equal(fresh.schema_version, "goliath-vehicle-tune-v2");
assert.equal(fresh.vehicle.drivetrain, null);
assert.equal(fresh.tune.differential, null);

assert.deepEqual(vehicleTune.createEmptyDifferential("FWD"), {
  front_acceleration_percent: null,
  front_deceleration_percent: null,
});
assert.deepEqual(vehicleTune.createEmptyDifferential("RWD"), {
  rear_acceleration_percent: null,
  rear_deceleration_percent: null,
});
assert.deepEqual(vehicleTune.createEmptyDifferential("AWD"), {
  front_acceleration_percent: null,
  front_deceleration_percent: null,
  rear_acceleration_percent: null,
  rear_deceleration_percent: null,
  center_balance_percent: null,
});

const validV2Documents = [
  vehicleTune.createEmptyVehicleTune(),
  vehicleTune.createEmptyVehicleTune("FWD"),
  vehicleTune.createEmptyVehicleTune("RWD"),
  vehicleTune.createEmptyVehicleTune("AWD"),
];
for (const document of validV2Documents) {
  const parsed = vehicleTune.parseVehicleTuneJson(JSON.stringify(document));
  assert.equal(parsed.schema_version, "goliath-vehicle-tune-v2");
  assert.deepEqual(parsed.vehicle.drivetrain, document.vehicle.drivetrain);
  assert.deepEqual(parsed.tune.differential, document.tune.differential);
}

const invalidV2Documents = [
  {
    ...vehicleTune.createEmptyVehicleTune(),
    tune: { ...vehicleTune.createEmptyVehicleTune().tune, differential: { rear_acceleration_percent: null, rear_deceleration_percent: null } },
  },
  {
    ...vehicleTune.createEmptyVehicleTune("FWD"),
    tune: { ...vehicleTune.createEmptyVehicleTune("FWD").tune, differential: { rear_acceleration_percent: null, rear_deceleration_percent: null } },
  },
  {
    ...vehicleTune.createEmptyVehicleTune("RWD"),
    tune: { ...vehicleTune.createEmptyVehicleTune("RWD").tune, differential: { front_acceleration_percent: null, front_deceleration_percent: null } },
  },
  {
    ...vehicleTune.createEmptyVehicleTune("AWD"),
    tune: {
      ...vehicleTune.createEmptyVehicleTune("AWD").tune,
      differential: {
        front_acceleration_percent: null,
        front_deceleration_percent: null,
        rear_acceleration_percent: null,
        rear_deceleration_percent: null,
      },
    },
  },
  {
    ...vehicleTune.createEmptyVehicleTune(),
    vehicle: { ...vehicleTune.createEmptyVehicleTune().vehicle, drivetrain: "4WD" },
  },
  {
    ...vehicleTune.createEmptyVehicleTune(),
    vehicle: {},
  },
  {
    ...vehicleTune.createEmptyVehicleTune(),
    tune: {},
  },
];
for (const document of invalidV2Documents) {
  assert.throws(() => vehicleTune.parseVehicleTuneJson(JSON.stringify(document)));
}

const v1Rwd = vehicleTune.createEmptyVehicleTune("RWD");
v1Rwd.schema_version = "goliath-vehicle-tune-v1";
v1Rwd.tune.differential.rear_acceleration_percent = 62;
v1Rwd.tune.differential.rear_deceleration_percent = 18;
const parsedV1Rwd = vehicleTune.parseVehicleTuneJson(JSON.stringify(v1Rwd));
assert.equal(parsedV1Rwd.schema_version, "goliath-vehicle-tune-v2");
assert.equal(parsedV1Rwd.vehicle.drivetrain, "RWD");
assert.equal(parsedV1Rwd.tune.differential.rear_acceleration_percent, 62);
assert.equal(parsedV1Rwd.tune.differential.rear_deceleration_percent, 18);

for (const drivetrain of ["FWD", "AWD"]) {
  const v1 = vehicleTune.createEmptyVehicleTune(drivetrain);
  v1.schema_version = "goliath-vehicle-tune-v1";
  const parsed = vehicleTune.parseVehicleTuneJson(JSON.stringify(v1));
  assert.equal(parsed.schema_version, "goliath-vehicle-tune-v2");
  assert.equal(parsed.vehicle.drivetrain, drivetrain);
  assert.deepEqual(parsed.tune.differential, v1.tune.differential);
}

const invalidV1 = vehicleTune.createEmptyVehicleTune("RWD");
invalidV1.schema_version = "goliath-vehicle-tune-v1";
invalidV1.tune.differential = { front_acceleration_percent: null, front_deceleration_percent: null };
assert.throws(() => vehicleTune.parseVehicleTuneJson(JSON.stringify(invalidV1)));

const unsetSaved = JSON.parse(vehicleTune.serializeVehicleTuneJson(vehicleTune.createEmptyVehicleTune()));
assert.equal(unsetSaved.schema_version, "goliath-vehicle-tune-v2");
assert.equal(unsetSaved.vehicle.drivetrain, null);
assert.equal(unsetSaved.tune.differential, null);

const rwdSaved = JSON.parse(vehicleTune.serializeVehicleTuneJson(vehicleTune.createEmptyVehicleTune("RWD")));
assert.equal(rwdSaved.vehicle.drivetrain, "RWD");
assert.deepEqual(rwdSaved.tune.differential, {
  rear_acceleration_percent: null,
  rear_deceleration_percent: null,
});

assert.match(panelSource, /createEmptyVehicleTune\(\)/);
assert.match(panelSource, /value=\{document\.vehicle\.drivetrain \?\? ""\}/);
assert.match(panelSource, /<option value="">\{TUNE_TEXT\.drivetrainUnset\}<\/option>/);
assert.match(panelSource, /drivetrain === null \? null : createEmptyDifferential\(drivetrain\)/);
assert.match(panelSource, /differential === null \? <p className="status-text">\{TUNE_TEXT\.differentialUnsetHelp\}<\/p> : null/);
assert.doesNotMatch(panelSource, /createEmptyVehicleTune\("RWD"\)/);
assert.match(uiTextSource, /drivetrainUnset: "未設定"/);
assert.match(uiTextSource, /differentialUnsetHelp:/);

console.log("vehicle tune schema smoke test passed");
