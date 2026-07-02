import type { RewindClusterPayload, RewindConfidence } from "./telemetryLap";

export type PracticeFocusReason = "repeated-rewind" | "credible-driving-error";

export interface PracticeFocusCandidate {
  cluster: RewindClusterPayload;
  reasons: PracticeFocusReason[];
}

const CONFIDENCE_RANK: Record<RewindConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  "": 0,
};

export function practiceFocusReasons(cluster: RewindClusterPayload): PracticeFocusReason[] {
  const reasons: PracticeFocusReason[] = [];
  if (cluster.eventCount >= 2) {
    reasons.push("repeated-rewind");
  }
  if (cluster.drivingErrorSuspectedCount >= 1 && isCredibleConfidence(cluster.confidence)) {
    reasons.push("credible-driving-error");
  }
  return reasons;
}

export function buildPracticeFocusCandidates(clusters: RewindClusterPayload[]): PracticeFocusCandidate[] {
  return clusters
    .map((cluster) => ({ cluster, reasons: practiceFocusReasons(cluster) }))
    .filter((candidate) => candidate.reasons.length > 0)
    .sort(comparePracticeFocusCandidates);
}

function comparePracticeFocusCandidates(left: PracticeFocusCandidate, right: PracticeFocusCandidate): number {
  return (
    right.cluster.eventCount - left.cluster.eventCount ||
    right.cluster.drivingErrorSuspectedCount - left.cluster.drivingErrorSuspectedCount ||
    confidenceRank(right.cluster.confidence) - confidenceRank(left.cluster.confidence) ||
    right.cluster.rewoundTimeS - left.cluster.rewoundTimeS ||
    left.cluster.courseDistanceM - right.cluster.courseDistanceM ||
    left.cluster.clusterId.localeCompare(right.cluster.clusterId)
  );
}

function isCredibleConfidence(confidence: RewindConfidence): boolean {
  return confidence === "high" || confidence === "medium";
}

function confidenceRank(confidence: RewindConfidence): number {
  return CONFIDENCE_RANK[confidence] ?? 0;
}
