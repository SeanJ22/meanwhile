/** A body is described by what it is, never by what shares its division. Bodies that were right stay right; the negative controls come first. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BODY_KINDS,
  BODY_KIND_DEFINITIONS,
  bodyKindDefinitionFor,
  definitionsForBody,
  isDivisionsOwnGovernment,
} from "../lib/officials/body-definitions.ts";
import type { BodyDivisionType } from "../lib/officials/body-description.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface RegistryDivision {
  ocdId: string;
  divisionType: string;
  lsad: string | null;
}
interface RegistryBody {
  id: string;
  ocdId: string | null;
  name: string | null;
  bodyOrigin: string;
  coverageStatus: string;
}

const registry = JSON.parse(
  readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
) as { divisions: RegistryDivision[]; bodies: RegistryBody[] };

const DIVISION = new Map(registry.divisions.map((d) => [d.ocdId, d]));

/** The whole answer for one registry body, exactly as the card asks for it. */
function definitionsFor(body: RegistryBody) {
  const division = body.ocdId === null ? null : (DIVISION.get(body.ocdId) ?? null);
  return definitionsForBody({
    bodyId: body.id,
    ocdId: body.ocdId,
    divisionType: (division?.divisionType ?? "place") as BodyDivisionType,
    lsad: division?.lsad ?? null,
    // The Census dependency classification is not loaded here: every branch of it yields a non-null class definition.
  });
}

function bodyById(id: string): RegistryBody {
  const body = registry.bodies.find((b) => b.id === id);
  assert.ok(body, `${id} is not in the registry — the test's subject moved, not the code`);
  return body;
}

const PIMA = "ocd-division/country:us/state:az/county:pima";
const CAWCD = `${PIMA}#central-arizona-water-conservation-district`;
const PIMA_BOARD = `${PIMA}#governing`;

test("DATA-4: the county's OWN board keeps the county class definition and § 11-251", () => {
  const answer = definitionsFor(bodyById(PIMA_BOARD));
  assert.equal(answer.classKey, "county");
  assert.ok(answer.classDefinition, "Pima County's own board lost its class definition");
  assert.match(answer.formDefinition?.basis ?? "", /11-251/);
  assert.match(answer.formDefinition?.text ?? "", /county budget and property tax rate/);
});

test("DATA-4: every body the registry DERIVED from its division still gets a class definition", () => {
  /* Bodies derived from their division are its government by construction; the count is computed so it tracks the registry. */
  const derived = registry.bodies.filter((b) => b.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE");
  assert.ok(derived.length > 500, `only ${derived.length} derived bodies — the filter found nothing`);

  const silenced = derived.filter((b) => definitionsFor(b).classDefinition === null);
  assert.deepEqual(
    silenced.map((b) => b.id).slice(0, 10),
    [],
    `${silenced.length} of ${derived.length} division-derived bodies lost their class definition`,
  );
});

test("DATA-4: CAWCD is not described as a county, and cites no county statute", () => {
  const answer = definitionsFor(bodyById(CAWCD));

  // Read BOTH layers out before asserting either is null: the assertion
  // narrows the type to `never`, and a check written after it would compile
  // into a check of nothing.
  const cited = `${answer.classDefinition?.basis ?? ""} ${answer.formDefinition?.basis ?? ""}`;
  const said = `${answer.classDefinition?.text ?? ""} ${answer.formDefinition?.text ?? ""}`;

  assert.equal(answer.classKey, null, "CAWCD still resolves to a division's class");
  assert.equal(answer.classDefinition, null, "CAWCD still carries the county class definition");
  assert.ok(!/11-251/.test(cited), `CAWCD still cites A.R.S. § 11-251: ${cited}`);

  for (const claim of [
    /county budget and property tax rate/,
    /the jail/,
    /county hospital/,
    /outside any city or town/,
  ]) {
    assert.ok(!claim.test(said), `CAWCD is still described with a county's powers: ${claim}`);
  }

  // And it says what it actually is, from the statute that creates it.
  assert.match(answer.formDefinition?.basis ?? "", /48-3708/);
  assert.match(answer.formDefinition?.text ?? "", /multi-county water conservation district/);
});

test("DATA-4: no body that is not its division's own government cites its division's statute", () => {
  /* The class sweep: no body that is not its division's own government inherits a class definition. */
  const attached = registry.bodies.filter(
    (b) => b.ocdId !== null && b.bodyOrigin !== "DERIVED_FROM_DIVISION_TYPE",
  );
  assert.ok(attached.length > 100, `only ${attached.length} attached bodies — the filter found nothing`);

  const inheriting = attached.filter((b) => definitionsFor(b).classDefinition !== null);
  assert.deepEqual(
    inheriting.map((b) => `${b.name ?? b.id}`).slice(0, 10),
    [],
    `${inheriting.length} bodies still inherit a class definition from a government that merely shares their ground`,
  );
});

test("DATA-4: the id grammar and bodyOrigin agree on EVERY body in the registry", () => {
  /* isDivisionsOwnGovernment reads the id grammar; it is checked against bodyOrigin over every body. */
  const disagreements: string[] = [];
  for (const body of registry.bodies) {
    const division = body.ocdId === null ? null : (DIVISION.get(body.ocdId) ?? null);
    const grammar = isDivisionsOwnGovernment(
      body.id,
      body.ocdId,
      (division?.divisionType ?? "place") as BodyDivisionType,
    );
    const origin = body.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE";
    if (grammar !== origin) disagreements.push(`${body.id} grammar=${grammar} origin=${origin}`);
  }
  assert.deepEqual(disagreements.slice(0, 10), [], `${disagreements.length} disagreement(s)`);
});

test("DATA-4: a LIVE body with a null ocdId is described from its own statute", () => {
  /* A live body with no division whose board is the county board ex officio must still never be described as a county. */
  const rockingK = definitionsFor(bodyById("curated:az/pima-rocking-k-south-cfd#governing"));
  assert.equal(rockingK.classDefinition, null, "a body with no division may not get a class line");
  assert.equal(rockingK.classKey, null);
  assert.match(rockingK.formDefinition?.basis ?? "", /48-709/);
  assert.match(rockingK.formDefinition?.text ?? "", /community facilities district/);
  const said = rockingK.formDefinition?.text ?? "";
  assert.ok(!/county budget/.test(said) && !/the jail/.test(said), "described as a county");

  const pcc = definitionsFor(bodyById("curated:az/pima-community-college#governing"));
  assert.equal(pcc.classDefinition, null);
  assert.match(pcc.formDefinition?.basis ?? "", /15-1444/);
  assert.match(pcc.formDefinition?.text ?? "", /community college/);
  assert.ok(
    !/school district/i.test(pcc.formDefinition?.text ?? "") ||
      /not a school district/i.test(pcc.formDefinition?.text ?? ""),
    "a community college district may not be described as a school district",
  );
});

test("DATA-4: the null-ocdId floor still refuses a placeholder divisionType", () => {
  /* "place" is the placeholder for a body with no division, and it must never resolve to the municipality class. */
  const answer = definitionsForBody({
    bodyId: "wtp-body/country:us/state:nj/southeast_regional_council#governing",
    ocdId: null,
    divisionType: "place",
    lsad: null,
  });
  assert.equal(answer.classDefinition, null);
  assert.equal(answer.classKey, null);
  assert.equal(answer.formDefinition, null);
  assert.equal(answer.unreadNote, null, "an apology with no description above it is the refusal again");
});

test("DATA-4: every body-kind row carries a citation, a URL and the date it was read", () => {
  for (const row of BODY_KIND_DEFINITIONS) {
    assert.ok(row.definition.text.length > 120, `${row.kind}: the text is too short to be a description`);
    assert.ok(row.definition.basis.length > 10, `${row.kind}: no basis`);
    assert.ok(row.definition.basisUrl, `${row.kind}: no basisUrl — pnpm definitions:verify cannot check it`);
    assert.match(row.definition.readOn, /^\d{4}-\d{2}-\d{2}$/, `${row.kind}: readOn is not a date`);
    assert.match(row.state, /^[a-z]{2}$/, `${row.kind}: a body kind is state-scoped`);
  }
});

test("DATA-4: every body-kind assignment names a body that exists and resolves to a row", () => {
  /* Both directions: no row points at a missing body, and no assignment's kind lacks a definition for that body's state. */
  const ids = new Set(registry.bodies.map((b) => b.id));
  const dangling = BODY_KINDS.filter((r) => !ids.has(r.bodyId)).map((r) => r.bodyId);
  assert.deepEqual(dangling, [], "these body-kind rows name bodies the registry does not have");

  const unresolved = BODY_KINDS.filter((r) => {
    const body = registry.bodies.find((b) => b.id === r.bodyId)!;
    return bodyKindDefinitionFor(r.bodyId, body.ocdId) === null;
  }).map((r) => `${r.bodyId} -> ${r.kind}`);
  assert.deepEqual(unresolved, [], "these assignments resolve to no definition, so they render as a gap");
});

test("DATA-4: the honest denominator is reported over ALL bodies, not over the ones that pass a filter", () => {
  /* The denominator is the whole registry, never a population filtered by the same rule as the numerator. */
  const all = registry.bodies.length;
  const described = registry.bodies.filter((b) => {
    const answer = definitionsFor(b);
    return answer.classDefinition !== null || answer.formDefinition !== null;
  });
  const noDivision = registry.bodies.filter((b) => b.ocdId === null);

  assert.ok(noDivision.length > 0, "the registry says every body has a division; the split is gone");
  assert.ok(
    described.length < all,
    `${described.length} of ${all} — a definition layer that describes every body is a layer nobody can measure`,
  );
  // The population must be established before the fraction is reportable at all.
  assert.ok(all > 1000, `denominator ${all} — the registry did not load`);
});
