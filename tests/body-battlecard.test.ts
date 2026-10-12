import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BODY_BLURBS,
  DIVISION_BODY_BLURBS,
  NO_BODY_BLURB_LINE,
  blurbForBody,
} from "../lib/officials/body-description.ts";

/* The body battlecard renders every applicable section with either content or an honest line. */

const ROOT = process.cwd();
const PIMA = "ocd-division/country:us/state:az/county:pima";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified";

test("M136: the three named bodies each get a sourced role, not a generated one", () => {
  const cases = [
    { ocdId: PIMA, type: "county" as const, basis: /11-251/ },
    { ocdId: TUCSON, type: "place" as const, basis: /Charter/i },
    { ocdId: TUSD, type: "school_district" as const, basis: /15-341/ },
  ];
  for (const c of cases) {
    const blurb = blurbForBody(c.ocdId, c.type);
    assert.ok(blurb, `${c.ocdId} has no role blurb — section 2 would be empty for a named test body`);
    assert.match(blurb.basis, c.basis, `${c.ocdId} cites the wrong law`);
    assert.ok(
      blurb.basisUrl && /^https:\/\//.test(blurb.basisUrl),
      `${c.ocdId} cites a law with no reachable URL — a citation a reader cannot follow`,
    );
    assert.match(blurb.readOn, /^\d{4}-\d{2}-\d{2}$/, `${c.ocdId} has no read date`);
  }
});

test("M136: Tucson's own entry wins over the state-level one", () => {
  // Tucson is a charter council-manager city. A generic Arizona municipal
  // answer would say its council runs the city, which is false there — the
  // same trap DIVISION_OFFICE_BLURBS exists for on the mayor's card.
  const tucson = blurbForBody(TUCSON, "place");
  assert.ok(tucson);
  assert.match(tucson.text, /city manager/i, "Tucson's council-manager form is not stated");
  assert.ok(
    !BODY_BLURBS.some((r) => r.state === "az" && r.divisionType === "place"),
    "a generic Arizona municipal blurb appeared — it would be wrong for every " +
      "charter city that is not council-manager, and silently so",
  );
});

test("M136: a body with no read statute gets the honest line, never a paraphrase", () => {
  // Covered bodies whose enabling law has not been read.
  for (const ocdId of [
    "ocd-division/country:us/state:nh/county:merrimack",
    "ocd-division/country:us/state:nh/place:newbury",
    "ocd-division/country:us/state:nh/school_district:kearsarge_regional",
  ]) {
    const type = ocdId.includes("county:")
      ? ("county" as const)
      : ocdId.includes("place:")
        ? ("place" as const)
        : ("school_district" as const);
    assert.equal(
      blurbForBody(ocdId, type),
      null,
      `${ocdId} grew a blurb from somewhere — every entry must be a read statute`,
    );
  }
  assert.match(NO_BODY_BLURB_LINE, /we haven't/i);
  // The line describes OUR research, never the body. "This body has no defined
  // powers" would be a claim about a government we did not check.
  assert.ok(
    !/this body (has|does) not/i.test(NO_BODY_BLURB_LINE),
    "the absence line makes a claim about the body rather than about us",
  );
});

test("M136: every blurb carries a checkable basis — no unsourced prose anywhere", () => {
  const all = [
    ...BODY_BLURBS.map((r) => r.blurb),
    ...DIVISION_BODY_BLURBS.map((r) => r.blurb),
  ];
  assert.ok(all.length > 0, "the library is empty");
  for (const blurb of all) {
    assert.ok(blurb.text.length > 80, "a blurb too short to explain anything");
    assert.ok(blurb.basis.length > 0, "a blurb with no cited basis");
    assert.match(blurb.readOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("M136: the card renders the same SET of sections for every body", () => {
  /* A section is never hidden for lack of content: an empty section collapses closed with its honest line inside. */
  const source = readFileSync(
    join(ROOT, "components/map/popup/entity-modal.tsx"),
    "utf8",
  );

  for (const id of ["what", "representation", "meetings", "contact", "jurisdiction", "sources"]) {
    assert.ok(
      source.includes(`id: "${id}"`),
      `the body card lost its "${id}" section`,
    );
  }

  // The absence line renders INSIDE the section, and the section is never
  // conditional on having content.
  assert.match(
    source,
    /section\.content \?\? <WorkingOnIt/,
    "a section stopped using the shared gap state (FE-29)",
  );
  assert.ok(
    !/sections\s*\.filter\(/.test(source),
    "sections are being filtered — an empty section must still render",
  );

  // Sections and tabs are mutually exclusive: a card carrying both would say
  // everything twice.
  assert.match(source, /\{subject\.bodyCard \?/, "the body card no longer picks the section grammar");
});

test("M136: the body card orders meetings upcoming-first from one clock", () => {
  const source = readFileSync(
    join(ROOT, "components/map/popup/entity-modal.tsx"),
    "utf8",
  );
  assert.match(source, /orderByUpcomingFirst\(subject\.meetings, now\)/);
  // The stated count and the ordering must read the same instant, or the
  // header's "N upcoming" can disagree with the block underneath it.
  assert.match(source, /hasConcluded\(m, now\)/);
  // Pinned at mount, not read during render: reading the clock in a render
  // body is impure (the lint catches it), and it would also let a re-render
  // reshuffle the list under a reader when a start time passes mid-session.
  assert.ok(
    /const \[now\] = useState\(\(\) => Date\.now\(\)\);/.test(source),
    "the card reads the clock during render, or reads it more than once",
  );
});

test("M136: a school district's superintendent is asked for and named when missing", () => {
  const entry = readFileSync(join(ROOT, "components/map/map-entry.tsx"), "utf8");
  assert.match(entry, /isSchoolDistrict: body\.divisionType === "school_district"/);
  assert.match(entry, /superintendent/i);

  const modal = readFileSync(
    join(ROOT, "components/map/popup/entity-modal.tsx"),
    "utf8",
  );
  // The gap says whose it is: hired by this board, not elected. A blank row
  // would read as "this district has no superintendent".
  assert.match(modal, /hired by this board, not elected/);
});

test("M136: the contact section never invents a route", () => {
  const entry = readFileSync(join(ROOT, "components/map/map-entry.tsx"), "utf8");
  const fn = entry.slice(entry.indexOf("function bodyContactRows"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    !/mailto:info@|@\$\{|`info@/.test(body),
    "a contact address is being pattern-built rather than sourced",
  );
  assert.match(body, /body\.homepageUrl/);
});
