import type { VehicleTuneDocument } from "./vehicleTune";

export interface LoadedVehicleIdentity {
  carOrdinal: number | null;
  displayName: string;
}

export type VehicleIdentityComparison = "same" | "different" | "indeterminate";

export function compareVehicleIdentities(
  previous: LoadedVehicleIdentity | null,
  next: LoadedVehicleIdentity | null,
): VehicleIdentityComparison {
  if (!previous || !next) {
    return "indeterminate";
  }
  if (isValidOrdinal(previous.carOrdinal) && isValidOrdinal(next.carOrdinal)) {
    return previous.carOrdinal === next.carOrdinal ? "same" : "different";
  }
  const previousName = normalizeVehicleDisplayName(previous.displayName);
  const nextName = normalizeVehicleDisplayName(next.displayName);
  if (!previousName || !nextName) {
    return "indeterminate";
  }
  return previousName === nextName ? "same" : "different";
}

export function normalizeVehicleDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/g, " ").toLowerCase();
}

export function deriveVehicleIdentityFromTuneDocument(
  document: VehicleTuneDocument,
): LoadedVehicleIdentity | null {
  const name = document.vehicle.name.trim();
  if (!name) {
    return null;
  }
  return {
    carOrdinal: null,
    displayName: document.vehicle.year === null ? name : `${document.vehicle.year} ${name}`,
  };
}

function isValidOrdinal(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
