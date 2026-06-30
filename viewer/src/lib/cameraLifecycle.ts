export type CameraViewMode = "2d" | "3d";

export interface CameraLifecycleInputs {
  viewMode: CameraViewMode;
  resetToken: number;
  referenceIdentity: string;
  telemetryIdentity: string;
}

export function buildCameraLifecycleKey(inputs: CameraLifecycleInputs): string {
  return [
    inputs.referenceIdentity,
    inputs.telemetryIdentity,
    inputs.viewMode,
    inputs.resetToken,
  ].join("|");
}

export function shouldResetCameraForLifecycleChange(
  previous: CameraLifecycleInputs,
  next: CameraLifecycleInputs,
): boolean {
  return buildCameraLifecycleKey(previous) !== buildCameraLifecycleKey(next);
}