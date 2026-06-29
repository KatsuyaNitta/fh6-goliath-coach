import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const payload = JSON.parse(
  await readFile(new URL("../public/reference/goliath_reference.json", import.meta.url), "utf-8"),
);

assert.equal(payload.schema_version, "goliath-reference-v1");
assert.deepEqual(payload.point_columns, [
  "course_distance_m",
  "display_x",
  "display_y",
  "display_z",
  "position_x",
  "position_y",
  "position_z",
  "speed_kmh",
  "current_lap_time",
  "section_index",
]);
assert.equal(payload.sections.length, 6);
assert.equal(payload.markers.length, 5);
assert.equal(payload.points.length, payload.stats.point_count);
assert.equal(payload.points.length, 84678);
assert.equal(payload.points[0][1], 0);
assert.equal(payload.points[0][2], 0);
assert.equal(payload.points[0][3], 0);
assert.ok(Math.abs(payload.start_finish.finish_course_distance_m - 84677.15121230017) < 0.001);
assert.deepEqual(
  payload.markers.map((marker) => marker.course_distance_m),
  [17630.242, 31659.142, 42581.232, 60737.384, 74188.316],
);

console.log("generated reference smoke test passed");
