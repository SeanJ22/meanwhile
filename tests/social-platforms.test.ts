import assert from "node:assert/strict";
import test from "node:test";

import { SOCIAL_PLATFORMS } from "../lib/hunt/coverage-matrix.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import {
  DEFAULT_SOCIAL_PLATFORMS, SOCIAL_PLATFORMS_SETTING, accountLabel, platformForUrl, profileUrl,
  socialAccountsOf, socialPlatformsOrDefault, validSocialPlatforms,
} from "../lib/officials/social-platforms.ts";

test("CA-04: six platforms by default, Mastodon not among them", () => {
  assert.deepEqual(DEFAULT_SOCIAL_PLATFORMS.map((p) => p.id), ["facebook", "x", "instagram", "youtube", "linkedin", "tiktok"]);
  assert.ok(validSocialPlatforms(DEFAULT_SOCIAL_PLATFORMS));
});

test("CA-04: the list is a reader-facing setting; a seventh platform validates and shows", () => {
  const definition = settingDefinition(SOCIAL_PLATFORMS_SETTING);
  assert.ok(definition?.readerFacing);
  const seventh = { id: "bluesky", label: "Bluesky", urlPatterns: ["bsky.app"], profileUrlTemplate: "https://bsky.app/profile/{handle}", iconKey: "bluesky" };
  const list = [...DEFAULT_SOCIAL_PLATFORMS, seventh];
  assert.ok(definition.validate(list));
  assert.equal(socialPlatformsOrDefault(list).length, 7);
  assert.equal(platformForUrl("https://bsky.app/profile/a.b", list)?.id, "bluesky");
});

test("CA-04: a malformed or repeated platform is refused, and the default stands", () => {
  const dup = [DEFAULT_SOCIAL_PLATFORMS[0], DEFAULT_SOCIAL_PLATFORMS[0]];
  assert.equal(validSocialPlatforms(dup), false);
  assert.equal(validSocialPlatforms([{ ...DEFAULT_SOCIAL_PLATFORMS[0], profileUrlTemplate: "http://x/{handle}" }]), false);
  assert.equal(validSocialPlatforms([{ ...DEFAULT_SOCIAL_PLATFORMS[0], urlPatterns: ["https://facebook.com/x"] }]), false);
  assert.equal(socialPlatformsOrDefault(dup), DEFAULT_SOCIAL_PLATFORMS);
});

test("CA-04: a LinkedIn account is recognised by its host and keeps its kind", () => {
  assert.equal(platformForUrl("https://www.linkedin.com/in/someone", DEFAULT_SOCIAL_PLATFORMS)?.id, "linkedin");
  assert.equal(platformForUrl("https://notlinkedin.com/in/someone", DEFAULT_SOCIAL_PLATFORMS), null);
  const accounts = socialAccountsOf([
    { platform: "linkedin", url: "https://linkedin.com/in/someone", accountKind: "PERSONAL_PUBLIC", sourceUrl: "https://example.org", collectedAt: "2026-10-05" },
  ]);
  assert.equal(accounts[0].accountKind, "PERSONAL_PUBLIC");
});

test("CA-04: the directory's own fields read as OFFICIAL accounts; X keeps its handle label", () => {
  const accounts = socialAccountsOf({ twitter: "SenatorX", facebook: "senx", youtubeId: "UC123", mastodon: "@s@mastodon.social" });
  assert.deepEqual(accounts.map((a) => a.platform), ["x", "facebook", "youtube"]);
  assert.ok(accounts.every((a) => a.accountKind === "OFFICIAL"));
  assert.equal(accounts[0].url, "https://x.com/SenatorX");
  assert.equal(accounts[2].url, "https://youtube.com/channel/UC123");
  assert.equal(accountLabel(DEFAULT_SOCIAL_PLATFORMS[1], accounts[0]), "@SenatorX");
  assert.equal(accountLabel(DEFAULT_SOCIAL_PLATFORMS[0], accounts[1]), "Facebook");
  assert.equal(profileUrl(DEFAULT_SOCIAL_PLATFORMS[5], "@someone"), "https://tiktok.com/@someone");
});

test("CA-04: the coverage matrix reads the same list", () => {
  assert.deepEqual([...SOCIAL_PLATFORMS], [...DEFAULT_SOCIAL_PLATFORMS.map((p) => p.id), "other"]);
});
