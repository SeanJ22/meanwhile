import test from "node:test";
import assert from "node:assert/strict";
import { stanceRowFrom, stanceRowIssue, stanceId } from "../lib/civic-data/stance-rows.ts";
import { DEFAULT_STANCE_TOPICS } from "../lib/stances/topics.ts";
import { isWorkerReaderContract, workerReaderClassMatches } from "../lib/civic-data/worker-reader-contracts.ts";

const topicIds = DEFAULT_STANCE_TOPICS.map((t) => t.id);
const base = { personId: "candidacy:a", personName: "A Person", quote: "We must build more homes.", date: "2026-09-01", topicId: "housing", sourceKind: "CAMPAIGN_SITE" };
const call = (fields: Record<string, string>, pageUrl = "https://www.aperson.example/issues", hosts: string[] = ["aperson.example"]) =>
  stanceRowFrom({ fields, pageUrl, collectedAt: "2026-09-02T00:00:00Z", now: "2026-10-06T00:00:00Z", topicIds, ownSiteHosts: () => hosts });

test("stances is a worker reader door for STANCE records", () => {
  assert.ok(isWorkerReaderContract("stances"));
  assert.ok(workerReaderClassMatches("stances", "STANCE"));
});

test("an exact quote on the person's own campaign page becomes a row that passes the projection check", () => {
  const row = call(base);
  assert.equal(row.id, stanceId("candidacy:a", "housing", "We must build more homes."));
  assert.equal(row.sourceUrl, "https://www.aperson.example/issues");
  assert.equal(stanceRowIssue(row), null);
});

test("a campaign page counts only for its own candidate", () => {
  assert.throws(() => call(base, "https://www.other.example/issues"), /STANCE_CAMPAIGN_PAGE_NOT_OWN/);
  assert.throws(() => call(base, "https://www.aperson.example/issues", []), /STANCE_CAMPAIGN_PAGE_NOT_OWN/);
  // The same words on a voter guide need no campaign site.
  assert.equal(call({ ...base, sourceKind: "VOTER_GUIDE" }, "https://guide.example/a", []).sourceKind, "VOTER_GUIDE");
});

test("a paraphrase is refused: it needs a second source", () => {
  assert.throws(() => call({ ...base, statementSummary: "Supports housing." }), /STANCE_PARAPHRASE_NEEDS_SECOND_SOURCE/);
});

test("an unknown topic, a future or malformed date, or an unknown source kind is refused", () => {
  assert.throws(() => call({ ...base, topicId: "pizza" }), /STANCE_TOPIC_UNKNOWN/);
  assert.throws(() => call({ ...base, date: "2027-01-01" }), /STANCE_DATE_INVALID/);
  assert.throws(() => call({ ...base, date: "2026-02-30" }), /STANCE_DATE_INVALID/);
  assert.throws(() => call({ ...base, sourceKind: "RUMOR" }), /STANCE_SOURCE_KIND_UNKNOWN/);
});

test("a stored row whose id is not its own identity is held", () => {
  assert.match(stanceRowIssue({ ...call(base), quote: "Changed words." }) ?? "", /lacks its exact/);
});
