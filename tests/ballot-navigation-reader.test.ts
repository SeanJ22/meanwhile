import { ballotNavigationFor } from "../lib/ballot/navigation.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launchGuarded } from "../scripts/browser.mts";
import { Card } from "../components/ui/card.tsx";
import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { CuratedReaderProjection, ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import { electionFieldIssue, type PublishedElectionField } from "../lib/civic-data/election-fields.ts";
import { formatDateMDY } from "../lib/map/format.ts";
import { absentEdgeEntry, manualEdgeEntry, promotedFamily, provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { registryFixtureForState, registryTransferImport, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { stateBallotScope, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";

const zips: Readonly<Record<string, string>> = {
  AL: "35004", AK: "99501", AZ: "85003", AR: "71601", CA: "90001", CO: "80002", CT: "06001", DE: "19701", DC: "20001",
  FL: "32003", GA: "30002", HI: "96701", ID: "83120", IL: "60002", IN: "46001", IA: "50001", KS: "66002", KY: "40003",
  LA: "70001", ME: "03579", MD: "20601", MA: "01001", MI: "48001", MN: "55001", MS: "38601", MO: "63005", MT: "59001",
  NE: "68001", NV: "89001", NH: "03031", NJ: "07001", NM: "87001", NY: "10001", NC: "27006", ND: "58002", OH: "43001",
  OK: "73002", OR: "97002", PA: "15001", RI: "02804", SC: "29001", SD: "57001", TN: "37010", TX: "75001", UT: "82930",
  VT: "05001", VA: "20105", WA: "98001", WV: "24701", WI: "53001", WY: "82001",
};
const sourceInputs = Object.keys(zips).map(state => JSON.parse(readFileSync(new URL(`../data/ballot/2026-navigation/${state.toLowerCase()}.json`, import.meta.url), "utf8")) as { state: string; package: ManualProjectionPackage });
const states = Object.keys(zips);
const projection: CuratedReaderProjection = { kind: "ballot-navigation", records: sourceInputs.flatMap(input => (input.package.payload as CuratedReaderProjection).records) };
const fields = projection.records as unknown as PublishedElectionField[];

async function publishNavigationFixture(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ballot-navigation-reader-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  process.env.WTP_READER_EDGE_DIR = dir;
  const registry = registryTransferImport().projection.payload;
  const checkedAt = "2026-10-15T20:10:00.000Z";
  const result = await publishReaderEdgeArtifacts({ formatVersion: 1, generatedAt: checkedAt, counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [], meetings: [], agendaDocuments: [] }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
    store: new LocalFileArtifactStore(dir), authority: {
      "federal-directory": { value: syntheticFederalDirectory(registry), versionId: "BL-20:navigation-federal" },
      "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
    }, stateAuthorities: {
      "registry-runtime": Object.fromEntries(states.map(state => [state, { versionId: `BL-20:navigation-registry:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
        entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
          versionId: `BL-20:navigation-registry:${state}`, value: registryFixtureForState(state, registry) })] } }])),
      "ballot-contests": Object.fromEntries(states.map(state => [state,
        promotedFamily([absentEdgeEntry("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state))], `BL-20:no-ballots:${state}`)])),
      "ballot-navigation": Object.fromEntries(sourceInputs.map(input => [input.state,
        promotedFamily([manualEdgeEntry("ballot-navigation", input.package.payload, `navigation:${input.state}`)], `navigation:${input.state}`)])),
    }, registrations: {}, stateLegislators: {},
  });
  assert.equal(result.status, "PUBLISHED");
}

function navigationCard(tree: React.ReactNode, state: string): React.ReactElement<React.ComponentProps<typeof Card>> | null {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const card = navigationCard(child, state);
      if (card) return card;
    }
    return null;
  }
  if (!React.isValidElement<{ children?: React.ReactNode; attrs?: Record<string, string> }>(tree)) return null;
  if (tree.type === Card && tree.props.attrs?.["data-ballot-navigation"] === state) return tree as React.ReactElement<React.ComponentProps<typeof Card>>;
  return navigationCard(tree.props.children, state);
}

test("sourced no-date rules remain text and primary deadlines cannot stand in for November", () => {
  const rule = fields.find(row => row.value.fieldKind === "registration_deadline" && row.value.dates.length === 0)!;
  assert.ok(rule);
  assert.equal(electionFieldIssue(rule), null);
  const calendar = electionDatesFor(rule.value.state, ballotNavigationFor(rule.value.state, { ...projection, records: [{ ...rule }] }, "BL-20:no-date-rule", []).dates)!;
  assert.equal(calendar.steps[0].date, "");
  assert.equal(calendar.steps[0].detail, rule.value.quote);
  const primary = { ...rule, id: "test:primary-rule", value: { ...rule.value, electionDate: "2026-08-04" } };
  assert.equal(electionDatesFor(rule.value.state, ballotNavigationFor(rule.value.state, { ...projection, records: [primary] }, "BL-20:primary-rule", []).dates), null);
});

test("a ZIP in every state and DC renders acquired official navigation and deadlines without a ballot", async () => {
  fields.forEach(row => assert.equal(electionFieldIssue(row), null, row.id));
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];
  const env = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  after(() => { if (env === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Reflect.set(process.env, "NODE_ENV", env); });
  await publishNavigationFixture();
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  const browser = await launchGuarded({ label: "BL-20-acquired-national-navigation", blockWrites: true });
  try {
    const page = await browser.page({ viewport: { width: 1100, height: 1100 } });
    mkdirSync(".scratch/ci", { recursive: true });
    for (const [state, zip] of Object.entries(zips)) {
      const start = performance.now();
      const card = navigationCard(await BallotPage({ searchParams: Promise.resolve({ zip }) }), state);
      assert.ok(card, `${state}: ZIP ${zip} has no navigation`);
      assert.deepEqual(card.props.gaps, [], `${state}: false missing-information gap`);
      await page.setContent(renderToStaticMarkup(card));
      const stateFields = fields.filter(row => row.value.state === state);
      const stateRecords = projection.records.filter(row => (row.value as { state?: string } | undefined)?.state === state);
      const noRegistration = stateFields.some(row => row.value.fieldKind === "registration_deadline" &&
        row.value.text.toLowerCase().includes("does not require voter registration"));
      for (const kind of ["election_office", "registration_page", "ballot_lookup", "polling_lookup", ...(noRegistration ? [] : ["registration_lookup"])]) {
        if (kind === "polling_lookup") {
          assert.ok(stateFields.some(row => row.value.fieldKind === kind), `${state}: no acquired ${kind}`);
          assert.equal(await page.locator(`a[data-navigation-kind="${kind}"]`).count(), 0, `${state}: polling lookup was linked out instead of shown from voting sites`);
          continue;
        }
        const routes = stateRecords.flatMap(row => {
          const value = row.value as PublishedElectionField["value"];
          if (row.kind === "ELECTION_FIELD") return value.fieldKind === kind && value.navigationUrl
            ? [{ url: value.navigationUrl, sourceUrl: value.url }] : [];
          return ((row.kind === "REGISTRATION_LINK" && kind === "registration_lookup") || (row.kind === "POLLING_PLACE_LINK" && kind === "polling_lookup"))
            ? [{ url: value.url, sourceUrl: (row.value as { sourceUrl?: string }).sourceUrl ?? value.url }] : [];
        });
        assert.ok(routes.length, `${state}: no acquired ${kind}`);
        const distinctRoutes = new Map<string, readonly string[]>();
        for (const route of routes) distinctRoutes.set(route.url, [...(distinctRoutes.get(route.url) ?? []), route.sourceUrl]);
        for (const [url, sourceUrls] of distinctRoutes) {
          const selector = kind === "election_office" ? "[data-ballot-election-offices] a" : `a[data-navigation-kind="${kind}"]`;
          assert.ok(await page.locator(selector).evaluateAll((links, target) =>
            links.some(link => link.getAttribute("href") === target), url), `${state}: ${kind} did not reach the page`);
          assert.ok(card.props.sources.some(source => sourceUrls.includes(source.provenance.sourceUrl ?? "")), `${state}: route source missing`);
        }
      }
      const displayedDates = await page.locator("[data-navigation-date]").allTextContents();
      const text = await page.locator("article").innerText();
      assert.match(text, /Election Day: November 3rd, 2026/);
      for (const kind of ["registration_deadline", "mail_ballot_request_deadline", "early_voting"]) {
        const deadlines = stateFields.filter(row => row.value.fieldKind === kind && row.value.electionDate === "2026-11-03");
        assert.ok(deadlines.length, `${state}: no acquired ${kind}`);
        for (const { value } of deadlines) {
          for (const date of value.dates) assert.ok(displayedDates.some(rendered => rendered.includes(formatDateMDY(date))), `${state}: missing displayed ${date}`);
          assert.ok(text.replace(/\s+/g, " ").includes(value.quote.replace(/\s+/g, " ")), `${state}: deadline clock or method disappeared`);
          assert.ok(card.props.sources.some(source => source.provenance.sourceUrl === value.url && source.provenance.collectedAt === value.collectedAt), `${state}: original deadline provenance missing`);
        }
      }
      if (noRegistration) assert.equal(await page.locator('a[data-navigation-kind="registration_lookup"]').count(), 0);
      assert.ok(performance.now() - start < 3000, `${state}: first-use navigation exceeded three seconds`);
      if (["DC", "ND", "OH", "MI"].includes(state)) await page.screenshot({ path: `.scratch/ci/BL-20-acquired-navigation-${state.toLowerCase()}.png` });
    }
  } finally {
    await browser.close();
  }
});
