import assert from "node:assert/strict";
import test from "node:test";

import {
  activeInstances,
  assertDenominatorMayCertify,
  bodiesForDivisions,
  checkInstanceUniverse,
  diagnosticWorkItemFor,
  generateInstances,
  loadZipBodyUniverses,
  retireExpiredInstances,
  type EnumerationDenominator,
  type FailureClass,
  type ReaderQuestionInstance,
  type ReaderQuestionTemplate,
} from "../lib/health/reader-question.ts";
import { EVERYDAY_ZIPS } from "../lib/routing/everyday.ts";

/**
 * READER QUESTIONS (WS-CONTRACT): instantiation against the real committed
 * registry, retirement as a recorded state, the instance-universe check, and
 * RULING 9 — a Census/NCES denominator refused for the governing-body layer.
 */

const NOW = "2026-08-30T12:00:00.000Z";

const BODY_TEMPLATE: ReaderQuestionTemplate = {
  id: "tmpl:next-meeting",
  questionClass: "GENERATED_FROM_REGISTRY",
  templateText: "When does [BODY] meet next?",
  placeholders: ["BODY"],
  applicability: { kind: "EVERY_BODY_IN_ZIP" },
};

const ZIP_TEMPLATE: ReaderQuestionTemplate = {
  id: "tmpl:adversarial-whole-zip",
  questionClass: "HAND_AUTHORED_ADVERSARIAL",
  templateText: "Which governments can a reader in [ZIP] see?",
  placeholders: ["ZIP"],
  applicability: { kind: "PER_ZIP" },
};

test("instantiation from the committed registry covers every pilot ZIP body", async () => {
  const universes = await loadZipBodyUniverses(EVERYDAY_ZIPS);
  assert.equal(universes.length, EVERYDAY_ZIPS.length);
  for (const universe of universes) {
    assert.ok(
      universe.bodies.length > 0,
      `pilot ZIP ${universe.zip} enumerates no bodies — the registry slice is empty`,
    );
  }

  const instances = generateInstances([BODY_TEMPLATE, ZIP_TEMPLATE], universes, NOW);

  // EVERY_BODY_IN_ZIP: one instance per (zip, body); PER_ZIP: one per zip.
  const expectedBodyInstances = universes.reduce((n, u) => n + u.bodies.length, 0);
  const bodyInstances = instances.filter((i) => i.templateId === BODY_TEMPLATE.id);
  const zipInstances = instances.filter((i) => i.templateId === ZIP_TEMPLATE.id);
  assert.equal(bodyInstances.length, expectedBodyInstances);
  assert.equal(zipInstances.length, EVERYDAY_ZIPS.length);

  for (const instance of bodyInstances) {
    assert.ok(instance.subjectBodyId, "a body-scoped instance carries its subject body id");
    // Plain language: no OCD-ID and no registry slug reaches question text.
    assert.ok(
      !instance.questionText.includes("ocd-division"),
      `question text leaks an OCD id: ${instance.questionText}`,
    );
    assert.ok(
      !instance.questionText.includes("[BODY]"),
      "the placeholder must render, never ship as its own token",
    );
    assert.equal(instance.status.state, "ACTIVE");
  }
});

test("bodiesForDivisions matches on ocdId and on alsoServesOcdIds (RULING 121)", () => {
  const spanning = {
    id: "ocd-division/country:us/state:nh/place:bradford#village-district",
    ocdId: "ocd-division/country:us/state:nh/place:bradford",
    alsoServesOcdIds: ["ocd-division/country:us/state:nh/place:newbury_town"],
    name: "Lake Todd Village District",
    bodyClass: "GOVERNING",
    bodyOrigin: "SOURCED",
    coverageStatus: "MANUAL",
    agendaSourceType: "NONE",
    agendaSourceRef: null,
    meetingCadence: null,
    homepageUrl: null,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY",
    provenance: { sourceUrl: null, sourceOrg: "test", collectedAt: NOW, verifiedAt: null },
  } as const;
  const viaPrimary = bodiesForDivisions([spanning.ocdId], [spanning]);
  const viaAlso = bodiesForDivisions(
    ["ocd-division/country:us/state:nh/place:newbury_town"],
    [spanning],
  );
  assert.equal(viaPrimary.length, 1);
  assert.equal(viaAlso.length, 1, "a body is visible from every division it also serves");
});

test("a passed window retires instances — recorded state, never deletion", () => {
  const universeStub = {
    zip: "03255",
    divisionIds: [],
    bodies: [],
    divisionLabels: new Map<string, string>(),
  };
  const instances = generateInstances([ZIP_TEMPLATE], [universeStub], NOW, {
    notBefore: null,
    notAfter: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(instances.length, 1);
  // Born past its window: born RETIRED, not born stale.
  assert.equal(instances[0].status.state, "RETIRED");

  const standing = generateInstances([ZIP_TEMPLATE], [universeStub], "2026-08-28T00:00:00.000Z", {
    notBefore: null,
    notAfter: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(standing[0].status.state, "ACTIVE");

  const after = retireExpiredInstances(standing, NOW);
  assert.equal(after.length, standing.length, "retirement never deletes a row");
  assert.equal(after[0].status.state, "RETIRED");
  if (after[0].status.state === "RETIRED") {
    assert.equal(after[0].status.retiredAt, NOW);
    assert.ok(after[0].status.reason.length > 0, "a retirement records its reason");
  }
  assert.equal(activeInstances(after).length, 0);
});

test("a seeded disagreement produces a typed CoverageDefect in both directions", () => {
  const instances: ReaderQuestionInstance[] = [
    {
      id: "rq:1",
      templateId: BODY_TEMPLATE.id,
      questionClass: "GENERATED_FROM_REGISTRY",
      zip: "85701",
      subjectBodyId: "body-a",
      questionText: "When does the governing body for Tucson meet next?",
      window: { notBefore: null, notAfter: null },
      status: { state: "ACTIVE" },
    },
    {
      id: "rq:2",
      templateId: BODY_TEMPLATE.id,
      questionClass: "GENERATED_FROM_REGISTRY",
      zip: "85701",
      subjectBodyId: "body-not-enumerated",
      questionText: "When does the commission for Tucson meet next?",
      window: { notBefore: null, notAfter: null },
      status: { state: "ACTIVE" },
    },
  ];
  const denominator: EnumerationDenominator = {
    zip: "85701",
    layer: "GOVERNING_BODY",
    source: "PROJECT_REGISTRY",
    memberIds: ["body-a", "body-b-with-no-instance"],
  };
  const defect = checkInstanceUniverse(instances, denominator);
  assert.ok(defect, "a disagreement must produce a defect, not a null");
  assert.deepEqual(defect.missingSubjects, ["body-b-with-no-instance"]);
  assert.deepEqual(defect.unexpectedSubjects, ["body-not-enumerated"]);
  assert.equal(defect.zip, "85701");

  // Agreement is honestly null.
  const agreeing = checkInstanceUniverse([instances[0]], {
    ...denominator,
    memberIds: ["body-a"],
  });
  assert.equal(agreeing, null);
});

test("RULING 9: a Census/NCES denominator is refused for the body layer", () => {
  for (const source of ["CENSUS_TIGER", "NCES"] as const) {
    const denominator: EnumerationDenominator = {
      zip: "85701",
      layer: "GOVERNING_BODY",
      source,
      memberIds: [],
    };
    assert.throws(() => assertDenominatorMayCertify(denominator), /RULING 9/);
    assert.throws(() => checkInstanceUniverse([], denominator), /RULING 9/);
  }
  // The same sources ARE permitted for the government/district universe layer.
  assert.doesNotThrow(() =>
    assertDenominatorMayCertify({
      zip: "85701",
      layer: "GOVERNMENT_UNIVERSE",
      source: "CENSUS_TIGER",
      memberIds: [],
    }),
  );
});

test("diagnosticWorkItemFor requires an explicit, valid failure class", () => {
  const question: ReaderQuestionInstance = {
    id: "rq:diag",
    templateId: BODY_TEMPLATE.id,
    questionClass: "GENERATED_FROM_REGISTRY",
    zip: "07866",
    subjectBodyId: "some-body#governing",
    questionText: "When does the governing body meet next?",
    window: { notBefore: null, notAfter: null },
    status: { state: "ACTIVE" },
  };
  const item = diagnosticWorkItemFor(question, "rendering", NOW);
  assert.equal(item.obligation, "reader-diagnostic:rendering:rq:diag");
  assert.match(item.why, /turning green/);

  // Red never defaults to "go acquire": no class, no work item.
  assert.throws(
    () => diagnosticWorkItemFor(question, "go-acquire" as FailureClass, NOW),
    /twelve failure classes/,
  );
  assert.throws(
    () => diagnosticWorkItemFor(question, undefined as unknown as FailureClass, NOW),
    /twelve failure classes/,
  );
});
