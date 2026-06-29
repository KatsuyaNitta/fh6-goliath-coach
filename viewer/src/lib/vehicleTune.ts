export type Drivetrain = "FWD" | "RWD" | "AWD";

export const VEHICLE_TUNE_SCHEMA_VERSION = "goliath-vehicle-tune-v1";

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
  torque: "N·m",
  weight: "kg",
  weightDistribution: "%",
  angle: "deg",
  springRate: "kgf/mm",
  rideHeight: "cm",
  aeroDownforce: "kgf",
  percent: "%",
  unitlessGameValue: "game",
};

export interface VehicleMetadata {
  name: string;
  year: number | null;
  car_class: string;
  pi: number | null;
  drivetrain: Drivetrain;
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
  differential: DifferentialSettings;
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

export function createEmptyVehicleTune(drivetrain: Drivetrain = "RWD"): VehicleTuneDocument {
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
      differential: createEmptyDifferential(drivetrain),
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
  return {
    rear_acceleration_percent: null,
    rear_deceleration_percent: null,
  };
}

export function parseVehicleTuneJson(text: string): VehicleTuneDocument {
  const parsed = JSON.parse(text) as VehicleTuneDocument;
  if (parsed.schema_version !== VEHICLE_TUNE_SCHEMA_VERSION) {
    throw new Error(`Unsupported vehicle tune schema: ${parsed.schema_version}`);
  }
  if (!["FWD", "RWD", "AWD"].includes(parsed.vehicle.drivetrain)) {
    throw new Error(`Unsupported drivetrain: ${parsed.vehicle.drivetrain}`);
  }
  return parsed;
}
