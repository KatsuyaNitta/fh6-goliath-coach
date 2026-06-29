# Telemetry Format

The first reference-path vertical slice expects:

```text
current_lap_time,course_distance_m,course_distance_km,position_x,position_y,position_z,speed_kmh
```

Later telemetry imports must inspect actual CSV headers before parsing. Do not assume fields beyond those present in the file being processed.
