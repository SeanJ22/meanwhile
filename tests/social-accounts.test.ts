import assert from "node:assert/strict";
import test from "node:test";
import { accountKindForPage, socialFieldsIn, socialLinksIn, verifiedSocialAccounts } from "../lib/civic-data/social-accounts.ts";
import { DEFAULT_SOCIAL_PLATFORMS } from "../lib/officials/social-platforms.ts";

const PAGE = "https://council.example.gov/members";

test("CA-05: profile links on the listed platforms are found in a block; share endpoints, homepages and other hosts are not", () => {
  const html = `<a href="/about">About</a>
    <a href="https://www.linkedin.com/in/jane-doe">LinkedIn</a>
    <a href="https://twitter.com/janedoe?ref=x">X</a>
    <a href="https://twitter.com/intent/tweet?text=hi">Tweet</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=1">Share</a>
    <a href="https://www.instagram.com/">Instagram</a>
    <a href='https://www.tiktok.com/@janedoe'>TikTok</a>
    <a href="https://example.org/janedoe">Elsewhere</a>`;
  assert.deepEqual(socialLinksIn(html, PAGE), [
    { platform: "x", url: "https://twitter.com/janedoe?ref=x" },
    { platform: "linkedin", url: "https://www.linkedin.com/in/jane-doe" },
    { platform: "tiktok", url: "https://www.tiktok.com/@janedoe" },
  ]);
  assert.deepEqual(Object.keys(socialFieldsIn(html, PAGE)), ["socials.x", "socials.linkedin", "socials.tiktok"]);
});

test("CA-05: a platform added to the list is collected with no code change, and only §3-verified fields become accounts, with the kind set by where they were found", () => {
  const platforms = [...DEFAULT_SOCIAL_PLATFORMS, { id: "bluesky", label: "Bluesky", urlPatterns: ["bsky.app"], profileUrlTemplate: "https://bsky.app/profile/{handle}", iconKey: "bluesky" }];
  const fields = socialFieldsIn(`<a href="https://bsky.app/profile/jane.bsky.social">B</a><a href="https://facebook.com/jane">F</a>`, PAGE, platforms);
  assert.deepEqual(Object.keys(fields), ["socials.facebook", "socials.bluesky"]);
  const accounts = verifiedSocialAccounts({ fields, verified: ["socials.bluesky"], accountKind: "CAMPAIGN", sourceUrl: PAGE, collectedAt: "2026-10-01T00:00:00Z", platforms });
  assert.deepEqual(accounts.map(a => [a.platform, a.accountKind, a.sourceUrl]), [["bluesky", "CAMPAIGN", PAGE]]);
  assert.equal(accountKindForPage({ official: true, campaign: false }), "OFFICIAL");
  assert.equal(accountKindForPage({ official: false, campaign: true }), "CAMPAIGN");
  assert.equal(accountKindForPage({ official: false, campaign: false }), null, "a page that is neither is never a source of accounts");
});
