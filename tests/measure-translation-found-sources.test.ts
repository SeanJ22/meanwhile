import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BallotSet } from "../lib/ballot/types.ts";
import { saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { hubLinks, measureLabels, measureLinkNames, measureLinks, pageLinks, pageNamesMeasure } from "../lib/translate/routine-measure-pages.ts";
import { routineMeasureFinds } from "../lib/translate/routine-finds.ts";
import { loadRoutineMeasureSources, MEASURE_SEARCH_RETRY_MS } from "../lib/translate/routine-sources.ts";
import { runMeasureTranslationPass } from "../lib/translate/provider.ts";
import { readTranslations, withMeasureTranslations } from "../lib/translate/projection-reader.ts";
import { translationHash } from "../lib/translate/records.ts";
import type { TranslationAttempt } from "../lib/translate/standing.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";

const now = "2026-10-20T18:00:00.000Z";
const stateOcd = "ocd-division/country:us/state:co";
const cited = "https://www.sos.state.co.us/pubs/elections/contacts.html";
const indexUrl = "https://www.sos.state.co.us/pubs/elections/measures.html";
const fec = "https://www.fec.gov/state-election-offices/";
const pageUrl = "https://www.sos.state.co.us/pubs/elections/amendment-84.html";
const pageText = "<html><h1>Amendment 84</h1><p>Mail Ballot Voter Identification. The measure requires an ID number on mail ballots. A YES vote requires an ID number. A NO vote keeps the current rules.</p></html>";
const ballot = { election: { state: "CO", id: "general", date: "2026-11-03" },
  contests: [{ id: "co-amendment-84", type: "MEASURE", title: "Mail Ballot Voter Identification", ocdId: stateOcd,
    provenance: { sourceUrl: cited, sourceOrg: "Colorado Secretary of State" } }],
  measures: [{ contestId: "co-amendment-84", officialNumber: "Amendment 84", questionText: "Shall mail ballots require an ID number?",
    provenance: { sourceUrl: cited, sourceOrg: "Colorado Secretary of State" } }],
} as unknown as BallotSet;

async function localVault(t: TestContext) {
  const previous = process.env.WTP_VAULT_PROVIDER;
  process.env.WTP_VAULT_PROVIDER = "local";
  const root = await mkdtemp(join(tmpdir(), "measure-found-sources-"));
  t.after(async () => {
    if (previous === undefined) delete process.env.WTP_VAULT_PROVIDER; else process.env.WTP_VAULT_PROVIDER = previous;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function stateRepos(withLink: boolean) {
  const repos = createMemoryRepositories();
  const door: VotingSourceDoor = { id: "co-election-office", publisher: "Colorado Secretary of State", url: "https://www.sos.state.co.us/pubs/elections/",
    shape: "list-page", covers: ["BALLOT_MEASURES"], scope: { state: "CO", ocdId: stateOcd, name: "Colorado" },
    electionDate: "2026-11-03", electionPageUrl: indexUrl, officialLinkingPage: { url: fec, html: "This stored excerpt is not current response evidence." } };
  await saveVotingSourceDoor(repos.doors, door, now);
  const index = withLink ? `<html><a href="/pubs/elections/amendment-84.html">Amendment 84</a><a href="/pubs/elections/amendment-85.html">Amendment 85</a></html>` : "<html>No measure links yet.</html>";
  const served = (extra: Record<string, string> = {}): Record<string, string> => ({ [cited]: "<html>Ballot contacts for every initiative.</html>", [indexUrl]: index,
    "https://www.sos.state.co.us/pubs/elections/": "<html>Elections home.</html>", [pageUrl]: pageText,
    [fec]: `<html><a href="https://www.sos.state.co.us/pubs/elections/">Colorado Secretary of State</a></html>`, ...extra });
  return { repos, served };
}

const opener = (served: Record<string, string>, opened: string[]) => async (url: string) => {
  opened.push(url);
  return url in served ? new Response(served[url], { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("Not found", { status: 404 });
};

test("links on held election-office pages name the measure, best match first, and hubs lead to the lists of measures", () => {
  const index = { url: indexUrl, html: `<a href="/pubs/elections/amendment-85.html">Amendment 85</a><a href="/pubs/elections/amendment-84.html">Amendment 84 &mdash; Mail</a>
    <a href="https://vendor.example.com/amendment-84">Amendment 84</a><a href="mailto:x@sos.state.co.us">Amendment 84</a><a href="/pubs/elections/ballot-measures.html">Ballot measures</a>` };
  const labels = measureLabels({ title: "Mail Ballot Voter Identification", officialNumber: "Amendment 84" });
  const official = (url: string) => new URL(url).hostname.endsWith("sos.state.co.us");
  const links = measureLinks([index], measureLinkNames(labels, "Mail Ballot Voter Identification"), new Set(), official);
  assert.deepEqual(links.map(link => link.url), [pageUrl], "only an official link that names this exact measure is followed");
  assert.deepEqual(hubLinks([index], new Set(), official).map(link => link.url), [
    "https://www.sos.state.co.us/pubs/elections/amendment-85.html", pageUrl, "https://www.sos.state.co.us/pubs/elections/ballot-measures.html"]);
  assert.equal(pageLinks(index.html, index.url).some(link => link.url.startsWith("mailto:")), false);
  assert.equal(pageNamesMeasure(pageText, labels), true);
  assert.equal(pageNamesMeasure("Amendment 841 and Amendment 8", labels), false, "a longer number is another measure");
});

test("a measure whose cited page never names it is found through the election office's own list, saved, and remembered", async t => {
  const root = await localVault(t), { repos, served } = await stateRepos(true), opened: string[] = [];
  const finds = routineMeasureFinds(repos, "CO");
  const result = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [ballot], now: () => now, open: opener(served(), opened), finds });
  assert.deepEqual(result.discovered.get("co-amendment-84"), [pageUrl]);
  assert.ok(result.captures.some(capture => capture.evidence.canonicalUrl === pageUrl && capture.evidence.text === pageText), "the page itself is saved as evidence");
  assert.equal(opened.includes("https://www.sos.state.co.us/pubs/elections/amendment-85.html"), false, "another measure's page is never fetched");
  assert.deepEqual((await finds.read()).map(row => [row.kind, row.contestId, row.url]), [["FOUND", "co-amendment-84", pageUrl]]);
  // The next pass goes straight to the remembered page.
  const again: string[] = [];
  const second = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [ballot], now: () => now, open: opener(served(), again), finds });
  assert.deepEqual(second.discovered.get("co-amendment-84"), [pageUrl]);
  assert.deepEqual(new Set(again), new Set([cited, pageUrl]));
});

test("a measure whose cited page names it needs no discovery and opens nothing extra", async t => {
  const root = await localVault(t), { repos, served } = await stateRepos(true), opened: string[] = [];
  const result = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [ballot], now: () => now,
    open: opener(served({ [cited]: pageText }), opened), finds: routineMeasureFinds(repos, "CO") });
  assert.deepEqual([...result.discovered], []);
  assert.deepEqual(opened, [cited]);
});

test("official search results are read; unofficial hosts are never opened; an empty search waits before the next one", async t => {
  const root = await localVault(t), { repos, served } = await stateRepos(false), opened: string[] = [], queries: string[] = [];
  const finds = routineMeasureFinds(repos, "CO");
  const search = async (query: string) => { queries.push(query); return [
    { url: "https://campaign.example.com/amendment-84", title: "Amendment 84" }, { url: pageUrl, title: "Amendment 84" }]; };
  const result = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [ballot], now: () => now, open: opener(served(), opened), finds, search });
  assert.deepEqual(result.discovered.get("co-amendment-84"), [pageUrl]);
  assert.equal(opened.some(url => url.includes("campaign.example.com")), false);
  assert.match(queries[0], /Colorado 2026/);

  const emptyRepos = (await stateRepos(false)).repos, emptyFinds = routineMeasureFinds(emptyRepos, "CO"), empty: string[] = [];
  const nothing = async (query: string) => { empty.push(query); return []; };
  const first = await loadRoutineMeasureSources({ root, repos: emptyRepos, state: "CO", ballots: [ballot], now: () => now, open: opener(served({ [pageUrl]: "gone" }), []), finds: emptyFinds, search: nothing });
  assert.deepEqual([...first.discovered], []);
  const asked = empty.length;
  assert.ok(asked > 0);
  assert.deepEqual((await emptyFinds.read()).map(row => row.kind), ["SEARCHED"]);
  await loadRoutineMeasureSources({ root, repos: emptyRepos, state: "CO", ballots: [ballot], now: () => now, open: opener(served({ [pageUrl]: "gone" }), []), finds: emptyFinds, search: nothing });
  assert.equal(empty.length, asked, "no second search inside the wait");
  const later = new Date(Date.parse(now) + MEASURE_SEARCH_RETRY_MS).toISOString();
  await loadRoutineMeasureSources({ root, repos: emptyRepos, state: "CO", ballots: [ballot], now: () => later, open: opener(served({ [pageUrl]: "gone" }), []), finds: emptyFinds, search: nothing });
  assert.ok(empty.length > asked, "the search is tried again after the wait");
});

test("an unreachable or unreadable find leaves the measure an open blank and breaks nothing else", async t => {
  const root = await localVault(t), { repos, served } = await stateRepos(true), opened: string[] = [];
  const result = await loadRoutineMeasureSources({ root, repos, state: "CO", ballots: [ballot], now: () => now,
    open: opener(served({ [pageUrl]: "<html>Moved.</html>" }), opened), finds: routineMeasureFinds(repos, "CO") });
  assert.deepEqual([...result.discovered], []);
  assert.ok(result.captures.length >= 2, "the pages that did read are still saved");
});

test("an explainer written from a found page publishes and attaches to its exact measure with that page as its source", async () => {
  const division = "ocd-division/country:us/state:oh";
  const citedUrl = "https://elections.example.gov/contacts", foundUrl = "https://elections.example.gov/prop-12";
  const summary = "The levy funds library services.", yes = "A YES vote adopts the levy.", no = "A NO vote keeps the current levy.";
  const text = `Proposition 12. ${summary} ${yes} ${no}`, contactsText = "Election office contacts.";
  const cap = (url: string, body: string) => ({ evidence: { artifactId: url, acquiredByAttemptId: "held", sourceId: "Fixture election office", methodRouteId: "measure-text",
    canonicalUrl: url, contentHash: `sha256-${translationHash(body)}`, retrievedAt: now, text: body }, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" as const });
  const held = { election: { state: "OH", id: "general", date: "2026-11-03" }, candidacies: [], measures: [],
    contests: [{ id: "measure:12", title: "Proposition 12", type: "MEASURE", ocdId: division, provenance: { sourceUrl: citedUrl } }] } as unknown as BallotSet;
  const store = new MemoryRoutineDataStore(), saved: TranslationAttempt[] = [];
  const base = { states: ["OH"], repos: createMemoryRepositories(), store, now, modelLaneEnabled: true as boolean | null, paidWorkerCapacity: () => 1,
    loadBallotsForState: async () => [held], loadCapturesForState: async () => [cap(citedUrl, contactsText), cap(foundUrl, text)],
    readAttemptsForState: async () => saved, saveAttempt: async (attempt: TranslationAttempt) => { saved.push(attempt); },
    guardedTransportFor: () => async (request: ModelRequest) => {
      const measure = { contestId: "measure:12", whatItDoes: summary, yesMeans: yes, noMeans: no, parts: [], sourceUrl: foundUrl, sourceHash: translationHash(text), writtenAt: now };
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
      return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: request.tools[0].name === "write_measure_translation"
          ? { measure, sentences } : { checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) } }] };
    } };
  const without = await runMeasureTranslationPass(base);
  assert.equal(without.checkedAfter, 0);
  assert.equal(without.held[0].reason, "No complete current source capture is held.");
  const found = await runMeasureTranslationPass({ ...base, foundSources: new Map([["measure:12", [foundUrl]]]) });
  assert.deepEqual(found.outcomes.map(row => row.status), ["PUBLISHED"], JSON.stringify(found));
  assert.equal(found.persistenceError, null);
  const attached = withMeasureTranslations(held, await readTranslations([division], { store, now, bypassCache: true }));
  assert.equal(attached.measureRecords?.[0].sourceUrl, foundUrl);
  assert.equal(attached.measureRecords?.[0].yesMeans, yes);
  const wrongMeasure = { ...held, contests: [{ ...held.contests[0], id: "measure:13", title: "Proposition 13" }] } as unknown as BallotSet;
  assert.equal(withMeasureTranslations(wrongMeasure, await readTranslations([division], { store, now, bypassCache: true })).measureRecords, undefined, "another measure never takes it");
});
