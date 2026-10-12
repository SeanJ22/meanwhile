import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PARTY_HOSTED_HOSTS,
  campaignLinkKind,
  campaignLinkLabel,
  partyHostFor,
} from "../lib/officials/campaign-link-label.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("an ordinary campaign domain is still a campaign site", () => {
  assert.equal(campaignLinkKind("https://votejonraiche.com/"), "SITE");
  assert.equal(campaignLinkLabel("https://votejonraiche.com/"), "Campaign site");
});

test("a campaign living on Facebook says which platform it is", () => {
  assert.equal(campaignLinkKind("https://www.facebook.com/somecampaign"), "FACEBOOK");
  assert.equal(
    campaignLinkLabel("https://www.facebook.com/somecampaign"),
    "The campaign's Facebook page",
  );
});

test("a party-hosted page renders as the candidate's page WITH THE HOST NAMED", () => {
  const url = "https://majiparty.org/nh-governor-shaun-fife";
  assert.equal(campaignLinkKind(url), "PARTY_HOSTED");
  const label = campaignLinkLabel(url);
  assert.match(label, /MAJI Party/);
  assert.match(label, /publishes about them/);
  assert.notEqual(label, "Campaign site", "it is not his site and must not say it is");
});

test("the label NEVER characterises the party's politics", () => {
  const banned =
    /\b(conservative|progressive|liberal|right.wing|left.wing|extremist|fringe|aligned|affiliate|backed)\b/i;
  for (const host of PARTY_HOSTED_HOSTS) {
    const label = campaignLinkLabel(`https://${host.host}/someone`);
    assert.doesNotMatch(label, banned, `${host.host} label characterises the organization`);
  }
});

test("every party host is a RECORD — read, dated, with what was read", () => {
  // A URL alone cannot show a site is a party's, so a host is listed only because it was read.
  assert.ok(PARTY_HOSTED_HOSTS.length > 0);
  for (const host of PARTY_HOSTED_HOSTS) {
    assert.match(host.host, /^[a-z0-9.-]+$/, "a host, lowercased, with no scheme");
    assert.doesNotMatch(host.host, /^www\./, "www is stripped so matching is stable");
    assert.ok(host.organization.length > 0, "whose site it is");
    assert.match(host.confirmedOn, /^\d{4}-\d{2}-\d{2}$/, "the date it was read");
    assert.ok(host.evidence.length > 40, "WHAT was read, so it can be checked not trusted");
  }
});

test("the host list is not a pattern over the word 'party'", () => {
  // A regex over "party" would catch `blockpartyrentals.com` and miss party domains without the word.
  assert.equal(partyHostFor("https://blockpartyrentals.com/x"), null);
  assert.equal(campaignLinkKind("https://blockpartyrentals.com/x"), "SITE");
  assert.notEqual(partyHostFor("https://nh.majiparty.org/x"), null);
  assert.equal(partyHostFor("https://majiparty.org.evil.test/x"), null);
});

test("a malformed URL is not a party host, and does not throw", () => {
  assert.equal(partyHostFor("not a url"), null);
  assert.equal(campaignLinkKind("not a url"), "SITE");
});

test("the pill row asks the shared module rather than testing the URL itself", () => {
  const source = readFileSync(
    join(ROOT, "components", "officials", "contact-pills.tsx"),
    "utf8",
  );
  assert.match(source, /campaignLinkLabel\(/, "the label comes from the shared module");
  assert.doesNotMatch(
    source,
    /\?\s*"The campaign's Facebook page"/,
    "the label must not be decided inline",
  );
});
