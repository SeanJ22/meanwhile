import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { answerQuestion, REFUSAL_LOG_MAX_CHARS } from "../lib/routing/ask.ts";
import { matchTopic } from "../lib/routing/match.ts";

/**
 * The ask box, v1 (session brief 5, 2026-08-19): routing without
 * generation. The author's two golden cases run LIVE — the same
 * answerQuestion the surface calls, against the real registry at 85701 —
 * plus the honest refusal, the no-LLM guarantee, and the transparency
 * coupling.
 */

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

// ── The everyday layer (session brief 3, wall clock 2026-08-14) ──────────

test("golden, live at 85701: the pothole question returns Tucson's street-maintenance owner with a working phone", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer, contacts } = answerQuestion(
    "There's a pothole in front of my house — who do I call?",
    coverage,
    "85701",
  );
  assert.equal(match?.topicId, "roads-local");
  assert.equal(answer.kind, "ROUTED");
  const streetMaintenance = contacts.find((c) =>
    c.body.includes("Street Maintenance"),
  );
  assert.ok(streetMaintenance, "the street-maintenance owner must ride the answer");
  // The city's own page, read in a real browser 2026-08-14: the published
  // channel is Tucson 311 — call 3-1-1 or the request portal. The old
  // direct TDOT line lives on in 2015-era news stories; the city's page
  // today says 311, and the row ships what the page says.
  assert.equal(streetMaintenance.phone, "311");
  assert.equal(
    streetMaintenance.requestUrl,
    "https://www.tucsonaz.gov/Residents/311-Service-Request-Portal",
  );
  assert.match(streetMaintenance.sourceUrl, /^https:\/\/www\.tucsonaz\.gov\//);
  assert.equal(streetMaintenance.verification, "PAGE_FETCHED");
  // The service line is the answer — the note says so.
  assert.ok(streetMaintenance.note?.includes("service line is the answer"));
});

test("the refusal log drove the map: the two live refusals now route", async () => {
  const { matchTopic } = await import("../lib/routing/match.ts");
  // "my kids school" refused on the school-anchor tie (logged 2026-08-14
  // 18:49 UTC); the possessive is a running-the-school question.
  assert.equal(matchTopic("my kids school")?.topicId, "schools-operations");
  // "I want a bike lane" (logged 2026-08-14 18:16 UTC) is a streets ask.
  assert.equal(matchTopic("I want a bike lane")?.topicId, "roads-local");
  // The original tie still refuses — "school" alone cannot decide.
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

test("the hang-tight beat is presentation only — routed and logged before the timer, and never labeled AI", () => {
  const source = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  // The author's words, verbatim — the trailing dots animate (6e,
  // 2026-08-14 second session), so the static half is the sentence and
  // the dots render beside it.
  assert.ok(source.includes("I got you... hang tight"));
  assert.ok(
    /"\."\.repeat\(dots\)/.test(source),
    "the trailing dots animate in sequence for the beat's duration",
  );
  // The author's retune: ~3 seconds before the answer renders.
  assert.ok(
    source.includes("BEAT_MS = 3000"),
    "the beat holds three seconds",
  );
  // Never "Thinking" or anything implying AI — the transparency page says
  // no AI answers questions and the label must not contradict it.
  assert.ok(!/Thinking|thinking\.\.\.|AI is/.test(source));
  // The answer and the log both happen BEFORE the beat timer starts: the
  // routing stays instant and deterministic; only the rendering waits.
  const answerAt = source.indexOf("answerQuestion(question");
  const logAt = source.indexOf("logEvent(");
  const timerAt = source.indexOf("beatTimer.current = setTimeout(");
  assert.ok(answerAt > 0 && logAt > answerAt && timerAt > logAt,
    "route → log → beat, in that order; nothing new logs inside the beat");
  // Nothing is logged inside the timer callback.
  const timerBody = source.slice(timerAt, source.indexOf("}, BEAT_MS)"));
  assert.ok(!timerBody.includes("logEvent"), "the beat must not log");
});

test("no generation: the ask pipeline touches no LLM, no network, no API key", () => {
  for (const file of ["match.ts", "ask.ts", "resolve.ts", "topics.ts", "everyday.ts"]) {
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
  // The component is the enforcement point — pin its source: the routed
  // branch must not send the question, the refusal branch must cap it.
  const source = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  assert.match(source, /routed: true,\s*\}/, "the routed log call must carry no question text");
  assert.match(
    source,
    /question: question\.slice\(0, REFUSAL_LOG_MAX_CHARS\)/,
    "the refusal log call must cap the text",
  );
  assert.ok(!/localStorage/.test(source), "the ask box stores nothing on the device");
  assert.equal(REFUSAL_LOG_MAX_CHARS, 200);
});

test("the transparency page covers the ask box in the same commit", () => {
  const page = readFileSync(
    join(ROOT, "app", "transparency", "page.tsx"),
    "utf8",
  );
  assert.match(page, /Who do I talk to about/);
  assert.match(page, /no AI writes the answer/);
  assert.match(page, /200\s*(\n\s*)?characters/, "the cap must be stated to readers");
  // The scrub coupling (session brief 4): the scrub ships with its
  // disclosure — the page states that phone-, email-, and address-shaped
  // text is blanked before storage.
  assert.match(page, /automatically\s+blanked/, "the scrub must be disclosed");
  assert.match(page, /phone number/);
  assert.match(page, /street\s+(\n\s*)?address/);
});

// ── The scrub (session brief 4, wall clock 2026-08-14) ───────────────────

test("scrub: phone-, email-, and address-shaped text becomes [#] before storage", async () => {
  const { scrubFreeText, SCRUB_MARK } = await import("../lib/log/scrub.ts");
  // The three fixture shapes the brief names, each in a real question.
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
});
