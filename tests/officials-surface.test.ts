import assert from "node:assert/strict";
import test from "node:test";

import { CAMPAIGN_SITES } from "../lib/officials/campaign-sites.ts";
import {
  OFFICE_BLURBS,
  blurbForTitle,
  officeTypeForTitle,
} from "../lib/officials/office-blurbs.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

test("every office blurb speaks the product's register", () => {
  for (const [type, blurb] of Object.entries(OFFICE_BLURBS)) {
    // Second person, present tense — the neighbor explaining, not a statute.
    assert.ok(
      /\b[Yy]our?\b/.test(blurb.text),
      `${type}: blurb must address the reader ("your")`,
    );
    // The wonk words the register forbids.
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
    // An unmapped title renders no blurb rather than a guessed one, but these must always map.
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
        birthDate: null,
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
