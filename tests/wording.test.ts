import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agendaAbsenceNote,
  collapseFootnotes,
  stateOf,
} from "../lib/registry/wording.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

const NH = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const AZ = "ocd-division/country:us/state:az/county:pima";

test("the state comes off the identifier, never off a label", () => {
  assert.equal(stateOf(NH), "nh");
  assert.equal(stateOf(AZ), "az");
  assert.equal(stateOf(null), null);
  // A place merely named after a state must not read as that state.
  assert.equal(stateOf("ocd-division/country:us/state:nj/place:new_hampshire"), "nj");
});

test("DC and the territories are read as their own jurisdictions, exactly as lib/ocd/fips.ts mints them (2026-09-25)", () => {
  assert.equal(stateOf("ocd-division/country:us/district:dc/county:district_of_columbia"), "dc");
  assert.equal(stateOf("ocd-division/country:us/territory:pr/county:adjuntas_municipio/place:adjuntas_barrio_pueblo"), "pr");
  assert.equal(stateOf("ocd-division/country:us/territory:vi"), "vi");
  // Only the class the FIPS table gives: no `district:` or `territory:` segment names a state.
  assert.equal(stateOf("ocd-division/country:us/district:az"), null);
  assert.equal(stateOf("ocd-division/country:us/territory:dc"), null);
  // A school district's segment is not a jurisdiction's.
  assert.equal(stateOf("ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district"), "nh");
});

test("an exhausted New Hampshire search says the law does not require an agenda", () => {
  const note = agendaAbsenceNote(NH, "NO_SOURCE_FOUND")!;
  assert.match(note, /searched high and low/);
  assert.match(note, /New Hampshire does not require an agenda/);
  assert.ok(!/does require an agenda/.test(note.replace(/does not require/g, "")));
});

test("a body nobody searched never claims a search", () => {
  for (const status of ["NOT_ATTEMPTED", "KNOWN_UNCOVERED", "LIVE"] as const) {
    const note = agendaAbsenceNote(NH, status)!;
    assert.match(note, /New Hampshire does not require an agenda/, status);
    assert.ok(
      !/searched/i.test(note),
      `${status} must not claim a search happened`,
    );
  }
});

test("outside a no-agenda state, an unsearched body gets no note at all", () => {
  // Arizona requires the agenda posted, so there is no statutory fact to state.
  assert.equal(agendaAbsenceNote(AZ, "NOT_ATTEMPTED"), null);
  assert.equal(agendaAbsenceNote(AZ, "LIVE"), null);
});

test("outside New Hampshire an exhausted search owns the gap", () => {
  const note = agendaAbsenceNote(AZ, "NO_SOURCE_FOUND")!;
  assert.match(note, /searched high and low/);
  assert.ok(!/does not require an agenda/.test(note));
});

test("the statutory sentence now renders for real NH bodies", () => {
  const nhBodies = registry.bodies.filter(
    (b) => b.ocdId && stateOf(b.ocdId) === "nh",
  );
  assert.ok(nhBodies.length > 0, "the registry holds NH bodies");
  for (const body of nhBodies) {
    const note = agendaAbsenceNote(body.ocdId, body.coverageStatus as never);
    assert.ok(note, `${body.id} should carry the statutory sentence`);
    assert.match(note!, /New Hampshire does not require an agenda/);
  }
  // The diligence sentence still renders for nobody: no hunt is exhausted.
  const exhausted = registry.bodies.filter(
    (b) => b.coverageStatus === "NO_SOURCE_FOUND",
  );
  assert.equal(exhausted.length, 0);
});

test("identical footnotes collapse to one, naming every distinct body", () => {
  const bodies = [
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Kearsarge Regional School District", ocdId: "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district" },
  ];

  const collapsed = collapseFootnotes(bodies, (b) =>
    agendaAbsenceNote(b.ocdId, "NOT_ATTEMPTED"),
  );

  assert.equal(collapsed.length, 1, "the statutory sentence rendered more than once");
  assert.equal(
    collapsed[0].subjects,
    "Newbury town, Kearsarge Regional School District",
    "a repeated town was named repeatedly, or a body was dropped from the line",
  );
  assert.match(collapsed[0].note, /New Hampshire does not require an agenda/);
});

test("footnotes that differ stay separate, in the panel's own order", () => {
  const bodies = [
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Tucson city", ocdId: "ocd-division/country:us/state:az/place:tucson" },
  ];
  const collapsed = collapseFootnotes(bodies, (b) =>
    agendaAbsenceNote(b.ocdId, "NO_SOURCE_FOUND"),
  );
  assert.equal(collapsed.length, 2, "two different sentences were merged into one");
  assert.equal(collapsed[0].subjects, "Newbury town");
  assert.equal(collapsed[1].subjects, "Tucson city");
});

test("a body with nothing to say contributes no footnote at all", () => {
  const collapsed = collapseFootnotes(
    [{ divisionLabel: "Rockaway township", ocdId: "ocd-division/country:us/state:nj/place:rockaway" }],
    (b) => agendaAbsenceNote(b.ocdId, "LIVE"),
  );
  assert.deepEqual(collapsed, [], "an empty note became a rendered line");
});

test("F01 6.1: no reader surface calls an absence a gap in our research or data", async () => {
  const { readdirSync, readFileSync: read, statSync } = await import("node:fs");
  const { join: j } = await import("node:path");

  const roots = ["app", "components", "lib", "data"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = j(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(tsx?|json)$/.test(name)) continue;
      const text = read(p, "utf8");
      if (/gap in our (data|research)/i.test(text)) offenders.push(p);
    }
  };
  for (const r of roots) walk(j(process.cwd(), r));

  assert.deepEqual(
    offenders,
    [],
    `F01 6.1: the struck gap phrasing is back in ${offenders.length} file(s):\n${offenders.join("\n")}`,
  );
});

test("F01 6.2: an absence reads as the working-on-it sentence", async () => {
  const { readFileSync: read } = await import("node:fs");
  const { join: j } = await import("node:path");
  const surface = read(
    j(process.cwd(), "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  assert.ok(
    /<WorkingOnIt/.test(surface) &&
      !/not a statement that no vote happened/.test(surface),
    "the key-votes absence line is the working-on-it sentence (rulings §10), with no disclaimer",
  );
});

test("item 4: no reader surface refuses to describe a body or an office", async () => {
  const { readdirSync, readFileSync: read, statSync } = await import("node:fs");
  const { join: j } = await import("node:path");

  // The refusal, in the forms it has actually shipped in.
  const REFUSALS = [
    /so we can[’']?t describe it/i,
    /we[’']?re not going to describe it/i,
    /rather than guess,? we (?:won[’']?t|will not) describe/i,
  ];
  const roots = ["app", "components", "lib", "data"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = j(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(tsx?|json)$/.test(name)) continue;
      // This file quotes the removed copy.
      if (p.endsWith(j("lib", "officials", "body-definitions.ts"))) continue;
      const text = read(p, "utf8");
      for (const re of REFUSALS) if (re.test(text)) offenders.push(`${p} — ${re}`);
    }
  };
  for (const r of roots) walk(j(process.cwd(), r));

  assert.deepEqual(
    offenders,
    [],
    `the refusal clause is back in ${offenders.length} place(s):\n${offenders.join("\n")}`,
  );
});

test("item 4: the office and body absence lines keep their whose-gap attribution", async () => {
  const { readFileSync: read } = await import("node:fs");
  const { join: j } = await import("node:path");

  const sections = read(j(process.cwd(), "lib", "design", "card-sections.ts"), "utf8");
  assert.match(sections, /id: "office"[^\n]+emptyLine: copy\("copy.working"\)/,
    "the shared office section uses the approved Reader gap default");
  const entity = read(j(process.cwd(), "components", "map", "popup", "entity-modal.tsx"), "utf8");
  assert.match(entity, /<WorkingOnIt/,
    "a missing body definition remains an open Reader hunt");
});
