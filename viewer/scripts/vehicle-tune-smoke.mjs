import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = await readFile(new URL("../src/lib/vehicleTune.ts", import.meta.url), "utf-8");

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

for (const unit of ["bar", "PS", "N·m", "kg", "kgf/mm", "cm", "kgf"]) {
  assert.ok(source.includes(unit), `missing unit: ${unit}`);
}

console.log("vehicle tune metadata smoke test passed");
