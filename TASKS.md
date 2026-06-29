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

## Repository and Viewer

- [x] GitHub repository created.
- [x] Final repository name is `fh6-goliath-coach`.
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
- [x] Full 3D Goliath reference path renders.
- [x] Confirmed render-coordinate transform is applied.
- [x] World-Y turntable camera controls are implemented.
- [x] Camera reset places START side near and mountain side far.
- [x] S1-S6 selection is implemented.
- [x] Selected section uses its original color, thicker line, and halo.
- [x] Non-selected sections are gray and dimmed.
- [x] Selected section boundary markers are emphasized.
- [x] Reference and actual telemetry paths use consistent selection emphasis.

## Milestone B1

- [x] Telemetry CSV and session JSON import.
- [x] UTF-8 BOM handling.
- [x] Completed-lap extraction.
- [x] Post-finish sample separation.
- [x] Five handbrake marker detection.
- [x] Marker exclusion windows.
- [x] Continuity-constrained reference-path projection.
- [x] Loop-bridge incorrect-branch prevention.
- [x] Course-distance and section assignment.
- [x] Projection error calculation.
- [x] Total and S1-S6 section timing.
- [x] Processed output generation.
- [x] Projected-lap CSV browser loading.
- [x] Actual driven-path overlay.
- [x] Reference/Actual visibility toggles.
- [x] Total lap time and selected-section time display.
- [x] Actual P1-P5 marker display.
- [x] Selected actual-lap segment highlighting.
- [x] Sanitized fixtures and end-to-end tests.

## Verified B1 Integration Result

- Completed lap: `28:06.859`.
- Markers: `5`.
- Mean projection error: `2.015 m`.
- Median projection error: `1.600 m`.
- Maximum projection error: `14.795 m`.
- Uncertain mappings: `0`.
- Maximum error confirmed as legitimate racing-line/reference-line offset in S4.
- Section sum differs from lap time by about `0.044 s` because boundary-crossing intervals are not interpolated.

## Current Known Limitations

- Manual lap-selection UI is not implemented.
- Replay is not implemented.
- Telemetry charts are not implemented.
- Driving-quality analysis is not implemented.
- AI explanations are not implemented.
- The 2D map view requires a dedicated repair pass.
- `projected-lap.csv` is approximately 42 MB and should later have a lighter browser-specific representation.
- Section-boundary timing should later use interpolation.
- `.gitignore` contains a leading UTF-8 BOM.
- Previously tracked `backend/fh6_goliath_coach.egg-info/` files must be removed from Git tracking.

---
# 1. Repository Setup — P0

- [x] Create GitHub repository.
- [x] Choose final repository name: `fh6-goliath-coach`.
- [x] Add `README.md`.
- [x] Add `CODEX_INSTRUCTIONS.md`.
- [x] Add `TASKS.md`.
- [ ] Add license.
- [x] Add `.gitignore`.
- [x] Ignore raw telemetry logs.
- [x] Add small sanitized sample data.
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
- [x] Add documented backend and frontend test commands.

## Acceptance criteria

- [ ] Fresh clone can install dependencies.
- [x] Backend tests run with one command.
- [x] Frontend tests run with one command.
- [x] Raw logs are not tracked.

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
- [x] Validate boundary ordering.
- [x] Validate no section gaps.
- [x] Validate no section overlap.
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

- [x] Parser loads the reference path.
- [x] Every reference point receives one section ID.
- [x] Start and finish are valid.
- [x] P1–P5 render at the correct distances.

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
- [x] Apply confirmed render-coordinate transform.
- [x] Color S1-S6 separately.
- [x] Render P1-P5.
- [x] Render start/finish.
- [x] Add OrbitControls.
- [x] Implement world-Y turntable camera controls.
- [x] Add camera reset.
- [x] Camera reset places START side near and mountain side far.
- [ ] Add fullscreen mode.
- [x] Add 2D/3D toggle.
- [x] Add elevation-scale slider.
- [x] Add grid.
- [x] Add direction indicator.
- [x] Add section legend.
- [x] Add section selection.
- [x] Highlight selected section.
- [x] Selected section keeps original color with thicker line and halo.
- [x] Non-selected sections are gray and dimmed.
- [x] Selected section boundary markers are emphasized.
- [x] Reference and actual telemetry paths use consistent selection emphasis.
- [x] Show section start/end/length.
- [x] Add loading and error states.

## Acceptance criteria

- [x] Entire course renders smoothly.
- [x] User can rotate, zoom, and pan.
- [x] Six sections are visually distinct.
- [x] Five markers are visible.
- [x] Elevation scale changes display only.
- [x] No invented geometry is presented as factual.

---
# 5. Telemetry Import — P0

- [x] Load telemetry CSV.
- [x] Inspect and validate headers.
- [x] Handle UTF-8 BOM.
- [x] Load session JSON.
- [x] Display session metadata.
- [x] Detect candidate laps.
- [ ] Allow manual lap selection.
- [x] Detect incomplete laps.
- [x] Extract completed lap.
- [x] Separate post-finish samples.
- [x] Detect five handbrake markers.
- [x] Apply marker exclusion windows.
- [x] Detect long pauses.
- [ ] Detect obvious coordinate jumps.
- [ ] Flag possible rewind segments.
- [x] Add import error messages.
- [x] Export normalized session metadata.
- [x] Generate processed output files.

---
# 6. Reference-Path Projection — P0

- [ ] Build 3D nearest-neighbor index.
- [x] Project telemetry samples to reference path.
- [x] Assign course distance.
- [x] Assign section ID.
- [x] Calculate projection error.
- [x] Preserve timestamps.
- [x] Enforce temporal continuity.
- [x] Prevent jumps to nearby wrong branches.
- [x] Handle loop-bridge proximity.
- [x] Flag uncertain matches.
- [x] Add projection-quality summary.
- [x] Calculate total lap time.
- [x] Calculate S1-S6 section timing.
- [x] Export normalized lap data.
- [x] Load projected-lap CSV in the browser.
- [x] Render actual driven-path overlay.
- [x] Add Reference/Actual visibility toggles.
- [x] Display total lap time and selected-section time.
- [x] Display actual P1-P5 markers.
- [x] Highlight selected actual-lap segment.

## Tests

- [ ] Exact reference point maps to itself.
- [ ] Nearby point maps to expected distance.
- [ ] Outlier receives warning.
- [x] Sequence avoids impossible backward jumps.
- [x] Loop-bridge samples map to correct branch.
- [x] Sanitized fixtures cover the end-to-end B1 workflow.

---

# Relative Elevation Visualization — P0

- [ ] Define the canonical reference-path minimum `position_y` as relative height `0 m`.
- [ ] Preserve original world `position_y`.
- [ ] Use one fixed reference baseline for all imported laps.
- [ ] Render a `0 m` base plane.
- [ ] Draw vertical guides from the base plane to the course.
- [ ] Show minimum, maximum, start/finish, and total relative-height range.
- [ ] Label values as relative height above course minimum, not sea-level elevation.
- [ ] Apply the same baseline to reference and actual paths.
- [ ] Keep elevation multipliers display-only.
- [ ] Add baseline and scaling regression tests.

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
- [x] Store car identity.
- [x] Store drivetrain.
- [x] Store PI.
- [x] Store power.
- [x] Store weight.
- [ ] Store tire type.
- [x] Store setup metadata.
- [ ] Compare uphill performance.
- [ ] Compare downhill stability.
- [ ] Compare high-speed corner behavior.
- [ ] Compare low-speed traction.
- [ ] Compare full-throttle ratio.
- [ ] Compare correction-steering frequency.
- [ ] Compare repeatability.

---

# 16. Setup Data — P3

- [x] Tire pressures.
- [x] Gear ratios.
- [x] Final drive.
- [x] Camber.
- [x] Toe.
- [x] Caster.
- [x] Anti-roll bars.
- [x] Springs.
- [x] Ride height.
- [x] Damping.
- [x] Aero.
- [x] Brake balance.
- [x] Brake pressure.
- [x] Differential settings.
- [x] AWD torque split where applicable.
- [x] Setup versioning.
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

- [x] Packet count.
- [x] Saved packet count.
- [x] Ignored/off packet count.
- [x] Sampling interval distribution.
- [x] Maximum sampling gap.
- [x] Missing-field report.
- [x] Projection mean error.
- [x] Projection median error.
- [x] Projection maximum error.
- [x] Uncertain mapping count.
- [x] Lap completeness.
- [x] Maximum projection error reviewed and classified.
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
- [x] Marker detection tests.
- [x] Projection tests.
- [x] Loop-bridge branch tests.
- [x] CSV encoding tests.
- [x] Missing-column tests.
- [x] Invalid-value tests.
- [ ] Large-session performance tests.
- [x] Viewer smoke test.
- [x] Telemetry lap loader smoke test.
- [x] End-to-end sample workflow test.

---
# 20. Documentation — P0/P1

- [x] README setup instructions.
- [ ] Architecture overview.
- [ ] Telemetry field documentation.
- [x] Coordinate-system documentation.
- [x] Reference-path limitations.
- [x] Section definitions.
- [ ] Projection algorithm.
- [ ] Rule-based analysis design.
- [x] Data-quality interpretation.
- [x] Known limitations.
- [x] Raw-log and privacy handling.

---
# Next 10 Tasks

1. [ ] Remove the `.gitignore` BOM and stop tracking generated `*.egg-info/`.
2. [ ] Implement relative elevation above the canonical course minimum.
3. [ ] Add the `0 m` plane and vertical height guides.
4. [ ] Add relative-height labels and range summary.
5. [ ] Add relative-elevation tests.
6. [ ] Produce a lightweight browser-specific lap dataset.
7. [ ] Interpolate section-boundary crossing times.
8. [ ] Repair and separate the 2D orthographic map view.
9. [ ] Add the first synchronized telemetry chart, starting with speed.
10. [ ] Begin Milestone C with a vehicle marker and basic replay controls.

---

# MVP Definition of Done

The MVP is complete when:

- [x] The browser renders the full 3D Goliath reference path.
- [x] S1-S6 are color-coded and selectable.
- [x] P1-P5 and start/finish are visible.
- [x] Elevation scale is adjustable.
- [x] Telemetry import and normalization are implemented.
- [x] A completed lap can be projected to the reference path.
- [x] Static actual-path and section-time inspection are implemented.
- [x] The application works without an external AI API.
- [ ] Relative-height visualization is implemented.
- [ ] The lap can be replayed in 3D.
- [ ] Rule-based issue detection is implemented.
- [ ] Evidence-backed recommendations are shown.
