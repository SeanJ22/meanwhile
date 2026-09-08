import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { socialChannelLinks } from "../lib/officials/social-channels.ts";

test("official social links are dynamic and use only held channels", () => {
  const links = socialChannelLinks({
    twitter: "@ExampleOffice",
    instagram: "example.office",
    youtubeId: "UC_example",
    newsletter: "https://example.gov/newsletter",
  });
  assert.deepEqual(links.map(link => link.id), ["x", "instagram", "youtube", "newsletter"]);
  assert.equal(links.find(link => link.id === "x")!.href, "https://x.com/ExampleOffice");
  assert.equal(links.find(link => link.id === "newsletter")!.href, "https://example.gov/newsletter");
  assert.equal(links.some(link => link.id === "facebook"), false);
});

test("ambiguous networks require a complete official URL", () => {
  const links = socialChannelLinks({
    linkedin: "not-a-verifiable-profile",
    nextdoor: "neighbourhood-handle",
    newsletter: "javascript:alert(1)",
    tiktok: "@ExampleOffice",
  });
  assert.deepEqual(links.map(link => link.id), ["tiktok"]);
  assert.equal(links[0].href, "https://www.tiktok.com/@ExampleOffice");
});

test("social badge themes keep the decided shape and distinct responses", () => {
  const css = readFileSync(
    new URL("../components/officials/social-channel-badges.module.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /border-radius:\s*20%/);
  assert.match(css, /:global\(\[data-theme="light"\]\) \.badge::before/);
  assert.match(css, /transform-origin:\s*center bottom/);
  assert.match(css, /@keyframes social-gradient-flow/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /data-social-channel="x"/);
  assert.match(css, /background:\s*#050505/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("body battlecards reserve the header badge position for held channels", () => {
  const modal = readFileSync(
    new URL("../components/map/popup/entity-modal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(modal, /social\?: SocialAccounts/);
  assert.match(modal, /<SocialChannelBadges social=\{subject\.bodyCard\?\.social\}/);
});
