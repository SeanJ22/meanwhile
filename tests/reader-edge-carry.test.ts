import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("every pointer publishes before meetings compose, and meetings read the prepared row only past their carry", () => {
  const child = readFileSync("lib/civic-data/reader-edge-publication.ts", "utf8");
  const states = child.indexOf("await dispatchStateArtifacts(");
  const promoted = child.indexOf("await publishPromotedEdgeFamilies(");
  const prepare = child.indexOf("await preparePublishedMeetingSnapshot(");
  assert.ok(states > 0 && promoted > 0 && states < prepare && promoted < prepare, "no pointer waits on the meeting composition");
  const manifestRead = child.indexOf("await artifactStore.readManifest()");
  const carry = child.indexOf("const sameComposition = prepared?.status === \"CURRENT\"");
  const current = child.indexOf("if (!sameComposition");
  const rowRead = child.indexOf("await readPreparedMeetingsProjection(");
  const publish = child.indexOf("await publishReaderMeetings(");
  assert.match(child, /if \(preparesMeetings\) \{\n\s+const servedMeetings = \(await artifactStore\.readManifest\(\)\)/,
    "only a meeting publication reads the manifest");
  assert.ok(manifestRead > 0 && manifestRead < carry, "the served manifest is read before the decision");
  assert.match(child.slice(carry, current), /servedMeetings\.composition === prepared\.composition/, "carry compares the serving copy's actual composition");
  assert.match(child.slice(carry, current), /servedMeetings\?\.meetingLayout === "governing-area"/, "old state pieces read the prepared row once to repartition");
  assert.match(child.slice(carry, current), /servedMeetings\.meetingRegistryVersion === meetingRegistryVersion/, "registry-only changes rebuild body areas");
  assert.match(child, /const preparesMeetings = selected === null \|\| selected\.some\(pointer => pointer\.recordClass === "MEETING"\)/,
    "a state registry publication does not prepare the country meeting catalogue");
  assert.ok(carry < current && current < rowRead && rowRead < publish, "the prepared row is read only past the carry");
  assert.match(child.slice(rowRead, publish), /readPreparedMeetingsProjection\(\{ store, expectedSequence: prepared\.sequence \}\)/,
    "the payload read is bound to the exact prepared sequence used for the carry decision");
  assert.equal(child.match(/readPreparedMeetingsProjection\(/g)?.length, 1, "one prepared-row read, on the publish path");
});
