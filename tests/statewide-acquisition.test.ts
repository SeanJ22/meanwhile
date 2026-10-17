import assert from "node:assert/strict";
import { test } from "node:test";

import { contestIncumbency } from "../lib/ballot/incumbency-resolve.ts";
import { nameParts, namesAgree, resolveContestIncumbency } from "../lib/ballot/incumbency.ts";
import { looksLikeFurniture, pickPortrait, pickPortraits } from "../lib/hunt/portrait-pick.ts";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { rosterFactReader } from "./helpers/roster-fact-reader.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}



await installRegistryRuntime(["AZ", "NH", "NJ"]);

test("a bare 'Mine Inspector' classifies — the office's own shorter spelling is not a new office", () => {
  assert.equal(officeIdentity("State Mine Inspector"), "state_mine_inspector");
  assert.equal(officeIdentity("Mine Inspector"), "state_mine_inspector");
  assert.equal(officeIdentity("Arizona State Mine Inspector"), "state_mine_inspector");
});

test("the acquired offices all classify, or their holders could not join their own seats", () => {
  for (const executive of STATEWIDE_EXECUTIVES) {
    assert.ok(
      officeIdentity(executive.holder.officeTitle) !== null,
      `${executive.holder.name}: "${executive.holder.officeTitle}" is not in the office vocabulary, ` +
        "so this holder can never match the contest for their own seat",
    );
  }
});

test("every statewide executive states a government source, a publisher and a read date", () => {
  assert.ok(STATEWIDE_EXECUTIVES.length >= 14, `only ${STATEWIDE_EXECUTIVES.length} rows`);
  for (const executive of STATEWIDE_EXECUTIVES) {
    const host = new URL(executive.sourceUrl).hostname;
    assert.ok(host.endsWith(".gov"), `${executive.holder.name}: ${host} is not a government domain`);
    assert.ok(executive.sourceOrg.length > 5, `${executive.holder.name}: no publishing organisation`);
    assert.match(executive.collectedAt, /^\d{4}-\d{2}-\d{2}$/, `${executive.holder.name}: no read date`);
  }
});

test("no two statewide executives share an id — a collision would collapse two people", () => {
  const ids = STATEWIDE_EXECUTIVES.map((e) => e.holder.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
});

test("Arizona's Corporation Commission is FIVE rows on ONE office, which is what the ballot elects", () => {
  const commission = STATEWIDE_EXECUTIVES.filter(
    (e) => officeIdentity(e.holder.officeTitle) === "corporation_commissioner",
  );
  assert.equal(commission.length, 5, "the Commission seats five");
  for (const member of commission) {
    // The ROLE inside the body (Chair, Vice Chair) may never reach officeTitle:
    // a title that drifted to "Chair" would stop matching the office elected.
    assert.equal(member.holder.officeTitle, "Corporation Commissioner");
  }
});

test("a quoted nickname the RECORD ITSELF prints is read as a first name", () => {
  const filed = nameParts('Nicholas "Nick"', "Myers");
  const serving = nameParts("Nick", "Myers");
  assert.deepEqual(filed.aliases, ["nick"]);
  assert.ok(
    namesAgree(filed, serving),
    'Nicholas "Nick" Myers and Nick Myers are the same man, and the filing prints both',
  );
});

test("the alias is not a fuzzy match — the surname must still agree exactly", () => {
  assert.equal(namesAgree(nameParts('Nicholas "Nick"', "Myers"), nameParts("Nick", "Meyers")), false);
});

test("REGRESSION: without the alias the whole Commission contest failed closed", () => {

  const candidates = [
    { id: "thompson", givenName: "Kevin", familyName: "Thompson" },
    { id: "myers", givenName: 'Nicholas "Nick"', familyName: "Myers" },
    { id: "pratte", givenName: "Clara", familyName: "Pratte" },
  ];
  const holders = [
    { givenName: "Kevin", familyName: "Thompson", source: "azcc.gov" },
    { givenName: "Nick", familyName: "Myers", source: "azcc.gov" },
  ];
  const decided = resolveContestIncumbency({ candidates, holders, officeIsElected: true });
  assert.equal(decided.get("thompson")?.standing, "INCUMBENT");
  assert.equal(decided.get("myers")?.standing, "INCUMBENT");
  assert.equal(decided.get("pratte")?.standing, "CHALLENGER");
});

test("the holder's own identifier reaches the resolution instead of a hard-coded null", async () => {
  const holder: SeatHolder = {
    id: "statewide:az/secretary-of-state",
    name: "Adrian Fontes",
    officeTitle: "Secretary of State",
    partyLabel: "Democratic",
    websiteUrl: null,
    contactFormUrl: null,
    phone: null,
    email: null,
    campaignUrl: null,
    photoUrl: null,
    termEnd: null,
    birthDate: null,
    provenance: { sourceUrl: "https://azsos.gov/", sourceOrg: "AZ SOS", collectedAt: "2026-08-28", verifiedAt: null },
  } as unknown as SeatHolder;

  const result = await contestIncumbency(
    {
      id: "c",
      title: "Secretary of State",
      ocdId: "ocd-division/country:us/state:az",
      federal: false,
      voteFor: 1,
      candidates: [{ key: "k", display: "Adrian Fontes", targetKey: "k" }],
    },
    async () => null,
    async () => [holder],
  );

  assert.equal(result.resolved.get("k")?.standing, "INCUMBENT");
  assert.equal(
    result.decisions.get("k")?.standing,
    "INCUMBENT",
    "a sourced positive fact about this person reaches the reader; the universe gates the " +
      "NEGATIVE label, which is the one that asserts an absence",
  );
  assert.equal(
    result.eligibility.eligible,
    false,
    "and the contest is still not established — nobody is labelled a challenger off it",
  );
  // The holder came back out of `holderFor`, which is only populated for an
  // INCUMBENT, and it is the SAME record — id included.
  assert.equal(result.holderFor.get("k")?.id, "statewide:az/secretary-of-state");
});

test("an image the page's own words call a LOGO is never a face", () => {
  // An office masthead named after the officeholder matches the
  // surname-plus-extension clause exactly.
  const banner = {
    src: "https://azsos.gov/sites/default/files/fontes_banner01_small-white.png",
    alt: "Logo for Arizona Secretary of State",
  };
  const portrait = {
    src: "https://azsos.gov/sites/default/files/photo/AZ-SOS-Adrian-Fontes-Official-Photo-2025-sml.jpg",
    alt: "Photo of Secretary",
  };
  assert.equal(looksLikeFurniture(banner), true);
  assert.equal(looksLikeFurniture(portrait), false);
  const picked = pickPortrait("Adrian Fontes", [banner, portrait]);
  assert.equal(picked?.src, portrait.src, "the banner must never be picked over the portrait");
});

test("a seal, a masthead and a favicon are refused the same way", () => {
  for (const alt of ["Official Seal of the State of Arizona", "site masthead", "favicon"]) {
    assert.equal(looksLikeFurniture({ src: "https://x.gov/a.png", alt }), true, alt);
  }
  // The DIRECTORY is not the file: a portrait filed under /logos/ is a portrait.
  assert.equal(
    looksLikeFurniture({ src: "https://x.gov/logos/jane-doe.jpg", alt: "Jane Doe" }),
    false,
  );
});

test("every explicitly full-name-labelled rendition is offered, including CamelCase filenames", () => {
  // An official photo at 85x120 and again at 326x468: MIN_PORTRAIT_EDGE is 96
  // and only the second clears it.
  const small = { src: "https://x.gov/w_85,h_120/Kimberly%20Yee.jpg", alt: "Treasurer Kimberly Yee Official Photo" };
  const large = { src: "https://x.gov/w_326,h_468/KimberlyYee_2024_official.jpg", alt: "KimberlyYee_2024_official.jpg" };
  const all = pickPortraits("Kimberly Yee", [small, large]);
  assert.equal(all.length, 2, "both renditions are candidates");
  assert.equal(all[0].src, small.src, "page order is preserved");
  assert.equal(pickPortrait("Kimberly Yee", [small, large])?.src, small.src, "the singular picker is unchanged");
  assert.deepEqual(pickPortraits("Kimberly Yee", [
    { src: "https://x.gov/Yee.jpg", alt: "Official photo" },
    { src: "https://x.gov/KimberlyYeeting.jpg", alt: "Official photo" },
    { src: "https://x.gov/KimberlyYeeLogo.png", alt: "Official photo" },
  ]), [], "neither a surname, an extended name nor page furniture supplies the full source name");
});
