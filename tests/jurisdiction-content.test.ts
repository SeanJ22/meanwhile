import assert from "node:assert/strict";
import test from "node:test";

import {
  BODY_ROSTERS,
  divisionOcdIdForRosterHolder,
} from "../lib/registry/body-rosters.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import { EVERYDAY_CONTACTS, everydayContactsFor } from "../lib/routing/everyday.ts";
import { TOPIC_ROUTES } from "../lib/routing/topics.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";
import { coverageAt } from "../lib/registry/server.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import {
  DIVISION_OFFICE_BLURBS,
  OFFICE_BLURBS,
  blurbForTitle,
} from "../lib/officials/office-blurbs.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

/**
 * No curated official's rendered content may reference a jurisdiction outside their own, checked with per-state
 * marker lists (place names as word-bounded regexes, official domains, phone area codes). A marker list needs a
 * row when coverage grows.
 */

type StateCode = "az" | "nj" | "nh";

/** Markers that identify each state's jurisdictions: place-name words and official domains, word-bounded when matched. */
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

/**
 * The ask box's shared templates name no covered place, and the answer as rendered at each covered zip carries
 * nothing from another state in any sentence or link.
 */

const ZIP_STATE: Record<string, StateCode> = {
  "85701": "az",
  "85641": "az",
  "07866": "nj",
  "03255": "nh",
};

test("topic explainer templates name no covered place — per-place truth lives only in divisionWhy", () => {
  const placeMarkers = [
    ...STATE_MARKERS.az,
    ...STATE_MARKERS.nj,
    ...STATE_MARKERS.nh,
  ]
    // State names themselves are allowed in a template only if no template
    // uses them; keeping them in the list is the stricter reading and
    // nothing currently trips it.
    .map((m) => new RegExp(`\\b${m}\\b`, "i"));
  assert.ok(TOPIC_ROUTES.length > 0, "routes exist");
  for (const route of TOPIC_ROUTES) {
    const shared = [
      route.label,
      route.basis,
      ...route.examples,
      ...route.steps.map((s) => s.why),
    ];
    for (const text of shared) {
      for (const marker of placeMarkers) {
        assert.ok(
          !marker.test(text),
          `topic ${route.id}: shared template "${text}" names a specific place (${marker}) — move it to the step's divisionWhy`,
        );
      }
    }
    // Every override keys on a real OCD id, and its copy belongs to that
    // division's own state.
    for (const step of route.steps) {
      for (const override of step.divisionWhy ?? []) {
        assert.ok(
          override.divisionOcdId.startsWith("ocd-division/country:us/"),
          `topic ${route.id}: divisionWhy key ${override.divisionOcdId} is a full OCD id`,
        );
        const own = stateOfOcdId(override.divisionOcdId);
        assert.ok(own, `topic ${route.id}: ${override.divisionOcdId} resolves to a state`);
        assertNoForeignMarker(
          own,
          override.why,
          `topic ${route.id} divisionWhy ${override.divisionOcdId}`,
        );
        assertNoForeignMarker(
          own,
          override.basis ?? null,
          `topic ${route.id} divisionWhy ${override.divisionOcdId} basis`,
        );
      }
    }
  }
});

test("the regression itself: every ask-box answer at every covered zip is free of another state's content and links", async () => {
  let checkedAnswers = 0;
  let checkedStrings = 0;
  for (const [zip, own] of Object.entries(ZIP_STATE) as [string, StateCode][]) {
    const centroid = lookupZcta(zip);
    assert.ok(centroid, `${zip} has a centroid`);
    const coverage = await coverageAt(centroid.lat, centroid.lng, 0);
    for (const route of TOPIC_ROUTES) {
      const answer = resolveRouting(route.id, coverage);
      assert.equal(answer.kind, "ROUTED", `${zip}/${route.id} routes`);
      checkedAnswers++;
      const strings: [string, string | null][] = [];
      for (const [i, step] of answer.steps.entries()) {
        strings.push([`${zip}/${route.id} step${i} why`, step.why]);
        strings.push([`${zip}/${route.id} step${i} gap`, step.gap]);
        for (const body of step.bodies) {
          strings.push([`${zip}/${route.id} step${i} body label`, body.label]);
          // The link target matters as much as the text.
          strings.push([`${zip}/${route.id} step${i} body link`, body.homepageUrl]);
        }
        for (const person of step.people) {
          strings.push([`${zip}/${route.id} step${i} person`, person.name]);
          strings.push([`${zip}/${route.id} step${i} person title`, person.officeTitle]);
          strings.push([`${zip}/${route.id} step${i} person link`, person.sourceUrl]);
        }
      }
      for (const contact of everydayContactsFor(route.id, zip)) {
        strings.push([`${zip}/${route.id} contact body`, contact.body]);
        strings.push([`${zip}/${route.id} contact service`, contact.service]);
        strings.push([`${zip}/${route.id} contact note`, contact.note]);
        strings.push([`${zip}/${route.id} contact request link`, contact.requestUrl]);
        strings.push([`${zip}/${route.id} contact source link`, contact.sourceUrl]);
        strings.push([`${zip}/${route.id} contact source org`, contact.sourceOrg]);
      }
      for (const [where, text] of strings) {
        if (text) checkedStrings++;
        assertNoForeignMarker(own, text, where);
      }
    }
  }
  // The denominator, stated: a silently empty audit is not a passing audit.
  assert.equal(
    checkedAnswers,
    Object.keys(ZIP_STATE).length * TOPIC_ROUTES.length,
    "every topic was resolved at every covered zip",
  );
  assert.ok(
    checkedStrings > 200,
    `the audit read ${checkedStrings} rendered strings — too few to have covered the answers`,
  );
});

test("the sourced Pima library fact reaches Pima readers and nobody else", async () => {
  const az = lookupZcta("85701");
  const nh = lookupZcta("03255");
  assert.ok(az && nh);
  const azAnswer = resolveRouting(
    "libraries",
    await coverageAt(az.lat, az.lng, 0),
  );
  const nhAnswer = resolveRouting(
    "libraries",
    await coverageAt(nh.lat, nh.lng, 0),
  );
  assert.ok(
    /county Board of Supervisors sits as its board/.test(azAnswer.steps[1].why),
    "Pima's reader keeps the sourced, division-specific sentence",
  );
  assert.ok(
    !/\bpima\b/i.test(nhAnswer.steps[1].why),
    "the New Hampshire reader is told about no Arizona county",
  );
  assert.ok(
    nhAnswer.steps[1].bodies.every(
      (b) => !b.homepageUrl || /\bnh\b|newhampshire|merrimack/i.test(b.homepageUrl),
    ),
    "every link on the New Hampshire answer resolves inside New Hampshire",
  );
});

test("everyday contacts serve only their own state's zips", () => {
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
