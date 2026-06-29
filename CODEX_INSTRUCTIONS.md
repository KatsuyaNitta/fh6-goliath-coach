# Codex Instructions — FH6 Goliath Improvement Program

## Project purpose

Build a browser-based telemetry analysis application specialized for the **Goliath** course in *Forza Horizon 6*.

The application must help the user understand:

- where time is gained or lost;
- whether a corner can be taken more aggressively;
- whether entry speed or entry angle is inappropriate;
- whether the car is understeering or oversteering;
- whether throttle application is too early or too late;
- how different cars behave at the same course location;
- how setup changes affect the same car.

The defining feature is a **3D visualization of the Goliath course** with telemetry-derived annotations.

The first release is intentionally Goliath-specific. Do not prioritize arbitrary-course support over a reliable Goliath MVP.

---

## Confirmed project goals

### Goal 1 — Driving improvement

Analyze a completed Goliath lap and produce actionable feedback such as:

- “The tires still had margin here; carry more speed.”
- “The corner-entry angle is too shallow.”
- “Brake more before turn-in and rotate the car earlier.”
- “Throttle was applied too early and caused likely power-on understeer.”
- “Steering corrections indicate instability.”
- “The selected gear reduced acceleration on the climb.”

Each diagnosis must include:

1. course location;
2. observed telemetry evidence;
3. inference;
4. confidence;
5. concrete driving recommendation;
6. setup recommendation only when justified.

### Goal 2 — 3D spatial visualization

The user must be able to:

- rotate, zoom, and pan the course;
- switch between 2D and 3D views;
- see six major sections;
- see section boundary markers;
- select an issue on the course;
- inspect synchronized telemetry values;
- compare multiple laps or cars.

---

## Existing data

The logger produces:

- `*_telemetry.csv`
- `*_session.json`
- optionally `*.fh6raw`

The current packet size is 324 bytes.

The telemetry contains at least:

- timing;
- `position_x`;
- `position_y`;
- `position_z`;
- speed;
- throttle;
- brake;
- steering;
- handbrake;
- drivetrain data;
- tire data;
- suspension data;
- acceleration/orientation data.

Inspect actual CSV headers before implementing parsers. Do not assume undocumented fields.

### Coordinate interpretation

For display:

- `position_x`: horizontal world axis;
- `position_z`: horizontal world axis;
- `position_y`: height/elevation.

Normalize display coordinates around the start:

```text
display_x = position_x - start_x
display_y = position_y - start_y
display_z = position_z - start_z
```

Always preserve original coordinates in processed output.

---

## Reference course line

A clean automated-driving lap has already been converted to a 1 m resampled reference path.

Approximate total length:

```text
84.677 km
```

Treat this as a **reference driving path**, not as:

- a verified road centerline;
- an ideal racing line;
- official course geometry.

---

## Confirmed six-section definition

Five short handbrake pulses were used as explicit human boundary markers.

| Section | Start | End | Length |
|---|---:|---:|---:|
| S1 | 0.000 km | 17.630 km | 17.630 km |
| S2 | 17.630 km | 31.659 km | 14.029 km |
| S3 | 31.659 km | 42.581 km | 10.922 km |
| S4 | 42.581 km | 60.737 km | 18.156 km |
| S5 | 60.737 km | 74.188 km | 13.451 km |
| S6 | 74.188 km | 84.677 km | 10.489 km |

Names:

- S1 — Start to before the main climb
- S2 — Main uphill section
- S3 — Main downhill section
- S4 — Flat/high-speed corner section after the descent
- S5 — Loop-bridge approach and rolling elevation section
- S6 — Final flat section to the finish

Boundary markers:

- P1 = S1/S2
- P2 = S2/S3
- P3 = S3/S4
- P4 = S4/S5
- P5 = S5/S6

Use these boundaries unless a later verified dataset replaces them.

---

## Hard constraints

### Do not fabricate missing geometry

The telemetry does not directly provide:

- actual road width;
- road edges;
- guardrails;
- checkpoint gates;
- curb geometry;
- collision geometry.

The MVP may render:

- a 3D line;
- a thick display line;
- a constant-width ribbon for visualization only.

Any road ribbon must be labeled **approximate display geometry**.

### Separate fact, inference, and recommendation

Each analysis result must distinguish:

- **Observed fact**
- **Inference**
- **Recommendation**

Example:

```text
Observed:
Throttle > 85%, front slip > rear slip, steering increased.

Inference:
Likely power-on understeer.

Recommendation:
Delay throttle application and reduce steering overlap.
```

Never present a heuristic inference as certain fact.

### No AI API required for MVP

The first useful version must work with:

- deterministic processing;
- rule-based issue detection;
- template-based Japanese explanations.

Design schemas so an AI explanation layer can be added later.

---

## Recommended stack

### Processing

- Python 3.12+
- pandas
- NumPy
- SciPy
- Pydantic
- Typer
- pytest

Optional later:

- Polars
- DuckDB or SQLite

### Frontend

- Vite
- React
- TypeScript
- Three.js through React Three Fiber
- Zustand
- Plotly or another chart library

### Quality

- Ruff
- formatter
- Pyright or mypy
- ESLint
- Prettier
- Vitest
- Playwright

---

## Suggested repository structure

```text
fh6-goliath-coach/
├─ README.md
├─ CODEX_INSTRUCTIONS.md
├─ TASKS.md
├─ pyproject.toml
├─ package.json
├─ docs/
│  ├─ architecture.md
│  ├─ telemetry-format.md
│  ├─ coordinate-system.md
│  ├─ analysis-rules.md
│  └─ data-quality.md
├─ data/
│  ├─ reference/
│  ├─ config/
│  └─ samples/
├─ backend/
│  └─ goliath/
│     ├─ io/
│     ├─ preprocessing/
│     ├─ mapping/
│     ├─ metrics/
│     ├─ detection/
│     ├─ reporting/
│     └─ cli.py
├─ viewer/
│  ├─ public/
│  └─ src/
└─ tests/
```

Do not commit large raw telemetry logs. Include only small sanitized samples.

---

## Core schemas

### Reference point

```json
{
  "course_distance_m": 17630.242,
  "position_x": 0.0,
  "position_y": 0.0,
  "position_z": 0.0,
  "section_id": "S2",
  "gradient_pct": 3.2,
  "curvature": 0.0014
}
```

### Section

```json
{
  "id": "S2",
  "name_ja": "登り区間",
  "name_en": "Main uphill section",
  "start_distance_m": 17630.242,
  "end_distance_m": 31659.142,
  "description": "Main climb with repeated medium- and high-speed corners"
}
```

### Projected telemetry sample

```json
{
  "timestamp_s": 317.56,
  "course_distance_m": 17630.24,
  "reference_offset_m": 2.32,
  "position_x": 0.0,
  "position_y": 0.0,
  "position_z": 0.0,
  "speed_kmh": 218.98,
  "throttle_pct": 100.0,
  "brake_pct": 0.0,
  "steering": 0.12,
  "section_id": "S2"
}
```

### Analysis event

```json
{
  "event_id": "evt-000123",
  "course_distance_start_m": 20110.0,
  "course_distance_end_m": 20285.0,
  "section_id": "S2",
  "severity": "medium",
  "category": "power_on_understeer",
  "observations": [
    "Throttle exceeded 85%",
    "Front slip exceeded rear slip"
  ],
  "inference": "Likely power-on understeer",
  "recommendation": "Delay throttle application and reduce steering overlap",
  "confidence": 0.78
}
```

---

## Implementation order

### Milestone A — 3D course viewer

1. Load the 1 m reference path.
2. Normalize coordinates around the start.
3. Render the path in Three.js.
4. Color S1–S6 separately.
5. Render P1–P5.
6. Render start/finish.
7. Add orbit controls.
8. Add 2D/3D mode.
9. Add elevation-scale control.
10. Add section detail panel.

### Milestone B — Lap projection

1. Load telemetry CSV.
2. Detect or select a lap.
3. Project samples to the reference path.
4. Use 3D nearest-neighbor matching.
5. Enforce temporal continuity.
6. Calculate projection error.
7. Flag uncertain mappings.
8. Assign section ID and course distance.
9. Export normalized lap data.

### Milestone C — Replay

Implement:

- play/pause;
- seek;
- playback speed;
- vehicle marker;
- chase camera;
- top camera;
- synchronized charts.

### Milestone D — Rule-based analysis

Start with:

- excessive front slip under throttle;
- excessive rear slip under throttle;
- steering correction frequency;
- early braking;
- late braking;
- slow throttle pickup;
- excessive throttle/steering overlap;
- probable wall contact;
- probable course departure;
- probable landing impact.

All thresholds must be configurable and tested.

---

## First deliverable

A local vertical slice.

Expected commands:

```text
python -m goliath.cli build-reference ...
npm run dev
```

The browser must show:

- full 3D Goliath path;
- S1–S6;
- P1–P5;
- start/finish;
- orbit controls;
- elevation-scale control;
- section detail panel.

### Acceptance criteria

- Full 84.677 km path renders.
- Six section boundaries match confirmed distances.
- User can rotate, zoom, and pan.
- Elevation scale affects display only.
- Selecting a section highlights the correct range.
- No approximate road width is presented as factual.
- The path is labeled as a sampled driving path.

---

## Codex development rules

- Work in small, reviewable commits.
- Do not rewrite unrelated code.
- Add tests for coordinate transforms and section assignment.
- Keep thresholds configurable.
- Do not commit raw user logs.
- Prefer explicit types.
- Document schema changes.
- Update `README.md` when commands change.
- Update `TASKS.md` after completed work.
- Do not add AI integration before the rule-based MVP works.

---

## Initial Codex execution prompt

```text
Initialize the FH6 Goliath Improvement Program as a maintainable monorepo.

Read CODEX_INSTRUCTIONS.md and TASKS.md before making changes.

For the first milestone:

1. Create a Python package that loads and validates a 1 m Goliath reference-line CSV.
2. Create typed section configuration using the confirmed S1–S6 boundaries.
3. Export a browser-friendly JSON reference file.
4. Create a Vite + React + TypeScript viewer using React Three Fiber.
5. Render the reference path in 3D using position_x, position_y, and position_z.
6. Normalize coordinates to the start position for rendering.
7. Color S1–S6 separately.
8. Add P1–P5 markers and a start/finish marker.
9. Add OrbitControls and an elevation-scale control.
10. Add tests for section assignment and coordinate normalization.
11. Document all setup and run commands in README.md.

Do not implement AI integration yet.
Do not claim the path is the true road centerline.
Do not invent road width or checkpoint geometry.
Keep the changes modular and commit-ready.
```

