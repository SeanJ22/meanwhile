/**
 * **THE REST OF THE PATH A SEND IN ANY REGISTERED STATE TAKES.** (2026-09-25.)
 *
 * - DC and the territories: every step of the meetings chain reads a
 *   division's state through `lib/ocd/state-of.ts`, which reads `/district:`
 *   and `/territory:` as well as `/state:`. Matching `state:` alone put Puerto
 *   Rico's divisions in no state: no crosswalk row, no wiring row, no derived
 *   family, no reader scope.
 * - Admin's preview: the registration slice Postgres cuts, the count by the
 *   runner's rule (certain, and at the edge), and the sentence per state.
 * - The runner reads registration where it must: before the providers run,
 *   before the territory is read, and for a DISPATCH.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CROSSWALK_CITATION, crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { hasReviewedRegistry, JURISDICTION_REFERENCE_STATES } from "../lib/civic-data/reviewed-registry-states.ts";
import { JURISDICTION_REFERENCE_STATES as FROM_REFERENCE } from "../lib/civic-data/operational-references.ts";
import { registrationGovernments, type ReadOnlyQuery, type Statement } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { deployPreview } from "../lib/control-plane/deploy-preview.ts";
import { wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { registrationGovernmentsPlaced, stateSendPreviewSentence, type PreviewCode } from "../lib/control-plane/expansion/send-preview.ts";
import { scopeOfMeeting, stateOfOcdId } from "../lib/meetings/edge-artifacts.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";
import type { Meeting } from "../lib/sources/types.ts";

const ROOT = join(import.meta.dirname, "..");
const PR = "ocd-division/country:us/territory:pr/county:adjuntas";

test("a DC or territory division lies in its own state code on every step of the meetings chain", () => {
  assert.equal(ocdStateCode("ocd-division/country:us/state:oh/place:columbus"), "oh");
  assert.equal(ocdStateCode(PR), "pr");
  assert.equal(ocdStateCode(`${PR}#governing`), "pr", "a body id too");
  assert.equal(ocdStateCode("ocd-division/country:us/district:dc/ward:1"), "dc");
  assert.equal(ocdStateCode("ocd-division/country:us/territory:pr"), "pr");
  assert.equal(ocdStateCode("ocd-division/country:us"), null);
  assert.equal(ocdStateCode("ocd-division/country:us/statehood:xx"), null);
  assert.equal(ocdStateCode(null), null);

  /* The reader's serving scope: a Puerto Rico sitting is Puerto Rico's, not the national bucket's. */
  assert.equal(stateOfOcdId(PR), "pr");
  assert.equal(scopeOfMeeting({ ocdId: `${PR}/place:adjuntas` } as Meeting), "pr");

  /* A crosswalk row on a municipio's division, reviewed like any other. */
  const bodyId = `${PR}#governing`;
  const route = "https://adjuntas.pr.example.gov/calendar.ics";
  const row: MeetingBodyCrosswalkRow = {
    id: `${bodyId}|ICAL`,
    jurisdictionId: "pr:county:adjuntas-municipio",
    ocdId: PR,
    bodyId,
    bodyRole: "GOVERNING",
    bodyName: "Legislatura Municipal",
    kind: "ICAL",
    route,
    officialHost: "adjuntas.pr.example.gov",
    filter: { titleMatch: "Legislatura Municipal" },
    publishingOrg: "Adjuntas Municipio",
    timeZone: "America/Puerto_Rico",
    evidence: {
      bodyPage: { url: "https://adjuntas.pr.example.gov/", sha256: "a".repeat(64), quote: "La Legislatura Municipal se reúne" },
      calendar: { url: route, sha256: "b".repeat(64), selected: 1, total: 2 },
      readAt: "2026-09-25T10:00:00.000Z",
    },
    status: "ACTIVE",
    reviewedBy: "auto-crosswalk-reviewer@0123456789ab",
    reviewedAt: "2026-09-25T11:00:00.000Z",
    authorization: CROSSWALK_CITATION,
  };
  assert.equal(crosswalkRowIssue(row), null, "a territory's registered division is a registered division");
  assert.equal(wiringRowFor(row).state, "US-PR", "its wiring row belongs to Puerto Rico's derived family");
  assert.match(crosswalkRowIssue({ ...row, ocdId: "ocd-division/country:us/nowhere:pr/county:adjuntas" }) ?? "", /names no registered division/);
});

/** What Postgres answers for the registration slice, from a list of bodies. */
function slicedFrom(versionId: string | null, bodies: readonly { id: string; ocdId: string; jurisdictionId: string | null }[], seen: Statement[] = []): ReadOnlyQuery {
  return async (statements) => {
    seen.push(...statements);
    return statements.map((s) => {
      if (s.text.startsWith("SELECT current_version_id")) return versionId === null ? [] : [{ version_id: versionId }];
      const wanted = new Set(s.params[2] as string[]);
      return bodies.filter((b) => b.jurisdictionId !== null && wanted.has(b.ocdId)).map((b) => ({ jurisdiction_id: b.jurisdictionId, ocd_id: b.ocdId, body_id: b.id }));
    });
  };
}

test("Admin's preview: the registration slice, and the governments a Send must place and those at its edge", async () => {
  const OH = "ocd-division/country:us/state:oh";
  const seen: Statement[] = [];
  const bodies = [
    { id: `${OH}/county:franklin#governing`, ocdId: `${OH}/county:franklin`, jurisdictionId: "oh:county:county-of-franklin" },
    { id: `${OH}/place:columbus#governing`, ocdId: `${OH}/place:columbus`, jurisdictionId: "oh:city:city-of-columbus" },
    { id: `${OH}/place:edge#governing`, ocdId: `${OH}/place:edge`, jurisdictionId: "oh:city:village-of-edge" },
    { id: `${OH}/place:outside#governing`, ocdId: `${OH}/place:outside`, jurisdictionId: "oh:city:village-of-outside" },
    { id: `${OH}/school_district:derived#board`, ocdId: `${OH}/school_district:derived`, jurisdictionId: null },
  ];
  const slice = await registrationGovernments("oh", [`${OH}/county:franklin`, `${OH}/place:columbus`, `${OH}/place:edge`, `${OH}/place:outside`, `${OH}/school_district:derived`], slicedFrom("cv-oh-1", bodies, seen));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  assert.equal(slice.versionId, "cv-oh-1");
  assert.deepEqual(seen.map((s) => s.params.slice(0, 2)), [["REGISTRATION", "US-OH:registration:v1"], ["REGISTRATION", "US-OH:registration:v1"]]);
  assert.match(seen[1]!.text, /p\.payload->'bodies'/, "only the bodies cross the wire, cut by Postgres");
  assert.equal(slice.value.length, 4, "a board registration derived from a division alone is no government");

  const codes: PreviewCode[] = [
    /* Wholly inside: the county and the city both reach it. */
    { zcta5: "43215", whole: true, fraction: 1, divisions: [`${OH}/county:franklin`, `${OH}/place:columbus`], partial: [`${OH}/place:columbus`] },
    /* Mostly inside: a village covering only part of it, so only its sampled share can place it. */
    { zcta5: "43001", whole: false, fraction: 0.7, divisions: [`${OH}/county:franklin`, `${OH}/place:edge`], partial: [`${OH}/county:franklin`, `${OH}/place:edge`] },
    /* A sliver: a village there is never placed, whatever its share. */
    { zcta5: "43002", whole: false, fraction: 0.03, divisions: [`${OH}/place:outside`], partial: [`${OH}/place:outside`] },
  ];
  assert.deepEqual(registrationGovernmentsPlaced(codes, slice.value), {
    certain: ["oh:city:city-of-columbus", "oh:county:county-of-franklin"],
    edge: ["oh:city:village-of-edge"],
  });

  assert.equal((await registrationGovernments("OH", [], slicedFrom(null, []))).kind, "NOT_PUBLISHED");
  assert.equal((await registrationGovernments("OH", [], null)).kind, "UNREAD");
  assert.match(
    stateSendPreviewSentence({ kind: "REGISTRATION", state: "OH", versionId: "cv-oh-1", governments: ["a", "b"], edge: ["c"] }),
    /^OH: a Send creates work for 2 governments here, and up to 1 more at the edge .+, from registration \(the 2022 Census of Governments, promoted version cv-oh-1\) — no reviewed registry exists for OH\. A new Send discovers meetings, officeholders, elections and finance sources where missing/,
  );
  assert.match(stateSendPreviewSentence({ kind: "REVIEWED_REGISTRY", state: "AZ" }), /^AZ: its governments come from the reviewed AZ jurisdiction registry/);
  assert.match(stateSendPreviewSentence({ kind: "NOT_READ", state: "TX", why: "its registration is not promoted in this store yet" }), /no count is claimed/);

  /* A DISPATCH ("deep dive on Ohio") says where Ohio's governments come from, and what is blocked is only an unreadable registration. */
  const ohio = deployPreview({ note: "deep dive on Ohio", obligations: [], obligationsRead: true, ceilings: { rolling24HourModelUsd: 105 } }).creates[0]!.says;
  assert.match(ohio, /a state with no reviewed registry is read from its registration \(the 2022 Census of Governments\)/);
  assert.match(ohio, /a state whose registration cannot be read is named as blocked/);

  /* The reviewed states, read alone for the preview, are the reference's own. */
  assert.deepEqual([...JURISDICTION_REFERENCE_STATES], [...FROM_REFERENCE]);
  assert.equal(hasReviewedRegistry("AZ"), true);
  assert.equal(hasReviewedRegistry("oh"), false);
});

test("the runner reads a state's registration before its providers run, before the territory, and for a DISPATCH", () => {
  const runner = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  const preload = runner.indexOf("await preloadRegistrationJurisdictions({ root: ROOT, states: [...materialized.ids]");
  assert.ok(preload > 0 && preload < runner.indexOf("const registryProviders = ["), "created work's states are read before the providers keep it");
  const beforeTerritory = runner.slice(runner.indexOf("beforeTerritory: async (states) => {"), runner.indexOf("...(\"registries\" in promoted"));
  const registrationRead = beforeTerritory.indexOf("await preloadRegistrationJurisdictions({ root: ROOT, states,");
  const ownershipRead = beforeTerritory.indexOf("await meetingPartitions.readStates(states)");
  const refusalReturn = beforeTerritory.indexOf("return [...registration.refused]");
  assert.ok(registrationRead > 0 && ownershipRead > registrationRead && refusalReturn > ownershipRead,
    "a scope awaits registration and meeting ownership before returning its territory preflight, preserving refused registrations");
  assert.match(runner, /await preloadRegistrationJurisdictions\(\{ root: ROOT, states: dispatchTargets\.flatMap/, "a DISPATCH's states before its plan");
  assert.match(runner, /addressSource: dispatchedAddressSource\(e\.reg,\s*/, "a dispatched need's address names the registry it was recorded in");
  const wiring = readFileSync(join(ROOT, "scripts", "derive-meeting-source-wiring.mts"), "utf8");
  assert.match(wiring, /const stateOf = \(ocdId: string\): string \| null => ocdStateCode\(ocdId\)/, "the wiring derive reads a territory's registration too");
});
