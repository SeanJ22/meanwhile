import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_ROSTERS,
  divisionOcdIdForRosterHolder,
} from "../lib/registry/body-rosters.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import { EVERYDAY_CONTACTS } from "../lib/routing/everyday.ts";
import {
  DIVISION_OFFICE_BLURBS,
  OFFICE_BLURBS,
  blurbForTitle,
} from "../lib/officials/office-blurbs.ts";

/**
 * The cross-jurisdiction guard (session item 1, wall clock 2026-08-14
 * second session) — the uniqueness invariant's sibling in curated data.
 *
 * The Rockaway Township mayor rendered with Tucson's charter copy and a
 * hyperlink to Tucson's charter, because the per-office-TYPE blurb had
 * been written for one specific city. One jurisdiction's content bound to
 * another jurisdiction's key — the same shape as the D40 cache-key bug,
 * in curated words instead of a join.
 *
 * The rule: no curated official's rendered content may reference a
 * jurisdiction outside their own. Checked mechanically with per-state
 * marker lists (place names as word-bounded regexes, official domains,
 * phone area codes) covering everything the four zips render. A marker
 * list is deliberately dumb — it will need a row when coverage grows,
 * and that edit is the audit trail.
 */

type StateCode = "az" | "nj" | "nh";

/** Markers that identify each state's jurisdictions: place-name words,
 *  official domains. Word-bounded when matched, so "Morrison" never trips
 *  "morris" and "available" never trips "vail". */
const STATE_MARKERS: Record<StateCode, readonly string[]> = {
  az: [
    "tucson",
    "pima",
    "tusd",
    "amphi",
    "sunnyside",
    "marana",
    "vail",
    "tucsonaz",
    "arizona",
  ],
  nj: ["rockaway", "morris", "rockawaytownship", "jersey"],
  nh: [
    "newbury",
    "kearsarge",
    "merrimack",
    "boscawen",
    "hampshire",
    "gencourt",
  ],
};

/** Local-government phone area codes per covered state. A curated local
 *  official's phone must carry their own state's area code. */
const STATE_AREA_CODES: Record<StateCode, readonly string[]> = {
  az: ["520", "602", "480", "928"],
  nj: ["973", "862", "201", "609", "856", "908"],
  nh: ["603"],
};

function stateOfOcdId(ocdId: string): StateCode | null {
  const match = ocdId.match(/\/state:([a-z]{2})\//);
  return match ? (match[1] as StateCode) : null;
}

function foreignMarkers(own: StateCode): RegExp[] {
  return (Object.keys(STATE_MARKERS) as StateCode[])
    .filter((s) => s !== own)
    .flatMap((s) => STATE_MARKERS[s])
    .map((m) => new RegExp(`\\b${m}\\b`, "i"));
}

function assertNoForeignMarker(
  own: StateCode,
  text: string | null | undefined,
  where: string,
) {
  if (!text) return;
  for (const marker of foreignMarkers(own)) {
    assert.ok(
      !marker.test(text),
      `${where}: "${text}" references a jurisdiction outside ${own} (${marker})`,
    );
  }
}

function areaCodeOf(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null; // extensions-only, 311-style service codes, malformed
}

test("no curated roster carries another jurisdiction's content", () => {
  assert.ok(BODY_ROSTERS.length > 0, "rosters exist");
  for (const roster of BODY_ROSTERS) {
    const own = stateOfOcdId(roster.bodyId);
    assert.ok(own, `roster ${roster.bodyId} has a resolvable state`);
    assertNoForeignMarker(own, roster.bodyName, `${roster.bodyId} bodyName`);
    assertNoForeignMarker(own, roster.sourceUrl, `${roster.bodyId} sourceUrl`);
    assertNoForeignMarker(own, roster.sourceOrg, `${roster.bodyId} sourceOrg`);
    for (const member of roster.members) {
      const where = `${roster.bodyId} member ${member.name}`;
      assertNoForeignMarker(own, member.officeTitle, `${where} title`);
      assertNoForeignMarker(own, member.termNote, `${where} termNote`);
      assertNoForeignMarker(own, member.email, `${where} email`);
      assertNoForeignMarker(own, member.websiteUrl, `${where} websiteUrl`);
      if (member.phone) {
        const area = areaCodeOf(member.phone);
        if (area) {
          assert.ok(
            STATE_AREA_CODES[own].includes(area),
            `${where}: phone ${member.phone} carries area code ${area}, not a ${own} code`,
          );
        }
      }
    }
  }
});

test("the office blurb a roster member renders never references a foreign jurisdiction", () => {
  for (const roster of BODY_ROSTERS) {
    const own = stateOfOcdId(roster.bodyId);
    assert.ok(own);
    for (const member of roster.members) {
      const blurb = blurbForTitle(
        member.officeTitle,
        divisionOcdIdForRosterHolder(member.id),
      );
      if (!blurb) continue;
      const where = `${roster.bodyId} member ${member.name} blurb`;
      // A division-specific blurb may name the member's OWN place; a
      // generic one may name no covered place at all. Both reduce to:
      // nothing foreign.
      assertNoForeignMarker(own, blurb.text, `${where} text`);
      assertNoForeignMarker(own, blurb.basis, `${where} basis`);
      assertNoForeignMarker(own, blurb.basisUrl, `${where} basisUrl`);
    }
  }
});

test("the regression itself: Rockaway's mayor gets no Tucson content, Tucson's mayor keeps her verified charter blurb", () => {
  const rockaway = BODY_ROSTERS.find((r) =>
    r.bodyId.includes("place:rockaway_township"),
  );
  assert.ok(rockaway, "Rockaway Township roster exists");
  const rockawayMayor = rockaway.members.find(
    (m) => m.officeTitle === "Mayor",
  );
  assert.ok(rockawayMayor, "Rockaway Township has a mayor on the roster");
  const njBlurb = blurbForTitle(
    rockawayMayor.officeTitle,
    divisionOcdIdForRosterHolder(rockawayMayor.id),
  );
  assert.ok(njBlurb, "the Rockaway mayor still gets an office blurb");
  assert.ok(!/tucson/i.test(njBlurb.text), "no Tucson copy on the NJ mayor");
  assert.ok(!/tucson/i.test(njBlurb.basis));
  assert.ok(
    !njBlurb.basisUrl || !/tucson/i.test(njBlurb.basisUrl),
    "no Tucson link on the NJ mayor",
  );

  const tucson = BODY_ROSTERS.find(
    (r) => r.bodyId === "ocd-division/country:us/state:az/place:tucson#governing",
  );
  assert.ok(tucson, "Tucson roster exists");
  const tucsonMayor = tucson.members.find((m) => m.officeTitle === "Mayor");
  assert.ok(tucsonMayor, "Tucson has a mayor on the roster");
  const azBlurb = blurbForTitle(
    tucsonMayor.officeTitle,
    divisionOcdIdForRosterHolder(tucsonMayor.id),
  );
  assert.ok(azBlurb);
  assert.ok(
    /In Tucson, the day-to-day work/.test(azBlurb.text),
    "Tucson keeps the charter-verified council-manager sentence",
  );
});

test("generic per-office-type blurbs name no covered jurisdiction — per-place truth lives only in DIVISION_OFFICE_BLURBS", () => {
  // Two deliberate exceptions: single-state offices whose blurb IS about
  // that state's law (NH executive councilor / register of probate, AZ
  // mine inspector). Their statutes are the office's identity, not a
  // leak — but place names below the state level are still forbidden.
  const placeMarkers = [
    "tucson",
    "pima",
    "tusd",
    "rockaway",
    "morris",
    "newbury",
    "kearsarge",
    "merrimack",
  ].map((m) => new RegExp(`\\b${m}\\b`, "i"));
  for (const [type, blurb] of Object.entries(OFFICE_BLURBS)) {
    for (const marker of placeMarkers) {
      assert.ok(
        !marker.test(blurb.text) &&
          !marker.test(blurb.basis) &&
          !marker.test(blurb.basisUrl ?? ""),
        `generic blurb for ${type} names a specific place (${marker}) — move it to DIVISION_OFFICE_BLURBS`,
      );
    }
  }
  // And every division-specific entry actually names a real division key.
  for (const entry of DIVISION_OFFICE_BLURBS) {
    assert.ok(
      entry.divisionOcdId.startsWith("ocd-division/country:us/"),
      `division blurb key ${entry.divisionOcdId} is a full OCD id`,
    );
  }
});

test("curated bodies carry no foreign-jurisdiction content", () => {
  for (const body of CURATED_BODIES) {
    const own = body.ocdId ? stateOfOcdId(body.ocdId) : stateOfOcdId(body.id);
    if (!own) continue; // division-less curated ids carry their state inline
    assertNoForeignMarker(own, body.name, `${body.id} name`);
    assertNoForeignMarker(own, body.homepageUrl, `${body.id} homepageUrl`);
    assertNoForeignMarker(own, body.agendaSourceRef, `${body.id} agendaSourceRef`);
    assertNoForeignMarker(
      own,
      body.provenance?.sourceUrl ?? null,
      `${body.id} provenance.sourceUrl`,
    );
  }
});

test("everyday contacts serve only their own state's zips", () => {
  const ZIP_STATE: Record<string, StateCode> = {
    "85701": "az",
    "85641": "az",
    "07866": "nj",
    "03255": "nh",
  };
  for (const contact of EVERYDAY_CONTACTS) {
    const states = new Set(contact.zips.map((z) => ZIP_STATE[z]));
    assert.equal(
      states.size,
      1,
      `${contact.topicId} contact spans states: ${[...contact.zips].join(", ")}`,
    );
    const own = [...states][0];
    assert.ok(own, `${contact.topicId} zips resolve to a covered state`);
    const where = `${contact.topicId} @ ${contact.zips.join(",")}`;
    assertNoForeignMarker(own, contact.body, `${where} body`);
    assertNoForeignMarker(own, contact.service, `${where} service`);
    assertNoForeignMarker(own, contact.note, `${where} note`);
    assertNoForeignMarker(own, contact.requestUrl, `${where} requestUrl`);
    assertNoForeignMarker(own, contact.sourceUrl, `${where} sourceUrl`);
    assertNoForeignMarker(own, contact.sourceOrg, `${where} sourceOrg`);
    if (contact.phone) {
      const area = areaCodeOf(contact.phone);
      if (area) {
        assert.ok(
          STATE_AREA_CODES[own].includes(area),
          `${where}: phone ${contact.phone} carries area code ${area}, not a ${own} code`,
        );
      }
    }
  }
});
