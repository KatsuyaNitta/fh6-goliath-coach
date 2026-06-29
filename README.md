# FH6 Goliath Coach

Browser-based reference-path visualization for the Goliath course in Forza Horizon 6.

This milestone renders the confirmed 1 m sampled Goliath driving path. The path is not an official road centerline, not an ideal racing line, and not complete road geometry. The viewer renders a line only; it does not invent road width, road edges, curbs, guardrails, checkpoints, or terrain.

## Current Milestone Slice

- Load `data/reference/goliath_reference_1m.csv`.
- Validate required columns, finite numeric values, and strictly increasing `course_distance_m`.
- Preserve original `position_x`, `position_y`, and `position_z`.
- Export display coordinates normalized around the first point.
- Assign S1-S6 using the confirmed boundary distances.
- Export compact browser data to `viewer/public/reference/goliath_reference.json`.
- Render the sampled driving path in a Vite + React + TypeScript + React Three Fiber viewer.
- Capture minimal vehicle metadata and Forza-ordered tune values, with JSON save/load.
- Import one processed Goliath telemetry session from local CSV/JSON files.
- Extract the completed lap, detect five handbrake section markers, and project the lap onto the reference path.
- Load a processed `projected-lap.csv` in the viewer and overlay the actual driven path.

## Reference CSV

Source file:

```text
data/reference/goliath_reference_1m.csv
```

Required columns:

```text
current_lap_time,course_distance_m,course_distance_km,position_x,position_y,position_z,speed_kmh
```

Coordinate interpretation:

- `position_x`: horizontal world axis
- `position_z`: horizontal world axis
- `position_y`: height/elevation

Display coordinates:

```text
display_x = position_x - start_x
display_y = position_y - start_y
display_z = position_z - start_z
```

## Section Boundaries

| Section | Start m | End m |
|---|---:|---:|
| S1 | 0.000 | 17,630.242 |
| S2 | 17,630.242 | 31,659.142 |
| S3 | 31,659.142 | 42,581.232 |
| S4 | 42,581.232 | 60,737.384 |
| S5 | 60,737.384 | 74,188.316 |
| S6 | 74,188.316 | reference finish |

## Python Setup

From the repository root in Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .
```

## Generate Viewer Data

```powershell
.\.venv\Scripts\Activate.ps1
python -m goliath.cli build-reference data\reference\goliath_reference_1m.csv --output viewer\public\reference\goliath_reference.json
```

## Process a Local Telemetry Session

Raw local telemetry stays outside Git. Place session files under:

```text
data\local\sessions\<session_id>\
```

For the first integration session:

```powershell
.\.venv\Scripts\Activate.ps1
python -m goliath.cli process-session data\local\sessions\20260629_184938 --reference data\reference\goliath_reference_1m.csv --output-root data\processed
```

The command writes generated artifacts under:

```text
data\processed\20260629_184938\
```

Large processed outputs are generated locally and ignored by Git.

## Backend Tests

```powershell
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests
```

## Frontend Setup

```powershell
cd viewer
corepack enable
corepack pnpm install
```

If `pnpm` is already installed:

```powershell
cd viewer
pnpm install
```

## Start Development Server

```powershell
cd viewer
pnpm run dev
```

Open the local URL printed by Vite. The app loads:

```text
/reference/goliath_reference.json
```

Use the **Load projected lap** control to select a generated `projected-lap.csv` and overlay the actual driven path.

## Frontend Tests

```powershell
cd viewer
pnpm run test
```

The frontend smoke test checks generated reference data, camera transforms, vehicle/tune metadata constraints, and projected-lap CSV loading.

## Production Build

```powershell
cd viewer
pnpm run build
```
