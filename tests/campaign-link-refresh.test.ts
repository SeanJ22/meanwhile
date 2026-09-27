import assert from "node:assert/strict";
import test from "node:test";
import { campaignLinkRefreshIssue } from "../lib/civic-data/campaign-link-refresh.ts";

test("campaign refresh preserves conflicts and unverifiable or non-newer dates", () => {
  const prior = { url: "https://campaign.example", attemptedAt: "2026-09-20" };
  const next = { url: "https://campaign.example/", attemptedAt: "2026-09-21" };
  assert.equal(campaignLinkRefreshIssue(prior, next), null);
  assert.equal(campaignLinkRefreshIssue(null, next), null);
  assert.match(campaignLinkRefreshIssue(prior, { ...next, url: "https://other.example/" })!, /^CONFLICTING_CAMPAIGN_URL/);
  for (const attemptedAt of ["2026-09-20", "2026-09-19"]) {
    assert.match(campaignLinkRefreshIssue(prior, { ...next, attemptedAt })!, /^CAMPAIGN_READ_NOT_NEWER/);
  }
  for (const attemptedAt of ["", "2026-02-30", "unread"]) {
    assert.match(campaignLinkRefreshIssue({ ...prior, attemptedAt }, next)!, /^CAMPAIGN_READ_DATE_UNVERIFIED/);
    assert.match(campaignLinkRefreshIssue(prior, { ...next, attemptedAt })!, /^CAMPAIGN_READ_DATE_UNVERIFIED/);
  }
  assert.match(campaignLinkRefreshIssue({ ...prior, url: "invalid" }, next)!, /^CAMPAIGN_URL_INVALID/);
});
