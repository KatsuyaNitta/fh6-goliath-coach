export type Drivetrain = "FWD" | "RWD" | "AWD";
export type VehicleDrivetrain = Drivetrain | null;

export const VEHICLE_TUNE_SCHEMA_VERSION_V1 = "goliath-vehicle-tune-v1";
export const VEHICLE_TUNE_SCHEMA_VERSION = "goliath-vehicle-tune-v2";

export const TUNING_SECTION_ORDER = [
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
] as const;

export const TUNING_UNITS = {
  tirePressure: "bar",
  power: "PS",
  torque: "NM",
  weight: "KG",
  weightDistribution: "%",
  angle: "",
  springRate: "KGF/MM",
  rideHeight: "cm",
  aeroDownforce: "kgf",
  percent: "%",
  unitlessGameValue: "",
};

export interface VehicleMetadata {
  name: string;
  year: number | null;
  car_class: string;
  pi: number | null;
  drivetrain: VehicleDrivetrain;
  power_ps: number | null;
  torque_nm: number | null;
  weight_kg: number | null;
  front_weight_distribution_percent: number | null;
  engine_notes: string;
}

export interface VehicleTuneDocument {
  schema_version: typeof VEHICLE_TUNE_SCHEMA_VERSION;
  vehicle: VehicleMetadata;
  tune: TuneSettings;
}

export interface TuneSettings {
  tires: {
    front_pressure_bar: number | null;
    rear_pressure_bar: number | null;
  };
  gearing: {
    final_drive: number | null;
    gear_ratios: Record<string, number | null>;
  };
  alignment: {
    front_camber_degrees: number | null;
    rear_camber_degrees: number | null;
    front_toe_degrees: number | null;
    rear_toe_degrees: number | null;
    front_caster_degrees: number | null;
  };
  anti_roll_bars: {
    front: number | null;
    rear: number | null;
  };
  springs: {
    front: number | null;
    rear: number | null;
  };
  ride_height: {
    front: number | null;
    rear: number | null;
  };
  damping: {
    front_rebound: number | null;
    rear_rebound: number | null;
    front_bump: number | null;
    rear_bump: number | null;
  };
  aero: {
    front: number | null;
    rear: number | null;
  };
  brakes: {
    balance_percent: number | null;
    pressure_percent: number | null;
  };
  differential: DifferentialSettings | null;
}

export type DifferentialSettings =
  | {
      front_acceleration_percent: number | null;
      front_deceleration_percent: number | null;
    }
  | {
      rear_acceleration_percent: number | null;
      rear_deceleration_percent: number | null;
    }
  | {
      front_acceleration_percent: number | null;
      front_deceleration_percent: number | null;
      rear_acceleration_percent: number | null;
      rear_deceleration_percent: number | null;
      center_balance_percent: number | null;
    };

export function createEmptyVehicleTune(drivetrain: VehicleDrivetrain = null): VehicleTuneDocument {
  return {
    schema_version: VEHICLE_TUNE_SCHEMA_VERSION,
    vehicle: {
      name: "",
      year: null,
      car_class: "",
      pi: null,
      drivetrain,
      power_ps: null,
      torque_nm: null,
      weight_kg: null,
      front_weight_distribution_percent: null,
      engine_notes: "",
    },
    tune: {
      tires: {
        front_pressure_bar: null,
        rear_pressure_bar: null,
      },
      gearing: {
        final_drive: null,
        gear_ratios: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`gear_${index + 1}`, null]),
        ),
      },
      alignment: {
        front_camber_degrees: null,
        rear_camber_degrees: null,
        front_toe_degrees: null,
        rear_toe_degrees: null,
        front_caster_degrees: null,
      },
      anti_roll_bars: {
        front: null,
        rear: null,
      },
      springs: {
        front: null,
        rear: null,
      },
      ride_height: {
        front: null,
        rear: null,
      },
      damping: {
        front_rebound: null,
        rear_rebound: null,
        front_bump: null,
        rear_bump: null,
      },
      aero: {
        front: null,
        rear: null,
      },
      brakes: {
        balance_percent: null,
        pressure_percent: null,
      },
      differential: drivetrain === null ? null : createEmptyDifferential(drivetrain),
    },
  };
}

export function createEmptyDifferential(drivetrain: Drivetrain): DifferentialSettings {
  if (drivetrain === "FWD") {
    return {
      front_acceleration_percent: null,
      front_deceleration_percent: null,
    };
  }
  if (drivetrain === "AWD") {
    return {
      front_acceleration_percent: null,
      front_deceleration_percent: null,
      rear_acceleration_percent: null,
      rear_deceleration_percent: null,
      center_balance_percent: null,
    };
  }
  if (drivetrain === "RWD") {
    return {
      rear_acceleration_percent: null,
      rear_deceleration_percent: null,
    };
  }
  const exhaustive: never = drivetrain;
  throw new Error(`Unsupported drivetrain: ${exhaustive}`);
}

export function parseVehicleTuneJson(text: string): VehicleTuneDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Vehicle tune JSON must be an object.");
  }
  const schemaVersion = parsed.schema_version;
  if (schemaVersion === VEHICLE_TUNE_SCHEMA_VERSION_V1) {
    return normalizeVehicleTuneDocument(parsed, false);
  }
  if (schemaVersion === VEHICLE_TUNE_SCHEMA_VERSION) {
    return normalizeVehicleTuneDocument(parsed, true);
  }
  throw new Error(`Unsupported vehicle tune schema: ${String(schemaVersion)}`);
}

export function serializeVehicleTuneJson(document: VehicleTuneDocument): string {
  validateDrivetrainDifferential(document.vehicle.drivetrain, document.tune.differential, true);
  return JSON.stringify({ ...document, schema_version: VEHICLE_TUNE_SCHEMA_VERSION }, null, 2);
}

function normalizeVehicleTuneDocument(raw: Record<string, unknown>, strictNullable: boolean): VehicleTuneDocument {
  const vehicle = readRecord(raw.vehicle, "vehicle");
  const tune = readRecord(raw.tune, "tune");
  if (strictNullable && !("drivetrain" in vehicle)) {
    throw new Error("Vehicle tune v2 is missing vehicle.drivetrain.");
  }
  if (strictNullable && !("differential" in tune)) {
    throw new Error("Vehicle tune v2 is missing tune.differential.");
  }

  const drivetrain = parseDrivetrain(vehicle.drivetrain, strictNullable);
  const differential = "differential" in tune ? tune.differential : undefined;
  validateDrivetrainDifferential(drivetrain, differential, strictNullable);

  return {
    ...(raw as Omit<VehicleTuneDocument, "schema_version" | "vehicle" | "tune">),
    schema_version: VEHICLE_TUNE_SCHEMA_VERSION,
    vehicle: {
      ...(vehicle as Omit<VehicleMetadata, "drivetrain">),
      drivetrain,
    } as VehicleMetadata,
    tune: {
      ...(tune as Omit<TuneSettings, "differential">),
      differential: differential as DifferentialSettings | null,
    } as TuneSettings,
  };
}

function parseDrivetrain(value: unknown, allowNull: boolean): VehicleDrivetrain {
  if (value === null && allowNull) {
    return null;
  }
  if (value === "FWD" || value === "RWD" || value === "AWD") {
    return value;
  }
  throw new Error(`Unsupported drivetrain: ${String(value)}`);
}

function validateDrivetrainDifferential(
  drivetrain: VehicleDrivetrain,
  differential: unknown,
  allowNull: boolean,
): void {
  if (drivetrain === null) {
    if (!allowNull || differential !== null) {
      throw new Error("Unset drivetrain requires differential: null.");
    }
    return;
  }

  if (!isRecord(differential)) {
    throw new Error(`${drivetrain} drivetrain requires a matching differential object.`);
  }

  const keys = Object.keys(differential).sort();
  const expected = expectedDifferentialKeys(drivetrain).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${drivetrain} drivetrain has an incompatible differential shape.`);
  }

  for (const key of expected) {
    const value = differential[key];
    if (value !== null && typeof value !== "number") {
      throw new Error(`Differential field ${key} must be a number or null.`);
    }
  }
}

function expectedDifferentialKeys(drivetrain: Drivetrain): string[] {
  switch (drivetrain) {
    case "FWD":
      return ["front_acceleration_percent", "front_deceleration_percent"];
    case "RWD":
      return ["rear_acceleration_percent", "rear_deceleration_percent"];
    case "AWD":
      return [
        "center_balance_percent",
        "front_acceleration_percent",
        "front_deceleration_percent",
        "rear_acceleration_percent",
        "rear_deceleration_percent",
      ];
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Vehicle tune JSON must include ${label}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
