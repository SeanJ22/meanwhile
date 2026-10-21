import assert from "node:assert/strict";
import test from "../../tests/helpers/playbooks.ts";
import { factDb } from "../../tests/helpers/fact-db.ts";
import { readAskCommentAccess } from "./comment-access.ts";
import { lexicalReading } from "./lexical-reading.ts";
import { composeBodyOfficeAnswer } from "./office-contacts.ts";
import { commentAccessEvidenceFor } from "./meeting-knowledge.ts";
import { POST } from "../../app/api/ask/grounded/route.ts";
import { withResponseLifetime } from "../log/after-response.ts";
import { memberMeetingVoteQuestion, readMemberMeetingVotes } from "./member-meeting-votes.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { registryTransferImport } from "../../tests/helpers/promoted-fixtures.ts";
import { readerContestReference, readerMeasureReference, composeMissingContestStatements, readerMoneyReference, composeMissingReaderFunding } from "./reader-references.ts";
import type { BallotForDivisions } from "./server-sources.ts";
import { composeSittingAnswer } from "./sitting-answer.ts";

test("AQ-03 a question without a selected state gets its labeled AI answer instead of a registry exception", async () => {
  const priorFetch = globalThis.fetch, priorKey = process.env.ANTHROPIC_API_KEY;
  const priorDatabase = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.ANTHROPIC_API_KEY = "fixture";
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    return Response.json({ content: [{ type: "tool_use", name: "answer_reader", input: { known: true, answer: "A city council makes local laws." } }] });
  };
  try {
    for (const place of [{}, { ocdIds: ["ocd-division/country:us"] }, { approximateLocation: "00000", today: "2026-99-99" }]) {
      const pending: Promise<unknown>[] = [];
      const response = await withResponseLifetime(work => pending.push(work), () => POST(new Request("https://example.test/api/ask/grounded", {
        method: "POST", headers: { origin: "https://example.test", "content-type": "application/json", "x-wtp-synthetic-run": "aq-03" },
        body: JSON.stringify({ question: "What does a city council do?", ...place }),
      })));
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.aiAnswer, "A city council makes local laws.");
      assert.equal(answer.mode, "NO_EVIDENCE");
      assert.deepEqual(answer.records, []);
      assert.match(response.headers.get("server-timing")!, /ai_answer;dur=/);
      await Promise.all(pending);
    }
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorKey;
    if (priorDatabase !== undefined) process.env.DATABASE_URL = priorDatabase;
  }
});

test("AQ-03 relative references use held people and preserve ambiguity and compound qualifiers", () => {
  const person = (id: string, name: string) => ({ id, name, nameClass: "person" as const, divisionType: "person" });
  const people = [person("held:a", "Ada Adams"), person("held:b", "Bo Brown")];
  const question = "Who gives money to my member of Congress?";
  const read = (readerPeople: { id: string; officeTitle: string }[]) => lexicalReading({ question, inventory: people, namedBodies: [], readerPeople });
  assert.equal(read([{ id: "held:b", officeTitle: "U.S. Representative" }])?.subjectId, "held:b");
  assert.equal(read([])?.subjectId, "");
  const split = read(people.map(person => ({ id: person.id, officeTitle: "U.S. Representative" })));
  assert.equal(split?.subjectId, "");
  assert.deepEqual(split?.areaChoices?.bodies.map(person => person.id), ["held:a", "held:b"]);
  assert.ok(readerContestReference("Who is running for my state house seat, and what do they say about housing?"));
  assert.equal(readerContestReference("Who is running for my state house seat, and what do they say about housing and taxes?"), null);
  assert.ok(readerMeasureReference("What does the measure on my ballot actually do, and what does a NO vote mean?"));
  assert.equal(readerMeasureReference("What does the measure on my ballot do and who paid for it?"), false);
  const measures = ["one", "two"].map(id => ({ id, name: id, nameClass: "body" as const, divisionType: "measure" }));
  const measure = lexicalReading({ question: "What does the measure on my ballot actually do, and what does a NO vote mean?", inventory: measures, namedBodies: [] });
  assert.equal(measure?.subjectId, "");
  assert.equal(measure?.areaChoices?.bodies.length, 2);
  assert.equal(memberMeetingVoteQuestion("What did my mayor vote on at the last council meeting, and how did it turn out?")?.divisionType, "place");
  assert.equal(memberMeetingVoteQuestion("What did my mayor vote on at the last council meeting about housing?"), null);
  assert.equal(memberMeetingVoteQuestion("What did my senator vote on at the last council meeting?"), null);
});

test("AQ-03 an unusual jurisdiction or unclassified office retains the full vote reader", async () => {
  const base = registryTransferImport().projection.payload;
  for (const scenario of [
    { division: "ocd-division/country:us/district:dc", type: "district", title: "Mayor", question: "What did my mayor vote on at the last council meeting?" },
    { division: "ocd-division/country:us/state:az/school_district:example", type: "school_district", title: "Trustee", question: "What did my school board member vote on at the last school board meeting?" },
  ]) {
    const bodyId = `${scenario.division}#board`;
    const model = { ...base, bodyRosters: [{ bodyId, bodyName: "Example board", sourceUrl: "https://example.gov/board",
      sourceOrg: "Example government", collectedAt: "2026-10-20", partisanship: "UNDETERMINED" as const,
      members: [{ id: "held:person", name: "Ada Adams", officeTitle: scenario.title, termNote: null,
        email: null, phone: null, websiteUrl: null }] }] };
    const result = await withRegistryRuntimeProjection(model, [scenario.type === "district" ? "DC" : "AZ"], () =>
      readMemberMeetingVotes(scenario.question, [{ id: bodyId, ocdId: scenario.division, name: "Example board",
        nameClass: "body", divisionType: scenario.type }], [scenario.division], Date.parse("2026-10-20")));
    assert.equal(result, null, scenario.title);
  }
});

test("AQ-03 comment rules use migrated tables and stay with the exact resolved body", async () => {
  const db = await factDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES ('one','body','Council','AZ'),('two','body','School board','AZ')");
    const [source] = await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
      VALUES ('https://example.gov/rules','https://example.gov/rules',now(),$1,'aq-03:rules') RETURNING id`, ["a".repeat(64)]);
    for (const id of ["one", "two"]) await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES ($1,'comment:period','"YES"','YES','live','OFFICIAL',$2,'Public comment is allowed.',now(),'fixture')`, [id, source.id]);
    let reads = 0;
    const rules = await readAskCommentAccess("one", async statements => {
      reads += statements.length;
      return Promise.all(statements.map(statement => db.query(statement.text, statement.params)));
    });
    assert.equal(reads, 1);
    assert.deepEqual(rules.map(rule => rule.bodyId), ["one"]);
    assert.equal(commentAccessEvidenceFor("two", null, "School board", rules).records.length, 0);
    assert.equal(commentAccessEvidenceFor("one", null, "Council", rules).records[0]?.sourceUrl, "https://example.gov/rules");
  } finally { await db.pg.close(); }
});

test("AQ-03 exact office and compound agenda questions bind locally and preserve qualifiers", () => {
  const place = "ocd-division/country:us/state:az/place:tucson";
  const school = "ocd-division/country:us/state:az/school_district:tucson";
  const entities = [
    { id: `${place}#governing`, ocdId: place, name: "Tucson City Council", level: "BODY" as const, nameClass: "body" as const, divisionType: "place" },
    { id: `${school}#board`, ocdId: school, name: "Tucson Unified School District", level: "BODY" as const, nameClass: "body" as const, divisionType: "school_district" },
  ];
  const read = (question: string) => lexicalReading({ question, inventory: entities, namedBodies: entities, readerGoverning: entities });
  assert.equal(read("Where is my school district office?")?.subjectId, `${school}#board`);
  assert.equal(read("When does my city council meet next, and what's on the agenda?")?.shape, "BODY_AGENDA");
  assert.equal(read("Where is my school district office, and how much did it spend?"), null);
  assert.equal(read("When does my city council meet next, and what's on the agenda about housing?"), null);
  const genericOtherBody = { ...entities[0], id: "elsewhere", name: "City Council" };
  const ownReading = lexicalReading({ question: "When does my city council meet next, and what's on the agenda?",
    inventory: [...entities, genericOtherBody], namedBodies: [...entities, genericOtherBody], readerGoverning: [entities[0]] });
  assert.equal(ownReading?.subjectId, entities[0].id);
  assert.equal(composeBodyOfficeAnswer("Where is my school district office?", [])?.missingAnswer, true);
});

test("AQ-03 a missing statement keeps every certified candidate and its source", () => {
  const sourceUrl = "https://example.gov/canvass.pdf";
  const reference = readerContestReference("Who is running for my state house seat, and what do they say about housing?")!;
  const ballot = { loaderFailures: [], sets: [{ election: { id: "general", name: "General election", state: "AZ", date: "2026-11-03" },
    contests: [{ id: "house:one", title: "State Representative, District 1", type: "CANDIDACY", provenance: { sourceUrl } }], candidacies: [], removals: [] }],
    nominees: () => ["Ada Adams", "Bo Brown"].map(name => ({ name, partyLabel: null, sourceUrl })) } as unknown as BallotForDivisions;
  const answer = composeMissingContestStatements(reference, ballot)!;
  assert.match(answer.answer, /Ada Adams and Bo Brown/);
  assert.match(answer.answer, /don't have their statements about housing/);
  assert.deepEqual(answer.citedUrls, [sourceUrl]);
  assert.equal(answer.missingAnswer, true);
});

test("AQ-03 a funding-source gap needs no writer, while held filings still reach their reader", () => {
  const reference = readerMoneyReference("Who gives money to my member of Congress?")!;
  const person = { id: "congress:one", name: "Ada Adams" };
  assert.equal(composeMissingReaderFunding(reference, person, [])?.missingAnswer, true);
  assert.equal(composeMissingReaderFunding(reference, person, [{ kind: "FINANCE_SUMMARY", id: "filing:one", text: "A held FEC filing.", sourceUrl: "https://fec.gov/filing" }]), null);
});

test("AQ-03 a compound agenda answer retains the sourced date and links when agenda text is missing", () => {
  const meeting = { id: "held:meeting", title: "Regular meeting", startsAt: "2026-10-21T17:00:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };
  const answer = composeSittingAnswer({ shape: "BODY_AGENDA", subjectName: "Example Council", includeMeetingTime: true,
    sittings: [meeting], now: Date.parse("2026-10-20T12:00:00Z"),
    records: [{ kind: "MEETING", id: meeting.id, text: "Held meeting", sourceUrl: "https://example.gov/meeting" },
      { kind: "AGENDA_DOCUMENT", id: "held:agenda", text: "Held agenda", sourceUrl: "https://example.gov/agenda.pdf" }],
    sittingGaps: [{ role: "AGENDA", gap: { whose: "OURS", statement: "We haven't read the agenda text." } }] });
  assert.match(answer!.answer, /October 21/);
  assert.match(answer!.answer, /Regular meeting at 5:00 PM/);
  assert.match(answer!.answer, /don't have the agenda details/);
  assert.deepEqual(answer!.citedUrls, ["https://example.gov/meeting", "https://example.gov/agenda.pdf"]);
});
