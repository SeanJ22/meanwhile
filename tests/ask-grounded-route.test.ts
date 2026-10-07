import assert from "node:assert/strict";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";

delete process.env.ANTHROPIC_API_KEY;

const { POST } = await import("@/app/api/ask/grounded/route");
const { resetGroundedState } = await import("@/lib/ask/grounded-state");

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const VAIL_BOARD = `${VAIL}#board`;
const PIMA = "ocd-division/country:us/state:az/county:pima";
const AZ = "ocd-division/country:us/state:az";
const SLDU = "ocd-division/country:us/state:az/sldu:19";
const SLDL = "ocd-division/country:us/state:az/sldl:19";

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string; office?: string | null } | null;
  answer?: string | null;
  records?: {
    kind: string;
    id: string;
    text: string;
    occurredAt?: string | null;
    sourceUrl?: string | null;
    canonicalSubjectId?: string;
    candidateProfile?: EvidenceRecord["candidateProfile"];
    rollCall?: EvidenceRecord["rollCall"];
  }[];
  gaps?: { whose: string; statement: string }[];
  contacts?: { id: string; name: string; relationship: string; sourceUrl: string | null }[];
  denominators?: Record<string, number>;
  mention?: string;
  candidates?: string[];
  clarification?: string;
  trace?: {
    sourcesLoaded?: string;
    preloads?: Record<string, number>;
    preloadSources?: Record<string, string>;
    resolution: { state: string; basis?: string; subjectId?: string | null };
    retrieval: { selection: string; recordCount: number };
    answerMode: string;
  };
}

async function ask(
  question: string,
  over: Record<string, unknown> = {},
): Promise<GroundedBody> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must be
         — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "pr212-followup-route-test",
    },
    body: JSON.stringify({
      question,
      ocdIds: [AZ, PIMA, VAIL, SLDU, SLDL],
      /* Pinned so a passing test today cannot start failing on a Tuesday. The
         handler accepts a supplied date precisely so nothing has to guess one. */
      today: "2026-08-28",
      ...over,
    }),
  });
  const response = await POST(request);
  /* Read ONCE. A `Response` body is a stream, and reading it for an assertion
     message consumes it — so a failing status would have produced a confusing
     "Body has already been read" instead of the status it was reporting on. */
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as GroundedBody;
}

test("RED CONTROL: 'What's on the Vail school district agenda?' resolves Vail and takes the NEXT sitting", async () => {
  const body = await ask("What's on the Vail school district agenda?");

  assert.equal(body.subject?.id, VAIL_BOARD, "the BODY the reader NAMED, not its division");
  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.equal(body.trace?.retrieval.selection, "NEXT", "'what's on the agenda' means the next sitting");
  assert.equal(body.trace?.sourcesLoaded, "IDENTITY_AND_MEETINGS");
  for (const key of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) {
    assert.equal(body.trace?.preloads?.[key], undefined, `a bound meeting question never reads ${key}`);
    assert.equal(body.trace?.preloadSources?.[key], undefined, "an unread family is not mislabeled as a database read");
  }

  const meeting = body.records?.find((r) => r.kind === "MEETING");
  assert.ok(meeting, "the chosen sitting must travel as a record");
  assert.equal(
    meeting!.id,
    "apptegy:vail:60703698",
    "the next future Vail sitting as of 2026-08-28",
  );
});

test("a named body we don't hold gets a plain calendar gap without a model after restoring deferred sources", async () => {
  const body = await ask("When does the Unheld Example City Council meet next?");
  assert.equal(body.mode, "NO_EVIDENCE");
  assert.equal(body.answer, "We don't have Unheld Example City Council's calendar yet.");
  assert.equal(body.subject, null);
  assert.equal(body.clarification, undefined);
  assert.equal(body.records?.length, 0);
  assert.deepEqual(body.gaps, [{ whose: "OURS", statement: body.answer }]);
  assert.equal(body.trace?.sourcesLoaded, "ALL");
  for (const key of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) {
    assert.equal(typeof body.trace?.preloads?.[key], "number", `an unresolved body restores ${key} before its gap`);
  }
});

test("RED CONTROL: the SAME question in the past tense selects a DIFFERENT, earlier sitting", async () => {
  const body = await ask("What did the Vail school district discuss at its last meeting?");

  assert.equal(body.subject?.id, VAIL_BOARD);
  assert.equal(body.trace?.retrieval.selection, "LAST");
  const meeting = body.records?.find((r) => r.kind === "MEETING");
  assert.equal(meeting!.id, "apptegy:vail:60703697", "the most recent PAST sitting");
});

test("RED CONTROL: the sitting a reader reads is the LOCAL day, not the UTC day", async () => {
  const body = await ask("What's on the Vail school district agenda?");
  const meeting = body.records?.find((r) => r.kind === "MEETING");

  assert.match(meeting!.text, /Tuesday, September 8th, 2026 at 7:00 PM MST/);
  assert.ok(!/2026-09-09/.test(meeting!.text), "the UTC calendar date must not reach a reader");
  assert.ok(!/T02:00/.test(meeting!.text), "no ISO instant on a reader surface");
  assert.ok(!/America\/Phoenix/.test(meeting!.text), "no IANA zone id on a reader surface");
});

test("RED CONTROL: a portal landing page is NOT called this meeting's agenda", async () => {
  const body = await ask("What's on the Vail school district agenda?");

  const items = body.records?.filter((r) => r.kind === "AGENDA_ITEM") ?? [];
  assert.equal(items.length, 0, "no items may be extracted from a navigation menu");

  const gap = body.gaps?.find((g) => /agenda portal rather than the agenda itself/.test(g.statement));
  assert.ok(gap, "the reader is told exactly what we hold");
  assert.equal(gap!.whose, "OURS", "this is a fact about our retrieval, never about the district");

  const document = body.records?.find((r) => r.kind === "AGENDA_DOCUMENT");
  assert.ok(document?.sourceUrl, "the link still travels — it is where they publish it");
});

test("RED CONTROL: the Vail answer carries verified contacts with sources", async () => {
  const body = await ask("What's on the Vail school district agenda?");

  assert.ok((body.contacts?.length ?? 0) >= 5, "the district's own board and superintendent");
  for (const contact of body.contacts ?? []) {
    assert.ok(contact.sourceUrl, `${contact.name} carries the record it was read from`);
  }
  const superintendent = body.contacts?.find((c) => /Superintendent/.test(c.relationship));
  assert.ok(superintendent, "the most useful contact for a district question");

  const asRecords = body.records?.filter((r) => r.kind === "CONTACT") ?? [];
  assert.ok(asRecords.length > 0);
});

test("a question about a government we do not hold says so, and never substitutes a nearby one", async () => {
  const body = await ask("What's on the Cienega school district agenda?", {
  });
  assert.equal(body.mode, "NO_EVIDENCE");
  assert.equal(body.answer, "We don't have Cienega School District's agendas yet.");
  assert.equal(body.clarification, undefined);
  assert.equal(body.candidates, undefined);
  assert.equal(body.subject ?? null, null, "nothing is bound, so nothing is answered about");
});

test("RED CONTROL: Hobbs resolves to the exact person AND office, and the record gap is NAMED", async () => {
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");

  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.match(body.subject?.name ?? "", /Katie Hobbs/);

  const officeholder = body.records?.find((r) => r.kind === "OFFICEHOLDER");
  assert.ok(officeholder, "identity is a sourced record, not an assumption");
  assert.match(
    officeholder!.text,
    /holds the office of/,
    "identity is person AND office, never either alone",
  );
  assert.ok(officeholder!.sourceUrl, "every rendered fact about a person carries its source");
});

test("RED CONTROL: the corpus now HOLDS gubernatorial action records, windowed and bounded", async () => {
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");

  assert.ok(
    (body.denominators?.actionRecordsHeld ?? 0) > 0,
    "the corpus holds gubernatorial action records now",
  );

  const actions = body.records?.filter((r) => r.kind === "OFFICIAL_ACTION") ?? [];
  assert.ok(actions.length > 0, "and they reach the evidence pack");

  const SHAPES: RegExp[] = [
    /^Executive Order \d{4}-\d+, ".+", signed \d{4}-\d{2}-\d{2}\.$/,
    /^[HS][BCMJR]\d{3,4}, ".+", signed by the Governor on \d{4}-\d{2}-\d{2} and chaptered as Chapter \d+ of the \S+ session\.$/,
    /^[HS][BCMJR]\d{3,4}(, ".+",)? signed by the Governor on \d{4}-\d{2}-\d{2}, per her transmittal letter\.$/,
    /^[HS][BCMJR]\d{3,4}(, ".+",)? vetoed by the Governor on \d{4}-\d{2}-\d{2}, per her veto letter\.$/,
    /^[HS][BCMJR]\d{3,4}, ".+", became Arizona session law as Chapter \d+ .+\.$/,
    /^[HS][BCMJR]\d{3,4} — the Governor sent the legislature a letter about this bill\. We have the letter but have not read it yet, so we cannot say what it decided\./,
  ];
  for (const action of actions) {
    assert.ok(
      SHAPES.some((shape) => shape.test(action.text)),
      `${action.id} rendered a sentence no kind is allowed to produce: ${action.text}`,
    );
    assert.ok(action.sourceUrl, `${action.id} carries the document it was read from`);
  }

  for (const action of actions) {
    if (/\bsigned\b/i.test(action.text)) {
      assert.match(
        action.id,
        /^az-(eo|chapter|govletter)-/,
        `${action.id} claims a signing: ${action.text}`,
      );
      assert.ok(
        !/vetoed|have not read it yet/i.test(action.text),
        `${action.id} says both signed and not-signed: ${action.text}`,
      );
    }
  }

  for (const action of actions) {
    assert.ok(
      (action.occurredAt ?? "") >= "2025-08-28",
      `${action.id} at ${action.occurredAt} is outside the 12 months that were asked for`,
    );
  }
  assert.ok(
    (body.denominators?.actionRecordsInAskedWindow ?? 0) <
      (body.denominators?.actionRecordsHeld ?? 0),
    "the window actually narrows — a filter that matched everything would prove nothing",
  );

  const ourGaps = (body.gaps ?? []).filter((g) => g.whose === "OURS");
  assert.ok(ourGaps.length > 0, "what is still missing is named, never silence");

  const letterGap = ourGaps.find((g) => /letters about individual bills/.test(g.statement));
  assert.ok(letterGap, "the unread transmittal letters are a named gap");
  assert.match(
    letterGap!.statement,
    /we will not say what any of them decided until we have read it/,
    "and the gap refuses the inference rather than hinting at it",
  );

  for (const gap of body.gaps ?? []) {
    /* No gap may attribute our shortfall to the publisher. */
    assert.ok(
      !/does not permit automated reading|not ours to show/.test(gap.statement),
      `a gap still blames the publisher for our own shortfall: ${gap.statement}`,
    );
    if (gap.whose === "OURS") {
      assert.ok(
        !/\bthey (do not|don't|have not|haven't)\b/i.test(gap.statement),
        `an OURS gap is phrased as a fact about THEM: ${gap.statement}`,
      );
    }
  }

  /* And no gap anywhere may call the unread letters vetoes. */
  for (const gap of body.gaps ?? []) {
    if (/letters about individual bills/.test(gap.statement)) {
      assert.ok(!/\bveto/i.test(gap.statement), `an unread letter was called a veto: ${gap.statement}`);
    }
  }
});

test("RED CONTROL: nothing in the Hobbs reply is an action the corpus does not hold", async () => {
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");
  assert.equal(body.answer ?? null, null, "no model, no prose — never a plausible substitute");
  for (const record of body.records ?? []) {
    if (record.kind === "CONTACT") continue;
    if (record.kind === "CANDIDATE_CONTACT" && !record.sourceUrl) {
      const profile = record.candidateProfile;
      assert.ok(profile);
      assert.ok(["email", "phone"].includes(profile.field));
      const field = profile.field as "email" | "phone";
      const held = allCandidateCards().cards[profile.holdingKey];
      assert.ok(held, "contact exception requires an exact curated card holding");
      assert.equal(profile.value, held[field], "contact must be the native held field, never a generated substitute");
      assert.equal(record.canonicalSubjectId, profile.holdingKey);
      const pointer = profile.holdingKey.replaceAll("~", "~0").replaceAll("/", "~1");
      assert.equal(
        profile.holdingPath,
        `civic-data:CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates#/cards/${pointer}/${field}`,
        "the Reader receipt must identify the promoted candidate-profile authority, never its retired tracked seed",
      );
      assert.ok(profile.provenanceLimitation && record.text.includes(profile.provenanceLimitation), "missing contact provenance is disclosed with the actual field");
      continue;
    }
    assert.ok(record.sourceUrl, `${record.kind}:${record.id} reached the pack with no source`);
  }
});

test("BALLOT: a non-statewide challenger on the reader's ballot resolves and retrieves", async () => {
  const body = await ask("What do we know about Andy Biggs?", { surface: "BALLOT" });

  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.equal(body.subject?.id, "ballot-az-pima:governor|Andy Biggs");
  assert.equal(body.subject?.kind, "PERSON");
  assert.equal(body.subject?.office, "Governor", "identity is person AND office");

  const candidacy = body.records?.find((r) => r.kind === "CANDIDACY");
  assert.ok(candidacy, "the filing is the record");
  assert.equal(candidacy!.id, "ballot-az-pima:governor:biggs-andy");
});

test("BALLOT: a measure resolves from the short form a reader actually types", async () => {
  const body = await ask("What does Prop 423 do?", { surface: "BALLOT" });

  assert.equal(body.subject?.id, "ballot-az-pima:prop-423");
  assert.equal(body.subject?.kind, "MEASURE");
  const question = body.records?.find((r) => r.kind === "MEASURE_QUESTION");
  assert.ok(question, "the official question text, verbatim");
  assert.match(question!.text, /BUDGET OVERRIDE CONTINUATION/);
});

test("ASK-24: 'Explain Prop 141 to me' carries NOTHING off the measure — no Senate bullet, no unconnected people", async () => {
  const body = await ask("Explain Prop 141 to me", {
    surface: "BALLOT",
    ocdIds: [AZ, PIMA, VAIL, SLDU, SLDL],
  });

  assert.equal(body.subject?.id, "ballot-az-pima:prop-141");
  assert.equal(body.subject?.kind, "MEASURE");
  assert.equal(body.mode, "STRUCTURED_GROUNDED", "the measure's own records still answer it");

  /* The Senate bullet is gone — as a record and as any prose about it. */
  const absences = body.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.deepEqual(absences, [], "no ballot-at-large absence rides with a measure");
  for (const record of body.records ?? []) {
    assert.ok(
      !/U\.S\. Senate|Senate seat/i.test(record.text),
      `a record off the measure's subject reached the pack: ${record.text.slice(0, 80)}`,
    );
  }

  assert.deepEqual(body.contacts ?? [], [], "no contact without a printed connection to the measure");
  const contactRecords = body.records?.filter((r) => r.kind === "CONTACT") ?? [];
  assert.deepEqual(contactRecords, [], "and none reaches the evidence pack either");

  const own = (body.records ?? []).filter((r) => /^(CONTEST|MEASURE)/.test(r.kind));
  assert.ok(own.length > 0, "the measure's own contest/summary/provision records answer the question");
  for (const record of own) assert.ok(record.sourceUrl, `${record.kind} carries its source`);

  /* And the trace reports the gate ran, so a regression shows as a number. */
  assert.ok(
    (body.denominators?.recordsExcludedOffSubject ?? 0) >= 1,
    "the gate recorded the off-subject record it removed",
  );
});

test("BALLOT: a contest resolves and lists who filed for it", async () => {
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });

  assert.equal(body.subject?.id, "ballot-az-pima:governor");
  assert.equal(body.subject?.kind, "CONTEST");
  assert.ok(
    (body.denominators?.candidatesFiledForThisContest ?? 0) > 1,
    "the filing list is the denominator",
  );
});

test("BALLOT: a pronoun with one focused person on screen resolves; with two it asks", async () => {
  const one = await ask("What has she done?", {
    surface: "BALLOT",
    activeSubjects: [
      {
        id: "ballot-az-pima:governor|Katie Hobbs",
        name: "Katie Hobbs",
        kind: "PERSON",
        focused: true,
      },
    ],
  });
  assert.equal(one.subject?.id, "ballot-az-pima:governor|Katie Hobbs");

  const two = await ask("What has she done?", {
    surface: "BALLOT",
    activeSubjects: [
      { id: "ballot-az-pima:governor|Katie Hobbs", name: "Katie Hobbs", kind: "PERSON" },
      { id: "ballot-az-pima:governor|Andy Biggs", name: "Andy Biggs", kind: "PERSON" },
    ],
  });
  assert.equal(two.mode, "CLARIFY", "two plausible people ASK — they are never chosen between");
  assert.equal(two.candidates?.length, 2);
});

test("BALLOT: an explicit name beats the card the reader has open", async () => {
  const body = await ask("What has Katie Hobbs done?", {
    surface: "BALLOT",
    activeSubjects: [
      { id: "ballot-az-pima:governor|Andy Biggs", name: "Andy Biggs", kind: "PERSON", focused: true },
    ],
  });
  assert.match(body.subject?.name ?? "", /Katie Hobbs/);
});

test("RECORDS: no ISO date reaches a reader, because these render verbatim", async () => {
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });
  for (const record of body.records ?? []) {
    assert.ok(
      !/\d{4}-\d{2}-\d{2}/.test(record.text),
      `an ISO date reached a reader surface: ${record.kind} — ${record.text.slice(0, 160)}`,
    );
  }
  const contest = body.records?.find((r) => r.kind === "CONTEST");
  assert.ok(contest, "a contest question retrieves the contest");
  assert.match(contest.text, /November 3rd, 2026/, "spelled out, the way every other date is");
});

test("RECORDS: a source passage states the SEARCH, never a stance", async () => {
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  for (const record of (body.records ?? []).filter((r) => r.kind === "SOURCE_PASSAGE")) {
    assert.match(record.text, /^Searching a (campaign|official|held public) page linked to .+ for /);
    assert.ok(
      !/^On .+ published:/.test(record.text),
      "a matched passage is not a statement ON the issue that matched it",
    );
    assert.match(record.text, /A phrase match does not establish the candidate's personal stance/);
    assert.ok(record.sourceUrl, "and it carries the document it was read from");
  }
});

test("CONTACTS: a measure's contacts are its OWN district's board, not the reader's legislators", async () => {
  const body = await ask("What does Prop 423 do?", { surface: "BALLOT" });

  const names = (body.contacts ?? []).map((c) => c.name);
  assert.ok(names.includes("Allison Pratt"), `expected Vail's board, got ${names.join(", ")}`);
  assert.ok(
    !names.includes("David Gowan"),
    "a state senator has no factual relationship to a school district's budget override",
  );
  for (const contact of body.contacts ?? []) {
    assert.match(contact.relationship, /Vail Unified District$/);
    assert.ok(
      !/Proposition/.test(contact.relationship),
      `a person does not hold office on a ballot question: ${contact.relationship}`,
    );
  }
});

test("CONTACTS: the reader's own legislators are the FALLBACK, and they still appear", async () => {
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });
  const names = (body.contacts ?? []).map((c) => c.name);
  assert.ok(
    names.includes("David Gowan"),
    `a statewide contest has no roster of its own, so the reader's legislators stand: got ${names.join(", ")}`,
  );
  for (const contact of body.contacts ?? []) {
    assert.match(contact.relationship, /^Your /, "and they are described as the READER's, never the subject's");
  }
});

test("CONTACTS: an officeholder question carries that OFFICE's own published contact", async () => {
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  const office = body.contacts?.find((c) => /the office this question is about/.test(c.relationship));
  assert.ok(office, "the Governor's own office is the most relevant contact for a question about the Governor");
  assert.equal(office!.name, "Katie Hobbs");
  assert.ok(office!.sourceUrl, "and it is read off a sourced record like every other");
});

test("SOURCES: an answer does not carry documents it did not rest on", async () => {
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  const absences = body.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.equal(
    absences.length,
    0,
    "an absence about a school district is not evidence in an answer about the Governor",
  );

  const vail = await ask("What does Prop 423 do?", { surface: "BALLOT" });
  const vailAbsences = vail.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.equal(vailAbsences.length, 0, "a measure answer carries no absence about another race");
  assert.ok((vail.records ?? []).some((r) => r.kind.startsWith("MEASURE")), "the measure's own records stay");
  assert.ok((vail.contacts ?? []).some((c) => /Vail Unified District$/.test(c.relationship)), "its district board stays");
});

test("SIGNAL: a real reader Ask through the real route writes no interaction row without a continuity key", async () => {
  const body = await ask("What's on the Vail school district agenda?");
  assert.ok(body.subject, "the reader still gets their answer while nothing is stored");
});

test("ASK-05: every mode returns the WHOLE contract, not two or three keys", async () => {
  for (const [label, question] of [
    ["UNRESOLVED", "What is on the Nowheresville Township agenda?"],
    ["BOUND", "What's on the Vail school district agenda?"],
  ] as const) {
    const body = (await ask(question)) as unknown as Record<string, unknown>;
    for (const field of [
      "mode",
      "subject",
      "answer",
      "records",
      "gaps",
      "contacts",
      "denominators",
      "trace",
    ]) {
      assert.ok(field in body, `${label}: the reply dropped ${field}`);
    }
    assert.ok(Array.isArray(body.records), `${label}: records`);
    assert.ok(Array.isArray(body.gaps), `${label}: gaps`);
    assert.ok(Array.isArray(body.contacts), `${label}: contacts`);
  }
});

test("ASK-05: the topic sweep is EVIDENCE under the one answer, never a second answer", async () => {
  const body = await ask("Is there a rezoning coming?");
  assert.equal(
    typeof body.denominators?.agendasSweptForTopic,
    "number",
    "the sweep must state what it looked at, in the one denominator vocabulary",
  );

  const said = (body.gaps ?? []).map((g) => g.statement).join(" ");
  assert.match(
    said,
    /not the permit or zoning-application record/,
    "the corpus limit rides on every outcome — a filing exists long before a docket does",
  );

  for (const mention of body.records?.filter((r) => r.kind === "AGENDA_MENTION") ?? []) {
    assert.match(mention.text, /"/, "the record is the clerk's own line, quoted");
    assert.ok(mention.sourceUrl, "and it points at the agenda it was read from");
  }
});

test("ASK-05: a bound body NARROWS the sweep to its own agendas", async () => {
  const named = await ask("Is there a rezoning on the Vail school district agenda?");
  assert.equal(named.subject?.id, VAIL_BOARD, "the reader named a government");

  const wide = await ask("Is there a rezoning coming?");
  assert.ok(
    (named.denominators?.agendasSweptForTopic ?? 0) <
      (wide.denominators?.agendasSweptForTopic ?? 0),
    "a bound body must sweep FEWER agendas than the reader's whole area",
  );
});

const CD6 = "ocd-division/country:us/state:az/cd:6";

test("ASK-06 (a): a reader asking about their sitting representative gets his roll calls", async () => {
  const body = await ask("What has Juan Ciscomani done?", {
    ocdIds: [AZ, PIMA, CD6],
  });

  assert.equal(body.subject?.kind, "PERSON");
  assert.equal(body.subject?.name, "Juan Ciscomani");

  const votes = body.records?.filter((r) => r.kind === "ROLL_CALL_VOTE") ?? [];
  assert.ok(votes.length > 0, "twenty recorded federal votes reached nothing before ASK-06");
  assert.equal(body.denominators?.rollCallVotesRecorded, 20);

  for (const vote of votes) {
    assert.match(vote.sourceUrl ?? "", /clerk\.house\.gov\/Votes\//);
    /* Person AND office, and the office is the one he HOLDS. */
    assert.match(vote.text, /Juan Ciscomani, U\.S\. Representative: voted /);
  }
});

test("ASK-06 (a2): 'How has <person> voted?' is composed from the roll calls we hold — newest first, with how many we hold — with no model", async () => {
  const body = await ask("How has Juan Ciscomani voted?", { ocdIds: [AZ, PIMA, CD6] });
  assert.equal(body.mode, "GROUNDED_COMPOSED");
  assert.match(body.answer ?? "", /^Juan Ciscomani's most recent recorded votes: (?:YES|NO|Not Voting|Present)[^;]* on .+ \(.+; .+\)/);
  assert.match(body.answer ?? "", /We hold 20 recorded votes for Juan Ciscomani; the rest are listed below\.$/);
  const votes = (body.records ?? []).filter((record) => record.kind === "ROLL_CALL_VOTE");
  assert.equal(votes.length, 20, "the reader is shown every roll call, whatever the answer names");
  const newest = [...votes].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))[0]!;
  assert.ok((body.answer ?? "").includes(newest.rollCall!.what), "the newest recorded vote is the first one named");
});
