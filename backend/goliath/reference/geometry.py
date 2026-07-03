from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import math
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from goliath.reference.loader import load_reference_csv
from goliath.reference.model import ReferencePoint

SCHEMA_VERSION = "goliath-course-geometry-v1"
DEFAULT_OUTPUT_PATH = Path("viewer/public/reference/goliath_course_geometry.json")
POINT_COLUMNS = [
    "reference_index",
    "course_distance_m",
    "section_id",
    "tangent_x",
    "tangent_z",
    "heading_deg",
    "gradient_ratio",
    "gradient_pct",
    "gradient_angle_deg",
    "signed_curvature_1pm",
    "estimated_radius_m",
    "turn_direction",
    "slope_direction",
    "quality_flags",
]

QUALITY_FLAGS = [
    "edge_window",
    "insufficient_neighbors",
    "distance_gap",
    "degenerate_tangent",
    "unstable_curvature",
    "source_discontinuity",
]
SECTION_IDS = {"S1", "S2", "S3", "S4", "S5", "S6"}


@dataclass(frozen=True)
class GeometrySettings:
    half_window_m: float = 15.0
    stability_half_window_m: float = 25.0
    straight_curvature_threshold_1pm: float = 0.0005
    flat_gradient_threshold_pct: float = 0.5


@dataclass(frozen=True)
class LocalFit:
    dx_ds: float
    dy_ds: float
    dz_ds: float
    d2x_ds2: float
    d2z_ds2: float


def build_course_geometry_json(
    input_csv: Path,
    output_json: Path = DEFAULT_OUTPUT_PATH,
    settings: GeometrySettings = GeometrySettings(),
) -> dict[str, Any]:
    payload = build_course_geometry_payload(input_csv, settings)
    _assert_json_safe(payload)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=output_json.parent,
        prefix=f".{output_json.name}.",
        suffix=".tmp",
        delete=False,
    ) as temp:
        temp_path = Path(temp.name)
        json.dump(payload, temp, ensure_ascii=False, separators=(",", ":"))
    temp_path.replace(output_json)
    return payload


def build_course_geometry_payload(input_csv: Path, settings: GeometrySettings) -> dict[str, Any]:
    _validate_settings(settings)
    points, origin = load_reference_csv(input_csv)
    if len(points) < 7:
        raise ValueError("reference CSV must contain at least 7 points")
    if any(point.section_id not in SECTION_IDS for point in points):
        raise ValueError("reference CSV contains an unknown section id")

    source_hash = hashlib.sha256(input_csv.read_bytes()).hexdigest()
    distances = [point.course_distance_m for point in points]
    geometry_points = [
        _build_geometry_tuple(index, point, points, distances, settings)
        for index, point in enumerate(points)
    ]
    if len(geometry_points) != len(points):
        raise ValueError("internal point-count mismatch while building course geometry")

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "source": {
            "logical_path": str(input_csv).replace("\\", "/"),
            "sha256": source_hash,
            "point_count": len(points),
            "finish_course_distance_m": points[-1].course_distance_m,
        },
        "coordinate_convention": {
            "source_axes": {
                "position_x": "horizontal world axis",
                "position_y": "height/elevation",
                "position_z": "horizontal world axis",
            },
            "display_origin": {
                "position_x": origin.position_x,
                "position_y": origin.position_y,
                "position_z": origin.position_z,
            },
            "display_x": "position_x - start position_x",
            "display_y": "position_y - start position_y",
            "display_z": "position_z - start position_z",
            "heading_degrees": "0 deg = +display_z, 90 deg = +display_x, positive clockwise",
            "curvature_sign": "positive = left, negative = right",
        },
        "algorithm": {
            "name": "distance-local quadratic least-squares course geometry",
            "half_window_m": settings.half_window_m,
            "stability_half_window_m": settings.stability_half_window_m,
            "straight_curvature_threshold_1pm": settings.straight_curvature_threshold_1pm,
            "flat_gradient_threshold_pct": settings.flat_gradient_threshold_pct,
            "minimum_primary_points": 7,
            "minimum_primary_span_m": 10.0,
            "distance_gap_threshold_m": 2.5,
            "source_discontinuity_threshold": "adjacent 3D step > max(5.0 m, 3.0 * delta_s)",
        },
        "units": {
            "course_distance_m": "m",
            "tangent_x": "unitless",
            "tangent_z": "unitless",
            "heading_deg": "deg",
            "gradient_ratio": "m/m",
            "gradient_pct": "%",
            "gradient_angle_deg": "deg",
            "signed_curvature_1pm": "1/m",
            "estimated_radius_m": "m",
        },
        "quality_summary": _build_quality_summary(geometry_points),
        "display_scale": _build_display_scale(geometry_points),
        "point_columns": POINT_COLUMNS,
        "points": geometry_points,
    }
    return payload


def _build_geometry_tuple(
    index: int,
    point: ReferencePoint,
    points: list[ReferencePoint],
    distances: list[float],
    settings: GeometrySettings,
) -> list[Any]:
    flags: list[str] = []
    primary_indices = _window_indices(distances, point.course_distance_m, settings.half_window_m)
    if index == 0 or index == len(points) - 1:
        flags.append("edge_window")
    elif (
        point.course_distance_m - settings.half_window_m < distances[0]
        or point.course_distance_m + settings.half_window_m > distances[-1]
    ):
        flags.append("edge_window")

    primary_invalid_flags = _primary_invalid_flags(primary_indices, points, distances)
    flags.extend(flag for flag in primary_invalid_flags if flag not in flags)
    if any(flag in flags for flag in ("insufficient_neighbors", "distance_gap", "source_discontinuity")):
        return _tuple_with_values(index, point, None, None, None, None, None, flags)

    fit = _fit_local_quadratic(point.course_distance_m, primary_indices, points)
    horizontal_norm = math.hypot(fit.dx_ds, fit.dz_ds)
    if horizontal_norm < 0.2:
        flags.append("degenerate_tangent")
        return _tuple_with_values(index, point, None, None, None, None, None, flags)

    tangent_x = fit.dx_ds / horizontal_norm
    tangent_z = fit.dz_ds / horizontal_norm
    heading_deg = math.degrees(math.atan2(tangent_x, tangent_z)) % 360.0
    gradient_ratio = fit.dy_ds / horizontal_norm
    gradient_pct = gradient_ratio * 100.0
    gradient_angle_deg = math.degrees(math.atan(gradient_ratio))
    curvature = (
        fit.dx_ds * fit.d2z_ds2 - fit.dz_ds * fit.d2x_ds2
    ) / max((fit.dx_ds * fit.dx_ds + fit.dz_ds * fit.dz_ds) ** 1.5, 1e-12)
    radius = (
        None
        if abs(curvature) < settings.straight_curvature_threshold_1pm
        else abs(1.0 / curvature)
    )

    comparison = _comparison_curvature(point.course_distance_m, points, distances, settings)
    if comparison is not None and _curvature_unstable(
        curvature,
        comparison,
        settings.straight_curvature_threshold_1pm,
    ):
        flags.append("unstable_curvature")
        curvature = None
        radius = None

    return _tuple_with_values(
        index,
        point,
        tangent_x,
        tangent_z,
        heading_deg,
        gradient_ratio,
        gradient_pct,
        flags,
        gradient_angle_deg=gradient_angle_deg,
        signed_curvature_1pm=curvature,
        estimated_radius_m=radius,
        turn_direction=_turn_direction(curvature, settings.straight_curvature_threshold_1pm),
        slope_direction=_slope_direction(gradient_pct, settings.flat_gradient_threshold_pct),
    )


def _tuple_with_values(
    index: int,
    point: ReferencePoint,
    tangent_x: float | None,
    tangent_z: float | None,
    heading_deg: float | None,
    gradient_ratio: float | None,
    gradient_pct: float | None,
    flags: list[str],
    *,
    gradient_angle_deg: float | None = None,
    signed_curvature_1pm: float | None = None,
    estimated_radius_m: float | None = None,
    turn_direction: str = "unknown",
    slope_direction: str = "unknown",
) -> list[Any]:
    return [
        index,
        point.course_distance_m,
        point.section_id,
        _clean_float(tangent_x),
        _clean_float(tangent_z),
        _clean_float(heading_deg),
        _clean_float(gradient_ratio),
        _clean_float(gradient_pct),
        _clean_float(gradient_angle_deg),
        _clean_float(signed_curvature_1pm),
        _clean_float(estimated_radius_m),
        turn_direction,
        slope_direction,
        sorted(set(flags), key=QUALITY_FLAGS.index),
    ]


def _window_indices(distances: list[float], center: float, half_window_m: float) -> range:
    left = bisect_left(distances, center - half_window_m)
    right = bisect_right(distances, center + half_window_m)
    return range(left, right)


def _primary_invalid_flags(
    indices: range,
    points: list[ReferencePoint],
    distances: list[float],
) -> list[str]:
    flags: list[str] = []
    selected = list(indices)
    if len(selected) < 7 or distances[selected[-1]] - distances[selected[0]] < 10.0:
        flags.append("insufficient_neighbors")
    if len(selected) >= 2:
        for left, right in zip(selected, selected[1:]):
            delta_s = distances[right] - distances[left]
            if delta_s > 2.5:
                flags.append("distance_gap")
            delta_xyz = math.sqrt(
                (points[right].display_x - points[left].display_x) ** 2
                + (points[right].display_y - points[left].display_y) ** 2
                + (points[right].display_z - points[left].display_z) ** 2
            )
            if delta_xyz > max(5.0, 3.0 * delta_s):
                flags.append("source_discontinuity")
    return sorted(set(flags), key=QUALITY_FLAGS.index)


def _fit_local_quadratic(center: float, indices: range, points: list[ReferencePoint]) -> LocalFit:
    rows = []
    xs = []
    ys = []
    zs = []
    for index in indices:
        point = points[index]
        u = point.course_distance_m - center
        rows.append((1.0, u, u * u))
        xs.append(point.display_x)
        ys.append(point.display_y)
        zs.append(point.display_z)
    ax = _least_squares_3(rows, xs)
    ay = _least_squares_3(rows, ys)
    az = _least_squares_3(rows, zs)
    return LocalFit(
        dx_ds=ax[1],
        dy_ds=ay[1],
        dz_ds=az[1],
        d2x_ds2=2.0 * ax[2],
        d2z_ds2=2.0 * az[2],
    )


def _least_squares_3(rows: list[tuple[float, float, float]], values: list[float]) -> tuple[float, float, float]:
    normal = [[0.0, 0.0, 0.0] for _ in range(3)]
    rhs = [0.0, 0.0, 0.0]
    for row, value in zip(rows, values):
        for i in range(3):
            rhs[i] += row[i] * value
            for j in range(3):
                normal[i][j] += row[i] * row[j]
    return _solve_3x3(normal, rhs)


def _solve_3x3(matrix: list[list[float]], rhs: list[float]) -> tuple[float, float, float]:
    a = [row[:] + [rhs[index]] for index, row in enumerate(matrix)]
    for pivot_index in range(3):
        pivot_row = max(range(pivot_index, 3), key=lambda row: abs(a[row][pivot_index]))
        if abs(a[pivot_row][pivot_index]) < 1e-12:
            raise ValueError("local quadratic fit is singular")
        a[pivot_index], a[pivot_row] = a[pivot_row], a[pivot_index]
        pivot = a[pivot_index][pivot_index]
        for column in range(pivot_index, 4):
            a[pivot_index][column] /= pivot
        for row in range(3):
            if row == pivot_index:
                continue
            factor = a[row][pivot_index]
            for column in range(pivot_index, 4):
                a[row][column] -= factor * a[pivot_index][column]
    return (a[0][3], a[1][3], a[2][3])


def _comparison_curvature(
    center: float,
    points: list[ReferencePoint],
    distances: list[float],
    settings: GeometrySettings,
) -> float | None:
    indices = _window_indices(distances, center, settings.stability_half_window_m)
    invalid_flags = _primary_invalid_flags(indices, points, distances)
    if invalid_flags:
        return None
    fit = _fit_local_quadratic(center, indices, points)
    horizontal_norm_sq = fit.dx_ds * fit.dx_ds + fit.dz_ds * fit.dz_ds
    if math.sqrt(horizontal_norm_sq) < 0.2:
        return None
    return (fit.dx_ds * fit.d2z_ds2 - fit.dz_ds * fit.d2x_ds2) / max(horizontal_norm_sq**1.5, 1e-12)


def _curvature_unstable(primary: float, comparison: float, threshold: float) -> bool:
    if abs(primary) > threshold and abs(comparison) > threshold and primary * comparison < 0:
        return True
    return abs(primary - comparison) > max(0.002, 2.0 * min(abs(primary), abs(comparison)))


def _turn_direction(curvature: float | None, threshold: float) -> str:
    if curvature is None:
        return "unknown"
    if abs(curvature) < threshold:
        return "straight"
    return "left" if curvature >= threshold else "right"


def _slope_direction(gradient_pct: float | None, threshold: float) -> str:
    if gradient_pct is None:
        return "unknown"
    if abs(gradient_pct) < threshold:
        return "flat"
    return "uphill" if gradient_pct >= threshold else "downhill"


def _build_quality_summary(points: list[list[Any]]) -> dict[str, Any]:
    flags = {flag: 0 for flag in QUALITY_FLAGS}
    turn_counts = {"unknown": 0, "straight": 0, "left": 0, "right": 0}
    slope_counts = {"unknown": 0, "flat": 0, "uphill": 0, "downhill": 0}
    by_section: dict[str, dict[str, Any]] = {
        section_id: {
            "point_count": 0,
            "turn_direction_counts": {"unknown": 0, "straight": 0, "left": 0, "right": 0},
            "slope_direction_counts": {"unknown": 0, "flat": 0, "uphill": 0, "downhill": 0},
            "unstable_curvature_count": 0,
            "invalid_curvature_count": 0,
        }
        for section_id in sorted(SECTION_IDS)
    }
    for point in points:
        section_id = point[2]
        turn_counts[point[11]] += 1
        slope_counts[point[12]] += 1
        by_section[section_id]["point_count"] += 1
        by_section[section_id]["turn_direction_counts"][point[11]] += 1
        by_section[section_id]["slope_direction_counts"][point[12]] += 1
        if point[9] is None:
            by_section[section_id]["invalid_curvature_count"] += 1
        for flag in point[13]:
            flags[flag] += 1
            if flag == "unstable_curvature":
                by_section[section_id]["unstable_curvature_count"] += 1
    for section_id, summary in by_section.items():
        section_points = [point for point in points if point[2] == section_id]
        count = max(1, summary["point_count"])
        summary["median_gradient_pct"] = _clean_float(
            _percentile([point[7] for point in section_points if point[7] is not None], 50)
        )
        summary["uphill_proportion"] = summary["slope_direction_counts"]["uphill"] / count
        summary["downhill_proportion"] = summary["slope_direction_counts"]["downhill"] / count
        summary["flat_proportion"] = summary["slope_direction_counts"]["flat"] / count
        summary["left_proportion"] = summary["turn_direction_counts"]["left"] / count
        summary["right_proportion"] = summary["turn_direction_counts"]["right"] / count
        summary["straight_proportion"] = summary["turn_direction_counts"]["straight"] / count
        summary["invalid_curvature_proportion"] = summary["invalid_curvature_count"] / count
        summary["unstable_curvature_proportion"] = summary["unstable_curvature_count"] / count
    return {
        "point_count": len(points),
        "valid_heading_count": _nonnull_count(points, 5),
        "valid_gradient_count": _nonnull_count(points, 7),
        "valid_curvature_count": _nonnull_count(points, 9),
        "turn_direction_counts": turn_counts,
        "slope_direction_counts": slope_counts,
        "flag_counts": flags,
        "percentiles": {
            "gradient_pct": _percentile_block([point[7] for point in points if point[7] is not None]),
            "abs_gradient_pct": _abs_percentile_block([point[7] for point in points if point[7] is not None]),
            "signed_curvature_1pm": _percentile_block([point[9] for point in points if point[9] is not None]),
            "abs_curvature_1pm": _abs_percentile_block([point[9] for point in points if point[9] is not None]),
            "estimated_radius_m": _radius_percentile_block([point[10] for point in points if point[10] is not None]),
        },
        "by_section": by_section,
    }


def _percentile_block(values: list[float]) -> dict[str, float | None]:
    return {
        "min": _clean_float(min(values)) if values else None,
        "p05": _clean_float(_percentile(values, 5)),
        "median": _clean_float(_percentile(values, 50)),
        "p95": _clean_float(_percentile(values, 95)),
        "max": _clean_float(max(values)) if values else None,
    }


def _abs_percentile_block(values: list[float]) -> dict[str, float | None]:
    abs_values = [abs(value) for value in values]
    return {
        "p90": _clean_float(_percentile(abs_values, 90)),
        "p95": _clean_float(_percentile(abs_values, 95)),
        "p99": _clean_float(_percentile(abs_values, 99)),
    }


def _radius_percentile_block(values: list[float]) -> dict[str, float | None]:
    return {
        "min": _clean_float(min(values)) if values else None,
        "median": _clean_float(_percentile(values, 50)),
        "p95": _clean_float(_percentile(values, 95)),
        "max": _clean_float(max(values)) if values else None,
    }


def _build_display_scale(points: list[list[Any]]) -> dict[str, float | None]:
    abs_gradient = [abs(point[7]) for point in points if point[7] is not None]
    abs_curvature = [abs(point[9]) for point in points if point[9] is not None]
    gradient_p95 = _percentile(abs_gradient, 95)
    curvature_p95 = _percentile(abs_curvature, 95)
    gradient_clamp = _clamp(math.ceil(gradient_p95 or 0.0), 5.0, 20.0)
    curvature_clamp = _clamp(math.ceil((curvature_p95 or 0.0) / 0.001) * 0.001, 0.002, 0.030)
    return {
        "abs_gradient_pct_p95": _clean_float(gradient_p95),
        "abs_curvature_1pm_p95": _clean_float(curvature_p95),
        "gradient_abs_clamp_pct": gradient_clamp,
        "curvature_abs_clamp_1pm": curvature_clamp,
    }


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    position = (len(sorted_values) - 1) * percentile / 100.0
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    fraction = position - lower
    return sorted_values[lower] * (1.0 - fraction) + sorted_values[upper] * fraction


def _nonnull_count(points: list[list[Any]], column: int) -> int:
    return sum(1 for point in points if point[column] is not None)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _clean_float(value: float | None) -> float | None:
    if value is None:
        return None
    if not math.isfinite(value):
        raise ValueError("course geometry contains a non-finite value")
    rounded = round(value, 9)
    return 0.0 if rounded == -0.0 else rounded


def _validate_settings(settings: GeometrySettings) -> None:
    window_values = [settings.half_window_m, settings.stability_half_window_m]
    if any(not math.isfinite(value) or value <= 0 for value in window_values):
        raise ValueError("course geometry window settings must be finite positive values")
    threshold_values = [
        settings.straight_curvature_threshold_1pm,
        settings.flat_gradient_threshold_pct,
    ]
    if any(not math.isfinite(value) or value < 0 for value in threshold_values):
        raise ValueError("course geometry thresholds must be finite non-negative values")
    if settings.stability_half_window_m <= settings.half_window_m:
        raise ValueError("stability-half-window-m must be greater than half-window-m")


def _assert_json_safe(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("course geometry JSON contains NaN or Infinity")
    if isinstance(value, list):
        for item in value:
            _assert_json_safe(item)
    if isinstance(value, dict):
        for item in value.values():
            _assert_json_safe(item)
