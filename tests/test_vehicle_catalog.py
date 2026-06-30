from __future__ import annotations

import csv
import json
from pathlib import Path
import tempfile
import unittest

from goliath.telemetry.importer import load_telemetry_session
from goliath.telemetry.processor import process_session
from goliath.vehicle.catalog import import_vehicle_catalog, normalize_source_catalog, parse_ordinal, safe_slug
from goliath.vehicle.resolver import resolve_vehicle_identity, summarize_session_vehicle

REFERENCE_CSV = Path("data/reference/goliath_reference_1m.csv")
FIXTURE_SESSION = Path("tests/fixtures/b1_session")


class VehicleCatalogTests(unittest.TestCase):
    def write_source(self, directory: Path, payload: dict[str, object]) -> Path:
        path = directory / "source.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_source_mapping_is_inverted_and_valid_ordinals_are_accepted(self) -> None:
        vehicles, duplicates, rejected = normalize_source_catalog({"2020 Lamborghini Essenza SCV12": "3606"})
        self.assertEqual(vehicles["3606"].display_name, "2020 Lamborghini Essenza SCV12")
        self.assertEqual(vehicles["3606"].filename_slug, "2020-lamborghini-essenza-scv12")
        self.assertEqual(vehicles["3606"].year, 2020)
        self.assertEqual(duplicates, [])
        self.assertEqual(rejected, 0)
        self.assertEqual(parse_ordinal("3781"), 3781)

    def test_invalid_negative_and_null_placeholder_entries_are_rejected(self) -> None:
        vehicles, _duplicates, rejected = normalize_source_catalog({
            "Valid Car": "1",
            "Bad Ordinal": "abc",
            "Negative": "-5",
            "NUL_CAR_TEST": "2",
        })
        self.assertEqual(set(vehicles), {"1"})
        self.assertEqual(rejected, 3)

    def test_bidi_and_control_characters_cannot_reach_filename(self) -> None:
        slug = safe_slug("2023 Por\u202esche 911 GT3 RS\x00", fallback="car-3781")
        self.assertEqual(slug, "2023-porsche-911-gt3-rs")

    def test_duplicate_ordinals_are_reported_not_overwritten(self) -> None:
        vehicles, duplicates, rejected = normalize_source_catalog({"First Car": "10", "Second Car": "10"})
        self.assertEqual(vehicles["10"].display_name, "First Car")
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(rejected, 1)

    def test_overrides_take_precedence_and_provenance_counts_are_written(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.write_source(root, {"Catalog Name": "3606"})
            catalog_dir = root / "catalog"
            (catalog_dir).mkdir()
            (catalog_dir / "vehicle-overrides.json").write_text(
                json.dumps({"3606": {"display_name": "2020 Lamborghini Essenza SCV12"}}),
                encoding="utf-8",
            )
            report = import_vehicle_catalog(source_file=source, catalog_dir=catalog_dir)
            normalized = json.loads((catalog_dir / "normalized" / "fh6-vehicle-catalog.json").read_text(encoding="utf-8"))
            provenance = json.loads((catalog_dir / "catalog-provenance.json").read_text(encoding="utf-8"))
            self.assertEqual(normalized["vehicles"]["3606"]["display_name"], "2020 Lamborghini Essenza SCV12")
            self.assertEqual(report.override_count, 1)
            self.assertEqual(provenance["source_sha256"], report.source_sha256)
            self.assertEqual(provenance["source_entry_count"], 1)
            self.assertEqual(provenance["accepted_entry_count"], 1)

    def test_vehicle_resolution_precedence_and_fallbacks(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.write_source(root, {"Community Car": "3606"})
            catalog_dir = root / "catalog"
            catalog_dir.mkdir()
            (catalog_dir / "vehicle-overrides.json").write_text(
                json.dumps({"3606": {"display_name": "Override Car"}}),
                encoding="utf-8",
            )
            import_vehicle_catalog(source_file=source, catalog_dir=catalog_dir)
            session = summarize_session_vehicle([row_with_ordinal(3606)])
            explicit = resolve_vehicle_identity(session, session_metadata={"vehicle": {"display_name": "Explicit Car"}}, catalog_dir=catalog_dir)
            override = resolve_vehicle_identity(session, session_metadata={}, catalog_dir=catalog_dir)
            community_session = summarize_session_vehicle([row_with_ordinal(1)])
            no_override_source = self.write_source(root, {"Community One": "1"})
            no_override_catalog = root / "catalog2"
            import_vehicle_catalog(source_file=no_override_source, catalog_dir=no_override_catalog)
            community = resolve_vehicle_identity(community_session, session_metadata={}, catalog_dir=no_override_catalog)
            unknown_ordinal = resolve_vehicle_identity(summarize_session_vehicle([row_with_ordinal(9999)]), session_metadata={}, catalog_dir=no_override_catalog)
            missing = resolve_vehicle_identity(summarize_session_vehicle([]), session_metadata={}, catalog_dir=no_override_catalog)
            self.assertEqual(explicit.identification_source, "explicit_session_metadata")
            self.assertEqual(explicit.display_name, "Explicit Car")
            self.assertEqual(override.identification_source, "local_override")
            self.assertEqual(override.display_name, "Override Car")
            self.assertEqual(community.identification_source, "community_catalog")
            self.assertEqual(community.display_name, "Community One")
            self.assertEqual(unknown_ordinal.display_name, "Car 9999")
            self.assertEqual(missing.display_name, "Unknown vehicle")

    def test_empty_slug_fallback(self) -> None:
        self.assertEqual(safe_slug("\u2603", fallback="unknown-vehicle"), "unknown-vehicle")

    def test_session_processing_works_without_catalog_and_uses_prefixed_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp) / "processed"
            catalog_dir = Path(temp) / "missing-catalog"
            summary = process_session(
                FIXTURE_SESSION,
                reference_csv=REFERENCE_CSV,
                output_root=output_root,
                vehicle_catalog_dir=catalog_dir,
            )
            vehicle = summary["vehicle"]
            self.assertEqual(vehicle["display_name"], "Unknown vehicle")
            outputs = summary["outputs"]
            projected_path = Path(outputs["projected_lap_csv"])
            rewind_path = Path(outputs["rewind_analysis_json"])
            self.assertTrue(projected_path.name.endswith("b1_session_unknown-vehicle_projected-lap.csv"))
            self.assertTrue(projected_path.exists())
            self.assertTrue(rewind_path.exists())
            rewind = json.loads(rewind_path.read_text(encoding="utf-8"))
            self.assertEqual(rewind["vehicle"]["display_name"], "Unknown vehicle")
            with projected_path.open("r", encoding="utf-8", newline="") as file:
                reader = csv.DictReader(file)
                first = next(reader)
                second = next(reader)
            self.assertEqual(first["vehicle_display_name"], "Unknown vehicle")
            self.assertEqual(first["vehicle_filename_slug"], "unknown-vehicle")
            self.assertEqual(second["vehicle_display_name"], "")


def row_with_ordinal(ordinal: int):
    from goliath.telemetry.model import TelemetryRow

    return TelemetryRow(
        source_row_index=2,
        source={},
        timestamp_s=0.0,
        lap_time_s=0.0,
        lap_number=0,
        position_x=0.0,
        position_y=0.0,
        position_z=0.0,
        speed_kmh=0.0,
        handbrake_raw=0.0,
        handbrake_pct=0.0,
        car_ordinal=ordinal,
        car_class=6,
        car_performance_index=996,
        drive_train=1,
        car_group=26,
        num_cylinders=12,
    )


if __name__ == "__main__":
    unittest.main()