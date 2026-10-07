import assert from "node:assert/strict";
import test from "node:test";

/* No model runs: the deterministic half is what gets asserted. */
delete process.env.ANTHROPIC_API_KEY;

const { POST } = await import("@/app/api/ask/grounded/route");
const { resetGroundedState } = await import("@/lib/ask/grounded-state");

const AZ = "ocd-division/country:us/state:az";
const PIMA_DIVISION = "ocd-division/country:us/state:az/county:pima";
const SLDU = "ocd-division/country:us/state:az/sldu:19";
const SLDL = "ocd-division/country:us/state:az/sldl:19";

/** The county's own governing body. */
const BOARD_OF_SUPERVISORS = `${PIMA_DIVISION}#governing`;
/** A DIFFERENT government, recorded against the same division. */
const WATER_DISTRICT = `${PIMA_DIVISION}#central-arizona-water-conservation-district`;

const { readMeetingsProjection, requireMeetingsProjection } = await import("@/lib/meetings/snapshot");
const snapshot = requireMeetingsProjection(await readMeetingsProjection());

const meetingsOf = (bodyId: string) => snapshot.meetings.filter((m) => m.bodyId === bodyId);
const onDivision = snapshot.meetings.filter((m) => m.ocdId === PIMA_DIVISION);
const boardMeetings = meetingsOf(BOARD_OF_SUPERVISORS);
const waterMeetings = meetingsOf(WATER_DISTRICT);
const waterMeetingIds = new Set(waterMeetings.map((m) => m.id));

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string } | null;
  answer?: string | null;
  records?: {
    kind: string;
    id: string;
    text: string;
    bodyId?: string | null;
    /* Carried because an outcome record with no source is not evidence, and
       the assertion below is the only thing that would notice. */
    sourceUrl?: string | null;
  }[];
  gaps?: { whose: string; statement: string }[];
  denominators?: Record<string, number>;
  trace?: { resolution: { state: string; subjectId?: string | null } };
}

async function ask(question: string, over: Record<string, unknown> = {}): Promise<GroundedBody> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must be
         — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "exact-body-identity-2026-08-29",
    },
    body: JSON.stringify({
      question,
      ocdIds: [AZ, PIMA_DIVISION, SLDU, SLDL],
      /* The outcome first seed is a dated acceptance fixture. Pin the query
         date so a future clock cannot silently select a newer meeting whose
         outcome was never part of this fixture's denominator. */
      today: "2026-08-29",
      ...over,
    }),
  });
  const response = await POST(request);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as GroundedBody;
}

test("the committed corpus still puts two different governments on one division", () => {
  assert.ok(
    boardMeetings.length > 0,
    "the corpus holds no Board of Supervisors meetings — this test can no longer prove anything",
  );
  assert.ok(
    waterMeetings.length > 0,
    "the corpus holds no Central Arizona Water Conservation District meetings, so the " +
      "sibling-body case is no longer exercised and this whole file is a green no-op",
  );
  /* The exact shape of the defect: filtering by division would over-collect. */
  assert.ok(
    onDivision.length > boardMeetings.length,
    `the Pima division (${onDivision.length}) no longer carries more meetings than the ` +
      `Board itself (${boardMeetings.length}), so a division filter would no longer be wrong here`,
  );
});

test("the Board of Supervisors resolves to a BODY id, never to its division", async () => {
  const body = await ask("What's on the Pima County Board of Supervisors agenda?");

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    BOARD_OF_SUPERVISORS,
    `resolved to ${body.subject?.id} — the Ask inventory is keyed on the division again`,
  );
  assert.notEqual(
    body.subject?.id,
    PIMA_DIVISION,
    "the subject is the county DIVISION — 42 meetings, two governments, one of them wrong",
  );
});

test("no sibling body's meeting can reach an answer about the Board", async () => {
  const body = await ask("What's on the Pima County Board of Supervisors agenda?");
  const records = body.records ?? [];

  for (const record of records) {
    assert.ok(
      !waterMeetingIds.has(record.id),
      `a Central Arizona Water Conservation District meeting (${record.id}) was returned as ` +
        `evidence about the Board of Supervisors: "${record.text.slice(0, 120)}"`,
    );
    if (record.bodyId) {
      assert.equal(
        record.bodyId,
        BOARD_OF_SUPERVISORS,
        `record ${record.id} belongs to ${record.bodyId}, not to the resolved body`,
      );
    }
  }
});

test("the denominator counts the BODY's meetings, not the division's", async () => {
  const body = await ask("When does the Pima County Board of Supervisors meet next?");

  assert.equal(
    body.denominators?.meetingsHeldForThisBody,
    boardMeetings.length,
    "the meetings denominator is not the Board's own count",
  );
  assert.notEqual(
    body.denominators?.meetingsHeldForThisBody,
    onDivision.length,
    `the denominator is the DIVISION's count (${onDivision.length}) — every meeting on the ` +
      "geography is being treated as the Board's",
  );
});

test("the sibling body is still reachable under its OWN name", async () => {
  const body = await ask("What's on the Central Arizona Water Conservation District agenda?");

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    WATER_DISTRICT,
    "the water district can no longer be asked about by name — the repair over-corrected",
  );
  for (const record of body.records ?? []) {
    if (record.bodyId) assert.equal(record.bodyId, WATER_DISTRICT);
  }
});

test("the Board still retrieves its own meetings — the repair did not empty the answer", async () => {
  const body = await ask("When does the Pima County Board of Supervisors meet next?");

  assert.ok(
    (body.denominators?.meetingsHeldForThisBody ?? 0) > 0,
    "the Board now retrieves nothing at all, which is a different wrong answer",
  );
  const meetingRecords = (body.records ?? []).filter((r) => r.kind === "MEETING");
  for (const record of meetingRecords) {
    const held = snapshot.meetings.find((m) => m.id === record.id);
    assert.ok(held, `record ${record.id} is not a meeting in the corpus`);
    assert.equal(held?.bodyId, BOARD_OF_SUPERVISORS);
  }
});

test("a body named only 'Planning Board' is reachable by the town a reader would say", async () => {
  const body = await ask("What's on the Warner Planning Board agenda?", {
    ocdIds: [
      "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
      "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
      "ocd-division/country:us/state:nh",
    ],
  });

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#planning-board",
    "the reader named a town and a board; both are sourced and together they identify one body",
  );
});

test("qualifying by division never overwrites a body that has its own name", async () => {
  const body = await ask("What's on the Central Arizona Water Conservation District agenda?");
  assert.equal(body.subject?.id, WATER_DISTRICT, JSON.stringify(body.trace));
  assert.ok(
    !/^pima\b/i.test(body.subject?.name ?? ""),
    `a body with its own name was qualified anyway: "${body.subject?.name}"`,
  );
});

const OUTCOME_QUESTIONS = [
  "Did the Pima County Board of Supervisors vote on the budget?",
  "How did the Pima County Board of Supervisors vote last time?",
  "What did the Pima County Board of Supervisors decide at its last meeting?",
];

for (const question of OUTCOME_QUESTIONS) {
  test(`an outcome question is answered from OUTCOME records: ${question}`, async () => {
    const body = await ask(question);
    const records = body.records ?? [];
    const outcomeRecords = records.filter(
      (r) => r.kind === "MEETING_ACTION" || r.kind === "MEETING_MEMBER_VOTE",
    );
    assert.ok(
      outcomeRecords.length > 0,
      `the pack carried no outcome record at all: ${JSON.stringify(
        records.map((r) => r.kind),
      )}`,
    );

    /* Every outcome record traces to the body that was asked about. */
    for (const r of outcomeRecords) {
      assert.equal(r.bodyId, BOARD_OF_SUPERVISORS, `an outcome record from another body: ${r.id}`);
      assert.ok(r.sourceUrl, `an outcome record with no source: ${r.id}`);
    }

    if (/how did .* vote/i.test(question)) {
      assert.equal(
        records.filter((r) => r.kind === "MEETING_ACTION").length,
        0,
        "an action summary reached a per-member vote question",
      );
      assert.ok(
        records.some((r) => r.kind === "MEETING_MEMBER_VOTE"),
        "a per-member vote question got no per-member record",
      );
    }

    /* And no outcome gap, because the records are held. */
    assert.ok(
      !(body.gaps ?? []).some((g) => /have not recorded/i.test(g.statement)),
      `a gap claimed the outcome was missing while ${outcomeRecords.length} records were in the pack`,
    );
  });
}

test("all held per-member votes are returned with exact item and row denominators", async () => {
  // The evidence pack returns every eligible row; prose length never clips the reader records.
  const body = await ask("How did the Pima County Board of Supervisors vote last time?");
  const votes = (body.records ?? []).filter((r) => r.kind === "MEETING_MEMBER_VOTE");
  assert.ok(votes.length > 0, "the pack carried no per-member vote at all");

  const held = body.denominators?.personVotesHeldForThatMeeting;
  const inPack = body.denominators?.personVoteRowsInPack;
  assert.equal(typeof held, "number", "how many per-person votes are HELD must be reported");
  assert.equal(typeof inPack, "number", "and how many reached the pack must be reported too");
  assert.equal(inPack, votes.length, "the reported pack count must be the actual pack count");
  assert.equal(held, inPack, "every held member row reaches the pack");
  assert.ok(votes.length > 60, "the planted historical tail exceeds the removed cap");

  const withItem = votes.filter((r) => /^On "/.test(r.text));
  assert.ok(
    withItem.length > 0,
    "no vote row carried the item it was cast on: " + JSON.stringify(votes[0]?.text),
  );

  // Every complete roll call survives; question relevance still determines its order.
  const itemsHeld = body.denominators?.rollCallItemsHeldForThatMeeting;
  const itemsInPack = body.denominators?.rollCallItemsInPack;
  assert.equal(typeof itemsHeld, "number", "how many roll-call ITEMS are held must be reported");
  assert.equal(typeof itemsInPack, "number", "and how many items reached the pack");
  assert.equal(itemsHeld, itemsInPack, "every held roll-call item reaches the pack");

  const rowsPerItem = new Map();
  for (const r of votes) {
    const item = String(r.id).split("#")[0];
    rowsPerItem.set(item, (rowsPerItem.get(item) ?? 0) + 1);
  }
  assert.equal(
    rowsPerItem.size,
    itemsInPack,
    "the reported item count must be the actual number of distinct items in the pack",
  );
  // Exact, against the store: every item that reached the pack brought its
  // ENTIRE valid roll, as the store holds it — not the modal size, because a
  // roll with a genuinely smaller valid row set is not a split.
  const { outcomeEvidenceFor } = await import("../lib/outcomes/store.ts");
  const storeEvidence = outcomeEvidenceFor({
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    questionClass: "HOW_DID_THEY_VOTE",
  });
  const storeRows = new Map();
  for (const rec of storeEvidence.records) {
    if (rec.recordClass !== "ROLL_CALL") continue;
    storeRows.set(
      String(rec.eventItemId),
      rec.votes.filter((v) => v.personName && v.value).length,
    );
  }
  for (const [item, count] of rowsPerItem) {
    assert.equal(
      count,
      storeRows.get(item),
      `item ${item} reached the pack with ${count} member row(s) while the store holds ` +
        `${storeRows.get(item)} — a split roll call manufactures an absence for the members it dropped`,
    );
  }
});

test("NEGATIVE CONTROL: a body the outcome store holds nothing for still gets the OURS gap", async () => {
  const body = await ask("What did the Central Arizona Water Conservation District decide?");
  const records = body.records ?? [];
  assert.equal(
    records.filter((r) => r.kind === "MEETING_ACTION" || r.kind === "MEETING_MEMBER_VOTE").length,
    0,
    "outcome records appeared for a body the store holds none for",
  );
  const gaps = body.gaps ?? [];
  const outcomeGap = gaps.find((g) => /have not recorded|no outcome|not yet ingested/i.test(g.statement));
  assert.ok(outcomeGap, `no gap named the missing outcome record. gaps: ${JSON.stringify(gaps)}`);
  assert.equal(
    outcomeGap?.whose,
    "OURS",
    "our own empty store was rendered as a fact about that district",
  );
});

test("a question the agenda CAN answer is not given an outcome gap", async () => {
  for (const question of [
    "What was the Pima County Board of Supervisors last meeting about?",
    "What's on the Pima County Board of Supervisors agenda?",
    "When does the Pima County Board of Supervisors meet next?",
  ]) {
    const body = await ask(question);
    const gaps = body.gaps ?? [];
    assert.ok(
      !gaps.some((g) => /have not recorded (?:a roll call|minutes)/i.test(g.statement)),
      `"${question}" was given an outcome gap it never asked for: ${JSON.stringify(gaps)}`,
    );
  }
});

test("a named government we do not hold is still UNRESOLVED, never swapped", async () => {
  const body = await ask("What's on the Fictional Nonexistent County Board agenda?");
  assert.notEqual(body.trace?.resolution.state, "BOUND");
});
