import test from "node:test";
import assert from "node:assert/strict";

import { bodyPurposeFor } from "../lib/map/body-purpose.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

const PIMA = "ocd-division/country:us/state:az/county:pima";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";

function covered(overrides: Partial<CoveredBody>): CoveredBody {
  return {
    bodyId: `${PIMA}#governing`,
    ocdId: PIMA,
    name: null,
    divisionLabel: "Pima County",
    divisionType: "county",
    lsad: null,
    bodyClass: "GOVERNING",
    coverageStatus: "LIVE",
    homepageUrl: null,
    agendaSourceRef: null,
    lookedAt: true,
    tier: "local",
    ...overrides,
  };
}

test("WGH-24/MTG-20: a short purpose is an exact excerpt with provenance", () => {
  const purpose = bodyPurposeFor(
    covered({ bodyId: `${PIMA}#regional-flood-control-district` }),
  );
  assert.equal(purpose?.label, "Flood control");
  assert.match(purpose?.description ?? "", /flood control/i);
  assert.match(purpose?.basisUrl ?? "", /^https:\/\//);
  assert.match(purpose?.readOn ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.ok((purpose?.label.split(/\s+/).length ?? 3) <= 2);
});

test("WGH-24: a body without a held definition gets no invented purpose", () => {
  assert.equal(
    bodyPurposeFor(
      covered({
        bodyId: `${TUCSON}#design-review-board`,
        ocdId: TUCSON,
        name: "Design Review Board",
        divisionLabel: "Tucson",
        divisionType: "place",
        bodyClass: "ADVISORY",
      }),
    ),
    null,
  );
});

test("WGH-24: a body-specific sourced purpose does not require a division", () => {
  const purpose = bodyPurposeFor(
    covered({
      bodyId: "curated:az/pima-community-college#governing",
      ocdId: null,
      divisionLabel: "Pima Community College",
      divisionType: null,
    }),
  );
  assert.equal(purpose?.label, "Community colleges");
  assert.match(purpose?.basisUrl ?? "", /^https:\/\//);
});

test("WGH-24: a sourced denial never becomes a purpose label", () => {
  const concord = "ocd-division/country:us/state:nh/place:concord";
  assert.equal(
    bodyPurposeFor(
      covered({
        bodyId: `${concord}#governing`,
        ocdId: concord,
        name: null,
        divisionLabel: "Concord",
        divisionType: "place",
        lsad: "25",
      }),
    ),
    null,
  );
});
