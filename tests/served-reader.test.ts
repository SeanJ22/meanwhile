import test from "node:test";
import assert from "node:assert/strict";
import { campaignVisibleInHtml, collectServedReader } from "../lib/control-plane/served-reader-collector.ts";
import { servedWitness, type ServedReaderWitness } from "../lib/control-plane/served-reader.ts";
import type { DerivedCampaignSiteRecord } from "../lib/civic-data/derived-campaign-sites.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { observeCampaignControls } from "../lib/control-plane/campaign-reader-controls.ts";
import type { Page } from "playwright";

test("absent campaign candidates consume no action or nonexistent cleanup waits", async () => {
  const page = {
    locator: () => ({ count: async () => 0, getByRole: () => { throw Error("absent candidate must not be clicked"); } }),
    getByRole: () => ({ count: async () => 0, getByRole: () => { throw Error("absent dialog must not be closed"); } }),
  } as unknown as Page;
  const result = await observeCampaignControls(page, [{ id: "absent", candidateName: "Absent" }]);
  assert.equal(result.openedLinks?.length, 0);
  assert.match(result.failures![0].reason, /absent from the current public ballot/);
});

test("campaign readback identifies the failing action and stops after a panel cannot close", async () => {
  const clicked: string[] = [];
  const page = {
    locator: () => ({ count: async () => 1, getByRole: () => ({ click: async () => { clicked.push("open"); } }) }),
    getByRole: () => ({ count: async () => 1, isVisible: async () => true, getByRole: (_: string, options: { name: string }) => ({
      click: async () => { clicked.push(options.name); throw Error("private browser diagnostics"); },
    }) }),
  } as unknown as Page;
  const result = await observeCampaignControls(page, [{ id: "a", candidateName: "A" }, { id: "b", candidateName: "B" }]);
  assert.deepEqual(clicked, ["open", "Sources", "Close"]);
  assert.equal(result.openedLinks?.length, 0);
  assert.match(result.failures![0].reason, /opening Sources/);
  assert.match(result.failures!.find(f => f.readerKey === "b")!.reason, /not attempted/);
  assert.doesNotMatch(JSON.stringify(result), /private browser diagnostics/);
});

test("public readback requires the exact candidate container, not another card or serialized script", () => {
  const html = '<li data-candidate-target="a&amp;b"><div><a href="https://campaign.test/">Campaign</a></div></li><li data-candidate-target="wrong"><a href="https://else.test/">Campaign</a></li><script>"<li data-candidate-target=\"script\"><a href=\"https://campaign.test/\">"</script>';
  assert.equal(campaignVisibleInHtml(html, "a&b", "https://campaign.test/"), true);
  assert.equal(campaignVisibleInHtml(html, "a&b", "https://else.test/"), false);
  assert.equal(campaignVisibleInHtml(html, "wrong", "https://campaign.test/"), false);
  assert.equal(campaignVisibleInHtml(html, "script", "https://campaign.test/"), false);
});

test("a witness cannot transfer to a new approval or survive stale time", () => {
  const checkedAt = "2026-09-26T09:00:00Z";
  const w: ServedReaderWitness = { itemId: "a", approvalId: "v1", versionId: "d1", readerKey: "c", url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`, checkedAt, state: "CONFIRMED", reason: "observed", responseSha256: "a".repeat(64) };
  const read = { checkedAt, witnesses: [w], errors: [] };
  assert.equal(servedWitness(read, "a", "v1", checkedAt), w);
  assert.equal(servedWitness(read, "a", "v2", checkedAt), null);
  assert.equal(servedWitness(read, "b", "v1", checkedAt), null);
  assert.equal(servedWitness(read, "a", "v1", "2026-09-26T12:00:01Z"), null);
});

test("Battlecard evidence belongs only to the candidate whose controls were opened", async () => {
  const record = { id: "a", candidacyId: "a", campaign: { url: "https://campaign.test/", evidence: { approvalItemId: "a", approvalRecordId: "approved" } } } as DerivedCampaignSiteRecord;
  const run = (readerKey: string) => collectServedReader({ now: "2026-09-26T09:00:00Z", versionId: "d1", records: [record], destinations: new Map([["a", `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`]]), read: async () => ({ status: 200, html: "", openedLinks: [{ readerKey, href: record.campaign.url, domSha256: "b".repeat(64) }] }) });
  assert.equal((await run("a")).witnesses[0].state, "CONFIRMED");
  assert.equal((await run("b")).witnesses[0].state, "NOT_OBSERVED");
});

test("collector shares one public read, records exact approvals and holds missing destinations", async () => {
  const record = (id: string): DerivedCampaignSiteRecord => ({ id, candidacyId: id, candidateName: id, campaign: { url: "https://campaign.test/", verification: "fixture", attemptedAt: "2026-09-26", evidence: { approvalItemId: id, approvalRecordId: `${id}:approved` } as DerivedCampaignSiteRecord["campaign"]["evidence"] } });
  let reads = 0;
  const url = `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`;
  const result = await collectServedReader({ now: "2026-09-26T09:00:00Z", versionId: "derived-v1", records: [record("a"), record("b"), record("c")], destinations: new Map([["a", url], ["b", url]]), read: async () => {
    reads++; return { status: 200, html: '<li data-candidate-target="a"><a href="https://campaign.test/">Campaign</a></li>' };
  } });
  assert.equal(reads, 1);
  assert.deepEqual(result.witnesses.map(w => w.state), ["CONFIRMED", "NOT_OBSERVED", "NOT_OBSERVED"]);
  assert.equal(result.witnesses[0].approvalId, "a:approved");
  assert.match(result.witnesses[0].responseSha256!, /^[a-f0-9]{64}$/);
});

test("failed public controls retain the exact blocker for only that reader key", async () => {
  const record = (id: string) => ({ id, candidacyId: id, campaign: { url: "https://campaign.test/", evidence: { approvalItemId: id, approvalRecordId: "approved" } } }) as DerivedCampaignSiteRecord;
  const url = `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`;
  const result = await collectServedReader({ now: "2026-09-26T09:00:00Z", versionId: "d1", records: [record("a"), record("b")], destinations: new Map([["a", url], ["b", url]]), read: async () => ({ status: 200, html: "", failures: [{ readerKey: "a", reason: "Candidate absent from current certified lineup." }] }) });
  assert.equal(result.witnesses[0].state, "NOT_OBSERVED");
  assert.equal(result.witnesses[0].reason, "Candidate absent from current certified lineup.");
  assert.match(result.witnesses[1].reason, /not observed/);
});
