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

/**
 * **RULING 122** — a party-hosted candidate page is the candidate's page, with
 * the host labelled. (Sean's decision of 2026-08-24, closing `NH11`.)
 */

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
  /*
   * The party is NAMED. Presenting a party's site under a bare "Campaign site"
   * label would be a false claim about whose site it is, and the label is the
   * whole of what keeps this inside the organizations-render-as-filed rule.
   */
  assert.match(label, /MAJI Party/);
  assert.match(label, /publishes about them/);
  assert.notEqual(label, "Campaign site", "it is not his site and must not say it is");
});

test("the label NEVER characterises the party's politics", () => {
  /*
   * The organizations-render-as-filed rule: this product renders an
   * organization's filed name and nothing about its alignments. A label that
   * editorialised would be the exact defect that rule names.
   */
  const banned =
    /\b(conservative|progressive|liberal|right.wing|left.wing|extremist|fringe|aligned|affiliate|backed)\b/i;
  for (const host of PARTY_HOSTED_HOSTS) {
    const label = campaignLinkLabel(`https://${host.host}/someone`);
    assert.doesNotMatch(label, banned, `${host.host} label characterises the organization`);
  }
});

test("every party host is a RECORD — read, dated, with what was read", () => {
  /*
   * There is no way to look at a URL and know it is a party's site. A guess
   * would eventually mislabel a personal domain as a party's, which is a false
   * claim about a real person. So a host is here only because a session read
   * it.
   */
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
  /*
   * A regex over "party" would catch `blockpartyrentals.com` and miss every
   * party whose domain does not contain the word.
   */
  assert.equal(partyHostFor("https://blockpartyrentals.com/x"), null);
  assert.equal(campaignLinkKind("https://blockpartyrentals.com/x"), "SITE");
  // A subdomain of a confirmed host still resolves.
  assert.notEqual(partyHostFor("https://nh.majiparty.org/x"), null);
  // A lookalike does not.
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
  /*
   * RULING 103: the inline `facebook.com` test that used to decide the label
   * here is exactly the duplicate implementation that would go stale the
   * moment a third kind of link existed — which is what RULING 122 created.
   */
  assert.doesNotMatch(
    source,
    /\?\s*"The campaign's Facebook page"/,
    "the label must not be decided inline",
  );
});
