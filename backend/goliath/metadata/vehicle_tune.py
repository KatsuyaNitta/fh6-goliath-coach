from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
from typing import Any, Literal

Drivetrain = Literal["FWD", "RWD", "AWD"]

SCHEMA_VERSION = "goliath-vehicle-tune-v1"

VEHICLE_FIELDS = (
    "name",
    "year",
    "car_class",
    "pi",
    "drivetrain",
    "power_ps",
    "torque_nm",
    "weight_kg",
    "front_weight_distribution_percent",
    "engine_notes",
)

TUNING_SECTION_ORDER = (
    "tires",
    "gearing",
    "alignment",
    "anti_roll_bars",
    "springs",
    "ride_height",
    "damping",
    "aero",
    "brakes",
    "differential",
)

TUNING_UNITS = {
    "tire_pressure": "bar",
    "power": "PS",
    "torque": "N·m",
    "weight": "kg",
    "weight_distribution": "percent",
    "camber": "degrees",
    "toe": "degrees",
    "caster": "degrees",
    "spring_rate": "kgf/mm",
    "ride_height": "cm",
    "aero_downforce": "kgf",
    "brake_balance": "percent",
    "brake_pressure": "percent",
    "differential": "percent",
    "gear_ratio": "unitless game value",
    "anti_roll_bar": "unitless game value",
    "rebound": "unitless game value",
    "bump": "unitless game value",
}


@dataclass(frozen=True)
class VehicleMetadata:
    name: str = ""
    year: int | None = None
    car_class: str = ""
    pi: int | None = None
    drivetrain: Drivetrain = "RWD"
    power_ps: float | None = None
    torque_nm: float | None = None
    weight_kg: float | None = None
    front_weight_distribution_percent: float | None = None
    engine_notes: str = ""


@dataclass(frozen=True)
class TireSettings:
    front_pressure_bar: float | None = None
    rear_pressure_bar: float | None = None


@dataclass(frozen=True)
class GearingSettings:
    final_drive: float | None = None
    gear_ratios: dict[str, float] | None = None


@dataclass(frozen=True)
class AlignmentSettings:
    front_camber_degrees: float | None = None
    rear_camber_degrees: float | None = None
    front_toe_degrees: float | None = None
    rear_toe_degrees: float | None = None
    front_caster_degrees: float | None = None


@dataclass(frozen=True)
class AxlePairSettings:
    front: float | None = None
    rear: float | None = None


@dataclass(frozen=True)
class DampingSettings:
    front_rebound: float | None = None
    rear_rebound: float | None = None
    front_bump: float | None = None
    rear_bump: float | None = None


@dataclass(frozen=True)
class BrakeSettings:
    balance_percent: float | None = None
    pressure_percent: float | None = None


@dataclass(frozen=True)
class FwdDifferentialSettings:
    front_acceleration_percent: float | None = None
    front_deceleration_percent: float | None = None


@dataclass(frozen=True)
class RwdDifferentialSettings:
    rear_acceleration_percent: float | None = None
    rear_deceleration_percent: float | None = None


@dataclass(frozen=True)
class AwdDifferentialSettings:
    front_acceleration_percent: float | None = None
    front_deceleration_percent: float | None = None
    rear_acceleration_percent: float | None = None
    rear_deceleration_percent: float | None = None
    center_balance_percent: float | None = None


DifferentialSettings = FwdDifferentialSettings | RwdDifferentialSettings | AwdDifferentialSettings


@dataclass(frozen=True)
class TuneSettings:
    tires: TireSettings
    gearing: GearingSettings
    alignment: AlignmentSettings
    anti_roll_bars: AxlePairSettings
    springs: AxlePairSettings
    ride_height: AxlePairSettings
    damping: DampingSettings
    aero: AxlePairSettings
    brakes: BrakeSettings
    differential: DifferentialSettings


@dataclass(frozen=True)
class VehicleTuneDocument:
    schema_version: str
    vehicle: VehicleMetadata
    tune: TuneSettings

    def to_json_text(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)

    def save_json(self, path: Path) -> None:
        path.write_text(self.to_json_text(), encoding="utf-8")


def empty_tune_for_drivetrain(drivetrain: Drivetrain) -> TuneSettings:
    return TuneSettings(
        tires=TireSettings(),
        gearing=GearingSettings(gear_ratios={}),
        alignment=AlignmentSettings(),
        anti_roll_bars=AxlePairSettings(),
        springs=AxlePairSettings(),
        ride_height=AxlePairSettings(),
        damping=DampingSettings(),
        aero=AxlePairSettings(),
        brakes=BrakeSettings(),
        differential=_empty_differential(drivetrain),
    )


def empty_vehicle_tune(drivetrain: Drivetrain = "RWD") -> VehicleTuneDocument:
    return VehicleTuneDocument(
        schema_version=SCHEMA_VERSION,
        vehicle=VehicleMetadata(drivetrain=drivetrain),
        tune=empty_tune_for_drivetrain(drivetrain),
    )


def load_vehicle_tune_json(path: Path) -> VehicleTuneDocument:
    return vehicle_tune_from_dict(json.loads(path.read_text(encoding="utf-8")))


def vehicle_tune_from_dict(data: dict[str, Any]) -> VehicleTuneDocument:
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"unsupported vehicle tune schema version: {data.get('schema_version')}")

    vehicle = VehicleMetadata(**data["vehicle"])
    _validate_drivetrain(vehicle.drivetrain)
    tune_data = data["tune"]
    differential = _differential_from_dict(vehicle.drivetrain, tune_data["differential"])
    return VehicleTuneDocument(
        schema_version=SCHEMA_VERSION,
        vehicle=vehicle,
        tune=TuneSettings(
            tires=TireSettings(**tune_data["tires"]),
            gearing=GearingSettings(**tune_data["gearing"]),
            alignment=AlignmentSettings(**tune_data["alignment"]),
            anti_roll_bars=AxlePairSettings(**tune_data["anti_roll_bars"]),
            springs=AxlePairSettings(**tune_data["springs"]),
            ride_height=AxlePairSettings(**tune_data["ride_height"]),
            damping=DampingSettings(**tune_data["damping"]),
            aero=AxlePairSettings(**tune_data["aero"]),
            brakes=BrakeSettings(**tune_data["brakes"]),
            differential=differential,
        ),
    )


def _empty_differential(drivetrain: Drivetrain) -> DifferentialSettings:
    _validate_drivetrain(drivetrain)
    if drivetrain == "FWD":
        return FwdDifferentialSettings()
    if drivetrain == "RWD":
        return RwdDifferentialSettings()
    return AwdDifferentialSettings()


def _differential_from_dict(drivetrain: Drivetrain, data: dict[str, Any]) -> DifferentialSettings:
    _validate_drivetrain(drivetrain)
    if drivetrain == "FWD":
        return FwdDifferentialSettings(**data)
    if drivetrain == "RWD":
        return RwdDifferentialSettings(**data)
    return AwdDifferentialSettings(**data)


def _validate_drivetrain(drivetrain: str) -> None:
    if drivetrain not in {"FWD", "RWD", "AWD"}:
        raise ValueError(f"unsupported drivetrain: {drivetrain}")
