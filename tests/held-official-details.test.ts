import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { heldCommitteeCandidates, heldCommitteeFacts, heldStatementFacts, heldStatementLinks } from "../lib/control-plane/scheduler/providers/held-official-details.ts";
import { publishHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-publication.ts";
import type { HeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { heldSubjectDb } from "./helpers/held-subject-db.ts";

const AT = "2026-10-20T07:00:00.000Z", URL = "https://sample.example.gov/ada", PERSON = "person:ada";
const subject: HeldSubjectDetails = { subjectId: "roster:ada", subjectKind: "official", bodyId: null, bodyName: null, personId: PERSON,
  heldMemberId: "roster:ada", personName: "Ada Sample", officeTitle: "Councilmember", governmentId: null,
  sourceUrl: URL, sourceUrls: [URL], profileUrls: [URL], divisionIds: ["ocd-division/country:us/state:az/place:sample"],
  checklistIds: ["OFF-09", "OFF-12", "OFF-19"], needsMembers: false, label: "Ada Sample", checkedAt: AT };
const QUOTE = "Housing should be within reach of every family in our city.";
const page = `<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p><h2>Committee assignments</h2><ul>
  <li>Finance Committee — Chair — 2026–2028</li><li>Unheld Committee — Member</li></ul>
  <h2>Public statements</h2><article><h3>Housing statement</h3><time datetime="2026-10-19">October 19, 2026</time>
  <blockquote>${QUOTE}</blockquote><cite>Ada Sample</cite></article></main>`;
const capture = (html = page): WorkerPublicationCapture => ({ httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: AT,
  evidence: { artifactId: `saved:${createHash("sha256").update(html).digest("hex")}`, contentHash: `sha256-${createHash("sha256").update(html).digest("hex")}`,
    canonicalUrl: URL, text: html, retrievedAt: AT, sourceId: "sample.example.gov", methodRouteId: "held-subject-details", acquiredByAttemptId: "fixture-read" } });

test("one exact held official publishes verified committee and statement facts while their missing reader edges stay named", async () => {
  const db = await heldSubjectDb();
  try {
    const body = { id: "held:az:finance", name: "Finance Committee", ocdId: subject.divisionIds[0], bodyClass: "COMMITTEE", homepageUrl: "https://sample.example.gov/finance" };
    await db.saveRegistry("AZ", { registry: { bodies: [body, { ...body, id: "held:other-city:finance", ocdId: "ocd-division/country:us/state:az/place:other" }] } });
    await db.saveRegistry("NM", { registry: { bodies: [{ ...body, id: "held:nm:finance" }] } });
    const report = await publishHeldSubjectDetails({ subject, capture: capture(), db, clocks: factClocks(null), now: new Date(AT), purge: async () => ({ purged: true }) });
    assert.equal(report.refused, null);
    assert.equal(report.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "PUBLISH").length, 3);
    assert.equal(report.readerSupportedNewFacts, 0);
    assert.ok(report.readerDependencies.some(row => row.field === `committee:${body.id}` && row.ownerChange.includes("app/api/directory/route.ts")));
    assert.ok(report.readerDependencies.some(row => row.field.startsWith("statement:") && row.ownerChange.includes("lib/corpus/data-plane.ts")));
    const rows = await db.query(`SELECT f.entity_id,f.field,f.value,f.quote,s.url,s.sha256,s.blob_key FROM fact f
      JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live' ORDER BY f.field`);
    assert.ok(rows.every(row => row.entity_id === PERSON && row.url === URL));
    const committee = rows.find(row => row.field === `committee:${body.id}`)!;
    assert.deepEqual(committee.value, { committeeId: body.id, name: "Finance Committee", rank: null, title: "Chair", period: "2026–2028", url: body.homepageUrl });
    const statement = rows.find(row => String(row.field).startsWith("statement:"))!;
    assert.equal(statement.quote, QUOTE);
    assert.equal((statement.value as { postedOn: string }).postedOn, "2026-10-19");
    assert.equal(statement.sha256, capture().evidence.contentHash.replace("sha256-", ""));
    assert.equal(statement.blob_key, `artifact:${capture().evidence.artifactId}`);
  } finally { await db.pg.close(); }
});

test("wrong speaker, borrowed date, invalid or future date and topic-only page never manufacture a statement", () => {
  for (const html of [page.replace("<cite>Ada Sample</cite>", "<cite>Ben Other</cite>"), page.replace(/<time[^>]*>.*?<\/time>/, ""),
    page.replace("2026-10-19", "2026-02-30"), page.replace("2026-10-19", "2026-10-21"),
    '<main><h1>Ada Sample</h1><p>Housing press releases and information</p></main>']) assert.equal(heldStatementFacts(subject, capture(html)).length, 0);
  assert.equal(heldCommitteeFacts(subject, page, URL, []).length, 0, "unheld names remain owed");
  assert.equal(heldCommitteeFacts(subject, page, URL, [{ committeeId: "a", name: "Finance Committee", url: null }, { committeeId: "b", name: "Finance Committee", url: null }]).length, 0);
  assert.equal(heldCommitteeCandidates(subject, page.replace("<h1>Ada Sample</h1>", "<h2>Ada Sample</h2><h2>Ben Other</h2>").replace("<h2>Committee assignments</h2>", "<h3>Committee assignments</h3>"), URL).length, 0);
  assert.equal(heldCommitteeCandidates(subject, page.replace("<h2>Committee assignments</h2>", "<h2>Education</h2><p>Biography</p><h2>Committee assignments</h2>"), URL).length, 2);
  assert.equal(heldCommitteeCandidates(subject, page.replace("<h2>Committee assignments</h2>", "<h2>Staff</h2><h3>Committee assignments</h3>"), URL).length, 0);
});

test("a release's structured author and date work without a person-name headline or duplicated visible body", () => {
  const record = { "@type": "NewsArticle", author: { "@type": "Person", name: "Ada Sample" }, datePublished: "2026-10-19", headline: "Housing statement", articleBody: QUOTE };
  const html = (value: typeof record) => `<main><h1>Housing statement</h1><p>${QUOTE}</p></main><script type="application/ld+json">${JSON.stringify(value)}</script>`;
  assert.equal(heldStatementFacts(subject, capture(html(record))).length, 1);
  assert.equal(heldStatementFacts(subject, capture(html({ ...record, author: { "@type": "Person", name: "Ben Other" } }))).length, 0);
  assert.equal(heldStatementFacts(subject, capture(html(record).replace(`<p>${QUOTE}</p>`, ""))).length, 1);
});

test("the real saved copy verifies a metadata-only dated statement while rejecting another author without losing a contact", async () => {
  const db = await factDb();
  try {
    const statement = { "@type": "NewsArticle", author: { "@type": "Person", name: "Ada Sample" }, datePublished: "2026-10-19", articleBody: QUOTE };
    const html = `<main><h1>Ada Sample</h1><p>Phone: 520-555-0123</p></main><script type="application/ld+json">${JSON.stringify(statement)}</script>`;
    const result = await publishHeldSubjectDetails({ subject, capture: capture(html), db, clocks: factClocks(null), now: new Date(AT), purge: async () => ({ purged: true }) });
    assert.equal(result.facts.filter(fact => "decision" in fact.outcome && fact.outcome.decision === "PUBLISH").length, 2);
    const other = html.replace('"name":"Ada Sample"', '"name":"Ben Other"');
    const wrong = await publishHeldSubjectDetails({ subject, capture: capture(other), db, clocks: factClocks(null), now: new Date(AT), purge: async () => ({ purged: true }) });
    assert.deepEqual(wrong.facts.map(fact => fact.field), ["phone"]);
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id=$1 AND field LIKE 'statement:%' AND status='live'", [PERSON]))[0]!.n, 1);
    assert.ok(result.readerDependencies.some(row => row.field.startsWith("statement:")));
  } finally { await db.pg.close(); }
});

test("only dated explicit same-origin releases on the exact held profile become linked acquisition work", () => {
  const linked = `<main><h1>Ada Sample</h1><h2>Statements</h2><ul><li><time datetime="2026-10-19">October 19</time><a href="/press-release/housing">Housing statement</a></li></ul></main>`;
  assert.deepEqual(heldStatementLinks(subject, capture(linked)).map(link => [link.url, link.postedOn]), [["https://sample.example.gov/press-release/housing", "2026-10-19"]]);
  for (const html of [linked.replace("/press-release/housing", "https://elsewhere.gov/press-release/housing"), linked.replace("Ada Sample", "Ben Other"),
    linked.replace(/<time[^>]*>.*?<\/time>/, ""), linked.replace("<h2>Statements", "<h2>Staff"),
    linked.replace("<li>", '<li><span rel="author">Ben Other</span>')]) assert.equal(heldStatementLinks(subject, capture(html)).length, 0);
  assert.equal(heldStatementLinks(subject, capture(linked.replace('/press-release/housing', '/press-release/housing?a=1&amp;b=2#statement')))[0]!.url,
    "https://sample.example.gov/press-release/housing?a=1&b=2");
});
