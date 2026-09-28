import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { candidatePublicationLinkMatches, candidatePublicationLinks } from "../lib/control-plane/promotion/campaign-publication-links.ts";

test("approved captured HTML yields exact same-host publication links without turning pointers into facts", () => {
  const html = `<nav><a href="/issues/">Issues</a><a href="https://other.example/news">Other</a><a href="/issues/">Again</a><a href="#contact">Contact</a></nav>`;
  const hash = `sha256-${createHash("sha256").update(html).digest("hex")}`;
  const links = candidatePublicationLinks({ html, sourceUrl: "https://campaign.example/",
    sourceArtifactId: "ar-root", sourceContentHash: hash, approvalRecordId: "approval-1", candidacyId: "az:2026:candidate" });
  assert.deepEqual(links.map(row => row.url), ["https://campaign.example/issues/"]);
  assert.equal(html.slice(links[0]!.source.start, links[0]!.source.end), links[0]!.source.quote);
  assert.equal(candidatePublicationLinkMatches(links[0]!, html, hash), true);
  assert.equal(candidatePublicationLinkMatches({ ...links[0]!, url: "https://campaign.example/altered" }, html, hash), false);
  assert.equal(candidatePublicationLinkMatches(links[0]!, html.replace("Issues", "Changed"), hash), false,
    "The whole approved page must match its original captured-byte hash.");
  assert.equal(candidatePublicationLinkMatches(links[0]!, html, "sha256-" + "0".repeat(64)), false);
});
