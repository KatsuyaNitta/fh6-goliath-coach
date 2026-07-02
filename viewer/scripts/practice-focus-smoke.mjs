import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function compileModule(sourceUrl, filename) {
  const source = await readFile(sourceUrl, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const directory = join(tmpdir(), `fh6-practice-focus-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const { buildPracticeFocusCandidates, practiceFocusReasons } = await compileModule(
  new URL("../src/lib/practiceFocus.ts", import.meta.url),
  "practiceFocus.mjs",
);

function cluster(overrides) {
  return {
    clusterId: "RC000",
    sectionId: "S1",
    courseDistanceM: 1000,
    eventCount: 1,
    externalImpactSuspectedCount: 0,
    drivingErrorSuspectedCount: 0,
    undeterminedCount: 0,
    confidence: "",
    impactDirection: "unknown",
    rewoundTimeS: 0,
    rewoundCourseDistanceM: 0,
    eventIds: [],
    points: [],
    ...overrides,
  };
}

const repeatedUndetermined = cluster({
  clusterId: "RC-undetermined-repeat",
  eventCount: 3,
  undeterminedCount: 3,
  confidence: "low",
});
assert.deepEqual(practiceFocusReasons(repeatedUndetermined), ["repeated-rewind"]);

const repeatedExternal = cluster({
  clusterId: "RC-external-repeat",
  eventCount: 2,
  externalImpactSuspectedCount: 2,
  confidence: "high",
});
assert.deepEqual(practiceFocusReasons(repeatedExternal), ["repeated-rewind"]);

const singleMediumDriving = cluster({
  clusterId: "RC-driving-medium",
  drivingErrorSuspectedCount: 1,
  confidence: "medium",
});
assert.deepEqual(practiceFocusReasons(singleMediumDriving), ["credible-driving-error"]);

const singleHighDriving = cluster({
  clusterId: "RC-driving-high",
  drivingErrorSuspectedCount: 1,
  confidence: "high",
});
assert.deepEqual(practiceFocusReasons(singleHighDriving), ["credible-driving-error"]);

const bothReasons = cluster({
  clusterId: "RC-both",
  eventCount: 3,
  drivingErrorSuspectedCount: 2,
  confidence: "high",
});
assert.deepEqual(practiceFocusReasons(bothReasons), ["repeated-rewind", "credible-driving-error"]);

assert.deepEqual(
  practiceFocusReasons(cluster({ clusterId: "RC-external-single", externalImpactSuspectedCount: 1, confidence: "high" })),
  [],
);
assert.deepEqual(practiceFocusReasons(cluster({ clusterId: "RC-undetermined-single", undeterminedCount: 1 })), []);
assert.deepEqual(practiceFocusReasons(cluster({ clusterId: "RC-driving-low", drivingErrorSuspectedCount: 1, confidence: "low" })), []);
assert.deepEqual(practiceFocusReasons(cluster({ clusterId: "RC-driving-unknown", drivingErrorSuspectedCount: 1, confidence: "" })), []);

const ordered = buildPracticeFocusCandidates([
  cluster({ clusterId: "RC-distance-b", eventCount: 2, courseDistanceM: 900, rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-distance-a", eventCount: 2, courseDistanceM: 800, rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-time", eventCount: 2, courseDistanceM: 700, rewoundTimeS: 3 }),
  cluster({ clusterId: "RC-low", eventCount: 2, confidence: "low", rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-medium", eventCount: 2, confidence: "medium", rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-high", eventCount: 2, confidence: "high", rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-driving-count", eventCount: 2, drivingErrorSuspectedCount: 2, confidence: "medium", rewoundTimeS: 1 }),
  cluster({ clusterId: "RC-more-events", eventCount: 3, confidence: "" }),
]);
assert.deepEqual(
  ordered.map((candidate) => candidate.cluster.clusterId),
  ["RC-more-events", "RC-driving-count", "RC-high", "RC-medium", "RC-low", "RC-time", "RC-distance-a", "RC-distance-b"],
);

const tied = buildPracticeFocusCandidates([
  cluster({ clusterId: "RC-b", eventCount: 2, courseDistanceM: 1000 }),
  cluster({ clusterId: "RC-a", eventCount: 2, courseDistanceM: 1000 }),
]);
assert.deepEqual(tied.map((candidate) => candidate.cluster.clusterId), ["RC-a", "RC-b"]);

const noCap = buildPracticeFocusCandidates([
  cluster({ clusterId: "RC1", eventCount: 2 }),
  cluster({ clusterId: "RC2", eventCount: 2 }),
  cluster({ clusterId: "RC3", eventCount: 2 }),
  cluster({ clusterId: "RC4", eventCount: 2 }),
]);
assert.equal(noCap.length, 4);

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.match(appSource, /UI_TEXT\.practiceFocusDescription/, "practice-focus criteria explanation should be rendered");
assert.match(appSource, /candidate\.reasons\.map\(formatPracticeFocusReason\)/, "selection reasons should be rendered");
assert.match(appSource, /drivingErrorSuspectedCount/, "driving-error count should be rendered");
assert.match(appSource, /externalImpactSuspectedCount/, "external-impact count should be rendered");
assert.match(appSource, /undeterminedCount/, "undetermined count should be rendered");
assert.match(appSource, /rewoundTimeS\.toFixed/, "rewound time should be rendered");
assert.match(appSource, /rewoundCourseDistanceM\.toFixed/, "rewound distance should be rendered");
assert.match(appSource, /onClick=\{\(\) => selectRewindCluster\(candidate\.cluster\)\}/, "candidate clicks should select only the rewind cluster");
assert.match(appSource, /function navigateToRewindSection\(sectionId: string \| undefined\)/, "rewind selections should share section-focus navigation");
assert.match(appSource, /rewindNavigationDecision\(selectedSectionId, mapDisplayMode, sectionId\)/, "rewind navigation should reframe only when mode or section changes");
assert.match(appSource, /selectRewindCluster[\s\S]*navigateToRewindSection\(cluster\.sectionId\)/, "candidate clicks should enter section focus through cluster selection");
assert.doesNotMatch(appSource, /selectRewindCluster\(candidate\.cluster\)[\s\S]{0,160}setPinnedTelemetryPoint/, "candidate clicks should not pin chart cursors");
assert.doesNotMatch(appSource, /noPracticeFocus: ".*problem-free/, "no-candidate text should not claim the lap is problem-free");

console.log("practice focus smoke test passed");
