import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ballotRecordsFor, type BallotSubjectRecord } from "../lib/ask/ballot-inventory.ts";

const person: BallotSubjectRecord = { kind: "PERSON", id: "candidate:one", name: "Casey Example",
  contestId: "contest:one", contestTitle: "Council", ocdId: "ocd-division/country:us/state:az" };

test("Ask keeps source version, exact passage locator and source-stated date without claiming a personal stance", () => {
  const result = ballotRecordsFor(person, { set: { candidacies: [], measures: [], removals: [] } as never,
    contests: [], absences: [], positions: () => [{ issueLabel: "housing", quote: "more homes",
      documentUrl: "https://campaign.example/issues", retrievedAt: "2026-09-27T00:00:00.000Z",
      sourceClass: "CAMPAIGN_SITE", sourceRevisionId: "rev-1", sourceArtifactId: "ar-1",
      textStart: 10, textEnd: 20, revisionStatus: "HISTORICAL",
      publicationDate: { date: "2026-09-20", basis: "ARTICLE_PUBLISHED_TIME_META", artifactId: "ar-1",
        rawContentHash: "hash", start: 2, end: 8, quote: "<meta>", offsetUnit: "UTF16_CODE_UNITS" } }] });
  const passage = result.records.find(row => row.kind === "SOURCE_PASSAGE");
  assert.ok(passage);
  assert.match(passage.text, /Searching a campaign page linked to Casey Example/);
  assert.match(passage.text, /Earlier captured version/);
  assert.match(passage.text, /Source-stated publication date 2026-09-20/);
  assert.match(passage.text, /Source revision rev-1, capture ar-1, extracted UTF-16 span 10-20/);
  assert.match(passage.text, /does not establish the candidate's personal stance/);
  assert.equal(passage.retrievedAt, "2026-09-27T00:00:00.000Z");
});

test("ballot card labels source versions and keeps source publication and read dates distinct", () => {
  const component = readFileSync(join(process.cwd(), "components", "ballot", "candidate-positions.tsx"), "utf8");
  assert.match(component, /CardSourcesContribution/);
  assert.doesNotMatch(component, /new URL\(passage.documentUrl\).hostname/);
  assert.match(component, /earlier captured version/);
  assert.match(component, /latest captured version/);
  assert.match(component, /source-stated publication date/);
  assert.doesNotMatch(component, />\s*In their own words\s*</);
});
