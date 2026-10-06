import test from "node:test";
import assert from "node:assert/strict";
import { socialAccountsOnPage, accountIsOnPage, profileAddress } from "../lib/civic-data/social-accounts.ts";
import { DEFAULT_SOCIAL_PLATFORMS } from "../lib/officials/social-platforms.ts";

const html = `<a href="https://www.facebook.com/SenatorFixture">Facebook</a>
<a href="https://twitter.com/fixture?lang=en">X</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="https://twitter.com/intent/tweet?text=hi">Tweet</a>
<a href='https://www.youtube.com/channel/UC123'>Video</a>
<a href="https://www.linkedin.com/in/fixture-person/">LinkedIn</a>
<a href="https://instagram.com/p/AbC123/">a post</a>
<a href="https://mastodon.social/@fixture">Mastodon</a>
<a href="https://other.example/fixture">Not a platform</a>
<a href="https://facebook.com/senatorfixture">Again</a>`;
const input = { pageUrl: "https://state.example.gov/members/fixture", text: html, platforms: DEFAULT_SOCIAL_PLATFORMS, collectedAt: "2026-10-06T00:00:00Z" };

test("profile links on a saved official page become OFFICIAL accounts with that page as their source", () => {
  const found = socialAccountsOnPage({ ...input, pageKind: "OFFICIAL_PAGE" });
  assert.deepEqual(found.map((a) => [a.platform, a.url]), [
    ["facebook", "https://facebook.com/SenatorFixture"], ["x", "https://twitter.com/fixture"],
    ["youtube", "https://youtube.com/channel/UC123"], ["linkedin", "https://linkedin.com/in/fixture-person"]]);
  assert.ok(found.every((a) => a.accountKind === "OFFICIAL" && a.sourceUrl === input.pageUrl));
});

test("the same links on a verified campaign site are CAMPAIGN accounts", () => {
  assert.ok(socialAccountsOnPage({ ...input, pageKind: "CAMPAIGN_SITE" }).every((a) => a.accountKind === "CAMPAIGN"));
});

test("share buttons, post links and platforms not in the list are not accounts", () => {
  for (const link of ["https://facebook.com/sharer/sharer.php?u=x", "https://twitter.com/intent/tweet", "https://instagram.com/p/AbC123/", "https://x.com/"]) {
    assert.equal(profileAddress(link), null, link);
  }
  const noList = socialAccountsOnPage({ ...input, pageKind: "OFFICIAL_PAGE", platforms: DEFAULT_SOCIAL_PLATFORMS.filter((p) => p.id === "facebook") });
  assert.deepEqual(noList.map((a) => a.platform), ["facebook"]);
});

test("a platform added to the list is collected with no code change", () => {
  const withMastodon = [...DEFAULT_SOCIAL_PLATFORMS, { id: "mastodon", label: "Mastodon", urlPatterns: ["mastodon.social"], profileUrlTemplate: "https://mastodon.social/@{handle}", iconKey: "mastodon" }];
  const found = socialAccountsOnPage({ ...input, pageKind: "OFFICIAL_PAGE", platforms: withMastodon });
  assert.ok(found.some((a) => a.platform === "mastodon" && a.url === "https://mastodon.social/@fixture"));
});

test("the check: an account is on its page, and is not once the page no longer links it", () => {
  const [account] = socialAccountsOnPage({ ...input, pageKind: "OFFICIAL_PAGE" });
  assert.ok(accountIsOnPage(account, html, DEFAULT_SOCIAL_PLATFORMS));
  assert.ok(!accountIsOnPage(account, "<p>No links here.</p>", DEFAULT_SOCIAL_PLATFORMS));
});

test("a page that is itself on a platform contributes no accounts", () => {
  assert.deepEqual(socialAccountsOnPage({ ...input, pageUrl: "https://facebook.com/someone", pageKind: "OFFICIAL_PAGE" }), []);
});
