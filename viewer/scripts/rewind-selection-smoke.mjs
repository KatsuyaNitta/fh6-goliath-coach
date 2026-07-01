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

  const directory = join(tmpdir(), `fh6-rewind-selection-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, filename);
  await writeFile(modulePath, compiled, "utf-8");
  return import(`file:///${modulePath.replaceAll("\\", "/")}`);
}

const {
  clearRewindSelectionState,
  sectionForRewindSelection,
  selectRewindClusterState,
  selectRewindEventState,
} = await compileModule(new URL("../src/lib/rewindSelection.ts", import.meta.url), "rewindSelection.mjs");

const base = {
  selectedSectionId: "S2",
  selectedRewindClusterId: "",
  selectedRewindEventId: "",
};

const s3Cluster = { clusterId: "RC003", sectionId: "S3" };
const s2Cluster = { clusterId: "RC002", sectionId: "S2" };
const s4Cluster = { clusterId: "RC004", sectionId: "S4" };
const s5Event = { rewindEventId: "RW010", rewindClusterId: "RC010", sectionId: "S5" };
const invalidEvent = { rewindEventId: "RW999", rewindClusterId: "RC999", sectionId: "" };

assert.deepEqual(
  selectRewindClusterState(base, s3Cluster),
  { selectedSectionId: "S3", selectedRewindClusterId: "RC003", selectedRewindEventId: "" },
  "selecting an S3 rewind while S2 is selected should select S3",
);
assert.deepEqual(
  selectRewindClusterState({ ...base, selectedRewindClusterId: "RC001" }, s2Cluster),
  { selectedSectionId: "S2", selectedRewindClusterId: "RC002", selectedRewindEventId: "" },
  "selecting a rewind in the current section should keep the section",
);
const afterS3 = selectRewindClusterState(base, s3Cluster);
assert.deepEqual(
  selectRewindClusterState(afterS3, s4Cluster),
  { selectedSectionId: "S4", selectedRewindClusterId: "RC004", selectedRewindEventId: "" },
  "selecting a second rewind in another section should update the section again",
);
assert.deepEqual(
  selectRewindEventState(base, s5Event),
  { selectedSectionId: "S5", selectedRewindClusterId: "RC010", selectedRewindEventId: "RW010" },
  "selecting an individual rewind event should sync its section",
);
assert.deepEqual(
  selectRewindClusterState(base, s4Cluster),
  { selectedSectionId: "S4", selectedRewindClusterId: "RC004", selectedRewindEventId: "" },
  "practice-focus cluster selection should use the same cluster behavior",
);
assert.deepEqual(
  clearRewindSelectionState({ selectedSectionId: "S4", selectedRewindClusterId: "RC004", selectedRewindEventId: "RW004" }),
  { selectedSectionId: "S4", selectedRewindClusterId: "", selectedRewindEventId: "" },
  "clearing rewind selection should preserve the current section",
);
assert.equal(sectionForRewindSelection("S3", invalidEvent.sectionId), "S3", "invalid rewind section should preserve current section");
assert.deepEqual(
  selectRewindEventState({ selectedSectionId: "S3", selectedRewindClusterId: "RC003", selectedRewindEventId: "" }, invalidEvent),
  { selectedSectionId: "S3", selectedRewindClusterId: "RC999", selectedRewindEventId: "RW999" },
  "invalid event section should not crash or overwrite section",
);

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf-8");
assert.match(appSource, /function selectRewindCluster[\s\S]*sectionForRewindSelection/, "cluster selection should synchronize section centrally");
assert.match(appSource, /function selectRewindEvent[\s\S]*sectionForRewindSelection/, "event selection should synchronize section centrally");
assert.match(appSource, /onClick=\{\(\) => selectRewindCluster\(cluster\)\}/, "practice-focus button should use synced cluster selection");
assert.match(appSource, /onClick=\{\(\) => selectRewindEvent\(point\)\}/, "detail event buttons should use synced event selection");
assert.match(appSource, /function clearRewindSelection[\s\S]*setSelectedRewindClusterId\(""\)[\s\S]*setSelectedRewindEventId\(""\)/, "clear selection should only clear rewind selection state");
assert.match(appSource, /onClick=\{\(\) => selectSectionForFocus\(section\.id\)\}/, "manual section buttons should enter explicit section focus");
assert.doesNotMatch(appSource, /onClick=\{\(\) => selectSectionForFocus\(section\.id\)[\s\S]*setSelectedRewindClusterId/, "manual section selection should remain one-way only");

const sceneSource = await readFile(new URL("../src/components/CourseScene.tsx", import.meta.url), "utf-8");
assert.match(sceneSource, /onSelect\(cluster\)/, "scene marker selection should pass the cluster payload to the synced callback");

console.log("rewind selection smoke test passed");
