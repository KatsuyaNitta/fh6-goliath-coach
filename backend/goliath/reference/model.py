from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReferencePoint:
    current_lap_time: float
    course_distance_m: float
    course_distance_km: float
    position_x: float
    position_y: float
    position_z: float
    speed_kmh: float
    display_x: float
    display_y: float
    display_z: float
    section_id: str


@dataclass(frozen=True)
class DisplayOrigin:
    position_x: float
    position_y: float
    position_z: float
