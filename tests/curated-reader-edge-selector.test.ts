import assert from "node:assert/strict";
import { test } from "node:test";

import { primeCuratedReaderProjection, settleBallotNavigationRead } from "../lib/civic-data/curated-reader-read-model.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { currentPollingPlaceLinks } from "../lib/ballot/polling-place-links.ts";
import { currentRegistrationLinks } from "../lib/ballot/registration-links.ts";
import { campaignSiteFor } from "../lib/officials/campaign-sites.ts";
import { currentCommentAccess } from "../lib/registry/comment-access.ts";
import { settleCommentAccessRead } from "../lib/registry/server.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

/**
 * The selector must answer an edge-served BOOTSTRAP projection in production, not only a PROMOTED state. These run as
 * production does: NODE_ENV=production and no NODE_TEST_CONTEXT.
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

test("edge-served comment rules answer in production, with no database", async () => {
  const commentAccess = {
    value: { kind: "comment-access" as const, records: [{ id: "comment-access:edge-test-body", bodyId: "edge-test-body", ocdId: null, commentPeriod: "YES" as const,
      commentPeriodDetail: null, signup: null, writtenComment: null, attend: null, timeLimit: null,
      sourceUrl: "https://edge.example.test/comment", collectedAt: "2026-09-25", verifiedAt: null }] },
    versionId: "edge-test:comment-access",
  };
  await asProduction(async () => {
    await withReaderAuthorityEdge({ commentAccess }, async () => {
      await settleCommentAccessRead();
      assert.deepEqual(currentCommentAccess().map((rule) => rule.bodyId), ["edge-test-body"]);
    });
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
