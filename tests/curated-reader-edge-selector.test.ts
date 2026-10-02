import assert from "node:assert/strict";
import { test } from "node:test";

import { primeCuratedReaderProjection, readCuratedReaderProjection, settleBallotNavigationRead } from "../lib/civic-data/curated-reader-read-model.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { currentPollingPlaceLinks } from "../lib/ballot/polling-place-links.ts";
import { currentRegistrationLinks } from "../lib/ballot/registration-links.ts";
import { campaignSiteFor } from "../lib/officials/campaign-sites.ts";
import { currentCommentAccess } from "../lib/registry/comment-access.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import type { PublishedElectionField } from "../lib/civic-data/election-fields.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

/**
 * **AN EDGE-SERVED CURATED PROJECTION ANSWERS ITS SELECTOR IN PRODUCTION.**
 * (2026-09-25.)
 *
 * `currentCuratedReaderRecords` answered only a PROMOTED state and otherwise,
 * outside a test process, threw. The campaign-site URLs and the comment-access
 * rules have been primed from the reader edge as BOOTSTRAP (the edge copy of a
 * promoted version) since C20/C21, so in production every edge-served request
 * withheld every campaign link (`campaignSiteFor` catches and answers none)
 * and every comment rule. Under `node --test` the selector returned the
 * tracked seed instead, so no test saw it. These run as production does:
 * NODE_ENV=production and no NODE_TEST_CONTEXT.
 */

// A federal id: retired `plural:` roster ids never enter the Reader in production.
const OFFICEHOLDER = "congress:C001133";

function asProduction<T>(run: () => Promise<T> | T): Promise<T> {
  const env = { NODE_ENV: process.env.NODE_ENV, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT, DATABASE_URL: process.env.DATABASE_URL };
  Reflect.set(process.env, "NODE_ENV", "production");
  Reflect.deleteProperty(process.env, "NODE_TEST_CONTEXT");
  Reflect.deleteProperty(process.env, "DATABASE_URL");
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  });
}

test("an edge-primed campaign-site projection names its campaign links in production", async () => {
  await asProduction(() => {
    primeCuratedReaderProjection("campaign-sites", {
      kind: "campaign-sites",
      records: [{ id: `campaign-site:${OFFICEHOLDER}`, officeholderId: OFFICEHOLDER, site: { url: "https://edge.example.test", foundVia: "edge test", verification: "edge test", attemptedAt: "2026-09-25" } }],
    } as unknown as CuratedReaderProjection, "edge-test:campaign-sites");
    assert.equal(campaignSiteFor(OFFICEHOLDER)?.url, "https://edge.example.test", "an edge-served campaign link was withheld");
  });
});

test("an edge-primed comment-access projection answers its rules in production", async () => {
  await asProduction(() => {
    primeCuratedReaderProjection("comment-access", {
      kind: "comment-access",
      records: [{ id: "comment-access:edge-test-body", bodyId: "edge-test-body", sourceUrl: "https://edge.example.test/comment", collectedAt: "2026-09-25" }],
    } as unknown as CuratedReaderProjection, "edge-test:comment-access");
    assert.deepEqual(currentCommentAccess().map((rule) => rule.bodyId), ["edge-test-body"]);
  });
});

test("/ballot's navigation links read from the reader edge in production, with no database", async () => {
  const contract = requiredManualProductionContract("ballot-navigation");
  const navigation = {
    kind: "ballot-navigation",
    records: [
      { id: "registration:AZ", kind: "REGISTRATION_LINK", value: { state: "AZ", url: "https://edge.example.test/register", label: "Register", verifiedAt: "2026-09-25" } },
      { id: "polling-place:AZ", kind: "POLLING_PLACE_LINK", value: { state: "AZ", url: "https://edge.example.test/polls", label: "Find", verifiedAt: "2026-09-25" } },
    ],
  };
  const entry = provenEdgeEntry({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId, versionId: "edge-test:navigation", value: navigation });
  await asProduction(async () => {
    // No database is configured: a navigation read from the database would throw.
    await withReaderAuthorityEdge({ promoted: new Map([[entry.projection.key, entry]]) }, () => settleBallotNavigationRead());
    assert.deepEqual(currentRegistrationLinks().map((link) => link.url), ["https://edge.example.test/register"]);
    assert.deepEqual(currentPollingPlaceLinks().map((link) => link.url), ["https://edge.example.test/polls"]);
  });
});

test("sourced nonpilot tools supersede legacy state links without promoting a county tool to statewide", async () => {
  const field = (state: string, kind: "polling_lookup" | "registration_lookup", suffix = "", date = "2026-10-01"): PublishedElectionField => ({
    id: `${state}:${kind}:${suffix}:${date}`, kind: "ELECTION_FIELD", value: {
      state, divisionId: `ocd-division/country:us/state:${state.toLowerCase()}${suffix}`, fieldKind: kind,
      text: `https://elections.example.gov/${state}/${kind}`, quote: "The saved official page names this tool.", dates: [],
      url: "https://elections.example.gov/voters", navigationUrl: `https://elections.example.gov/${state}/${kind}/${date}`,
      verifiedAt: date, collectedAt: date, sourceOrg: "Saved election authority",
    },
  });
  await asProduction(() => {
    primeCuratedReaderProjection("ballot-navigation", {
      kind: "ballot-navigation", records: [
        { id: "legacy:AK", kind: "POLLING_PLACE_LINK", value: { state: "AK", url: "https://legacy.example.gov/polls" } },
        field("AK", "polling_lookup", "", "2026-09-30"), field("AK", "polling_lookup"),
        field("HI", "registration_lookup"), field("HI", "polling_lookup", "/county:hawaii"),
        { ...field("PA", "polling_lookup"), value: { ...field("PA", "polling_lookup").value, navigationUrl: null } },
      ],
    } as unknown as CuratedReaderProjection, "edge-test:national-navigation");
    assert.deepEqual(currentPollingPlaceLinks().map(link => [link.state, link.url]), [["AK", "https://elections.example.gov/AK/polling_lookup/2026-10-01"]]);
    assert.deepEqual(currentRegistrationLinks().map(link => [link.state, link.url]), [["HI", "https://elections.example.gov/HI/registration_lookup/2026-10-01"]]);
    assert.equal(currentPollingPlaceLinks()[0].note, "The saved official page names this tool.");
  });
});

test("a missing navigation pointer never supplies a software lookup in production or tests", async () => {
  await asProduction(async () => {
    await readCuratedReaderProjection("ballot-navigation", { store: new MemoryRoutineDataStore(), bypassCache: true });
    assert.throws(() => currentPollingPlaceLinks(), /NOT_RECORDED/);
    assert.throws(() => currentRegistrationLinks(), /NOT_RECORDED/);
  });
  assert.deepEqual(currentPollingPlaceLinks(), []);
  assert.deepEqual(currentRegistrationLinks(), []);
});
