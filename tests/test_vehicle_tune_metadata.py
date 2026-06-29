from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import tempfile
import unittest

from goliath.metadata.vehicle_tune import (
    SCHEMA_VERSION,
    TUNING_SECTION_ORDER,
    TUNING_UNITS,
    VEHICLE_FIELDS,
    AwdDifferentialSettings,
    FwdDifferentialSettings,
    RwdDifferentialSettings,
    empty_vehicle_tune,
    load_vehicle_tune_json,
    vehicle_tune_from_dict,
)


class VehicleTuneMetadataTests(unittest.TestCase):
    def test_vehicle_fields_are_intentionally_minimal(self) -> None:
        self.assertEqual(
            VEHICLE_FIELDS,
            (
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
            ),
        )
        self.assertNotIn("displacement", VEHICLE_FIELDS)
        self.assertNotIn("cylinder_count", VEHICLE_FIELDS)
        self.assertNotIn("aspiration", VEHICLE_FIELDS)
        self.assertNotIn("engine_swap", VEHICLE_FIELDS)

    def test_tuning_order_matches_forza_screen(self) -> None:
        self.assertEqual(
            TUNING_SECTION_ORDER,
            (
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
            ),
        )

    def test_units_are_documented(self) -> None:
        self.assertEqual(TUNING_UNITS["tire_pressure"], "bar")
        self.assertEqual(TUNING_UNITS["power"], "PS")
        self.assertEqual(TUNING_UNITS["torque"], "N·m")
        self.assertEqual(TUNING_UNITS["spring_rate"], "kgf/mm")
        self.assertEqual(TUNING_UNITS["aero_downforce"], "kgf")
        self.assertEqual(TUNING_UNITS["gear_ratio"], "unitless game value")

    def test_differential_forms_follow_drivetrain(self) -> None:
        self.assertIsInstance(empty_vehicle_tune("FWD").tune.differential, FwdDifferentialSettings)
        self.assertIsInstance(empty_vehicle_tune("RWD").tune.differential, RwdDifferentialSettings)
        self.assertIsInstance(empty_vehicle_tune("AWD").tune.differential, AwdDifferentialSettings)

    def test_save_and_load_json(self) -> None:
        document = empty_vehicle_tune("AWD")
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "tune.json"

        document.save_json(path)
        loaded = load_vehicle_tune_json(path)

        self.assertEqual(loaded.schema_version, SCHEMA_VERSION)
        self.assertEqual(asdict(loaded), asdict(document))

    def test_rejects_wrong_schema_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported vehicle tune schema"):
            vehicle_tune_from_dict({"schema_version": "old", "vehicle": {}, "tune": {}})


if __name__ == "__main__":
    unittest.main()
