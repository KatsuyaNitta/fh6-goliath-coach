export const MAP_DISPLAY_MODES = ["overview", "section-focus"] as const;

export type MapDisplayMode = (typeof MAP_DISPLAY_MODES)[number];

export const INITIAL_MAP_DISPLAY_MODE: MapDisplayMode = "overview";
export const OVERVIEW_AUTO_ROTATE_SPEED = 0.35;

export interface OverviewAutoRotateInputs {
  viewMode: "2d" | "3d";
  mapDisplayMode: MapDisplayMode;
  overviewRotationStopped: boolean;
  prefersReducedMotion: boolean;
}

export function shouldAutoRotateOverview(inputs: OverviewAutoRotateInputs): boolean {
  return (
    inputs.viewMode === "3d" &&
    inputs.mapDisplayMode === "overview" &&
    !inputs.overviewRotationStopped &&
    !inputs.prefersReducedMotion
  );
}
