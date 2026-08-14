import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CAMPAIGN_SITES } from "../lib/officials/campaign-sites.ts";
import {
  OFFICE_BLURBS,
  blurbForTitle,
  officeTypeForTitle,
} from "../lib/officials/office-blurbs.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

/**
 * The officials surface (3a–3e): contact, photos, blurbs and campaign sites
 * each carry the discipline they were built under, held here.
 */

const ROOT = join(import.meta.dirname, "..");

test("every office blurb speaks the product's register", () => {
  for (const [type, blurb] of Object.entries(OFFICE_BLURBS)) {
    // Second person, present tense — the neighbor explaining, not a statute.
    assert.ok(
      /\b[Yy]our?\b/.test(blurb.text),
      `${type}: blurb must address the reader ("your")`,
    );
    // The wonk words the register forbids. "serves as", "pursuant",
    // "chief executive officer" are the author's counter-example family.
    for (const banned of [
      "pursuant",
      "serves as",
      "chief executive officer",
      "subject to",
      "governance",
      "statutory",
    ]) {
      assert.ok(
        !blurb.text.toLowerCase().includes(banned),
        `${type}: "${banned}" is not how a neighbor talks`,
      );
    }
    // Neutrality: describes the office, never evaluates the holder.
    for (const evaluative of ["effective", "important", "powerful", "best "]) {
      assert.ok(
        !blurb.text.toLowerCase().includes(evaluative),
        `${type}: "${evaluative}" evaluates rather than describes`,
      );
    }
    assert.ok(blurb.basis.length > 0, `${type}: the basis must be named`);
  }
});

test("every roster office title maps to a blurb", () => {
  // The titles the rosters actually publish. An unmapped one renders no
  // blurb rather than a guessed one — but these four must always map.
  for (const title of [
    "U.S. Senator",
    "U.S. Representative",
    "State Senator",
    "State Representative",
    "Assemblymember",
  ]) {
    assert.ok(
      officeTypeForTitle(title) !== null,
      `"${title}" has no blurb mapping`,
    );
    assert.ok(blurbForTitle(title) !== null);
  }
});

test("every campaign site is verified, https, and never a social profile", () => {
  const entries = Object.entries(CAMPAIGN_SITES);
  assert.ok(entries.length > 0, "the overlay should not be empty after the hunt");
  for (const [id, site] of entries) {
    assert.ok(site.url.startsWith("https://"), `${id}: https only`);
    assert.ok(
      site.verification.length > 20,
      `${id}: verification must record what was seen`,
    );
    assert.ok(site.attemptedAt, `${id}: hunts are dated`);
    for (const social of ["facebook.com", "twitter.com", "x.com", "instagram.com", "actblue.com", "winred.com"]) {
      assert.ok(
        !site.url.includes(social),
        `${id}: a social/donation page is not the campaign site`,
      );
    }
  }
});

test("the photo manifest ships nothing without a license, and records its misses", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "official-photos.json"), "utf8"),
  ) as {
    photos: { officeholderId: string; url: string; sourceUrl: string; license: string | null }[];
    missing: { officeholderId: string; reason: string; attemptedAt: string }[];
  };

  assert.ok(manifest.photos.length > 0, "zero photos is a finding, not a state to pass");
  for (const photo of manifest.photos) {
    assert.ok(photo.license, `${photo.officeholderId}: unknown license is not shippable (D20)`);
    assert.ok(photo.sourceUrl, `${photo.officeholderId}: source recorded per image`);
    assert.ok(photo.url.startsWith("/officials/"), "served from our origin, never hotlinked");
    // The committed image actually exists — a manifest row without bytes
    // would render a broken image, which the rule forbids.
    readFileSync(join(ROOT, "public", photo.url));
  }
  for (const miss of manifest.missing) {
    assert.ok(miss.reason.length > 0, "every absence carries its reason");
    assert.ok(miss.attemptedAt, "every attempt is dated");
  }
});

test("contact fields survive the lookup to the surface", () => {
  const set: OfficeholderSet = {
    scope: "test",
    generatedAt: "2026-08-14T00:00:00.000Z",
    officeholders: [
      {
        id: "test:1",
        name: "Test Person",
        officeTitle: "State Representative",
        level: "STATE",
        termStart: "",
        termEnd: "",
        partyLabel: null,
        websiteUrl: "https://example.gov/member",
        contactFormUrl: null,
        phone: "555-0100",
        email: "person@example.gov",
        campaignUrl: null,
        photo: null,
        provenance: {
          sourceUrl: "https://example.gov/roster",
          sourceOrg: "test",
          collectedAt: "2026-08-14T00:00:00.000Z",
          verifiedAt: null,
        },
      },
    ],
    divisions: [
      {
        officeholderId: "test:1",
        ocdId: "ocd-division/country:us/state:az/sldl:20",
        bodyId: null,
      },
    ],
    unmatched: [],
  };

  const index = indexByDivision(
    [set],
    new Map([["test:1", "/officials/test.jpg"]]),
  );
  const holder = index.get("ocd-division/country:us/state:az/sldl:20")?.[0];
  assert.ok(holder);
  assert.equal(holder.email, "person@example.gov");
  assert.equal(holder.phone, "555-0100");
  assert.equal(holder.photoUrl, "/officials/test.jpg");
});

test("the corpus is append-only in shape and never merges votes", () => {
  const corpus = JSON.parse(
    readFileSync(join(ROOT, "data", "corpus", "statements.json"), "utf8"),
  ) as { snapshots: Record<string, unknown>[] };

  assert.ok(corpus.snapshots.length > 0, "the corpus should hold snapshots after the fill");
  for (const snap of corpus.snapshots) {
    assert.ok(snap.contentHash, "content-addressed");
    assert.ok(snap.retrievedAt, "dated");
    assert.ok(
      snap.kind === "CAMPAIGN_SITE" || snap.kind === "OFFICIAL_PAGE",
      "statements only — votes live in their own store, never here",
    );
    // The neutrality guard family: no snapshot may carry an evaluation.
    for (const banned of ["score", "rank", "rating", "match", "fit", "grade", "alignment", "recommendation"]) {
      assert.ok(!(banned in snap), `corpus snapshot must not carry "${banned}"`);
    }
  }
});
