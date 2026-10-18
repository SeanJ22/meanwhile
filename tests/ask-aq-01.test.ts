import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { decideNamedBody } from "../lib/ask/body-confirmation.ts";
import { lexicalReading } from "../lib/ask/lexical-reading.ts";
import { composeSittingAnswer } from "../lib/ask/sitting-answer.ts";
import { withResponseLifetime } from "../lib/log/after-response.ts";
import { meteredAskFetch } from "../lib/ask/cost.ts";
import { recordQuestionWork } from "../lib/ask/question-work.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { composeDistrictAnswer, districtQuestion } from "../lib/ask/districts.ts";
import { selectSitting } from "../lib/ask/select.ts";
import type { Division } from "../lib/registry/types.ts";
import { composePersonVotes } from "../lib/ask/person-votes.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

const body = (place: string, name: string): BindableEntity => ({ id: `${place}#board`, ocdId: place,
  name, level: "BODY", nameClass: "body", divisionType: "school_district" });
const tucson = body("ocd-division/country:us/state:az/school_district:tucson", "Tucson Unified School District Governing Board");
const turlock = body("ocd-division/country:us/state:ca/school_district:turlock", "Turlock Unified School District Board of Education");

test("AQ-01 abbreviations resolve using the reader's place and skip the model for a simple question", () => {
  const question = "When was the last TUSD meeting?";
  for (const local of [tucson, turlock]) {
    const inventory = [tucson, turlock];
    const decision = decideNamedBody(question, inventory, undefined, [], [local.ocdId!]);
    assert.equal(decision.kind, "BOUND");
    if (decision.kind === "BOUND") assert.equal(decision.entity.id, local.id);
    const reading = lexicalReading({ question, inventory, namedBodies: inventory, readerGoverning: [local] });
    assert.equal(reading?.subjectId, local.id);
    assert.equal(reading?.shape, "MEETING_TIME");
    assert.equal(reading?.interpretation.temporal.kind, "LAST");
  }
  assert.equal(decideNamedBody(question, [tucson, turlock]).kind, "CONFIRM");
});

test("AQ-01 a nickname-like typo with one real match does not need a confirmation", () => {
  assert.equal(decideNamedBody("What's on the Tucsno school district agenda?", [tucson]).kind, "BOUND");
  const la = body("ocd-division/country:us/state:ca/school_district:la", "Los Angeles Unified School District Board of Education");
  assert.equal(decideNamedBody("When does LAUSD meet?", [la]).kind, "BOUND");
});

test("AQ-01 ordinary question words do not silently name an unrelated body", () => {
  const housing = { ...tucson, id: "housing", name: "Housing Oversight Working", divisionType: undefined };
  assert.equal(decideNamedBody("How can I speak at a meeting?", [housing]).kind, "NONE");
  assert.equal(decideNamedBody("When does HOW meet?", [housing]).kind, "BOUND");
});

test("AQ-01 meeting answers use the body's local day and time across states, including daylight saving", () => {
  for (const [zone, expected] of [
    ["America/Phoenix", "October 7 at 4:00 PM"],
    ["America/Los_Angeles", "October 7 at 4:00 PM"],
    ["America/Chicago", "October 7 at 6:00 PM"],
    ["America/New_York", "October 7 at 7:00 PM"],
    ["America/Anchorage", "October 7 at 3:00 PM"],
    ["Pacific/Honolulu", "October 7 at 1:00 PM"],
  ]) {
    const sitting = { id: "m", title: "Budget Advisory Committee", startsAt: "2026-10-07T23:00:00Z", timeZone: zone, status: "SCHEDULED" };
    const answer = composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "TUSD", sittings: [sitting],
      records: [{ kind: "MEETING", id: "m", text: "Budget Advisory Committee", sourceUrl: "https://example.gov/calendar" }],
      sittingGaps: [{ role: "AGENDA", gap: { whose: "OURS", statement: "An unrelated agenda gap." } }], now: Date.parse("2026-10-18T00:00:00Z") });
    assert.equal(answer?.answer, `The most recent TUSD meeting was the Budget Advisory Committee on ${expected}.`);
    assert.deepEqual(answer?.citedUrls, ["https://example.gov/calendar"]);
  }
});

test("AQ-01 recording model cost does not delay the reader response and is retained by the host", async () => {
  let finish!: () => void;
  let saved = false;
  const writes: Promise<unknown>[] = [];
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const fetchModel = meteredAskFetch(async () => Response.json({ model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 } }), "FAST",
    async () => { await pending; saved = true; });
  const response = await withResponseLifetime(work => { writes.push(work); }, () => fetchModel("https://example.test", {
    method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1024 }),
  }));
  assert.equal(response.status, 200);
  assert.equal(saved, false);
  assert.equal(writes.length, 1);
  finish();
  await Promise.all(writes);
  assert.equal(saved, true);
});

test("AQ-01 missing answers enter the existing acquisition queue once; read-only probes create no work", async () => {
  const repos = createMemoryRepositories();
  const input = { question: "Who voted for the school budget?", divisions: [tucson.ocdId!], place: "85701",
    subjectId: tucson.id, runClass: "ORGANIC", now: "2026-10-18T00:00:00Z" };
  await recordQuestionWork({ ...input, runClass: "SYNTHETIC" }, repos);
  assert.equal((await repos.workItems.list()).length, 0);
  await recordQuestionWork(input, repos);
  await recordQuestionWork(input, repos);
  const rows = await repos.workItems.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value.state, "OPEN");
  assert.equal(rows[0].value.subject, tucson.id);
  assert.match(rows[0].value.obligation, /85701.*Who voted for the school budget/);
});

test("AQ-01 district questions use every sourced division in a split ZIP", () => {
  const divisions = [6, 7].map(n => ({ ocdId: `ocd-division/country:us/state:az/cd:${n}`, label: `District ${n}`,
    provenance: { sourceUrl: "https://www.census.gov/geographies.html", sourceOrg: "Census", collectedAt: "2026-10-18" } } as Division));
  assert.equal(districtQuestion("What's my congressional district?"), "cd");
  assert.equal(districtQuestion("Which school district do I live in?"), "school_district");
  assert.equal(districtQuestion("What did my district vote on?"), null);
  assert.equal(districtQuestion("Which districts border my school district?"), null);
  const answer = composeDistrictAnswer("cd", divisions, "85701");
  assert.equal(answer?.answer, "ZIP 85701 includes Congressional District 6 and Congressional District 7.");
  assert.equal(answer?.records.length, 2);
});

test("AQ-01 abbreviated bill numbers select the requested vote without matching a different bill", () => {
  const records = [1, 10].map(n => ({ kind: "ROLL_CALL_VOTE" as const, id: `vote:${n}`, text: `Vote on H.R. ${n}`,
    sourceUrl: `https://clerk.house.gov/votes/${n}`, rollCall: { position: n === 1 ? "Yea" : "Nay", what: `A measure (H R ${n})`, when: "October 7, 2026", result: "Passed" } }));
  const answer = composePersonVotes({ name: "Casey Example", topic: "HR1", records });
  assert.equal(answer?.answer, "Casey Example voted Yea on A measure (H R 1).");
  assert.deepEqual(answer?.citedUrls, ["https://clerk.house.gov/votes/1"]);
});

test("AQ-01 latest and next compare instants when publishers use different timestamp formats", () => {
  const earlier = { startsAt: "2026-10-07T18:00:00Z", timeZone: "America/Phoenix" };
  const later = { startsAt: "2026-10-07T16:00:00-07:00", timeZone: "America/Phoenix" };
  assert.equal(selectSitting("LAST", [earlier, later], Date.parse("2026-10-18T00:00:00Z")), later);
  assert.equal(selectSitting("NEXT", [later, earlier], Date.parse("2026-10-07T00:00:00Z")), earlier);
});
