import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("shared publication decides the meeting carry before it reads the prepared chunks, and opens them only to publish", () => {
  // Authority-only updates carry meetings without repeating the prepared payload read.
  const child = readFileSync("lib/civic-data/reader-edge-publication.ts", "utf8");
  const manifestRead = child.indexOf("await artifactStore.readManifest()");
  const carry = child.indexOf("const sameComposition = prepared?.status === \"CURRENT\"");
  const current = child.indexOf("if (prepared !== null && !sameComposition");
  const rowRead = child.indexOf("await readPreparedMeetingPublication(");
  const publish = child.indexOf("await publishReaderEdgeArtifacts(");
  assert.ok(manifestRead > 0 && manifestRead < carry, "the served manifest is read before the decision");
  assert.match(child.slice(carry, current), /servedMeetingManifest\.composition === prepared\.composition/, "carry compares the serving copy's actual composition");
  assert.match(child.slice(carry, current), /servedMeetingManifest\?\.meetingLayout === "governing-area"/, "old state pieces read the prepared chunks once to repartition");
  assert.match(child.slice(carry, current), /servedMeetingManifest\.meetingRegistryVersion === meetingRegistryVersion/, "registry-only changes rebuild body areas");
  assert.match(child, /pointer\.recordClass === "REGISTRY_RUNTIME_BINDING"/, "registry publication prepares the meeting dependency");
  assert.ok(carry < current && current < rowRead && rowRead < publish, "the prepared index is read only past the carry");
  assert.match(child.slice(rowRead, publish), /readPreparedMeetingPublication\(\{ store, expectedSequence: prepared\.sequence, state \}\)/,
    "the payload read is bound to the exact prepared sequence used for the carry decision");
  assert.match(child.slice(rowRead, publish), /yield \{ key: chunk\.key, version: chunk\.version, read: async \(\) => \{/,
    "each immutable place payload stays lazy until the edge needs that version");
  assert.equal(child.match(/readPreparedMeetingPublication\(/g)?.length, 1, "one prepared-publication read, on the publish path");
});
