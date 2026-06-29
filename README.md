# FH6 Goliath Coach

Browser-based telemetry analysis and 3D reference-path visualization for the Goliath course in Forza Horizon 6.

The first milestone focuses on rendering the confirmed 1 m sampled Goliath driving path. This path is not a verified road centerline and does not contain road width, road edges, checkpoints, guardrails, curbs, or collision geometry.

## Current Vertical Slice

- Load `data/reference/goliath_reference_1m.csv`.
- Preserve original `position_x`, `position_y`, and `position_z`.
- Add display coordinates normalized around the start point.
- Assign S1-S6 using the confirmed boundary distances.
- Export `viewer/public/reference/goliath_reference.json`.
- Render the full sampled driving path in a Vite + React + Three.js viewer.

## Reference Data

Expected source file:

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

Display coordinates are normalized around the start:

```text
display_x = position_x - start_x
display_y = position_y - start_y
display_z = position_z - start_z
```

## Build Reference JSON

```powershell
$env:PYTHONPATH="$PWD\backend"
python -m goliath.cli build-reference data\reference\goliath_reference_1m.csv --output viewer\public\reference\goliath_reference.json
```

## Backend Tests

```powershell
$env:PYTHONPATH="$PWD\backend"
python -m unittest discover -s tests
```

## Viewer

Install frontend dependencies, then run:

```powershell
cd viewer
npm install
npm run dev
```

Open the printed local URL. The viewer loads `/reference/goliath_reference.json`.
