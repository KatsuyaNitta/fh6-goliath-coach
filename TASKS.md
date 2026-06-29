# TASKS — FH6 Goliath Improvement Program

## Status

- [x] Completed
- [ ] Not started
- [~] In progress
- [!] Blocked or requires verification

---

# Project Goals

- [ ] Analyze a completed Goliath lap and identify actionable driving improvements.
- [ ] Explain each issue using telemetry evidence.
- [ ] Visualize issues on a 3D representation of the course.
- [ ] Compare laps, cars, and setup changes at the same course locations.
- [ ] Keep the MVP functional without an external AI API.

---

# 0. Completed Work

- [x] Build an FH6 UDP telemetry logger.
- [x] Save telemetry as CSV.
- [x] Save session metadata as JSON.
- [x] Capture an automated-driving Goliath reference lap.
- [x] Separate a failed attempt from the completed lap.
- [x] Extract the completed mapping lap.
- [x] Generate a 1 m resampled reference path.
- [x] Generate a 2D course plot.
- [x] Generate an elevation profile.
- [x] Confirm `position_y` as elevation for visualization.
- [x] Use handbrake pulses as explicit section markers.
- [x] Detect five boundary markers.
- [x] Convert markers to reference-course distance.
- [x] Divide Goliath into six major sections.
- [x] Create two UI concept images.

---

# 1. Repository Setup — P0

- [ ] Create GitHub repository.
- [ ] Choose final repository name.
  - Suggested: `fh6-goliath-coach`
- [x] Add `README.md`.
- [x] Add `CODEX_INSTRUCTIONS.md`.
- [x] Add `TASKS.md`.
- [ ] Add license.
- [x] Add `.gitignore`.
- [ ] Ignore raw telemetry logs.
- [ ] Add small sanitized sample data.
- [x] Create Python project configuration.
- [x] Create frontend project configuration.
- [ ] Pin Python version.
- [ ] Pin Node.js version.
- [ ] Add Ruff.
- [ ] Add formatter.
- [ ] Add type checking.
- [ ] Add ESLint.
- [ ] Add Prettier.
- [ ] Add GitHub Actions CI.
- [ ] Add documented backend and frontend test commands.

## Acceptance criteria

- [ ] Fresh clone can install dependencies.
- [ ] Backend tests run with one command.
- [ ] Frontend tests run with one command.
- [ ] Raw logs are not tracked.

---

# 2. Reference Course Data — P0

- [x] Add 1 m reference path to `data/reference/`.
- [x] Add exact S1–S6 configuration.
- [x] Add P1–P5 marker definitions.
- [x] Preserve original world coordinates.
- [x] Add display-origin normalized coordinates.
- [x] Document coordinate axes.
- [x] Validate monotonic course distance.
- [x] Validate total length near 84.677 km.
- [ ] Validate boundary ordering.
- [ ] Validate no section gaps.
- [ ] Validate no section overlap.
- [x] Export browser-friendly JSON.
- [x] Add schema version.
- [x] Add provenance metadata.

## Confirmed boundaries

| Section | Start km | End km | Length km |
|---|---:|---:|---:|
| S1 | 0.000 | 17.630 | 17.630 |
| S2 | 17.630 | 31.659 | 14.029 |
| S3 | 31.659 | 42.581 | 10.922 |
| S4 | 42.581 | 60.737 | 18.156 |
| S5 | 60.737 | 74.188 | 13.451 |
| S6 | 74.188 | 84.677 | 10.489 |

## Acceptance criteria

- [ ] Parser loads the reference path.
- [ ] Every reference point receives one section ID.
- [ ] Start and finish are valid.
- [ ] P1–P5 render at the correct distances.

---

# 3. Course Geometry Enrichment — P1

- [ ] Calculate tangent/direction vector.
- [ ] Calculate local gradient.
- [ ] Calculate local curvature.
- [ ] Classify left/right turns.
- [ ] Classify uphill/downhill/flat.
- [ ] Add smoothing controls.
- [ ] Detect discontinuities.
- [ ] Add data-quality flags.
- [ ] Document that the reference path is not a verified centerline.
- [ ] Add optional display-only constant-width ribbon.
- [ ] Label ribbon width as approximate.

## Deferred

- [ ] Actual road edges.
- [ ] Checkpoint-gate geometry.
- [ ] Guardrail geometry.
- [ ] Curb geometry.
- [ ] Collision mesh.

---

# 4. 3D Viewer MVP — P0

- [x] Initialize Vite.
- [x] Initialize React.
- [x] Initialize TypeScript.
- [x] Add React Three Fiber.
- [x] Load reference JSON.
- [x] Render full course as a 3D path.
- [x] Normalize coordinates around start.
- [x] Color S1–S6 separately.
- [x] Render P1–P5.
- [x] Render start/finish.
- [x] Add OrbitControls.
- [ ] Add camera reset.
- [ ] Add fullscreen mode.
- [x] Add 2D/3D toggle.
- [x] Add elevation-scale slider.
- [ ] Add grid.
- [ ] Add direction indicator.
- [x] Add section legend.
- [x] Add section selection.
- [x] Highlight selected section.
- [x] Show section start/end/length.
- [x] Add loading and error states.

## Acceptance criteria

- [ ] Entire course renders smoothly.
- [ ] User can rotate, zoom, and pan.
- [ ] Six sections are visually distinct.
- [ ] Five markers are visible.
- [ ] Elevation scale changes display only.
- [ ] No invented geometry is presented as factual.

---

# 5. Telemetry Import — P0

- [ ] Load telemetry CSV.
- [ ] Inspect and validate headers.
- [ ] Handle UTF-8 BOM.
- [ ] Load session JSON.
- [ ] Display session metadata.
- [ ] Detect candidate laps.
- [ ] Allow manual lap selection.
- [ ] Detect incomplete laps.
- [ ] Detect long pauses.
- [ ] Detect obvious coordinate jumps.
- [ ] Flag possible rewind segments.
- [ ] Add import error messages.
- [ ] Export normalized session metadata.

---

# 6. Reference-Path Projection — P0

- [ ] Build 3D nearest-neighbor index.
- [ ] Project telemetry samples to reference path.
- [ ] Assign course distance.
- [ ] Assign section ID.
- [ ] Calculate projection error.
- [ ] Preserve timestamps.
- [ ] Enforce temporal continuity.
- [ ] Prevent jumps to nearby wrong branches.
- [ ] Handle loop-bridge proximity.
- [ ] Flag uncertain matches.
- [ ] Add projection-quality summary.
- [ ] Export normalized lap data.

## Tests

- [ ] Exact reference point maps to itself.
- [ ] Nearby point maps to expected distance.
- [ ] Outlier receives warning.
- [ ] Sequence avoids impossible backward jumps.
- [ ] Loop-bridge samples map to correct branch.

---

# 7. Lap Replay — P1

- [ ] Add vehicle marker.
- [ ] Add play.
- [ ] Add pause.
- [ ] Add seek.
- [ ] Add playback-speed control.
- [ ] Show current time.
- [ ] Show current course distance.
- [ ] Show current section.
- [ ] Add chase camera.
- [ ] Add top-down camera.
- [ ] Add free camera.
- [ ] Add click-to-jump.
- [ ] Synchronize 3D view and charts.

---

# 8. Telemetry Charts — P1

- [ ] Speed.
- [ ] Throttle.
- [ ] Brake.
- [ ] Steering.
- [ ] Handbrake.
- [ ] Gear.
- [ ] RPM.
- [ ] Lateral G.
- [ ] Longitudinal G.
- [ ] Yaw/pitch/roll.
- [ ] Front tire slip.
- [ ] Rear tire slip.
- [ ] Individual tire slip.
- [ ] Suspension travel.
- [ ] Tire temperatures where available.
- [ ] Synchronized chart cursor.
- [ ] Section background bands.
- [ ] P1–P5 marker lines.

---

# 9. Course Coloring Modes — P1

- [ ] Section.
- [ ] Speed.
- [ ] Throttle.
- [ ] Brake.
- [ ] Steering magnitude.
- [ ] Lateral G.
- [ ] Gradient.
- [ ] Curvature.
- [ ] Front slip.
- [ ] Rear slip.
- [ ] Tire margin estimate.
- [ ] Improvement priority.
- [ ] Projection confidence.

---

# 10. Corner Detection — P2

- [ ] Detect corner start.
- [ ] Detect apex region.
- [ ] Detect corner exit.
- [ ] Assign stable corner IDs.
- [ ] Classify left/right.
- [ ] Classify low/medium/high speed.
- [ ] Detect linked corners.
- [ ] Detect S-curves.
- [ ] Detect major braking zones.
- [ ] Allow manual boundary correction.
- [ ] Save corrections in configuration.

---

# 11. Driving Metrics — P2

For each corner or analysis zone:

- [ ] Entry speed.
- [ ] Minimum speed.
- [ ] Exit speed.
- [ ] Braking start distance.
- [ ] Braking end distance.
- [ ] Turn-in distance.
- [ ] Maximum steering input.
- [ ] Throttle pickup distance.
- [ ] Full-throttle distance.
- [ ] Front/rear slip balance.
- [ ] Steering correction count.
- [ ] Average lateral G.
- [ ] Peak lateral G.
- [ ] Segment elapsed time.
- [ ] Time delta to comparison lap.

---

# 12. Rule-Based Issue Detection — P2

- [ ] Excessive entry speed.
- [ ] Insufficient entry speed.
- [ ] Shallow entry angle.
- [ ] Early turn-in.
- [ ] Late turn-in.
- [ ] Excessive trail braking.
- [ ] Premature brake release.
- [ ] Power-on understeer.
- [ ] Power oversteer.
- [ ] Early throttle application.
- [ ] Late throttle application.
- [ ] Excessive steering correction.
- [ ] Unused tire margin.
- [ ] Tire saturation.
- [ ] Poor gear selection.
- [ ] Probable wall contact.
- [ ] Probable course departure.
- [ ] Probable jump/landing impact.

## Rule requirements

- [ ] Document inputs.
- [ ] Make thresholds configurable.
- [ ] Return observations.
- [ ] Return inference.
- [ ] Return recommendation.
- [ ] Return confidence.
- [ ] Add unit tests.
- [ ] Never present a guess as fact.

---

# 13. Explanation Layer — P2

- [ ] Create template-based Japanese explanations.
- [ ] Separate observation, inference, and recommendation.
- [ ] Show supporting telemetry values.
- [ ] Show affected distance range.
- [ ] Show section and corner ID.
- [ ] Show severity.
- [ ] Show confidence.
- [ ] Separate driving advice from setup advice.
- [ ] Support future AI-generated wording.
- [ ] Keep API integration optional.

---

# 14. Lap Comparison — P2

- [ ] Load two laps.
- [ ] Overlay two spatial paths.
- [ ] Calculate distance-based time delta.
- [ ] Compare section times.
- [ ] Compare corner times.
- [ ] Compare entry/minimum/exit speeds.
- [ ] Compare braking locations.
- [ ] Compare throttle pickup.
- [ ] Compare steering corrections.
- [ ] Compare slip balance.
- [ ] Display improvement and regression zones.

---

# 15. Car Comparison — P2

- [ ] Compare Porsche 911 GT3 and Lamborghini Essenza SCV12.
- [ ] Store car identity.
- [ ] Store drivetrain.
- [ ] Store PI.
- [ ] Store power.
- [ ] Store weight.
- [ ] Store tire type.
- [ ] Store setup metadata.
- [ ] Compare uphill performance.
- [ ] Compare downhill stability.
- [ ] Compare high-speed corner behavior.
- [ ] Compare low-speed traction.
- [ ] Compare full-throttle ratio.
- [ ] Compare correction-steering frequency.
- [ ] Compare repeatability.

---

# 16. Setup Data — P3

- [ ] Tire pressures.
- [ ] Gear ratios.
- [ ] Final drive.
- [ ] Camber.
- [ ] Toe.
- [ ] Caster.
- [ ] Anti-roll bars.
- [ ] Springs.
- [ ] Ride height.
- [ ] Damping.
- [ ] Aero.
- [ ] Brake balance.
- [ ] Brake pressure.
- [ ] Differential settings.
- [ ] AWD torque split where applicable.
- [ ] Setup versioning.
- [ ] Before/after comparison.

---

# 17. Dashboard and Reporting — P3

- [ ] Lap summary.
- [ ] Vehicle summary.
- [ ] Section summary.
- [ ] 3D map.
- [ ] Elevation profile.
- [ ] Telemetry timeline.
- [ ] Issue list.
- [ ] Improvement-priority ranking.
- [ ] Comparison summary.
- [ ] Screenshot export.
- [ ] CSV export.
- [ ] JSON export.
- [ ] HTML report export.
- [ ] Japanese UI.
- [ ] Dark mode.
- [ ] Light mode.

---

# 18. Data Quality — P1

- [ ] Packet count.
- [ ] Saved packet count.
- [ ] Ignored/off packet count.
- [ ] Sampling interval distribution.
- [ ] Maximum sampling gap.
- [ ] Missing-field report.
- [ ] Projection mean error.
- [ ] Projection maximum error.
- [ ] Lap completeness.
- [ ] Coordinate jump detection.
- [ ] Rewind suspicion.
- [ ] Course-departure suspicion.
- [ ] Overall analysis-quality grade.

---

# 19. Testing — P0/P1

- [x] Coordinate normalization tests.
- [ ] Distance calculation tests.
- [ ] 1 m resampling tests.
- [x] Section assignment tests.
- [ ] Marker detection tests.
- [ ] Projection tests.
- [ ] Loop-bridge branch tests.
- [ ] CSV encoding tests.
- [ ] Missing-column tests.
- [ ] Invalid-value tests.
- [ ] Large-session performance tests.
- [ ] Viewer smoke test.
- [ ] End-to-end sample workflow test.

---

# 20. Documentation — P0/P1

- [ ] README setup instructions.
- [ ] Architecture overview.
- [ ] Telemetry field documentation.
- [ ] Coordinate-system documentation.
- [ ] Reference-path limitations.
- [ ] Section definitions.
- [ ] Projection algorithm.
- [ ] Rule-based analysis design.
- [ ] Data-quality interpretation.
- [ ] Known limitations.
- [ ] Raw-log and privacy handling.

---

# Next 10 Tasks

1. [ ] Create GitHub repository.
2. [ ] Commit `CODEX_INSTRUCTIONS.md` and `TASKS.md`.
3. [x] Add reference path and section configuration.
4. [x] Initialize Python package.
5. [x] Initialize Vite + React + TypeScript viewer.
6. [x] Render the 3D reference path.
7. [x] Color S1–S6.
8. [x] Render P1–P5 and start/finish.
9. [x] Add elevation-scale control.
10. [x] Add tests for coordinate normalization and section assignment.

---

# MVP Definition of Done

The MVP is complete when:

- [ ] The browser renders the full 3D Goliath reference path.
- [ ] S1–S6 are color-coded.
- [ ] P1–P5 and start/finish are visible.
- [ ] Elevation scale is adjustable.
- [ ] A telemetry CSV can be loaded.
- [ ] A selected lap can be projected to the reference path.
- [ ] The lap can be replayed in 3D.
- [ ] At least three rule-based issues are detected.
- [ ] Each issue is shown with evidence and a recommendation.
- [ ] The application works without an external AI API.

