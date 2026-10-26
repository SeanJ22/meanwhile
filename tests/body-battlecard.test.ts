import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModalSubject } from "../components/map/popup/entity-modal.tsx";

import {
  BODY_BLURBS,
  DIVISION_BODY_BLURBS,
  blurbForBody,
} from "../lib/officials/body-description.ts";

/* Every body section keeps its own held facts or missing-information message. */

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

test("M136: a body with no read statute gets no invented paraphrase", () => {
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

test("each empty body section contains its own missing-information message and request link", async () => {
  const { EntityModal } = await import("../components/map/popup/entity-modal.tsx");
  const { DataProvider } = await import("../lib/state/data.tsx");
  const subject: ModalSubject = { subjectId: "held:body", subjectKind: "BODY", title: "Held board", subtitle: "County", tier: "local",
    facts: [], representation: [], representationNote: "", meetings: [], sources: [], bodyCard: {
      whatItDoes: { classDefinition: null, formDefinition: null, unreadNote: null }, superintendent: null, isSchoolDistrict: false,
      contact: [], jurisdiction: [],
    } };
  const data: Parameters<typeof DataProvider>[0]["value"] = { allMeetings: [], meetings: [], venues: [], result: null, location: null, drawnDistricts: [], dropped: 0,
    searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: "ZIP" };
  const html = renderToStaticMarkup(createElement(DataProvider, { value: data } as Parameters<typeof DataProvider>[0],
    createElement(EntityModal, { subject, embedded: true, onClose: () => {} }))).replaceAll("&#x27;", "'").replaceAll("’", "'");
  const sections = html.match(/<section\b[\s\S]*?<\/section>/g) ?? [];
  for (const title of ["What this body does", "Who sits on it", "Meetings", "Contact", "Where it governs"]) {
    const section = sections.find(markup => markup.includes(`>${title}</span>`));
    assert.ok(section, `The body card lost its ${title} section`);
    assert.ok(section.includes("We're working on getting this info"), title);
    assert.ok(section.includes("Want us to get this sooner?"), title);
  }
  assert.doesNotMatch(html, /Still gathering/);
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
  assert.match(modal, /<CardGapContribution[^>]*label="the superintendent"/);
});

test("M136: the contact section never invents a route", () => {
  const body = readFileSync(join(ROOT, "lib/registry/body-contact.ts"), "utf8");
  assert.ok(
    !/mailto:info@|@\$\{|`info@/.test(body),
    "a contact address is being pattern-built rather than sourced",
  );
  assert.match(body, /body\.homepageUrl/);
});
