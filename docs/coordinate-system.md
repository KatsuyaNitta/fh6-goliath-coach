# Coordinate System

The Goliath reference CSV stores original game-world coordinates.

- `position_x`: horizontal world axis
- `position_z`: horizontal world axis
- `position_y`: height/elevation

The viewer uses display coordinates normalized around the first reference point:

```text
display_x = position_x - start_x
display_y = position_y - start_y
display_z = position_z - start_z
```

Elevation scaling is display-only. It must not modify original coordinates or exported telemetry facts.

The reference path is a sampled driving path. It is not a verified road centerline or road geometry.
