import { PUBLIC_SITE_ORIGIN, ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { PublicationVitals, observePublicationVitals, publicationVitalsIssue, type PublishedFactSample } from "../lib/civic-data/publication-vitals.ts";
import { recordPublicationFlow } from "../lib/civic-data/publication-flow.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
const row = (date: string) => ({ fields: { ".title": ["Council meeting"], ".date": [date] } });
const at = "2026-10-06T05:00:00.000Z";
const sample = (id: string): PublishedFactSample => ({ recordId: id, url: `${PUBLIC_SITE_ORIGIN}/?zip=10001`,
  selector: `[data-record-id="${id}"]`, fields: [{ selector: ".title", text: "Council meeting" }, { selector: ".date", text: "October 6" }] });

test("publisher counts only newly appended LIVE changes; concurrent replays and provenance rechecks earn nothing", async () => {
  const repos = createMemoryRepositories();
  const vitals = new PublicationVitals(at);
  const stop = observePublicationVitals(repos.ownerDigests, () => vitals);
  const receipt = { workerResultId: "result", stage: "CHECKED" as const, records: 5, changedRecords: 2, versionId: null };
  await recordPublicationFlow(repos, "candidate", receipt, at);
  assert.equal(vitals.reading().facts_live, 0);
  await Promise.all([recordPublicationFlow(repos, "candidate", { ...receipt, stage: "LIVE", versionId: "version" }, at),
    recordPublicationFlow(repos, "candidate", { ...receipt, stage: "LIVE", versionId: "version" }, at)]);
  await recordPublicationFlow(repos, "unchanged", { ...receipt, stage: "LIVE", changedRecords: 0, versionId: "version" }, at);
  assert.equal(vitals.reading().facts_live, 2);
  assert.equal(vitals.reading().records_without_page_binding, 2, "absence of a page binding is not successful sampling");
  assert.equal(publicationVitalsIssue(repos.ownerDigests, at), null);
  stop();
});

test("reservoir checks at most three exact public record containers, once, across flushes and restart", async () => {
  const priorities = [0.9, 0.4, 0.3, 0.2, 0.1];
  const vitals = new PublicationVitals(at, () => priorities.shift()!);
  vitals.published({ id: "event", at, changedRecords: 5, samples: ["a", "b", "c", "d", "e"].map(sample) });
  const restored = new PublicationVitals(at, Math.random, vitals.checkpoint());
  restored.published({ id: "event", at, changedRecords: 5 });
  assert.equal(restored.reading().facts_live, 5);
  let calls = 0;
  const read = async (s: PublishedFactSample) => {
    calls++;
    return { url: s.url, status: 200, matches: s.recordId === "e" ? [row("October 6")] :
      s.recordId === "d" ? [row("October 5")] : [row("October 6"), row("October 6")] };
  };
  const [one, two] = await Promise.all([restored.sample(read), restored.sample(read)]);
  assert.deepEqual(one, two);
  assert.equal(calls, 3);
  assert.equal(one.facts_sampled, 3);
  assert.equal(one.facts_confirmed, 1, "wrong dates and ambiguous containers fail");
  const after = new PublicationVitals(at, Math.random, restored.checkpoint());
  assert.deepEqual(await after.sample(read), one);
  assert.equal(calls, 3, "completed samples survive restart without fetching again");
});

test("Admin/API responses, redirected pages and failed public reads cannot establish reader confirmation", async () => {
  const vitals = new PublicationVitals(at);
  for (const url of [`${ADMIN_ORIGIN}/`, `${PUBLIC_SITE_ORIGIN}/api/reader/manifest`, "https://other.example/"]) {
    assert.throws(() => vitals.published({ id: url, at, changedRecords: 1, samples: [{ ...sample("one"), url }] }), /PUBLIC_PAGE/);
  }
  vitals.published({ id: "ok", at, changedRecords: 2, samples: [sample("one"), sample("two")] });
  const result = await vitals.sample(async s => {
    if (s.recordId === "one") throw Error("offline");
    return { url: `${PUBLIC_SITE_ORIGIN}/`, status: 200, matches: [row("October 6")] };
  });
  assert.equal(result.facts_confirmed, 0);
  assert.equal(result.facts_sampled, 2);
});

test("a measurement failure does not hold publication and cannot silently report complete totals", async () => {
  const repos = createMemoryRepositories();
  const wrongHour = new PublicationVitals("2026-10-06T04:00:00Z");
  observePublicationVitals(repos.ownerDigests, () => wrongHour);
  await recordPublicationFlow(repos, "candidate", { workerResultId: "result", stage: "LIVE", records: 1, changedRecords: 1, versionId: "version" }, at);
  assert.match(publicationVitalsIssue(repos.ownerDigests, at)!, /incomplete/);
  assert.equal(publicationVitalsIssue(repos.ownerDigests, "2026-10-06T06:00:00Z"), null, "one incomplete hour does not poison later hours");
  assert.equal((await repos.ownerDigests.read("publication-flow")).length, 1);
});

test("a numeric prefix or another field's value is not the sampled fact", async () => {
  const vitals = new PublicationVitals(at);
  vitals.published({ id: "money", at, changedRecords: 1, samples: [{ ...sample("budget"), fields: [{ selector: ".amount", text: "$5" }] }] });
  const result = await vitals.sample(async s => ({ url: s.url, status: 200,
    matches: [{ fields: { ".amount": ["$50"], ".other": ["$5"] } }] }));
  assert.equal(result.facts_confirmed, 0);
});
