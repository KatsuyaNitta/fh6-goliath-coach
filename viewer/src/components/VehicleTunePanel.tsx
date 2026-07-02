import { useEffect, useRef, useState } from "react";
import type { Drivetrain, VehicleDrivetrain, VehicleTuneDocument } from "../lib/vehicleTune";
import {
  TUNING_UNITS,
  createEmptyDifferential,
  createEmptyVehicleTune,
  parseVehicleTuneJson,
  serializeVehicleTuneJson,
} from "../lib/vehicleTune";
import { TUNE_TEXT, uiText } from "../lib/uiText";
import {
  compareVehicleIdentities,
  deriveVehicleIdentityFromTuneDocument,
  type LoadedVehicleIdentity,
} from "../lib/vehicleIdentity";
import {
  applyTelemetryVehicleDefaults,
  type LoadedSessionVehicleMetadata,
  type VehicleAutofillSources,
} from "../lib/vehicleAutofill";

type NumberPathSetter = (value: number | null) => void;
type TuneAssociationSource = "none" | "telemetry" | "manual" | "json";

interface TuneVehicleAssociation {
  identity: LoadedVehicleIdentity | null;
  source: TuneAssociationSource;
}

interface PendingVehicleReset {
  identity: LoadedVehicleIdentity;
  metadata: LoadedSessionVehicleMetadata;
  currentName: string;
  nextName: string;
}

interface VehicleTunePanelProps {
  loadedVehicleMetadata: LoadedSessionVehicleMetadata | null;
}

export function VehicleTunePanel({ loadedVehicleMetadata }: VehicleTunePanelProps) {
  const [document, setDocument] = useState<VehicleTuneDocument>(() => createEmptyVehicleTune());
  const [message, setMessage] = useState<string>(TUNE_TEXT.ready);
  const [pendingReset, setPendingReset] = useState<PendingVehicleReset | null>(null);
  const [mismatchWarning, setMismatchWarning] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement | null>(null);
  const resetCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const vehicleFieldSourcesRef = useRef<VehicleAutofillSources>({ name: "empty", year: "empty" });
  const associationRef = useRef<TuneVehicleAssociation>({ identity: null, source: "none" });
  const protectedRef = useRef(false);

  useEffect(() => {
    if (!loadedVehicleMetadata) {
      return;
    }
    const nextIdentity = identityFromMetadata(loadedVehicleMetadata);
    setDocument((current) => handleLoadedVehicleMetadata(current, loadedVehicleMetadata, nextIdentity));
  }, [loadedVehicleMetadata]);

  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (!dialog) {
      return;
    }
    if (pendingReset) {
      if (!dialog.open) {
        dialog.showModal();
      }
      window.setTimeout(() => resetCancelButtonRef.current?.focus(), 0);
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
  }, [pendingReset]);

  const updateDocument = (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => {
    setDocument((current) => updater(current));
  };

  const markManualOwnership = () => {
    protectedRef.current = true;
    associationRef.current = {
      identity: deriveVehicleIdentityFromTuneDocument(document),
      source: "manual",
    };
  };

  const setVehicle = <K extends keyof VehicleTuneDocument["vehicle"]>(
    key: K,
    value: VehicleTuneDocument["vehicle"][K],
  ) => {
    markManualOwnership();
    if (key === "name" || key === "year") {
      vehicleFieldSourcesRef.current = {
        ...vehicleFieldSourcesRef.current,
        [key]: "manual",
      };
    }
    updateDocument((current) => {
      const next: VehicleTuneDocument = {
        ...current,
        vehicle: { ...current.vehicle, [key]: value },
      };
      if (key === "drivetrain") {
        const drivetrain = value as VehicleDrivetrain;
        next.tune = {
          ...next.tune,
          differential: drivetrain === null ? null : createEmptyDifferential(drivetrain),
        };
      }
      return next;
    });
  };

  const saveJson = () => {
    let json: string;
    try {
      json = serializeVehicleTuneJson(document);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : TUNE_TEXT.loadFailed);
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    const safeName = document.vehicle.name.trim().replace(/[^a-z0-9_-]+/gi, "-") || "vehicle-tune";
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(TUNE_TEXT.saved);
  };

  const loadJson = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const parsed = parseVehicleTuneJson(await file.text());
      setDocument(parsed);
      vehicleFieldSourcesRef.current = { name: "json", year: "json" };
      associationRef.current = {
        identity: deriveVehicleIdentityFromTuneDocument(parsed),
        source: "json",
      };
      protectedRef.current = true;
      setMismatchWarning("");
      setMessage(uiText.loadedJson(file.name));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : TUNE_TEXT.loadFailed);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="metadata-panel" aria-label={TUNE_TEXT.title}>
      <div className="panel-heading">
        <h2>{TUNE_TEXT.title}</h2>
        <p>{TUNE_TEXT.description}</p>
      </div>

      <div className="metadata-actions">
        <button className="command-button" type="button" onClick={saveJson}>
          {TUNE_TEXT.saveJson}
        </button>
        <button className="command-button" type="button" onClick={() => fileInputRef.current?.click()}>
          {TUNE_TEXT.loadJson}
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
      {mismatchWarning ? <p className="status-text error-text">{mismatchWarning}</p> : null}

      <fieldset className="form-section">
        <legend>{TUNE_TEXT.vehicle}</legend>
        <TextField label={TUNE_TEXT.vehicleName} value={document.vehicle.name} onChange={(value) => setVehicle("name", value)} />
        <NumberField label={TUNE_TEXT.year} value={document.vehicle.year} onChange={(value) => setVehicle("year", value)} />
        <TextField label={TUNE_TEXT.class} value={document.vehicle.car_class} onChange={(value) => setVehicle("car_class", value)} />
        <NumberField label={TUNE_TEXT.pi} value={document.vehicle.pi} onChange={(value) => setVehicle("pi", value)} />
        <label className="field-row">
          <span>{TUNE_TEXT.drivetrain}</span>
          <select
            value={document.vehicle.drivetrain ?? ""}
            onChange={(event) =>
              setVehicle(
                "drivetrain",
                event.target.value === "" ? null : (event.target.value as Drivetrain),
              )
            }
          >
            <option value="">{TUNE_TEXT.drivetrainUnset}</option>
            <option value="FWD">FWD</option>
            <option value="RWD">RWD</option>
            <option value="AWD">AWD</option>
          </select>
        </label>
        <NumberField
          label={TUNE_TEXT.power}
          unit={TUNING_UNITS.power}
          value={document.vehicle.power_ps}
          onChange={(value) => setVehicle("power_ps", value)}
        />
        <NumberField
          label={TUNE_TEXT.torque}
          unit={TUNING_UNITS.torque}
          value={document.vehicle.torque_nm}
          onChange={(value) => setVehicle("torque_nm", value)}
        />
        <NumberField
          label={TUNE_TEXT.weight}
          unit={TUNING_UNITS.weight}
          value={document.vehicle.weight_kg}
          onChange={(value) => setVehicle("weight_kg", value)}
        />
        <NumberField
          label={TUNE_TEXT.frontWeight}
          unit={TUNING_UNITS.weightDistribution}
          value={document.vehicle.front_weight_distribution_percent}
          onChange={(value) => setVehicle("front_weight_distribution_percent", value)}
        />
        <label className="field-row field-row-wide">
          <span>{TUNE_TEXT.engineNotes}</span>
          <textarea
            value={document.vehicle.engine_notes}
            onChange={(event) => setVehicle("engine_notes", event.target.value)}
          />
        </label>
      </fieldset>

      <TuneSections document={document} markManualOwnership={markManualOwnership} updateDocument={updateDocument} />
      <dialog
        ref={resetDialogRef}
        aria-labelledby="vehicle-reset-dialog-title"
        className="danger-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setPendingReset(null);
        }}
        onClick={(event) => {
          if (event.target === resetDialogRef.current) {
            setPendingReset(null);
          }
        }}
      >
        {pendingReset ? (
          <form method="dialog" onSubmit={(event) => event.preventDefault()}>
            <h2 id="vehicle-reset-dialog-title">{TUNE_TEXT.vehicleChangedTitle}</h2>
            <p>{TUNE_TEXT.vehicleChangedBody}</p>
            <dl className="dialog-details">
              <div>
                <dt>{TUNE_TEXT.currentTuneVehicle}</dt>
                <dd>{pendingReset.currentName || TUNE_TEXT.unknownVehicle}</dd>
              </div>
              <div>
                <dt>{TUNE_TEXT.loadedTelemetryVehicle}</dt>
                <dd>{pendingReset.nextName || TUNE_TEXT.unknownVehicle}</dd>
              </div>
            </dl>
            <div className="dialog-actions">
              <button ref={resetCancelButtonRef} className="command-button" type="button" onClick={keepCurrentSettings}>
                {TUNE_TEXT.keepCurrentTune}
              </button>
              <button className="command-button danger-button" type="button" onClick={confirmVehicleReset}>
                {TUNE_TEXT.resetForLoadedVehicle}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </section>
  );

  function handleLoadedVehicleMetadata(
    current: VehicleTuneDocument,
    metadata: LoadedSessionVehicleMetadata,
    nextIdentity: LoadedVehicleIdentity,
  ): VehicleTuneDocument {
    const currentIdentity = associationRef.current.identity ?? deriveVehicleIdentityFromTuneDocument(current);
    const comparison = compareVehicleIdentities(currentIdentity, nextIdentity);

    if (comparison === "same") {
      associationRef.current = { identity: nextIdentity, source: "telemetry" };
      setMismatchWarning("");
      setPendingReset(null);
      return current;
    }

    if (comparison === "indeterminate" && protectedRef.current) {
      setMismatchWarning(TUNE_TEXT.vehicleIdentityIndeterminateWarning);
      setPendingReset(null);
      return current;
    }

    if (comparison === "different" && isProtectedVehicleTune(current, vehicleFieldSourcesRef.current, protectedRef.current)) {
      setPendingReset({
        identity: nextIdentity,
        metadata,
        currentName: displayNameForDocument(current),
        nextName: metadata.displayName,
      });
      return current;
    }

    return resetForLoadedVehicle(metadata, nextIdentity);
  }

  function resetForLoadedVehicle(
    metadata: LoadedSessionVehicleMetadata,
    identity: LoadedVehicleIdentity,
  ): VehicleTuneDocument {
    const empty = createEmptyVehicleTune();
    const result = applyTelemetryVehicleDefaults(empty, { name: "empty", year: "empty" }, metadata.displayName);
    vehicleFieldSourcesRef.current = result.sources;
    associationRef.current = { identity, source: "telemetry" };
    protectedRef.current = false;
    setMismatchWarning("");
    setPendingReset(null);
    return result.document;
  }

  function confirmVehicleReset(): void {
    if (!pendingReset) {
      return;
    }
    setDocument(resetForLoadedVehicle(pendingReset.metadata, pendingReset.identity));
  }

  function keepCurrentSettings(): void {
    setMismatchWarning(TUNE_TEXT.vehicleMismatchWarning);
    setPendingReset(null);
  }
}

function TuneSections({
  document,
  markManualOwnership,
  updateDocument,
}: {
  document: VehicleTuneDocument;
  markManualOwnership: () => void;
  updateDocument: (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => void;
}) {
  const setTune = <K extends keyof VehicleTuneDocument["tune"]>(
    section: K,
    value: VehicleTuneDocument["tune"][K],
  ) => {
    markManualOwnership();
    updateDocument((current) => ({
      ...current,
      tune: { ...current.tune, [section]: value },
    }));
  };

  return (
    <>
      <fieldset className="form-section">
        <legend>{TUNE_TEXT.tires}</legend>
        <NumberField
          label={TUNE_TEXT.frontPressure}
          unit={TUNING_UNITS.tirePressure}
          value={document.tune.tires.front_pressure_bar}
          onChange={setNestedNumber((value) => setTune("tires", { ...document.tune.tires, front_pressure_bar: value }))}
        />
        <NumberField
          label={TUNE_TEXT.rearPressure}
          unit={TUNING_UNITS.tirePressure}
          value={document.tune.tires.rear_pressure_bar}
          onChange={setNestedNumber((value) => setTune("tires", { ...document.tune.tires, rear_pressure_bar: value }))}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>{TUNE_TEXT.gearing}</legend>
        <NumberField
          label={TUNE_TEXT.finalDrive}
          value={document.tune.gearing.final_drive}
          onChange={(value) => setTune("gearing", { ...document.tune.gearing, final_drive: value })}
        />
        {Object.entries(document.tune.gearing.gear_ratios).map(([gear, value]) => (
          <NumberField
            key={gear}
            label={gear.replace("_", " ").toUpperCase()}
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
        <legend>{TUNE_TEXT.alignment}</legend>
        <NumberField label={TUNE_TEXT.frontCamber} value={document.tune.alignment.front_camber_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_camber_degrees: value })} />
        <NumberField label={TUNE_TEXT.rearCamber} value={document.tune.alignment.rear_camber_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, rear_camber_degrees: value })} />
        <NumberField label={TUNE_TEXT.frontToe} value={document.tune.alignment.front_toe_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_toe_degrees: value })} />
        <NumberField label={TUNE_TEXT.rearToe} value={document.tune.alignment.rear_toe_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, rear_toe_degrees: value })} />
        <NumberField label={TUNE_TEXT.frontCaster} value={document.tune.alignment.front_caster_degrees} onChange={(value) => setTune("alignment", { ...document.tune.alignment, front_caster_degrees: value })} />
      </fieldset>

      <AxleSection title={TUNE_TEXT.antiRollBars} value={document.tune.anti_roll_bars} onChange={(value) => setTune("anti_roll_bars", value)} />
      <AxleSection title={TUNE_TEXT.springs} unit={TUNING_UNITS.springRate} value={document.tune.springs} onChange={(value) => setTune("springs", value)} />
      <AxleSection title={TUNE_TEXT.rideHeight} unit={TUNING_UNITS.rideHeight} value={document.tune.ride_height} onChange={(value) => setTune("ride_height", value)} />

      <fieldset className="form-section">
        <legend>{TUNE_TEXT.damping}</legend>
        <NumberField label={TUNE_TEXT.frontRebound} value={document.tune.damping.front_rebound} onChange={(value) => setTune("damping", { ...document.tune.damping, front_rebound: value })} />
        <NumberField label={TUNE_TEXT.rearRebound} value={document.tune.damping.rear_rebound} onChange={(value) => setTune("damping", { ...document.tune.damping, rear_rebound: value })} />
        <NumberField label={TUNE_TEXT.frontBump} value={document.tune.damping.front_bump} onChange={(value) => setTune("damping", { ...document.tune.damping, front_bump: value })} />
        <NumberField label={TUNE_TEXT.rearBump} value={document.tune.damping.rear_bump} onChange={(value) => setTune("damping", { ...document.tune.damping, rear_bump: value })} />
      </fieldset>

      <AxleSection title={TUNE_TEXT.aero} unit={TUNING_UNITS.aeroDownforce} value={document.tune.aero} onChange={(value) => setTune("aero", value)} />

      <fieldset className="form-section">
        <legend>{TUNE_TEXT.brakes}</legend>
        <NumberField label={TUNE_TEXT.balance} unit={TUNING_UNITS.percent} value={document.tune.brakes.balance_percent} onChange={(value) => setTune("brakes", { ...document.tune.brakes, balance_percent: value })} />
        <NumberField label={TUNE_TEXT.pressure} unit={TUNING_UNITS.percent} value={document.tune.brakes.pressure_percent} onChange={(value) => setTune("brakes", { ...document.tune.brakes, pressure_percent: value })} />
      </fieldset>

      <DifferentialSection document={document} markManualOwnership={markManualOwnership} updateDocument={updateDocument} />
    </>
  );
}

function DifferentialSection({
  document,
  markManualOwnership,
  updateDocument,
}: {
  document: VehicleTuneDocument;
  markManualOwnership: () => void;
  updateDocument: (updater: (current: VehicleTuneDocument) => VehicleTuneDocument) => void;
}) {
  const differential = document.tune.differential;
  const setDifferential = (value: NonNullable<typeof differential>) => {
    markManualOwnership();
    updateDocument((current) => ({
      ...current,
      tune: { ...current.tune, differential: value },
    }));
  };

  return (
    <fieldset className="form-section">
      <legend>{TUNE_TEXT.differential}</legend>
      {differential === null ? <p className="status-text">{TUNE_TEXT.differentialUnsetHelp}</p> : null}
      {differential !== null && "front_acceleration_percent" in differential ? (
        <>
          <NumberField label={TUNE_TEXT.frontAccel} unit={TUNING_UNITS.percent} value={differential.front_acceleration_percent} onChange={(value) => setDifferential({ ...differential, front_acceleration_percent: value })} />
          <NumberField label={TUNE_TEXT.frontDecel} unit={TUNING_UNITS.percent} value={differential.front_deceleration_percent} onChange={(value) => setDifferential({ ...differential, front_deceleration_percent: value })} />
        </>
      ) : null}
      {differential !== null && "rear_acceleration_percent" in differential ? (
        <>
          <NumberField label={TUNE_TEXT.rearAccel} unit={TUNING_UNITS.percent} value={differential.rear_acceleration_percent} onChange={(value) => setDifferential({ ...differential, rear_acceleration_percent: value })} />
          <NumberField label={TUNE_TEXT.rearDecel} unit={TUNING_UNITS.percent} value={differential.rear_deceleration_percent} onChange={(value) => setDifferential({ ...differential, rear_deceleration_percent: value })} />
        </>
      ) : null}
      {differential !== null && "center_balance_percent" in differential ? (
        <NumberField label={TUNE_TEXT.centerBalance} unit={TUNING_UNITS.percent} value={differential.center_balance_percent} onChange={(value) => setDifferential({ ...differential, center_balance_percent: value })} />
      ) : null}
    </fieldset>
  );
}

function identityFromMetadata(metadata: LoadedSessionVehicleMetadata): LoadedVehicleIdentity {
  return {
    carOrdinal: metadata.carOrdinal,
    displayName: metadata.displayName,
  };
}

function displayNameForDocument(document: VehicleTuneDocument): string {
  if (!document.vehicle.name.trim()) {
    return "";
  }
  return document.vehicle.year === null ? document.vehicle.name : `${document.vehicle.year} ${document.vehicle.name}`;
}

function isProtectedVehicleTune(
  document: VehicleTuneDocument,
  sources: VehicleAutofillSources,
  hasExplicitProtection: boolean,
): boolean {
  if (hasExplicitProtection || sources.name === "manual" || sources.year === "manual" || sources.name === "json" || sources.year === "json") {
    return true;
  }
  if (
    document.vehicle.car_class
    || document.vehicle.pi !== null
    || document.vehicle.drivetrain !== null
    || document.vehicle.power_ps !== null
    || document.vehicle.torque_nm !== null
    || document.vehicle.weight_kg !== null
    || document.vehicle.front_weight_distribution_percent !== null
    || document.vehicle.engine_notes
  ) {
    return true;
  }
  return hasAnyTuneValue(document);
}

function hasAnyTuneValue(document: VehicleTuneDocument): boolean {
  return (
    document.tune.tires.front_pressure_bar !== null
    || document.tune.tires.rear_pressure_bar !== null
    || document.tune.gearing.final_drive !== null
    || Object.values(document.tune.gearing.gear_ratios).some((value) => value !== null)
    || Object.values(document.tune.alignment).some((value) => value !== null)
    || Object.values(document.tune.anti_roll_bars).some((value) => value !== null)
    || Object.values(document.tune.springs).some((value) => value !== null)
    || Object.values(document.tune.ride_height).some((value) => value !== null)
    || Object.values(document.tune.damping).some((value) => value !== null)
    || Object.values(document.tune.aero).some((value) => value !== null)
    || Object.values(document.tune.brakes).some((value) => value !== null)
    || document.tune.differential !== null
  );
}

function AxleSection({
  title,
  unit,
  value,
  onChange,
}: {
  title: string;
  unit?: string;
  value: { front: number | null; rear: number | null };
  onChange: (value: { front: number | null; rear: number | null }) => void;
}) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <NumberField label={TUNE_TEXT.front} unit={unit} value={value.front} onChange={(front) => onChange({ ...value, front })} />
      <NumberField label={TUNE_TEXT.rear} unit={unit} value={value.rear} onChange={(rear) => onChange({ ...value, rear })} />
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
