import type { SectionId } from "./reference";
import type { MapDisplayMode } from "./mapDisplayMode";

const SECTION_IDS = new Set<string>(["S1", "S2", "S3", "S4", "S5", "S6"]);

export interface RewindSelectionState {
  selectedSectionId: SectionId;
  selectedRewindClusterId: string;
  selectedRewindEventId: string;
}

export interface RewindNavigationDecision {
  shouldReframe: boolean;
  targetSectionId: SectionId;
}

export function sectionForRewindSelection(currentSectionId: SectionId, rewindSectionId: string | undefined): SectionId {
  return rewindSectionId !== undefined && SECTION_IDS.has(rewindSectionId)
    ? rewindSectionId as SectionId
    : currentSectionId;
}

export function selectRewindClusterState(
  current: RewindSelectionState,
  cluster: { clusterId: string; sectionId?: string } | undefined,
): RewindSelectionState {
  if (!cluster) {
    return current;
  }
  return {
    selectedSectionId: sectionForRewindSelection(current.selectedSectionId, cluster.sectionId),
    selectedRewindClusterId: cluster.clusterId,
    selectedRewindEventId: "",
  };
}

export function selectRewindEventState(
  current: RewindSelectionState,
  event: { rewindEventId: string; rewindClusterId: string; sectionId?: string } | undefined,
): RewindSelectionState {
  if (!event) {
    return current;
  }
  return {
    selectedSectionId: sectionForRewindSelection(current.selectedSectionId, event.sectionId),
    selectedRewindClusterId: event.rewindClusterId || event.rewindEventId,
    selectedRewindEventId: event.rewindEventId,
  };
}

export function rewindNavigationDecision(
  currentSectionId: SectionId,
  mapDisplayMode: MapDisplayMode,
  rewindSectionId: string | undefined,
): RewindNavigationDecision {
  const targetSectionId = sectionForRewindSelection(currentSectionId, rewindSectionId);
  return {
    targetSectionId,
    shouldReframe: mapDisplayMode !== "section-focus" || currentSectionId !== targetSectionId,
  };
}

export function clearRewindSelectionState(current: RewindSelectionState): RewindSelectionState {
  return {
    selectedSectionId: current.selectedSectionId,
    selectedRewindClusterId: "",
    selectedRewindEventId: "",
  };
}
