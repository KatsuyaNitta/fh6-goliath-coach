export const BRAKE_ACTIVE_THRESHOLD_PCT = 2;
export const THROTTLE_OFF_THRESHOLD_PCT = 2;
export const FULL_THROTTLE_THRESHOLD_PCT = 95;

export type OperationState =
  | "simultaneous-input"
  | "braking"
  | "coast"
  | "partial-throttle"
  | "full-throttle"
  | "unavailable";

export function classifyOperationState(
  throttlePct: number | null | undefined,
  brakePct: number | null | undefined,
): OperationState {
  if (!isValidPercent(throttlePct) || !isValidPercent(brakePct)) {
    return "unavailable";
  }
  if (brakePct > BRAKE_ACTIVE_THRESHOLD_PCT && throttlePct > THROTTLE_OFF_THRESHOLD_PCT) {
    return "simultaneous-input";
  }
  if (brakePct > BRAKE_ACTIVE_THRESHOLD_PCT) {
    return "braking";
  }
  if (throttlePct <= THROTTLE_OFF_THRESHOLD_PCT) {
    return "coast";
  }
  if (throttlePct < FULL_THROTTLE_THRESHOLD_PCT) {
    return "partial-throttle";
  }
  return "full-throttle";
}

function isValidPercent(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}
