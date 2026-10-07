/**
 * Any registered state's governments, as the jurisdiction registry a Send reads. A Send creates work
 * only from a jurisdiction registry (`lib/control-plane/expansion/dispatch-work.ts`). Reviewed registries
 * win wherever they exist; every other state, DC and territory is read here from its promoted
 * registration, so a Send in any registered state creates work with no code change:
 *
 * ```
 *   the governments   every government row of the committed reference the promoted version was
 *                     built from, under the reviewed registries' jurisdiction ids
 *                     (`<st>:<class>:<slug>`, `-<pid6>` on a collision)
 *   the body          the body that version minted for the government on its Census division;
 *                     none where registration pairs the government with no division
 *   what it owes      its meetings only. Where the Census records a web address, the own-site
 *                     MEETINGS source (`own-site-meetings`); where it records none, `find-own-site`
 * ```
 *
 * Only the promoted version is read. A state with no promoted registration, a failed read, or a version
 * built from another reference is refused by name and its governments are named as blocked.
 *
 * Server-only (node:fs); a request path never reads it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  installedRegistrationJurisdictionRegistries,
  installRegistrationJurisdictionRegistries,
} from "../civic-data/operational-references.ts";
import { hasReviewedRegistry } from "../civic-data/reviewed-registry-states.ts";
import type { CivicDataReadResult, PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type {
  Jurisdiction,
  JurisdictionClass,
  JurisdictionRegistry,
  JurisdictionSource,
} from "../hunt/jurisdiction-universe.ts";
import { OWN_SITE_MEETINGS_SOURCE } from "../hunt/meetings-discovery.ts";
import { readStateReference } from "../control-plane/expansion/state-references.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { registrationTarget } from "./publication.ts";
import { readRegistrationProjection } from "./reader.ts";
import { loadRegistrationReference, type LoadedReference } from "./reference.ts";

export const REGISTRATION_JURISDICTIONS_GENERATOR = "lib/registration/jurisdictions.ts" as const;

/** The Census government types a reference names, as the registry's classes (the reviewed generator's CLASS_OF, and the territories'). */
const CLASS_OF: Readonly<Record<string, JurisdictionClass>> = {
  STATE: "STATE",
  COUNTY: "COUNTY",
  MUNICIPAL: "CITY_OR_TOWN",
  TOWNSHIP: "CITY_OR_TOWN",
  "SCHOOL DISTRICT": "SCHOOL_DISTRICT",
  "SPECIAL DISTRICT": "SPECIAL_DISTRICT",
  "DEPENDENT SCHOOL SYSTEM": "DEPENDENT_SCHOOL_SYSTEM",
  "COUNTY-EQUIVALENT GOVERNMENT": "COUNTY",
  "COUNTY SUBDIVISION GOVERNMENT": "CITY_OR_TOWN",
  "PLACE GOVERNMENT": "CITY_OR_TOWN",
};

/* ------------------------------------------------------------ the Census file's own words */

/** What the Census of Governments records about one government that its registration reference does not carry. */
export interface CensusGovernmentFacts {
  /** `web_address`, as recorded: self-reported, with minimal quality control (data/reference/*.md). Empty when blank. */
  readonly web: string;
  /** `county_area_name`. */
  readonly county: string;
}

export interface CensusFacts {
  readonly byPid: ReadonlyMap<string, CensusGovernmentFacts>;
  /** The two files read, each with the sha256 the registration reference records it was built from. */
  readonly source: string;
}

/**
 * Read web addresses and counties from the named states' install-time projections.
 * Their source hashes must match the registration reference's source vintage.
 * Every caller supplies its states; there is no whole-country fallback.
 */
export function readCensusGovernmentFacts(root: string, states: readonly string[]): CensusFacts {
  const index = JSON.parse(readFileSync(join(/* turbopackIgnore: true */ root, "data", "derived", "registration", "index.json"), "utf8")) as { readonly source?: string };
  const byPid = new Map<string, CensusGovernmentFacts>();
  let source = "";
  for (const state of states) {
    const shard = readStateReference(root, state, { facts: true });
    if (!shard.censusSource || shard.censusSource.split(" and ").some(part => !index.source?.includes(part.replace(/^data\/reference\//, "")))) {
      throw new Error(`REGISTRATION_CENSUS_FILE_DRIFT:${state}: regenerate the state reference from the registered source vintage`);
    }
    for (const [id, fact] of Object.entries(shard.facts)) byPid.set(id, fact);
    source = shard.censusSource;
  }
  return { byPid, source };
}

/** The reviewed generator's rule for an address the Census recorded without a scheme (scripts/enumerate-jurisdictions.mts). */
function ownWebAddress(web: string): string | null {
  if (web === "") return null;
  return /^https?:\/\//i.test(web) ? web : `http://${web}`;
}

/** The own-site MEETINGS source: discovery, never acquisition. Its catalog key is the reviewed registries' own. */
export function registrationOwnSiteSource(census: string): JurisdictionSource {
  return {
    recordClass: "MEETINGS",
    authority: "this government itself",
    authorityBasis: "the government's own published web address, as the 2022 Census of Governments recorded it",
    scope: "THIS_JURISDICTION",
    routeId: null,
    /* Per-government: it lives on the row as `ownWebAddress`, exactly as in the reviewed registries. */
    url: null,
    state: "DISCOVERY_OWED",
    owed:
      "walk this row's `ownWebAddress` for the body's own meeting notices, agendas, minutes and officeholder roster, " +
      "under the body-own-publication-first order. The address is the Census's self-reported record, read " +
      "with minimal quality control; an address is not an acquisition.",
    citation: `${census} — the 2022 Census of Governments files this state's registration reference was built from (web_address)`,
  };
}

/* ------------------------------------------------------------ one state's registry */

export interface RegistrationRegistryInput {
  /** The committed reference the promoted version names by its sha256. */
  readonly reference: LoadedReference;
  /** The promoted registration version and its read model: the one readers use. */
  readonly promoted: { readonly versionId: string; readonly model: RegistrationReadModel };
  readonly census: CensusFacts;
}

/**
 * One state's registration, as a jurisdiction registry. PURE. Throws by name when the promoted version was not
 * built from this committed reference, or names another state.
 */
export function registrationJurisdictionRegistry(input: RegistrationRegistryInput): JurisdictionRegistry {
  const { reference: loaded, promoted, census } = input;
  const ref = loaded.reference;
  const state = ref.state.toLowerCase();
  const postal = state.toUpperCase();
  if (promoted.model.state.toLowerCase() !== state) {
    throw new Error(`REGISTRATION_STATE_MISMATCH:${postal}: the promoted version ${promoted.versionId} is ${promoted.model.state}'s`);
  }
  if (promoted.model.vintage.referenceSha256 !== loaded.sha256) {
    throw new Error(
      `REGISTRATION_REFERENCE_MISMATCH:${postal}: the promoted registration ${promoted.versionId} was built from reference ` +
        `${promoted.model.vintage.referenceSha256}, and the committed reference is ${loaded.sha256}; neither is read until they agree`,
    );
  }

  /* Join only bodies actually held by the promoted registration, on the exact sourced pairing. */
  const bodyById = new Map(promoted.model.bodies.map(body => [body.id, body]));

  /* Each division's Census layer and GEOID: the key its sampled ZCTA shares are read by. */
  const censusDivisionOf = new Map(ref.divisions.map(([ocdId, layer, geoid]) => [ocdId, `${layer}:${geoid}`] as const));
  const ownSite = registrationOwnSiteSource(census.source);
  let withSite = 0;
  const rowsRead: Record<string, number> = {};
  const jurisdictions: Jurisdiction[] = [];
  for (const [pid6, jurisdictionId, name, govType, division, how, alternate] of ref.governments) {
    const govClass = CLASS_OF[govType];
    if (govClass === undefined) continue;
    const enumeratedFrom =
      govType === "STATE"
        ? "the-state-itself"
        : how === "TIGER_FUNCSTAT"
          ? "tiger-line-2023-functional-status"
          : govType === "DEPENDENT SCHOOL SYSTEM"
            ? "census-dependent-school-systems-2022"
            : "census-govt-units-2022";
    rowsRead[enumeratedFrom] = (rowsRead[enumeratedFrom] ?? 0) + 1;
    /* A territory government has no Census of Governments row, so no address is recorded for it: none is invented. */
    const facts = govType === "STATE" || how === "TIGER_FUNCSTAT" ? undefined : census.byPid.get(pid6);
    const site = ownWebAddress(facts?.web ?? "");
    if (site !== null) withSite += 1;
    const slot = govType === "SCHOOL DISTRICT" || govType === "DEPENDENT SCHOOL SYSTEM" ? "board" : "governing";
    const pairedIds = govType === "STATE" || division < 0 ? [] : [...new Set([division, alternate]
      .filter(index => index >= 0)
      .map(index => ref.divisions[index]?.[0])
      .filter((id): id is string => id !== undefined))];
    const heldBodies = pairedIds.map(id => bodyById.get(id + "#" + slot)).filter(body => body !== undefined);
    const body = heldBodies.length === 1 ? heldBodies[0] : undefined;
    jurisdictions.push({
      id: jurisdictionId,
      stateCode: postal,
      name,
      govClass,
      countyName: facts?.county ? facts.county : null,
      enumeratedFrom,
      ownWebAddress: site,
      sourceIds: site === null ? [] : [OWN_SITE_MEETINGS_SOURCE],
      ocdId: body?.ocdId ?? null,
      bodyId: body?.id ?? null,
      censusDivision: body === undefined ? null : (censusDivisionOf.get(body.ocdId) ?? null),
      censusId: pid6,
    });
  }
  if (jurisdictions.filter((j) => j.govClass !== "STATE").length === 0 && ref.functionalStatus === undefined) {
    throw new Error(`REGISTRATION_REFERENCE_EMPTY:${postal}: the reference names no government, a failed extraction, never a state with none`);
  }
  const counts: Record<string, number> = {};
  for (const j of jurisdictions) counts[j.govClass] = (counts[j.govClass] ?? 0) + 1;
  const version = `promoted registration version ${promoted.versionId}`;
  const enumerations: Record<string, { readonly describe: string; readonly path: string }> = {
    "the-state-itself": { describe: "the state itself — the authority every STATEWIDE route belongs to", path: "(not an external enumeration)" },
    "census-govt-units-2022": { describe: "U.S. Census Bureau, 2022 Census of Governments: Organization, as this state's registration reads it", path: `data/derived/registration/${state}.json` },
    "census-dependent-school-systems-2022": { describe: "the same directory's DEPENDENT school systems, as this state's registration reads them", path: `data/derived/registration/${state}.json` },
    "tiger-line-2023-functional-status": { describe: "TIGER/Line 2023 functional status: the divisions that govern in a territory the Census of Governments does not enumerate", path: `data/derived/registration/${state}.json` },
  };
  return {
    formatVersion: 1,
    stateCode: postal,
    generatedBy: REGISTRATION_JURISDICTIONS_GENERATOR,
    generatedOn: loaded.generatedAt,
    _note: [
      `READ FROM ${postal}'S REGISTRATION (${version}), NOT A REVIEWED REGISTRY. No reviewed registry exists for this state; the reviewed registry wins wherever one does.`,
      "Every government registration names is here, under the same jurisdiction ids the reviewed registries use. What each owes is its meetings, and only that: no statute routing is read for this state, so no other route is defined.",
      `${withSite} of ${jurisdictions.length} rows carry the web address the Census of Governments recorded; the rest owe finding their own site first. An address is never invented.`,
    ],
    enumerationSources: Object.entries(rowsRead)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => ({ id, describe: enumerations[id]!.describe, path: enumerations[id]!.path, rowsRead: n })),
    counts,
    disagreements: [],
    sourceCatalog: withSite > 0 ? { [OWN_SITE_MEETINGS_SOURCE]: ownSite } : {},
    jurisdictions,
    registration: {
      kind: "REGISTRATION",
      versionId: promoted.versionId,
      referenceSha256: loaded.sha256,
      webAddresses: census.source,
    },
  };
}

/* ------------------------------------------------------------ the read, for the states a Send reaches */

export type RegistrationRead = (state: string) => Promise<CivicDataReadResult<RegistrationReadModel>>;

export interface RegistrationJurisdictionsLoad {
  /** Lower-case state → its registry, read from its registration. */
  readonly registries: ReadonlyMap<string, JurisdictionRegistry>;
  /** Lower-case state → why its registration could not be read as a registry. */
  readonly refused: ReadonlyMap<string, string>;
}

/**
 * Read each named state's registration as a registry: the promoted version (the one readers use) through `read`.
 * Every other outcome — no promoted version yet, an outage, a version built from another reference — refuses the
 * state by name; the committed reference is never read in its place. The caller decides which states (never a
 * reviewed one: the reviewed registry wins).
 */
export async function loadRegistrationJurisdictions(input: {
  readonly root: string;
  readonly states: Iterable<string>;
  readonly read: RegistrationRead;
}): Promise<RegistrationJurisdictionsLoad> {
  const registries = new Map<string, JurisdictionRegistry>();
  const refused = new Map<string, string>();
  const states = [...new Set([...input.states].map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)))].sort();
  for (const state of states) {
    try {
      registrationTarget(state);
      const reference = loadRegistrationReference(input.root, state);
      const read = await input.read(state);
      if (read.kind !== "PROMOTED") {
        throw new Error(
          read.kind === "NOT_RECORDED"
            ? `REGISTRATION_NOT_PROMOTED:${state.toUpperCase()}: its registration has no promoted version yet, and the committed reference is never read in its place`
            : `REGISTRATION_NOT_READ:${state.toUpperCase()}: ${read.kind}: ${"detail" in read ? read.detail : ""}`,
        );
      }
      if (read.metadata.versionId === null) throw new Error(`REGISTRATION_VERSION_UNNAMED:${state.toUpperCase()}: the promoted pointer names no version`);
      const census = readCensusGovernmentFacts(input.root, [state]);
      registries.set(state, registrationJurisdictionRegistry({ reference, promoted: { versionId: read.metadata.versionId, model: read.value }, census }));
    } catch (error) {
      refused.set(state, error instanceof Error ? error.message : String(error));
    }
  }
  return { registries, refused };
}

/**
 * **THE RUNNER'S READ.** Every named state that has no reviewed registry and is not installed yet this process is
 * read from its registration and installed beside the reviewed bundle, with every refusal named
 * (`installRegistrationJurisdictionRegistries`), so the providers, the territory index and the Send all read the
 * same registry. Returns what this call read; a state already installed is not read again.
 */
export async function preloadRegistrationJurisdictions(input: {
  readonly root: string;
  readonly states: Iterable<string>;
  readonly options?: PromotedCivicDataReadOptions;
  /** Injected in tests; the runner reads the promoted pointer. */
  readonly read?: RegistrationRead;
}): Promise<RegistrationJurisdictionsLoad> {
  const held = installedRegistrationJurisdictionRegistries();
  const wanted = [...new Set([...input.states].map((s) => s.trim().toLowerCase()))].filter(
    (s) => /^[a-z]{2}$/.test(s) && !hasReviewedRegistry(s) && !held.registries.has(s),
  );
  if (wanted.length === 0) return { registries: new Map(), refused: new Map() };
  const load = await loadRegistrationJurisdictions({
    root: input.root,
    states: wanted,
    read: input.read ?? ((state) => readRegistrationProjection(state, input.options ?? {})),
  });
  installRegistrationJurisdictionRegistries(load.registries, load.refused);
  return load;
}

/** The two-letter state of a jurisdiction id (`oh:city:city-of-columbus`) or an obligation id about one, or null. */
export function stateOfJurisdictionId(id: string): string | null {
  const rest = id.replace(/^freshness:[a-z-]+:/, "");
  const m = /^([a-z]{2}):[a-z]+:/.exec(rest);
  return m === null ? null : m[1]!;
}
