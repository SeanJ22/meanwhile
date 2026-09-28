import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/admin/v6/checklist/route.ts";
import { v6ChecklistSection } from "../lib/control-plane/admin-view/v6-checklist-section.ts";
import { CHECKLIST_PROFILE, checklistObligationKey, type ChecklistInstance } from "../lib/control-plane/readiness/checklist-score.ts";
import type { ChecklistInstanceIndexRead } from "../lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const scope = "zcta:2020/85635";
const receipt = "expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const sourceInstance: ChecklistInstance = {
  obligationKey: checklistObligationKey("OFF-01", "seat-a", scope, "effective-period-unresolved"),
  definitionIds: ["OFF-01"], predicateKey: "OFF-01", objectId: "seat-a", jurisdictionId: scope,
  period: "effective-period-unresolved", scopeRevision: "census:one",
  applicability: { state: "UNRESOLVED", reason: "The official term has not been established.", evidenceIds: [receipt] },
  due: { state: "UNRESOLVED", at: null, evidenceIds: [receipt] },
  predicate: { kind: "POSSESSION", requiredClauses: [`${CHECKLIST_PROFILE.version}:OFF-01`], contractVersion: "checklist-field-contract/1" },
  workIds: [], requiredSurfaces: [], requiresFreshness: true, owner: "Lead",
  blocker: "Term not established.", nextAction: "Read term authority.", failureKind: "DISCONNECTED_CAPABILITY",
};
const indexRead: ChecklistInstanceIndexRead = { state: "CURRENT_SNAPSHOT_CAPTURED_INSTANCES",
  scopeId: scope, instructionReceipt: receipt, definitionId: "OFF-01",
  projectionId: `cpidx-${"a".repeat(64)}`, snapshotPublishedAt: "2026-09-28T12:00:00.000Z",
  scopeRevision: "census:one", observedAt: "2026-09-28T11:59:00.000Z",
  rows: [sourceInstance], ordinals: [3], matchedCapturedCount: 1, pageLimit: 25, nextCursor: null,
  completeness: { inventoryComplete: false, readsComplete: false, expectedObjects: null,
    nationalTotal: null, historicalTotal: null } };

test("v6 section keeps all real definitions and one exact captured item, with every proof claim unmeasured", () => {
  const section = v6ChecklistSection({ scope, read: indexRead, readAt: "2026-09-28T12:05:00.000Z" });
  assert.equal(section.contract, "admin-v6/checklist@1");
  assert.equal(section.scope, scope);
  assert.equal(section.revision, indexRead.projectionId);
  assert.equal(section.asOf, indexRead.observedAt);
  assert.equal(section.data.definitionCount, 325);
  assert.equal(section.data.definitions.length, 325);
  assert.equal(section.data.placeGroups, null);
  assert.equal(section.page.total, 1);
  assert.equal(section.page.nextCursor, null);
  assert.equal(section.page.prevCursor, null);
  const item = section.data.items?.[0];
  assert.ok(item);
  assert.equal(item.definitionId, "OFF-01");
  assert.equal(item.subject, "seat-a");
  assert.equal(item.status, "unsure");
  assert.equal(item.actions.length, 0);
  assert.match(item.missing, /unresolved/);
  assert.equal(item.parts[0]?.tone, "muted");
  assert.match(item.parts[0]?.proof ?? "", /not read/i);
  assert.ok(section.data.systemGroups.every(group => group.counts === null && group.audit === null));
  assert.ok(section.missingParts.some(part => /unknown/.test(part)));
  assert.ok(section.missingParts.some(part => /lower bound/.test(part)));
  assert.ok(section.missingParts.some(part => /not read completely/.test(part)));
});

test("missing or stale index is an explicit partial section, never an empty list or zero", () => {
  for (const state of ["INDEX_NOT_POPULATED", "INDEX_STALE"] as const) {
    const section = v6ChecklistSection({ scope, read: { state, rows: null, matchedCapturedCount: null,
      says: "Exact indexed projection unavailable." }, readAt: "2026-09-28T12:05:00.000Z" });
    assert.equal(section.data.items, null);
    assert.equal(section.page.total, null);
    assert.equal(section.asOf, "2026-09-28T12:05:00.000Z");
    assert.ok(section.missingParts.includes("Exact indexed projection unavailable."));
  }
});

test("v6 route requires Admin session and exact saved scope/receipt/definition; place keys wait for binding", async () => {
  const url = `/api/admin/v6/checklist?scope=${encodeURIComponent(scope)}&instructionReceipt=${encodeURIComponent(receipt)}&definitionId=OFF-01`;
  assert.equal((await GET(new NextRequest(`https://${PUBLIC_HOST}${url}`, { headers: { host: PUBLIC_HOST } }))).status, 404);
  assert.equal((await GET(new NextRequest(`https://${ADMIN_HOST}${url}`, { headers: { host: ADMIN_HOST } }))).status, 401);
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const req = (suffix: string) => new NextRequest(`https://${ADMIN_HOST}${suffix}`, { headers: { host: ADMIN_HOST, cookie } });
    assert.equal((await GET(req("/api/admin/v6/checklist?scope=zcta%3A2020%2F85635"))).status, 400);
    assert.equal((await GET(req(`${url}&scope=other`))).status, 400);
    assert.equal((await GET(req(`${url}&limit=99`))).status, 400);
    assert.equal((await GET(req(`${url}&cursor=bad***`))).status, 400);
    const place = await GET(req(url.replace(encodeURIComponent(scope), encodeURIComponent("geo:az.zcta.85635"))));
    assert.equal(place.status, 409);
    assert.equal((await place.json()).code, "SCOPE_BINDING_NOT_CONNECTED");
  });
});
