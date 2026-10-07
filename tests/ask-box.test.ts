import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { answerQuestion, REFUSAL_LOG_MAX_CHARS } from "../lib/routing/ask.ts";
import { matchTopic } from "../lib/routing/match.ts";
import { resolveAskRoleModel } from "../lib/ask/model.ts";

const TUCSON: [number, number] = [32.21696, -110.971];
const ROOT = join(import.meta.dirname, "..");

test("golden, live at 85701: the library question routes to Tucson and Pima", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "They stopped building the library down the road — who should I talk to?",
    coverage,
  );
  assert.equal(match?.topicId, "libraries");
  assert.equal(answer.kind, "ROUTED");
  const [cityStep, countyStep] = answer.steps;
  assert.ok(cityStep.bodies.some((b) => b.label === "Tucson"));
  assert.ok(countyStep.bodies.some((b) => b.label === "Pima"));
  assert.equal(answer.grounding.totalSteps, 2);
  assert.equal(answer.grounding.stepsWithSomeone, 2);
});

test("golden, live at 85701: the school-construction question routes to district policy", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "Who do I talk to about the new school construction they stopped?",
    coverage,
  );
  assert.equal(match?.topicId, "schools-policy");
  assert.equal(answer.kind, "ROUTED");
  assert.ok(
    answer.steps[0].bodies.some((b) => b.label.includes("Tucson Unified")),
    "the board step grounds on TUSD",
  );
});

test("the honest refusal: an unroutable question refuses, never guesses", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "what is the meaning of civic life",
    coverage,
  );
  assert.equal(match, null);
  assert.equal(answer.kind, "NO_ROUTE");
  assert.ok(answer.statement?.includes("Rather than guess"));
  assert.equal(answer.steps.length, 0);
});

test("a tie between topics refuses — evidence that does not decide is not a route", () => {
  // One school anchor hit for each school topic and nothing else.
  assert.equal(matchTopic("school"), null);
  assert.equal(matchTopic(""), null);
  assert.equal(matchTopic("   "), null);
});

test("golden, live at 85701: the pothole question returns Tucson's street-maintenance owner with a working phone", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  assert.equal(
    matchTopic("There's a pothole in front of my house — who do I call?"),
    null,
    "one keyword hit is weak: the ruling sends this to the classifier",
  );
  const { match, answer, contacts } = answerQuestion(
    "There's a pothole in front of my house — who do I call?",
    coverage,
    "85701",
    "roads-local",
  );
  assert.equal(match?.topicId, "roads-local");
  assert.equal(match?.via, "classifier");
  assert.equal(answer.kind, "ROUTED");
  const streetMaintenance = contacts.find((c) =>
    c.body.includes("Street Maintenance"),
  );
  assert.ok(streetMaintenance, "the street-maintenance owner must ride the answer");
  assert.equal(streetMaintenance.phone, "311");
  assert.equal(
    streetMaintenance.requestUrl,
    "https://www.tucsonaz.gov/Residents/311-Service-Request-Portal",
  );
  assert.match(streetMaintenance.sourceUrl, /^https:\/\/www\.tucsonaz\.gov\//);
  assert.equal(streetMaintenance.verification, "PAGE_FETCHED");
  assert.ok(streetMaintenance.note?.includes("service line is the answer"));
});

test("the refusal log drove the map: the two live refusals now route", async () => {
  const { matchTopic } = await import("../lib/routing/match.ts");
  assert.equal(matchTopic("my kids school")?.topicId, "schools-operations");
  assert.equal(matchTopic("I want a bike lane")?.topicId, "roads-local");
  assert.equal(matchTopic("school"), null);
});

test("every everyday contact is real: a phone or request URL, an https source, a valid topic and zip", async () => {
  const { EVERYDAY_CONTACTS, EVERYDAY_TOPIC_IDS, EVERYDAY_ZIPS } = await import(
    "../lib/routing/everyday.ts"
  );
  const { TOPIC_ROUTES } = await import("../lib/routing/topics.ts");
  const routeIds = new Set(TOPIC_ROUTES.map((t) => t.id));
  assert.ok(EVERYDAY_CONTACTS.length >= 20, `only ${EVERYDAY_CONTACTS.length} contacts`);
  for (const c of EVERYDAY_CONTACTS) {
    assert.ok(routeIds.has(c.topicId), `${c.body}: unknown topic ${c.topicId}`);
    assert.ok((EVERYDAY_TOPIC_IDS as readonly string[]).includes(c.topicId));
    assert.ok(c.zips.length > 0);
    for (const zip of c.zips) {
      assert.ok((EVERYDAY_ZIPS as readonly string[]).includes(zip), `${c.body}: unknown zip ${zip}`);
    }
    assert.ok(
      c.phone !== null || c.requestUrl !== null,
      `${c.body}: a contact with no phone and no request URL is not a contact`,
    );
    assert.match(c.sourceUrl, /^https:\/\//, `${c.body}: source must be https`);
    assert.ok(c.sourceOrg.length > 0);
    assert.match(c.collectedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(
      c.verification === "PAGE_FETCHED" || c.verification === "PENDING_BROWSER",
    );
  }
});

test("the everyday grid is fully accounted: every topic × zip cell is a contact or a recorded miss, never silence", async () => {
  const {
    EVERYDAY_CONTACTS,
    EVERYDAY_MISSES,
    EVERYDAY_TOPIC_IDS,
    EVERYDAY_ZIPS,
    everydayCoverageReport,
  } = await import("../lib/routing/everyday.ts");
  const covered = new Set<string>();
  for (const c of EVERYDAY_CONTACTS) {
    for (const zip of c.zips) covered.add(`${c.topicId}|${zip}`);
  }
  const missed = new Set(EVERYDAY_MISSES.map((m) => `${m.topicId}|${m.zip}`));
  for (const cell of missed) {
    assert.ok(!covered.has(cell), `${cell} is both a contact and a miss`);
  }
  for (const topic of EVERYDAY_TOPIC_IDS) {
    for (const zip of EVERYDAY_ZIPS) {
      const cell = `${topic}|${zip}`;
      assert.ok(
        covered.has(cell) || missed.has(cell),
        `cell ${cell} is neither covered nor a recorded miss — silence is the failure mode`,
      );
    }
  }
  for (const m of EVERYDAY_MISSES) {
    assert.ok(m.reason.length >= 20, `miss ${m.topicId}|${m.zip} needs a real reason`);
  }
  // The report states the same denominator the grid actually has.
  const report = everydayCoverageReport();
  assert.equal(report.cells, EVERYDAY_TOPIC_IDS.length * EVERYDAY_ZIPS.length);
  assert.equal(report.covered, covered.size);
  assert.equal(report.missed, EVERYDAY_MISSES.length);
  assert.equal(report.covered + report.missed, report.cells);
});

test("the everyday contacts ride only their own zip — a Tucson number never answers in Rockaway", async () => {
  const { everydayContactsFor } = await import("../lib/routing/everyday.ts");
  const tucson = everydayContactsFor("roads-local", "85701");
  const rockaway = everydayContactsFor("roads-local", "07866");
  assert.ok(tucson.length > 0 && rockaway.length > 0);
  assert.notDeepEqual(
    tucson.map((c) => c.phone),
    rockaway.map((c) => c.phone),
    "distinct zips must resolve distinct contacts (the uniqueness invariant)",
  );
  assert.deepEqual(everydayContactsFor("roads-local", null), []);
  assert.deepEqual(everydayContactsFor("roads-local", "99999"), []);
});

test("the acknowledgment beat draws from the author's fixed pool — and code never adds an entry", async () => {
  const { ASK_BEAT_POOL, PROHIBITED_BEAT_WORDS, beatStem } = await import(
    "../lib/routing/ask-beat-pool.ts"
  );
  assert.deepEqual(
    [...ASK_BEAT_POOL],
    [
      "Hang tight, I got you...",
      "Bet — one sec...",
      "On it...",
      "Let me grab that...",
    ],
    "the pool is the author's list; code never adds to it",
  );
  assert.equal(ASK_BEAT_POOL.length, 4);
  for (const entry of ASK_BEAT_POOL) {
    for (const banned of PROHIBITED_BEAT_WORDS) {
      assert.ok(
        !entry.toLowerCase().includes(banned),
        `beat entry "${entry}" implies deliberation ("${banned}")`,
      );
    }
  }
  // Exactly one trailing ellipsis is stripped — the animated dots follow,
  // and the reader never sees "......".
  assert.equal(beatStem("On it..."), "On it");
  assert.equal(beatStem("no dots"), "no dots");
});

test("the hang-tight beat is presentation only — routed and logged before the timer, and never labeled AI", () => {
  const source = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  assert.ok(
    source.includes("drawAskBeat()") && source.includes("beatStem(beat)"),
    "the beat renders a draw from the author's pool, not a hard-coded line",
  );
  assert.ok(
    /"\."\.repeat\(dots\)/.test(source),
    "the trailing dots animate in sequence for the beat's duration",
  );
  assert.ok(!/BEAT_(MIN|MAX|STEP)_MS|drawBeatMs|beatTimer/.test(source), "an artificial hold on a ready answer is back");
  assert.ok(!/Thinking|thinking\.\.\.|AI is/.test(source));
  // The answer is routed and logged BEFORE it is shown, and showing it logs nothing.
  const answerAt = source.indexOf("answerQuestion(question");
  const logAt = source.indexOf("logEvent(");
  const shownAt = source.indexOf("setAsked(result);");
  assert.ok(answerAt > 0 && logAt > answerAt && shownAt > logAt,
    "route → log → show, in that order");
});

const NON_GENERATING_ROUTING_MODULES = [
  "match.ts",
  "ask.ts",
  "resolve.ts",
  "topics.ts",
  "everyday.ts",
  "digest.ts",
  "exact-name.ts",
  "destinations.ts",
];

test("no generation: the ask pipeline touches no LLM, no network, no API key", () => {
  for (const file of NON_GENERATING_ROUTING_MODULES) {
    const source = readFileSync(join(ROOT, "lib", "routing", file), "utf8");
    for (const banned of ["fetch(", "anthropic", "openai", "API_KEY", "llm"]) {
      assert.ok(
        !source.toLowerCase().includes(banned.toLowerCase()),
        `lib/routing/${file} contains "${banned}" — v1 is routing WITHOUT generation`,
      );
    }
  }
});

test("log discipline: routed asks log the topic only; refusals carry capped text", () => {
  const routedCall = /logEvent\("QUESTION_ASKED", ocdIds, \{[\s\S]*?routed: true,([\s\S]*?)\}\);/.exec(
    source,
  );
  assert.ok(routedCall, "the routed log call is missing");
  assert.ok(
    !/question/.test(routedCall[1]),
    "the routed log call must carry no question text",
  );
  assert.match(
    source,
    /question: question\.slice\(0, REFUSAL_LOG_MAX_CHARS\)/,
    "the refusal log call must cap the text",
  );
  assert.ok(!/localStorage/.test(source), "the ask box reaches storage only through getOrCreateBrowserKey");
  assert.equal(REFUSAL_LOG_MAX_CHARS, 200);
});

test("scrub: phone-, email-, and address-shaped text becomes [#] before storage", async () => {
  const { scrubFreeText, SCRUB_MARK } = await import("../lib/log/scrub.ts");
  assert.equal(
    scrubFreeText("call me back at 973-627-2000 about the pothole"),
    `call me back at ${SCRUB_MARK} about the pothole`,
  );
  assert.equal(
    scrubFreeText("my number is (520) 791-4444, who fixes streetlights"),
    `my number is ${SCRUB_MARK}, who fixes streetlights`,
  );
  assert.equal(
    scrubFreeText("email me at jane.doe@example.com please"),
    `email me at ${SCRUB_MARK} please`,
  );
  assert.equal(
    scrubFreeText("the pothole is at 123 Main Street in front of my house"),
    `the pothole is at ${SCRUB_MARK} in front of my house`,
  );
  // A bare long digit run (an SSN shape) scrubs too.
  assert.equal(scrubFreeText("my ssn is 123456789"), `my ssn is ${SCRUB_MARK}`);
});

test("scrub: ordinary questions pass through untouched", async () => {
  const { scrubFreeText } = await import("../lib/log/scrub.ts");
  for (const q of [
    "who fixes potholes",
    "there are 3 potholes on my street",
    "why did the school board cut the budget",
    "I want a bike lane",
  ]) {
    assert.equal(scrubFreeText(q), q, `"${q}" must survive the scrub`);
  }
  // A five-digit zip is orientation, not identity — it survives.
  assert.equal(scrubFreeText("trash pickup in 85701"), "trash pickup in 85701");
});

test("scrub: the write path runs it before the insert — nothing unscrubbed reaches the store", () => {
  const source = readFileSync(join(ROOT, "lib", "db", "search-log.ts"), "utf8");
  const scrubAt = source.indexOf("scrubFreeText(");
  const insertAt = source.indexOf(".insert(searchLog)");
  assert.ok(scrubAt > 0, "the write path must scrub");
  assert.ok(insertAt > scrubAt, "the scrub must run BEFORE the insert");
});

test("QUESTION_ASKED is a registered identifier-free event type", async () => {
  const { SEARCH_LOG_EVENT_TYPES, assertDetailIsAnonymous } = await import(
    "../lib/db/search-log.ts"
  );
  assert.ok(SEARCH_LOG_EVENT_TYPES.includes("QUESTION_ASKED"));
  // The exact detail shapes the component sends pass the anonymity guard.
  assertDetailIsAnonymous({ topic: "libraries", routed: true });
  assertDetailIsAnonymous({
    topic: "NO_ROUTE",
    routed: false,
    question: "who fixes the streetlights",
  });
  assertDetailIsAnonymous({ topic: "roads-local", routed: true, via: "classifier" });
});

test("the classifier answers with a curated topic id, or nothing", async () => {
  const { classifiableTopicIds, readClassifierAnswer, classifierSchema, NO_TOPIC } =
    await import("../lib/routing/classifier.ts");
  const { TOPIC_ROUTES } = await import("../lib/routing/topics.ts");

  // The enum IS the curated route list — not a parallel copy that can drift.
  assert.deepEqual(classifiableTopicIds(), TOPIC_ROUTES.map((r) => r.id));
  assert.ok(classifiableTopicIds().length >= 9, "the topic list is the denominator");

  // Validated against that list HERE, not only by the schema. A schema is a
  // promise made by a server; a topic id is a claim about a government.
  assert.deepEqual(readClassifierAnswer("libraries"), {
    kind: "TOPIC",
    topicId: "libraries",
  });
  assert.deepEqual(readClassifierAnswer(NO_TOPIC), { kind: "NONE" });
  for (const bogus of ["", "LIBRARIES", "potholes-and-things", 7, null, undefined]) {
    assert.deepEqual(
      readClassifierAnswer(bogus),
      { kind: "NONE" },
      `${String(bogus)} must not become a route`,
    );
  }

  // The wire schema carries the same closed enum plus the refusal value.
  const schema = classifierSchema() as {
    properties: { topic: { enum: string[] } };
    additionalProperties: boolean;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.topic.enum, [
    ...classifiableTopicIds(),
    NO_TOPIC,
  ]);
});

test("keyword-first: the classifier can never overrule a deterministic match", async () => {
  const coverage = await coverageAt(...TUCSON, 1);

  const strong = "there is a pothole on my street";
  assert.equal(matchTopic(strong)?.matchedOn.length, 2);
  const keyworded = answerQuestion(strong, coverage, "85701");
  assert.equal(keyworded.match?.topicId, "roads-local");
  // Handing the classifier a DIFFERENT topic changes nothing — the fourth
  // argument is read only when matchTopic returned null.
  const overruled = answerQuestion(strong, coverage, "85701", "libraries");
  assert.equal(overruled.match?.topicId, "roads-local");
  assert.equal(overruled.match?.via, undefined, "a keyword match is not a classifier one");

  // And where the keyword matcher refuses, the classifier's topic is used —
  // marked as its own rung, with no evidence words to claim.
  const refused = "the thing outside my house has been out for a week";
  assert.equal(matchTopic(refused), null, "the fixture must still refuse by keyword");
  const classified = answerQuestion(refused, coverage, "85701", "roads-local");
  assert.equal(classified.match?.topicId, "roads-local");
  assert.equal(classified.match?.via, "classifier");
  assert.deepEqual(classified.match?.matchedOn, []);

  // A topic the routing map does not know is still refused — the classifier
  // cannot invent a route by naming one.
  const invented = answerQuestion(refused, coverage, "85701", "made-up-topic");
  assert.equal(invented.answer.kind, "NO_ROUTE");
});

test("the classifier is bounded: a ripcord, a ceiling, a cache, and no key means off", async () => {
  const { RIPCORDS } = await import("../lib/ripcords.ts");
  const {
    classifyQuestion,
    resetClassifierState,
    classifierSpendToday,
    cacheKey,
  } = await import("../lib/routing/classifier.ts");

  assert.equal(RIPCORDS["ripcord.askClassifier"].pulled, false);

  const priorKey = process.env.ANTHROPIC_API_KEY;
  const priorMax = process.env.WTP_ASK_CLASSIFIER_DAILY_MAX;
  try {
    // No key is not a guess — it is the rung declaring itself unavailable,
    // which the caller renders as the keyword refusal.
    delete process.env.ANTHROPIC_API_KEY;
    resetClassifierState();
    assert.deepEqual(await classifyQuestion("anything at all"), {
      kind: "UNAVAILABLE",
      why: "no-key",
    });

    // The ceiling REFUSES rather than degrading. An over-ceiling ask gets
    // the answer it would have had, never a worse one dressed as an answer.
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    process.env.WTP_ASK_CLASSIFIER_DAILY_MAX = "1";
    resetClassifierState();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: '{"topic":"libraries"}' }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const labelledBy = { model: resolveAskRoleModel("CLASSIFIER"), servedModel: null };
    assert.deepEqual(await classifyQuestion("first question", { fetchImpl }), {
      kind: "TOPIC",
      topicId: "libraries",
      ...labelledBy,
    });
    assert.equal(calls, 1);
    assert.equal(classifierSpendToday().calls, 1);
    assert.deepEqual(await classifyQuestion("a second, different question", { fetchImpl }), {
      kind: "UNAVAILABLE",
      why: "ceiling",
    });
    assert.equal(calls, 1, "the ceiling must stop the call, not just the answer");

    // The cache answers a repeat without spending — including over ceiling.
    assert.deepEqual(await classifyQuestion("First Question!", { fetchImpl }), {
      kind: "TOPIC",
      topicId: "libraries",
      ...labelledBy,
    });
    assert.equal(calls, 1);
    assert.equal(cacheKey("First Question!"), cacheKey("first question"));

    // A model answer off the list is NONE, not a route.
    process.env.WTP_ASK_CLASSIFIER_DAILY_MAX = "50";
    resetClassifierState();
    const rogue = (async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: '{"topic":"do-my-taxes"}' }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    assert.deepEqual(await classifyQuestion("something odd", { fetchImpl: rogue }), {
      kind: "NONE",
      ...labelledBy,
    });

    // An upstream failure is unavailable, never a guess.
    resetClassifierState();
    const broken = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    assert.deepEqual(await classifyQuestion("something else", { fetchImpl: broken }), {
      kind: "UNAVAILABLE",
      why: "error",
    });
  } finally {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
    if (priorMax === undefined) delete process.env.WTP_ASK_CLASSIFIER_DAILY_MAX;
    else process.env.WTP_ASK_CLASSIFIER_DAILY_MAX = priorMax;
    resetClassifierState();
  }
});

test("the classifier writes no reader-facing sentence, and the key stays server-side", () => {
  for (const file of NON_GENERATING_ROUTING_MODULES) {
    const source = readFileSync(join(ROOT, "lib", "routing", file), "utf8");
    for (const b of ["fetch(", "anthropic", "openai", "API_KEY", "llm"]) {
      assert.ok(
        !source.toLowerCase().includes(b.toLowerCase()),
        `lib/routing/${file} contains "${b}" — the answer is assembled without generation`,
      );
    }
  }

  const classifier = readFileSync(join(ROOT, "lib", "routing", "classifier.ts"), "utf8");
  // The scrub runs before anything leaves.
  assert.match(classifier, /scrubFreeText\(question\)/);
  // The response is read for one field and one field only.
  assert.match(classifier, /readClassifierAnswer\(parsed\.topic\)/);

  // The component reads a topic id off the route and nothing else — no
  // sentence, no summary, no explanation reaches a reader from the model.
  const box = readFileSync(join(ROOT, "components", "ask", "ask-box.tsx"), "utf8");
  assert.match(box, /body\.topic === "string" \? body\.topic : null/);
  assert.ok(
    !/ANTHROPIC|api\.anthropic/i.test(box),
    "the client must never hold the key or the endpoint",
  );

  // And the route itself never persists the question.
  const route = readFileSync(
    join(ROOT, "app", "api", "ask", "classify", "route.ts"),
    "utf8",
  );
  for (const banned of ["logSearchEvent", "writeReaction", "getDb", "insert("]) {
    assert.ok(!route.includes(banned), `the classify route must not ${banned}`);
  }
});
