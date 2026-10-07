import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("shared publication decides the meeting carry before it reads the prepared row, and reads it only to publish", () => {
  // Authority-only updates carry meetings without repeating the prepared payload read.
  const child = readFileSync("lib/civic-data/reader-edge-publication.ts", "utf8");
  const manifestRead = child.indexOf("await artifactStore.readManifest()");
  const carry = child.indexOf("const sameComposition = prepared?.status === \"CURRENT\"");
  const current = child.indexOf("if (prepared !== null && !sameComposition");
  const rowRead = child.indexOf("await readPreparedMeetingsProjection({ store })");
  const publish = child.indexOf("await publishReaderEdgeArtifacts(");
  assert.ok(manifestRead > 0 && manifestRead < carry, "the served manifest is read before the decision");
  assert.match(child.slice(carry, current), /servedManifest\.composition === prepared\.composition/, "carry compares the serving copy's actual composition");
  assert.match(child.slice(carry, current), /servedManifest\?\.meetingLayout === "governing-area"/, "old state pieces read the prepared row once to repartition");
  assert.match(child.slice(carry, current), /servedManifest\.meetingRegistryVersion === meetingRegistryVersion/, "registry-only changes rebuild body areas");
  assert.match(child, /pointer\.recordClass === "REGISTRY_RUNTIME_BINDING"/, "registry publication prepares the meeting dependency");
  assert.ok(carry < current && current < rowRead && rowRead < publish, "the prepared row is read only past the carry");
  assert.equal(child.match(/readPreparedMeetingsProjection\(/g)?.length, 1, "one prepared-row read, on the publish path");
});
