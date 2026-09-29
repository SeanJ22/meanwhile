import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { readerProofSources } from "./lib/reader-proof-sources.ts";
import { prepareReaderProofRuntime } from "./lib/reader-proof-runtime.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { contestsForDivisions } from "../lib/sources/ballot-nj-morris/index.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { divisionsAt } from "../lib/registry/server.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { publishedZipDistricts } from "../lib/geo/zip-census-districts.ts";
import { readAllZipDivisions } from "../lib/geo/zip-division-index.ts";
import { lineupForContest } from "../lib/ballot/general-lineup.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import { provisionsForContest } from "../lib/ballot/measure-provisions.ts";
import { reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { launchGuarded } from "./browser.mts";
import { analysisForContest } from "../lib/ballot/analyses.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import { registrationLinkFor } from "../lib/ballot/registration-links.ts";
import { pollingPlaceLinkFor } from "../lib/ballot/polling-place-links.ts";
import { formatDateMDY } from "../lib/map/format.ts";
import { groupAbsences } from "../lib/ballot/absence-grouping.ts";
import { inspectReaderMarkup, sha256, type ReaderComponentCase } from "../lib/holdings/reader-census.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { njMorrisFilingReadState } from "../lib/sources/ballot-nj-morris/index.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-ballot.json";
const planOutputPath = process.env.READER_BALLOT_PLAN_OUTPUT ?? "docs/evidence/reader-last-mile-ballot-plan.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES;
const successorPublic = process.argv.includes("--successor-public");
const deployedCommit = process.env.READER_DEPLOYED_COMMIT ?? "";
const successorKey = process.env.READER_SUCCESSOR_KEY ?? "";
const successorVersionId = process.env.READER_SUCCESSOR_VERSION_ID ?? "";
if (successorPublic) {
  assert.equal(base, PUBLIC_SITE_ORIGIN, "Successor ballot readback uses only the canonical public origin");
  assert.match(deployedCommit, /^[0-9a-f]{40}$/, "Successor ballot readback needs the exact deployed commit");
  assert.equal(successorKey, "BALLOT_FILING:US-NJ:county:morris:2026-general",
    "Successor ballot key must be the exact registered Morris filing authority");
  assert.ok(successorVersionId && !successorVersionId.startsWith("bootstrap:"),
    "Successor ballot readback requires a promoted exact version");
  assert.equal(process.env.READER_BALLOT_STATES, "nj", "Successor ballot scope is exactly New Jersey");
  assert.match(outputPath, /^docs\/evidence\/reader-last-mile-successor-ballot-[a-z0-9-]+\.json$/,
    "Successor ballot must write a separately named execution artifact");
  assert.match(planOutputPath, /^docs\/evidence\/reader-last-mile-successor-ballot-plan-[a-z0-9-]+\.json$/,
    "Successor ballot plan must be separately named");
} else {
  assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
}
const requestedStates = process.env.READER_BALLOT_STATES?.split(",").map((state) => state.trim()).filter(Boolean);
await prepareReaderProofRuntime();
const sets = await Promise.all(BALLOT_SOURCES.filter(({ state }) => !requestedStates?.length || requestedStates.includes(state)).map(async ({ state, source }) => ({ state, set: source.normalize(await source.fetch()) })));
if (successorPublic) {
  const read = njMorrisFilingReadState();
  assert.equal(read.kind, "PROMOTED", "Successor ballot cannot inherit a bootstrap or unavailable filing");
  assert.equal(read.metadata.versionId, successorVersionId,
    "Successor ballot local selector is not bound to the changed canonical version");
}
// Every indexed ZIP that reaches a ballot state: a ZIP reaching none of them cannot match any contest or absence here.
const ballotStates = sets.map(({ state }) => `/state:${state}`);
const indexedZips = [...readAllZipDivisions(process.cwd())].filter(([, entry]) => entry.ids.some((id) => ballotStates.some((st) => id.includes(st)))).map(([zip]) => zip);
type BallotPlan = { zip: string; state: typeof sets[number]["state"]; set: typeof sets[number]["set"] } & ReturnType<typeof contestsForDivisions>;
const plans: BallotPlan[] = [];
for (const zip of [...new Set(["85701", "85641", "07866", "03255", ...indexedZips])].sort()) {
  const point = resolveZip(zip); if (!point.ok) continue;
  const divisions = await divisionIdsForZipArea(zip, (await divisionsAt(point.centroid.lat, point.centroid.lng)).map((division) => division.ocdId));
  for (const { state, set } of sets) {
    const matched = contestsForDivisions(set, divisions);
    if (matched.contests.length || matched.absences.length) {
      plans.push({ zip, state, set, ...matched });
      break;
    }
  }
}
const targets = new Set(sets.flatMap(({ set }) => set.contests.map((contest) => contest.id)));
const absenceTargets = new Set(sets.flatMap(({ set }) => set.absences.map((absence) => `absence:${absence.ocdId}`)));
const planIds = (plan: typeof plans[number]) => [...plan.contests.map(contest => contest.id), ...plan.absences.map(absence => `absence:${absence.ocdId}`)];
floored("canonical ballot contests", "all currently normalized registered ballot sources", targets.size, targets.size);
// The page and this planner both add the current published Census district
// overlap to the sampled ZIP shard. A transient 1 s read can leave a planner
// ZIP on the older shard while the served page later gets the published slice.
// Require a settled read for every selected ZIP before claiming exact equality;
// keep NOT_PUBLISHED distinct from a failed read.
async function currentPlan(plan: BallotPlan): Promise<BallotPlan> {
  let districtRead = await publishedZipDistricts(plan.zip);
  for (let attempt = 1; districtRead.kind === "UNREAD" && attempt < 3; attempt++) {
    districtRead = await publishedZipDistricts(plan.zip);
  }
  assert.notEqual(districtRead.kind, "UNREAD", `${plan.zip}: current Census district scope could not be read for exact ballot comparison`);
  const point = resolveZip(plan.zip);
  assert.ok(point.ok, `${plan.zip}: selected ZIP no longer resolves`);
  const divisionIds = await divisionIdsForZipArea(
    plan.zip,
    (await divisionsAt(point.centroid.lat, point.centroid.lng)).map((division) => division.ocdId),
  );
  return { ...plan, ...contestsForDivisions(plan.set, divisionIds) };
}

const chosen: BallotPlan[] = [];
for (const plan of plans.filter((plan) => ["85701", "85641", "07866", "03255"].includes(plan.zip))) {
  chosen.push(await currentPlan(plan));
}
const remaining = new Set([...targets, ...absenceTargets]);
for (const plan of chosen) for (const id of planIds(plan)) remaining.delete(id);
while (remaining.size) {
  const best = plans.filter((plan) => !chosen.some((selected) => selected.zip === plan.zip && selected.state === plan.state)).map((plan) => ({ plan, added: planIds(plan).filter(id => remaining.has(id)).length })).sort((a, b) => b.added - a.added || a.plan.zip.localeCompare(b.plan.zip))[0];
  if (!best?.added) break;
  const current = await currentPlan(best.plan);
  chosen.push(current);
  planIds(current).forEach(id => remaining.delete(id));
}
if (successorPublic) assert.ok(chosen.length <= 32,
  "Successor ballot ZIP set-cover exceeds its 32-navigation hosted limit");
const planEvidence = { rule: "Deterministic ZIP set cover over every ZIP the national ZIP index gives a division of a ballot state, every normalized current contest and every sourced absence; mandatory pilot ZIPs retained.", contests: targets.size, sourcedAbsences: absenceTargets.size, chosen: chosen.map(({ zip, state, contests, absences }) => ({ zip, state, contestIds: contests.map((contest) => contest.id), absenceOcdIds: absences.map(absence => absence.ocdId) })), unresolvedContestIds: [...remaining].filter(id => !id.startsWith("absence:")).sort(), unresolvedAbsenceIds: [...remaining].filter(id => id.startsWith("absence:")).sort() };
writeFileSync(planOutputPath, JSON.stringify(planEvidence, null, 2) + "\n", successorPublic ? { flag: "wx" } : undefined);
if (process.argv.includes("--plan-only")) { console.log(JSON.stringify(planEvidence, null, 2)); process.exit(remaining.size ? 1 : 0); }
assert.equal(remaining.size, 0, `Held current contests cannot reach any indexed ZIP: ${[...remaining].join(", ")}`);
const checkHostedBuild = async () => {
  if (!successorPublic) return;
  const response = await fetch(`${PUBLIC_SITE_ORIGIN}/api/build`, { cache: "no-store" });
  assert.equal(response.status, 200, "Hosted ballot build identity is unavailable");
  const served = await response.json() as { commit?: unknown };
  assert.equal(served.commit, deployedCommit, "Hosted ballot serves a different deployed commit");
};
await checkHostedBuild();
const browser = await launchGuarded({ label: "reader-last-mile-all-ballots" });
const context = await browser.context({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const rows = [];
const cases: ReaderComponentCase[] = [];
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
try {
  for (const plan of chosen) {
    await page.goto(`${base}/ballot?zip=${plan.zip}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (successorPublic) {
      assert.equal(await page.locator("main[data-ballot-source-version-id]").getAttribute("data-ballot-source-version-id"),
        successorVersionId, `${plan.zip}: hosted ballot did not select the exact promoted Morris filing`);
    }
    const dates = electionDatesFor(plan.set.election.state);
    const registration = registrationLinkFor(plan.set.election.state);
    const polling = pollingPlaceLinkFor(plan.set.election.state);
    assert.ok(dates && registration && polling, `${plan.state}: mandatory held navigation controls`);
    const datesSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dates that decide whether you can vote", exact: true }) });
    if (dates) {
      const datesText = normalize(await datesSection.innerText());
      assert.equal(await datesSection.locator("li").count(), dates.steps.length);
      for (const step of dates.steps) {
        assert.ok(datesText.includes(normalize(step.label)), `${plan.state}: missing election step ${step.label}`);
        assert.ok(datesText.includes(normalize(formatDateMDY(step.date))), `${plan.state}: missing election date ${step.date}`);
      }
      assert.ok(await datesSection.locator(`a[href="${dates.sourceUrl}"]`).count());
    }
    if (registration) assert.ok(await page.locator(`a[href="${registration.url}"]`).count(), `${plan.state}: registration link`);
    const pollingLinkRendered = polling ? await page.locator(`a[href="${polling.url}"]`).count() > 0 : false;
    const actualContests = await page.locator("[data-contest-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-contest-id")));
    assert.deepEqual([...actualContests].sort(), plan.contests.map((contest) => contest.id).sort(), `${plan.zip}: exact contest population`);
    const proofs = [];
    for (const contest of plan.contests) {
      const section = page.locator(`[data-contest-id="${contest.id}"]`);
      const lineup = lineupForContest(contest.id);
      const candidates = plan.set.candidacies.filter((candidate) => candidate.contestId === contest.id);
      const expectedKeys = contest.type === "CANDIDACY" ? lineup ? lineup.nominees.map((nominee) => `${contest.id}|${nominee.name}`) : candidates.map((candidate) => candidate.id) : [];
      const actualKeys = await section.locator("[data-candidate-target]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-candidate-target")));
      assert.deepEqual([...actualKeys].sort(), [...expectedKeys].sort(), `${plan.zip}/${contest.id}: candidates`);
      for (const details of await section.locator("details[data-measure-official-text], details[data-filing-change-count], details[data-provisions]").all()) {
        if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
      }
      const text = normalize(await section.innerText());
      for (const measure of plan.set.measures.filter((measure) => measure.contestId === contest.id)) {
        assert.ok(text.includes(normalize(measure.questionText)), `${measure.id}: official question missing`);
        if (measure.officialStatement) assert.ok(text.includes(normalize(measure.officialStatement)), `${measure.id}: official statement missing`);
      }
      const summary = summaryForContest(contest.id);
      if (summary) assert.ok(text.includes(normalize(summary.summary)), `${contest.id}: eligible summary missing`);
      const provisions = provisionsForContest(contest.id);
      for (const provision of provisions) {
        assert.ok(text.includes(normalize(provision.label)), `${provision.id}: provision label missing`);
        assert.ok(text.includes(normalize(provision.what)), `${provision.id}: provision text missing`);
        assert.ok(await section.locator(`a[href="${provision.citesUrl}"]`).count(), `${provision.id}: provision source missing`);
      }
      const analysis = analysisForContest(contest.id);
      if (analysis?.text) {
        const disclosure = section.locator("details").filter({ has: page.locator("summary", { hasText: /^Official analysis/ }) });
        if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
        assert.ok(normalize(await disclosure.innerText()).includes(normalize(analysis.text)), `${contest.id}: complete official analysis`);
        assert.ok(await section.locator(`a[href="${analysis.analysisUrl}"]`).count(), `${contest.id}: analysis source`);
      }
      const removals = (plan.set.removals ?? []).filter((record) => record.contestId === contest.id);
      assert.equal(await section.locator("[data-filing-change-id]").count(), removals.length);
      for (const record of removals) assert.ok(text.includes(normalize(record.statement)), `${record.id}: filing change missing`);
      proofs.push({ contestId: contest.id, candidacyIds: expectedKeys.map((key) => reconciledCandidacyIdForCard(key) ?? key), actualCardKeys: actualKeys, measureIds: plan.set.measures.filter((measure) => measure.contestId === contest.id).map((measure) => measure.id), provisionIds: provisions.map((provision) => provision.id), removalIds: removals.map((record) => record.id), summaryHeld: Boolean(summary), textSha256: createHash("sha256").update(text).digest("hex"), sourceUrls: await section.locator("a[href]").evaluateAll((elements) => elements.map((element) => element.getAttribute("href"))) });
      if (process.argv.includes("--source-renewal")) {
        // Browser outerHTML leaves apostrophes literal; the existing React SSR
        // inspector expects their equivalent HTML character reference.
        const markup = (await section.evaluate(element => element.outerHTML)).replaceAll("'", "&#x27;");
        const expectedFragments = [contest.id, ...expectedKeys, ...(summary ? [summary.summary] : [])];
        const rowCounts = { candidates: { expected: expectedKeys.length, actual: actualKeys.length } };
        cases.push({ auditId: `${plan.zip}:${contest.id}`, component: "app/ballot/page.tsx", componentSha256: sha256(readFileSync("app/ballot/page.tsx")), selector: "canonical ZIP/division ballot selection → actual production DOM", actualCanonicalIdentities: [contest.id, ...expectedKeys], payloadSha256: sha256(JSON.stringify(proofs.at(-1))), markup, markupSha256: sha256(markup), expectedFragments, forbiddenFragments: [], rowCounts, failures: inspectReaderMarkup(markup, expectedFragments, [], rowCounts) });
      }
    }
    const actualAbsences = await page.locator("[data-absence-ocd-ids]").evaluateAll((elements) => elements.flatMap((element) => (element.getAttribute("data-absence-ocd-ids") ?? "").split(" ")));
    assert.deepEqual(actualAbsences.sort(), plan.absences.map((absence) => absence.ocdId).sort(), `${plan.zip}: sourced absences`);
    for (const group of groupAbsences(plan.absences)) {
      const section = page.locator(`[data-absence-ocd-ids~="${group.members[0].ocdId}"]`);
      assert.ok(normalize(await section.innerText()).includes(normalize(group.statement)));
    }
    for (const absence of plan.absences) {
      const section = page.locator(`[data-absence-ocd-ids~="${absence.ocdId}"]`);
      assert.equal(await section.count(), 1);
      const declared = Number(await section.getAttribute("data-absence-count"));
      const identities = (await section.getAttribute("data-absence-ocd-ids"))!.split(" ");
      assert.equal(declared, identities.length);
      if (absence.provenance.sourceUrl) assert.equal(await section.locator(`a[href="${absence.provenance.sourceUrl}"]`).count(), 1);
      assert.ok(normalize(await section.innerText()).includes(absence.provenance.sourceOrg));
    }
    rows.push({ zip: plan.zip, state: plan.state,
      ...(successorPublic ? { hostedSourceVersionId: successorVersionId } : {}),
      navigation: { dates, registration, polling, pollingLinkRendered }, analysisContestIds: plan.contests.filter((contest) => analysisForContest(contest.id)?.text).map((contest) => contest.id), statedContestCount: plan.contests.length, returnedContestCount: actualContests.length, proofs, absenceOcdIds: actualAbsences });
    console.log(JSON.stringify({ zip: plan.zip, contests: plan.contests.length, result: "PROVEN" }));
  }
} finally { await context.close(); await browser.close(); }
await checkHostedBuild();
writeFileSync(outputPath, JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), sourceHashes: proofSourcesPath ? JSON.parse(readFileSync(proofSourcesPath, "utf8")) : readerProofSources(), plan: planEvidence, execution: successorPublic ? "Actual canonical public ballot DOM at the named deployed commit; Morris filing local selector and every selected ZIP bound to the exact promoted version; no model request." : "Actual local production ballot navigation and rendered DOM; complete normalized contest population across deterministic committed ZIP coverage, including explicit disclosure gestures.", ...(successorPublic ? { origin: PUBLIC_SITE_ORIGIN, deployedCommit, pointerKey: successorKey, sourceVersionId: successorVersionId } : {}), rows, ...(cases.length ? { cases } : {}) }, null, 2) + "\n", successorPublic ? { flag: "wx" } : undefined);
