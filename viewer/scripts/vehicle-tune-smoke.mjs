import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8");

assert.ok(source.includes('VEHICLE_TUNE_SCHEMA_VERSION = "goliath-vehicle-tune-v2"'), "missing v2 schema");
assert.ok(source.includes("export type VehicleDrivetrain = Drivetrain | null"), "missing nullable drivetrain type");

for (const field of [
  "name",
  "year",
  "car_class",
  "pi",
  "drivetrain",
  "power_ps",
  "torque_nm",
  "weight_kg",
  "front_weight_distribution_percent",
  "engine_notes",
]) {
  assert.ok(source.includes(field), `missing vehicle field: ${field}`);
}

for (const forbidden of [
  "displacement",
  "cylinder_count",
  "aspiration",
  "engine_family",
  "engine_swap",
]) {
  assert.ok(!source.includes(forbidden), `forbidden structured engine field found: ${forbidden}`);
}

const order = [
  "tires",
  "gearing",
  "alignment",
  "anti_roll_bars",
  "springs",
  "ride_height",
  "damping",
  "aero",
  "brakes",
  "differential",
];
let previousIndex = -1;
for (const section of order) {
  const index = source.indexOf(`"${section}"`);
  assert.ok(index > previousIndex, `tuning section order is wrong around ${section}`);
  previousIndex = index;
}

for (const unit of ["bar", "PS", "NM", "KG", "KGF/MM", "cm", "kgf"]) {
  assert.ok(source.includes(unit), `missing unit: ${unit}`);
}

for (const replacedUnit of ["N·m", "Nm", '"kg"', "kgf/mm"]) {
  assert.ok(!source.includes(replacedUnit), `old display unit remains: ${replacedUnit}`);
}

console.log("vehicle tune metadata smoke test passed");
