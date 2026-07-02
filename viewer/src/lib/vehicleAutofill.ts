import type { VehicleTuneDocument } from "./vehicleTune";

export type VehicleFieldSource = "empty" | "telemetry" | "manual" | "json";

export interface LoadedSessionVehicleMetadata {
  displayName: string;
  carOrdinal: number | null;
  loadId: number;
}

export interface ParsedVehicleDisplayName {
  name: string;
  year: number | null;
}

export interface VehicleAutofillSources {
  name: VehicleFieldSource;
  year: VehicleFieldSource;
}

export function parseVehicleDisplayName(displayName: string): ParsedVehicleDisplayName | null {
  const trimmed = displayName.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown vehicle") {
    return null;
  }
  const match = trimmed.match(/^((?:19|20)\d{2})\s+(.+)$/);
  if (!match) {
    return { name: trimmed, year: null };
  }
  const name = match[2].trim();
  if (!name) {
    return { name: trimmed, year: null };
  }
  return {
    name,
    year: Number(match[1]),
  };
}

export function applyTelemetryVehicleDefaults(
  document: VehicleTuneDocument,
  sources: VehicleAutofillSources,
  displayName: string,
): { document: VehicleTuneDocument; sources: VehicleAutofillSources } {
  const parsed = parseVehicleDisplayName(displayName);
  if (!parsed) {
    return { document, sources };
  }

  const nextDocument: VehicleTuneDocument = {
    ...document,
    vehicle: { ...document.vehicle },
  };
  const nextSources: VehicleAutofillSources = { ...sources };

  if (sources.name === "empty" || sources.name === "telemetry") {
    nextDocument.vehicle.name = parsed.name;
    nextSources.name = "telemetry";
  }

  if (sources.year === "empty" || sources.year === "telemetry") {
    nextDocument.vehicle.year = parsed.year;
    if (parsed.year !== null || sources.year === "telemetry") {
      nextSources.year = "telemetry";
    }
  }

  return { document: nextDocument, sources: nextSources };
}
