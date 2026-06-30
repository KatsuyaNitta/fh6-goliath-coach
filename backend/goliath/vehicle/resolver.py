from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from goliath.telemetry.model import TelemetryRow, TelemetrySessionVehicle
from goliath.vehicle.catalog import DEFAULT_CATALOG_DIR, VehicleCatalogEntry, load_normalized_catalog, load_overrides, safe_slug, sanitize_display_name

IDENTIFICATION_SOURCES = {
    "explicit_session_metadata",
    "local_override",
    "community_catalog",
    "ordinal_fallback",
    "unknown",
}


@dataclass(frozen=True)
class VehicleIdentity:
    display_name: str
    filename_slug: str
    car_ordinal: int | None
    identification_source: str
    catalog_source: str | None = None
    catalog_sha256: str | None = None
    car_class: int | None = None
    car_performance_index: int | None = None
    drive_train: int | None = None
    car_group: int | None = None
    num_cylinders: int | None = None
    ordinal_distribution: dict[str, int] | None = None


def resolve_vehicle_identity(
    session: TelemetrySessionVehicle,
    *,
    session_metadata: dict[str, object] | None = None,
    catalog_dir: Path = DEFAULT_CATALOG_DIR,
) -> VehicleIdentity:
    explicit_name = explicit_vehicle_name(session_metadata or {})
    if explicit_name:
        ordinal = session.car_ordinal
        return _with_session_fields(
            VehicleIdentity(
                display_name=explicit_name,
                filename_slug=safe_slug(explicit_name, fallback=f"car-{ordinal}" if ordinal else "unknown-vehicle"),
                car_ordinal=ordinal,
                identification_source="explicit_session_metadata",
                ordinal_distribution=session.ordinal_distribution,
            ),
            session,
        )

    ordinal = session.car_ordinal
    catalog, provenance = load_normalized_catalog(catalog_dir)
    overrides = load_overrides(Path(catalog_dir) / "vehicle-overrides.json")
    catalog_sha256 = None
    if provenance:
        catalog_sha256_raw = provenance.get("source_sha256")
        catalog_sha256 = str(catalog_sha256_raw) if catalog_sha256_raw else None

    if ordinal is not None:
        key = str(ordinal)
        override = overrides.get(key)
        if override:
            return _with_session_fields(
                _identity_from_entry(override, ordinal, "local_override", "local_override", catalog_sha256),
                session,
            )
        entry = catalog.get(key)
        if entry:
            return _with_session_fields(
                _identity_from_entry(entry, ordinal, "community_catalog", "community_catalog", catalog_sha256),
                session,
            )
        return _with_session_fields(
            VehicleIdentity(
                display_name=f"Car {ordinal}",
                filename_slug=f"car-{ordinal}",
                car_ordinal=ordinal,
                identification_source="ordinal_fallback",
                ordinal_distribution=session.ordinal_distribution,
            ),
            session,
        )

    return _with_session_fields(
        VehicleIdentity(
            display_name="Unknown vehicle",
            filename_slug="unknown-vehicle",
            car_ordinal=None,
            identification_source="unknown",
            ordinal_distribution=session.ordinal_distribution,
        ),
        session,
    )


def explicit_vehicle_name(metadata: dict[str, object]) -> str | None:
    vehicle = metadata.get("vehicle")
    if isinstance(vehicle, dict):
        display_name = vehicle.get("display_name")
        if isinstance(display_name, str) and display_name.strip():
            return sanitize_display_name(display_name)
    vehicle_name = metadata.get("vehicle_name")
    if isinstance(vehicle_name, str) and vehicle_name.strip():
        return sanitize_display_name(vehicle_name)
    return None


def summarize_session_vehicle(rows: Iterable[TelemetryRow]) -> TelemetrySessionVehicle:
    meaningful_rows = [row for row in rows if row.car_ordinal is not None and row.car_ordinal > 0]
    distribution = Counter(str(row.car_ordinal) for row in meaningful_rows)
    if len(distribution) > 1:
        raise ValueError(f"session contains multiple car_ordinal values: {dict(distribution)}")
    representative = meaningful_rows[0] if meaningful_rows else None
    return TelemetrySessionVehicle(
        car_ordinal=representative.car_ordinal if representative else None,
        car_class=representative.car_class if representative else None,
        car_performance_index=representative.car_performance_index if representative else None,
        drive_train=representative.drive_train if representative else None,
        car_group=representative.car_group if representative else None,
        num_cylinders=representative.num_cylinders if representative else None,
        ordinal_distribution=dict(distribution),
    )


def vehicle_identity_payload(identity: VehicleIdentity) -> dict[str, object]:
    return {key: value for key, value in asdict(identity).items() if value is not None}


def _identity_from_entry(
    entry: VehicleCatalogEntry,
    ordinal: int,
    identification_source: str,
    catalog_source: str | None,
    catalog_sha256: str | None,
) -> VehicleIdentity:
    return VehicleIdentity(
        display_name=entry.display_name,
        filename_slug=entry.filename_slug,
        car_ordinal=ordinal,
        identification_source=identification_source,
        catalog_source=catalog_source,
        catalog_sha256=catalog_sha256,
    )


def _with_session_fields(identity: VehicleIdentity, session: TelemetrySessionVehicle) -> VehicleIdentity:
    return VehicleIdentity(
        display_name=identity.display_name,
        filename_slug=identity.filename_slug,
        car_ordinal=identity.car_ordinal,
        identification_source=identity.identification_source,
        catalog_source=identity.catalog_source,
        catalog_sha256=identity.catalog_sha256,
        car_class=session.car_class,
        car_performance_index=session.car_performance_index,
        drive_train=session.drive_train,
        car_group=session.car_group,
        num_cylinders=session.num_cylinders,
        ordinal_distribution=session.ordinal_distribution,
    )