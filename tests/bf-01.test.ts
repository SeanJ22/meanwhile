import assert from "node:assert/strict";
import test from "node:test";
import { deadlineAudience, deadlineSummary, orderedDeadlines } from "../lib/ballot/deadline-summary.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import { measureTitle } from "../lib/ballot/measure-title.ts";
import { BALLOT_LINK_START_SCRIPT } from "../lib/ballot/link-start.ts";
import { launchGuarded } from "../scripts/browser.mts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

test("an empty ZIP selection retains its published source without accepting an empty whole-source record", async () => {
  const pointer = requiredManualProductionContract("campaign-sites");
  const entry = provenEdgeEntry({ recordClass: pointer.recordClass, scope: pointer.scope, sourceId: pointer.sourceId,
    versionId: "BF-01:empty-selected-context", value: { kind: "campaign-sites", records: [] } });
  const store = {
    async readPromotion() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readCandidate() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readPromotedEntry() { return entry; },
  };
  await assert.rejects(readCuratedReaderProjection("campaign-sites", { store }), /no records/);
  const selected = await readCuratedReaderProjection("campaign-sites", { store }, "SELECTED");
  assert.equal(selected.kind, "PROMOTED");
  if (selected.kind === "PROMOTED") assert.deepEqual(selected.value.records, []);
});

test("ordinary deadlines lead and repeated legal instructions appear once, with military rules separate", () => {
  const base = { label: "Mail-ballot request", date: "2026-10-29", detail: "Request by 5 p.m.", sourceUrl: "https://elections.example.gov/rules",
    sourceOrg: "Election office", collectedAt: "2026-10-01", verifiedAt: "2026-10-01" };
  const military = { ...base, date: "2026-10-30", audience: "MILITARY_OVERSEAS" as const };
  const steps = orderedDeadlines([military, ...Array.from({ length: 40 }, () => ({ ...base }))]);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map(step => step.date), ["2026-10-29", "2026-10-30"]);
  assert.equal(deadlineAudience({ text: "Applications by military electors", quote: "Military voters", url: "https://elections.example.gov" }), "MILITARY_OVERSEAS");
  assert.equal(deadlineAudience({ text: "Ballot request", quote: "Request your ballot", url: "https://www.fvap.gov/arizona" }), "MILITARY_OVERSEAS");
  assert.equal(deadlineAudience({ text: "Request your mail ballot", quote: "Request by October 23", url: "https://elections.example.gov" }), "GENERAL");
  assert.equal(deadlineAudience({ text: "Deadline for ballot requests from non-UOCAVA voters", quote: "non-UOCAVA voters", url: "https://elections.example.gov" }), "GENERAL");
  assert.equal(deadlineAudience({ text: "October 30 (other than military and overseas voters)", quote: "military and overseas voters", url: "https://elections.example.gov" }), "GENERAL");
  assert.equal(deadlineAudience({ text: "Register by October 5", quote: "Send ballots to UOCAVA voters September 19. Register by October 5.", url: "https://elections.example.gov" }), "GENERAL");
  const calendar = electionDatesFor("AZ", [{ state: "AZ", electionDay: "2026-11-03", steps: [{ ...military, label: "Voter registration" }] }])!;
  assert.equal(calendar.steps[0].date, "2026-10-05");
  assert.equal(calendar.steps.at(-1)?.audience, "MILITARY_OVERSEAS");
});

test("a legal mail instruction keeps both request methods and times in plain words", () => {
  const text = "The clerk shall mail absentee ballots in response to verified absentee ballot requests that have been received by 12:00 p.m. on the day before the election. The clerk shall provide an absentee ballot to any voter requesting an absentee ballot in person at the clerk's office up until 5:00 p.m. on the day before the election or as may be provided elsewhere in Title LXIII.";
  const summary = deadlineSummary({ fieldKind: "mail_ballot_request_deadline", text, quote: text });
  assert.match(summary, /noon the day before the election/);
  assert.match(summary, /clerk’s office until 5 p\.m\./);
  assert.doesNotMatch(summary, /shall|Title LXIII/);
});

test("measure headings use held designations and never assign numbers from their positions", () => {
  assert.equal(measureTitle({ title: "Clean water" }, { officialNumber: "Question 3", questionText: "Shall…" }), "Question 3 — Clean water");
  assert.equal(measureTitle({ title: "Question 3 — Clean water" }, { officialNumber: "Question 3", questionText: "Shall…" }), "Question 3 — Clean water");
  assert.equal(measureTitle({ title: "Clean water" }, null), "Clean water");
  assert.equal(measureTitle({ title: "A 1% tax" }, { officialNumber: "1", questionText: "Shall…" }), "1 — A 1% tax");
  for (const [title, officialNumber] of [["Ci-132", "CI-132"], ["LR19CA — Proposed Amendment", "LR19CA"], ["State Question - No. 6", "6"], ["1. Higher Education", "1"]])
    assert.equal(measureTitle({ title }, { officialNumber, questionText: "Shall…" }), title);
});

test("a Ballot click before hydration carries the saved ZIP and a link's ZIP takes precedence", async () => {
  const browser = await launchGuarded({ label: "BF-01-before-hydration", blockWrites: true });
  try {
    const page = await browser.page();
    await page.route("http://127.0.0.1:3319/**", route => route.fulfill({ contentType: "text/html", body:
      new URL(route.request().url()).pathname === "/ballot" ? "<p>Your ballot</p>"
        : `<script>${BALLOT_LINK_START_SCRIPT}</script><a data-ballot-link href="${new URL(route.request().url()).searchParams.has("point") ? "/ballot?state=CO&lat=39.7&lng=-104.9" : "/ballot"}">Ballot</a>` }));
    await page.goto("http://127.0.0.1:3319/");
    await page.evaluate(() => localStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: "85701" })));
    await page.getByRole("link", { name: "Ballot", exact: true }).click();
    await page.waitForURL("http://127.0.0.1:3319/ballot?zip=85701");
    await page.goto("http://127.0.0.1:3319/?zip=03301");
    await page.getByRole("link", { name: "Ballot", exact: true }).click();
    await page.waitForURL("http://127.0.0.1:3319/ballot?zip=03301");
    await page.goto("http://127.0.0.1:3319/?point=1");
    await page.getByRole("link", { name: "Ballot", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/ballot" && url.searchParams.get("zip") === "85701");
    assert.equal(new URL(page.url()).searchParams.get("state"), "CO");
    assert.equal(new URL(page.url()).searchParams.get("lat"), "39.7");
  } finally { await browser.close(); }
});
