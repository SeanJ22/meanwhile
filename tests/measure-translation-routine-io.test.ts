import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BallotSet } from "../lib/ballot/types.ts";
import { saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { captureIntact } from "../lib/civic-data/worker-publication-evidence.ts";
import { linkingPageFrom, section3Page } from "../lib/control-plane/promotion/section3.ts";
import { routineTranslationAttempts } from "../lib/translate/routine-attempts.ts";
import { loadRoutineMeasureSources } from "../lib/translate/routine-sources.ts";
import { translationHash } from "../lib/translate/records.ts";
import type { TranslationAttempt } from "../lib/translate/standing.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";

const now = "2026-10-20T18:00:00.000Z";
const sourceUrl = "https://elections.example.gov/measures";
const text = "Proposition 12. The levy funds library services. A YES vote adopts the levy. A NO vote keeps the current levy.";
const ballot = { election: { state: "OH", id: "general", date: "2026-11-03" },
  contests: [{ id: "measure:12", type: "MEASURE", title: "Proposition 12", ocdId: "ocd-division/country:us/state:oh",
    provenance: { sourceUrl, sourceOrg: "Fixture election office" } }],
  measures: [{ contestId: "measure:12", questionText: text, provenance: { sourceUrl, sourceOrg: "Fixture election office" } }],
} as unknown as BallotSet;

async function localVault(t: TestContext) {
  const previous = process.env.WTP_VAULT_PROVIDER;
  process.env.WTP_VAULT_PROVIDER = "local";
  const root = await mkdtemp(join(tmpdir(), "measure-translation-io-"));
  t.after(async () => {
    if (previous === undefined) delete process.env.WTP_VAULT_PROVIDER;
    else process.env.WTP_VAULT_PROVIDER = previous;
    await rm(root, { recursive: true, force: true });
  });
  return { root, vault: new DurableEvidenceStore(join(root, ...VAULT_DIR), { remote: null }) };
}

test("routine attempts round-trip running, held and published retry state through existing durable attempts", async () => {
  const repos = createMemoryRepositories(), attempts = routineTranslationAttempts(repos, "OH");
  const running: TranslationAttempt = { id: "translation:fixture", scope: "US:plain-english-translations:ocd-division/country:us/state:oh",
    subjectId: "measure:12", sourceHash: translationHash(text), sourceTextHash: translationHash(text), at: now,
    status: "RUNNING", usage: [], versionId: null };
  await attempts.save(running);
  assert.deepEqual(await attempts.read(), [running]);
  const active = (await repos.attempts.mustRead(running.id)).value;
  assert.equal(active.outcome, null);
  assert.equal(active.endedAt, null);
  assert.deepEqual(active.cost, ZERO_COST);
  const held: TranslationAttempt = { ...running, status: "HELD", detail: "One sentence failed its source check." };
  await attempts.save(held);
  assert.deepEqual(await attempts.read(), [held]);
  const failed = (await repos.attempts.mustRead(running.id)).value;
  assert.equal(failed.outcome, "ABORTED");
  assert.equal(failed.abortReason, held.detail);
  assert.equal(failed.startedAt, now, "the exact standing retry clock survives status changes");
  const completed: TranslationAttempt = { ...running, status: "PUBLISHED", versionId: "checked-version" };
  await attempts.save(completed);
  assert.deepEqual(await attempts.read(), [completed]);
  assert.equal((await repos.attempts.mustRead(running.id)).value.outcome, "COMPLETED");
  assert.deepEqual(await routineTranslationAttempts(repos, "CA").read(), [], "another state never inherits these attempts");
});

test("a saved routine attempt without translation retry state is an unreadable input", async () => {
  const repos = createMemoryRepositories();
  const adapter = routineTranslationAttempts(repos, "OH");
  const attempt: TranslationAttempt = { id: "translation:fixture", scope: "US:plain-english-translations:ocd-division/country:us/state:oh",
    subjectId: "measure:12", sourceHash: translationHash(text), sourceTextHash: translationHash(text), at: now,
    status: "RUNNING", usage: [], versionId: null };
  await adapter.save(attempt);
  const prior = await repos.attempts.mustRead(attempt.id);
  const { translation: _lost, ...broken } = prior.value as typeof prior.value & { translation: TranslationAttempt };
  await repos.attempts.compareAndSet(prior.id, prior.revision, broken, now);
  await assert.rejects(adapter.read(), /lost its retry state/);
});

test("routine source reads retain exact UTF-8 bytes and attributable completed attempts before returning captures", async t => {
  const { root, vault } = await localVault(t);
  const repos = createMemoryRepositories(), opened: string[] = [];
  const result = await loadRoutineMeasureSources({ root, repos, state: "OH", ballots: [ballot], now: () => now,
    open: async url => { opened.push(url); return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }); },
  });
  assert.deepEqual(opened, [sourceUrl], "the same cited source is fetched once per pass");
  assert.deepEqual(result.failures, []);
  assert.equal(result.captures.length, 1);
  const capture = result.captures[0];
  assert.equal(captureIntact(capture), true);
  assert.equal(capture.evidence.text, text);
  assert.equal(capture.evidence.contentHash, contentHash(text));
  const attempt = (await repos.attempts.mustRead(capture.evidence.acquiredByAttemptId)).value;
  assert.equal(attempt.outcome, "COMPLETED");
  assert.deepEqual(attempt.artifactIds, [capture.evidence.artifactId]);
  const metadata = await repos.artifacts.read(attempt.workItemId);
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].attemptId, attempt.id);
  assert.equal(metadata[0].canonicalUrl, sourceUrl);
  const keys = await vault.list("project/freshness/");
  assert.equal(keys.length, 1);
  const retained = await vault.get(keys[0]);
  assert.ok(retained);
  assert.equal(Buffer.from(retained.bytes).toString("utf8"), text);
  assert.equal(retained.meta.custom?.attemptId, attempt.id);
});

test("failed, partial and invalid-UTF-8 source responses retain a named open failure and return no usable capture", async t => {
  const { root } = await localVault(t);
  const failures = [
    { response: () => new Response("Source unavailable", { status: 503 }), reason: /HTTP 503/ },
    { response: () => new Response("Partial official text", { status: 206 }), reason: /HTTP 206/ },
    { response: () => new Response(new Uint8Array([0xff, 0xfe])), reason: /not valid UTF-8/ },
  ];
  for (const failure of failures) {
    const repos = createMemoryRepositories();
    const result = await loadRoutineMeasureSources({ root, repos, state: "OH", ballots: [ballot], now: () => now,
      open: async () => failure.response(),
    });
    assert.deepEqual(result.captures, []);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].reason, failure.reason);
    const attempts = await repos.attempts.list();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].value.outcome, "ABORTED");
    assert.match(attempts[0].value.abortReason!, failure.reason);
  }
});

test("a prior summary's official source is acquired even when the ballot also cites a different document", async t => {
  const { root } = await localVault(t);
  const priorUrl = "https://elections.example.gov/proposition12-text";
  const withPrior: BallotSet = { ...ballot, measureRecords: [{ contestId: ballot.contests[0].id, sourceUrl: priorUrl,
    whatItDoes: "The levy funds library services.", yesMeans: null, noMeans: null, parts: [], sourceHash: translationHash(text), writtenAt: now }] };
  const opened: string[] = [];
  const result = await loadRoutineMeasureSources({ root, repos: createMemoryRepositories(), state: "OH", ballots: [withPrior], now: () => now,
    open: async url => { opened.push(url); return new Response(text); },
  });
  assert.deepEqual(new Set(opened), new Set([sourceUrl, priorUrl]));
  assert.equal(result.captures.length, 2);
  assert.deepEqual(result.failures, []);
});

test("complete PDF source capture retains the original bytes and a source-bound full transcription", async t => {
  const { root, vault } = await localVault(t);
  const repos = createMemoryRepositories();
  const bytes = await readFile(new URL("./fixtures/azleg-legtext-0001.pdf", import.meta.url));
  const result = await loadRoutineMeasureSources({ root, repos, state: "OH", ballots: [ballot], now: () => now,
    open: async () => new Response(bytes, { headers: { "content-type": "application/pdf" } }),
  });
  assert.deepEqual(result.failures, [], JSON.stringify(result.failures));
  assert.equal(result.captures.length, 1);
  const capture = result.captures[0];
  assert.equal(captureIntact(capture), true);
  assert.equal(capture.evidence.sourceDocument?.contentHash, contentHash(bytes));
  assert.equal(capture.evidence.sourceDocument?.kind, "PDF_TEXT");
  assert.notEqual(capture.evidence.contentHash, capture.evidence.sourceDocument?.contentHash);
  assert.match(capture.evidence.text, /\[Page 1\]/);
  const keys = await vault.list("project/freshness/");
  assert.equal(keys.length, 2);
  const objects = await Promise.all(keys.map(key => vault.get(key)));
  const original = objects.find(object => object?.meta.contentType === "application/pdf");
  const transcription = objects.find(object => object?.meta.custom?.tier === "EXTRACTED_DERIVED");
  assert.ok(original); assert.ok(transcription);
  assert.deepEqual(Buffer.from(original.bytes), bytes);
  assert.equal(Buffer.from(transcription.bytes).toString("utf8"), capture.evidence.text);
  const extraction = JSON.parse(transcription.meta.custom!.extraction);
  assert.equal(extraction.complete, true);
  assert.ok(extraction.pages > 0);
  assert.equal(extraction.parent.contentHash, contentHash(bytes));
});

test("registered official linking pages are re-read and vaulted before admitting a non-gov measure source", async t => {
  const { root, vault } = await localVault(t);
  const repos = createMemoryRepositories();
  const officialUrl = "https://www.fec.gov/state-election-offices/";
  const measureUrl = "https://www.sos.state.co.us/pubs/elections/measures.html";
  const door: VotingSourceDoor = { id: "fec-co-chief", publisher: "Colorado Secretary of State",
    url: "https://www.sos.state.co.us/pubs/elections/main.html", shape: "list-page", covers: ["BALLOT_MEASURES"],
    scope: { state: "CO", ocdId: "ocd-division/country:us/state:co", name: "Colorado" },
    electionDate: "2026-11-03", electionPageUrl: measureUrl,
    officialLinkingPage: { url: officialUrl, html: "This stored excerpt is not current response evidence." },
  };
  await saveVotingSourceDoor(repos.doors, door, now);
  const provenance = { ...ballot.contests[0].provenance, sourceUrl: measureUrl, doorId: door.id };
  const localBallot: BallotSet = { ...ballot, election: { ...ballot.election, state: "CO" },
    contests: [{ ...ballot.contests[0], ocdId: door.scope.ocdId, provenance }],
    measures: [{ ...ballot.measures[0], provenance }],
  };
  const freshIndex = `<html><a href="${door.url}">Colorado election office</a></html>`;
  const opened: string[] = [];
  const result = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [localBallot], now: () => now,
    open: async url => { opened.push(url); return new Response(url === officialUrl ? freshIndex : text); },
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(new Set(opened), new Set([measureUrl, officialUrl]));
  assert.equal(result.captures.length, 2);
  const primary = result.captures.find(capture => capture.evidence.canonicalUrl === measureUrl)!;
  const links = linkingPageFrom(measureUrl, result.captures.map(capture => capture.evidence));
  assert.equal(links?.html, freshIndex, "authority uses the actual saved HTTP response, never the registry's stored excerpt");
  const page = { url: measureUrl, text: primary.evidence.text, retrievedAt: now };
  assert.equal(section3Page(page, "BALLOT_MEASURE", now).ok, false);
  assert.equal(section3Page({ ...page, linkingPage: links }, "BALLOT_MEASURE", now).ok, true);
  const retained = await Promise.all((await vault.list("project/freshness/")).map(key => vault.get(key)));
  assert.ok(retained.some(object => object?.meta.custom?.canonicalUrl === officialUrl && Buffer.from(object.bytes).toString() === freshIndex));
  assert.ok(retained.every(object => object?.meta.custom?.canonicalUrl !== door.url), "an uncaptured root is never synthesized");
});

test("a registry linking excerpt cannot authorize a source when the freshly read official page no longer links it", async t => {
  const { root } = await localVault(t);
  const repos = createMemoryRepositories();
  const officialUrl = "https://www.fec.gov/state-election-offices/";
  const measureUrl = "https://www.dcboe.org/measures";
  const door: VotingSourceDoor = { id: "fec-dc-chief", publisher: "District of Columbia Board of Elections",
    url: "https://www.dcboe.org/", shape: "list-page", covers: ["BALLOT_MEASURES"],
    scope: { state: "DC", ocdId: "ocd-division/country:us/district:dc", name: "District of Columbia" },
    electionDate: "2026-11-03", electionPageUrl: measureUrl,
    officialLinkingPage: { url: officialUrl, html: `<a href="${measureUrl}">Stored old authority</a>` },
  };
  await saveVotingSourceDoor(repos.doors, door, now);
  const provenance = { ...ballot.contests[0].provenance, sourceUrl: measureUrl, doorId: door.id };
  const localBallot: BallotSet = { ...ballot, election: { ...ballot.election, state: "DC" },
    contests: [{ ...ballot.contests[0], ocdId: door.scope.ocdId, provenance }], measures: [{ ...ballot.measures[0], provenance }],
  };
  const result = await loadRoutineMeasureSources({ root, repos, state: "DC", ballots: [localBallot], now: () => now,
    open: async url => new Response(url === officialUrl ? "<html>No current election-office link is held here.</html>" : text),
  });
  assert.equal(result.captures.length, 2);
  assert.equal(linkingPageFrom(measureUrl, result.captures.map(capture => capture.evidence)), null);
  assert.equal(section3Page({ url: measureUrl, text, retrievedAt: now }, "BALLOT_MEASURE", now).ok, false);
});
