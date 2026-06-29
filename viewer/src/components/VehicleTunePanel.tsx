import { useRef, useState } from "react";
import type { Drivetrain, VehicleTuneDocument } from "../lib/vehicleTune";
import {
  TUNING_UNITS,
  createEmptyDifferential,
  createEmptyVehicleTune,
  parseVehicleTuneJson,
} from "../lib/vehicleTune";

type NumberPathSetter = (value: number | null) => void;

export function VehicleTunePanel() {
  const [document, setDocument] = useState<VehicleTuneDocument>(() => createEmptyVehicleTune("RWD"));
  const [message, setMessage] = useState<string>("Ready");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateDocument = (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => {
    setDocument((current) => updater(current));
  };

  const setVehicle = <K extends keyof VehicleTuneDocument["vehicle"]>(
    key: K,
    value: VehicleTuneDocument["vehicle"][K],
  ) => {
    updateDocument((current) => {
      const next: VehicleTuneDocument = {
        ...current,
        vehicle: { ...current.vehicle, [key]: value },
      };
      if (key === "drivetrain") {
        next.tune = {
          ...next.tune,
          differential: createEmptyDifferential(value as Drivetrain),
        };
      }
      return next;
    });
  };

  const saveJson = () => {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    const safeName = document.vehicle.name.trim().replace(/[^a-z0-9_-]+/gi, "-") || "vehicle-tune";
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("JSON saved");
  };

  const loadJson = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      setDocument(parseVehicleTuneJson(await file.text()));
      setMessage(`Loaded ${file.name}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load JSON");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="metadata-panel" aria-label="Vehicle and tune metadata">
      <div className="panel-heading">
        <h2>Vehicle & Tune</h2>
        <p>Minimal vehicle specs. Engine details beyond notes stay free-text.</p>
      </div>

      <div className="metadata-actions">
        <button className="command-button" type="button" onClick={saveJson}>
          Save JSON
        </button>
        <button className="command-button" type="button" onClick={() => fileInputRef.current?.click()}>
          Load JSON
        </button>
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void loadJson(event.target.files?.[0])}
        />
      </div>
      <p className="status-text">{message}</p>

      <fieldset className="form-section">
        <legend>Vehicle</legend>
        <TextField label="Vehicle name" value={document.vehicle.name} onChange={(value) => setVehicle("name", value)} />
        <NumberField label="Year" value={document.vehicle.year} onChange={(value) => setVehicle("year", value)} />
        <TextField label="Class" value={document.vehicle.car_class} onChange={(value) => setVehicle("car_class", value)} />
        <NumberField label="PI" value={document.vehicle.pi} onChange={(value) => setVehicle("pi", value)} />
        <label className="field-row">
          <span>Drivetrain</span>
          <select
            value={document.vehicle.drivetrain}
            onChange={(event) => setVehicle("drivetrain", event.target.value as Drivetrain)}
          >
            <option value="FWD">FWD</option>
            <option value="RWD">RWD</option>
            <option value="AWD">AWD</option>
          </select>
        </label>
        <NumberField
          label="Power"
          unit={TUNING_UNITS.power}
          value={document.vehicle.power_ps}
          onChange={(value) => setVehicle("power_ps", value)}
        />
        <NumberField
          label="Torque"
          unit={TUNING_UNITS.torque}
          value={document.vehicle.torque_nm}
          onChange={(value) => setVehicle("torque_nm", value)}
        />
        <NumberField
          label="Weight"
          unit={TUNING_UNITS.weight}
          value={document.vehicle.weight_kg}
          onChange={(value) => setVehicle("weight_kg", value)}
        />
        <NumberField
          label="Front weight"
          unit={TUNING_UNITS.weightDistribution}
          value={document.vehicle.front_weight_distribution_percent}
          onChange={(value) => setVehicle("front_weight_distribution_percent", value)}
        />
        <label className="field-row field-row-wide">
          <span>Engine notes</span>
          <textarea
            value={document.vehicle.engine_notes}
            onChange={(event) => setVehicle("engine_notes", event.target.value)}
          />
        </label>
      </fieldset>

      <TuneSections document={document} updateDocument={updateDocument} />
    </section>
  );
}

function TuneSections({
  document,
  updateDocument,
}: {
  document: VehicleTuneDocument;
  updateDocument: (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => void;
}) {
  const setTune = <K extends keyof VehicleTuneDocument["tune"]>(
    section: K,
    value: VehicleTuneDocument["tune"][K],
  ) => {
    updateDocument((current) => ({
      ...current,
      tune: { ...current.tune, [section]: value },
    }));
  };

  return (
    <>
      <fieldset className="form-section">
        <legend>1. Tires</legend>
        <NumberField
          label="Front pressure"
          unit={TUNING_UNITS.tirePressure}
          value={document.tune.tires.front_pressure_bar}
          onChange={setNestedNumber((value) => setTune("tires", { ...document.tune.tires, front_pressure_bar: value }))}
        />
        <NumberField
          label="Rear pressure"
          unit={TUNING_UNITS.tirePressure}
          value={document.tune.tires.rear_pressure_bar}
          onChange={setNestedNumber((value) => setTune("tires", { ...document.tune.tires, rear_pressure_bar: value }))}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>2. Gearing</legend>
        <NumberField
          label="Final drive"
          unit={TUNING_UNITS.unitlessGameValue}
          value={document.tune.gearing.final_drive}
          onChange={(value) => setTune("gearing", { ...document.tune.gearing, final_drive: value })}
        />
        {Object.entries(document.tune.gearing.gear_ratios).map(([gear, value]) => (
          <NumberField
            key={gear}
            label={gear.replace("_", " ").toUpperCase()}
            unit={TUNING_UNITS.unitlessGameValue}
            value={value}
            onChange={(nextValue) =>
              setTune("gearing", {
                ...document.tune.gearing,
                gear_ratios: { ...document.tune.gearing.gear_ratios, [gear]: nextValue },
              })
            }
          />
        ))}
      </fieldset>

      <fieldset className="form-section">
        <legend>3. Alignment</legend>
        <NumberField label="Front camber" unit={TUNING_UNITS.angle} value={document.tune.alignment.front_camber_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_camber_degrees: value })} />
        <NumberField label="Rear camber" unit={TUNING_UNITS.angle} value={document.tune.alignment.rear_camber_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, rear_camber_degrees: value })} />
        <NumberField label="Front toe" unit={TUNING_UNITS.angle} value={document.tune.alignment.front_toe_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_toe_degrees: value })} />
        <NumberField label="Rear toe" unit={TUNING_UNITS.angle} value={document.tune.alignment.rear_toe_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, rear_toe_degrees: value })} />
        <NumberField label="Front caster" unit={TUNING_UNITS.angle} value={document.tune.alignment.front_caster_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_caster_degrees: value })} />
      </fieldset>

      <AxleSection title="4. Anti-roll bars" unit={TUNING_UNITS.unitlessGameValue} value={document.tune.anti_roll_bars} onChange={(value) => setTune("anti_roll_bars", value)} />
      <AxleSection title="5. Springs" unit={TUNING_UNITS.springRate} value={document.tune.springs} onChange={(value) => setTune("springs", value)} />
      <AxleSection title="6. Ride height" unit={TUNING_UNITS.rideHeight} value={document.tune.ride_height} onChange={(value) => setTune("ride_height", value)} />

      <fieldset className="form-section">
        <legend>7. Damping</legend>
        <NumberField label="Front rebound" unit={TUNING_UNITS.unitlessGameValue} value={document.tune.damping.front_rebound} onChange={(value) => setTune("damping", { ...document.tune.damping, front_rebound: value })} />
        <NumberField label="Rear rebound" unit={TUNING_UNITS.unitlessGameValue} value={document.tune.damping.rear_rebound} onChange={(value) => setTune("damping", { ...document.tune.damping, rear_rebound: value })} />
        <NumberField label="Front bump" unit={TUNING_UNITS.unitlessGameValue} value={document.tune.damping.front_bump} onChange={(value) => setTune("damping", { ...document.tune.damping, front_bump: value })} />
        <NumberField label="Rear bump" unit={TUNING_UNITS.unitlessGameValue} value={document.tune.damping.rear_bump} onChange={(value) => setTune("damping", { ...document.tune.damping, rear_bump: value })} />
      </fieldset>

      <AxleSection title="8. Aero" unit={TUNING_UNITS.aeroDownforce} value={document.tune.aero} onChange={(value) => setTune("aero", value)} />

      <fieldset className="form-section">
        <legend>9. Brakes</legend>
        <NumberField label="Balance" unit={TUNING_UNITS.percent} value={document.tune.brakes.balance_percent} onChange={(value) => setTune("brakes", { ...document.tune.brakes, balance_percent: value })} />
        <NumberField label="Pressure" unit={TUNING_UNITS.percent} value={document.tune.brakes.pressure_percent} onChange={(value) => setTune("brakes", { ...document.tune.brakes, pressure_percent: value })} />
      </fieldset>

      <DifferentialSection document={document} updateDocument={updateDocument} />
    </>
  );
}

function DifferentialSection({
  document,
  updateDocument,
}: {
  document: VehicleTuneDocument;
  updateDocument: (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => void;
}) {
  const differential = document.tune.differential;
  const setDifferential = (value: typeof differential) => {
    updateDocument((current) => ({
      ...current,
      tune: { ...current.tune, differential: value },
    }));
  };

  return (
    <fieldset className="form-section">
      <legend>10. Differential</legend>
      {"front_acceleration_percent" in differential ? (
        <>
          <NumberField label="Front accel" unit={TUNING_UNITS.percent} value={differential.front_acceleration_percent} onChange={(value) => setDifferential({ ...differential, front_acceleration_percent: value })} />
          <NumberField label="Front decel" unit={TUNING_UNITS.percent} value={differential.front_deceleration_percent} onChange={(value) => setDifferential({ ...differential, front_deceleration_percent: value })} />
        </>
      ) : null}
      {"rear_acceleration_percent" in differential ? (
        <>
          <NumberField label="Rear accel" unit={TUNING_UNITS.percent} value={differential.rear_acceleration_percent} onChange={(value) => setDifferential({ ...differential, rear_acceleration_percent: value })} />
          <NumberField label="Rear decel" unit={TUNING_UNITS.percent} value={differential.rear_deceleration_percent} onChange={(value) => setDifferential({ ...differential, rear_deceleration_percent: value })} />
        </>
      ) : null}
      {"center_balance_percent" in differential ? (
        <NumberField label="Center balance" unit={TUNING_UNITS.percent} value={differential.center_balance_percent} onChange={(value) => setDifferential({ ...differential, center_balance_percent: value })} />
      ) : null}
    </fieldset>
  );
}

function AxleSection({
  title,
  unit,
  value,
  onChange,
}: {
  title: string;
  unit: string;
  value: { front: number | null; rear: number | null };
  onChange: (value: { front: number | null; rear: number | null }) => void;
}) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <NumberField label="Front" unit={unit} value={value.front} onChange={(front) => onChange({ ...value, front })} />
      <NumberField label="Rear" unit={unit} value={value.rear} onChange={(rear) => onChange({ ...value, rear })} />
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | null;
  onChange: NumberPathSetter;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <span className="numeric-input">
        <input
          type="number"
          step="any"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
        {unit ? <em>{unit}</em> : null}
      </span>
    </label>
  );
}

function setNestedNumber(setter: NumberPathSetter): NumberPathSetter {
  return setter;
}
