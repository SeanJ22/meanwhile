/**
 * **THE JURISDICTION UNIVERSE — every local government that can hold an
 * election, named, before a reader needs it.** (Session C3, lane C, 2026-09-01.
 * RULING 229; A.R.S. § 16-928 as recorded in
 * `data/campaign-finance/filing-regimes.json`.)
 *
 * ## The defect this closes, stated as the wrong sentence it prevents
 *
 * "Arizona campaign finance is acquired" was true of the SECRETARY OF STATE and
 * of Pima County, and of nothing else. Arizona's own filing statute routes four
 * different classes of election to three different filing officers, and the
 * state's own bulk drop names **109 filing jurisdictions**. A statewide
 * acquisition that stopped at the Secretary of State would leave 108 of them
 * unnamed — and an unnamed jurisdiction cannot be an open obligation, cannot
 * accrue debt, and cannot appear in any denominator. It is simply invisible,
 * which is how a partial corpus comes to read as a complete one.
 *
 * **STATEWIDE ACQUISITION DOES NOT MEAN THE SECRETARY OF STATE OWNS EVERY LOCAL
 * RECORD.** A route that belongs to Pima County is Pima-specific and may never
 * be presented as an Arizona route; a route that belongs to the Arizona SOS is
 * statewide and may never be filed under one county. `scope` on every source
 * below carries that distinction as data rather than as a naming convention.
 *
 * ## What this is a registry OF
 *
 * Governments, not URLs. `GOVERNMENT -> RECORD -> REPRESENTATION(S) -> ROUTE(S)`
 * (RULING 206): a row here is the GOVERNMENT, its `sources` are the routes we
 * know to its records, and a row with no known route carries an explicit
 * DISCOVERY obligation rather than nothing. **Absence of a route is a fact about
 * this repository. It is never a fact about the government.**
 *
 * ## What "enumerated" and "adapted" mean, and why they are two fields
 *
 * ```
 *   ENUMERATED   the government is NAMED, from an authoritative enumeration,
 *                and therefore exists as an obligation with a clock
 *   ADAPTED      this repository holds a route to at least one of its record
 *                classes that a machine can actually open
 * ```
 *
 * A session may report `enumerated 690, adapted 3` and that is an honest
 * reading. What it may not do is report Arizona's acquisition universe as
 * complete while `enumerated` is unknown, because a denominator nobody
 * established is not a denominator that happens to be small.
 */

import type { WebsiteAddressCorrectionNote } from "../civic-data/website-corrections.ts";

/**
 * The classes of local government this project distinguishes.
 *
 * A string union rather than an `enum`: `pnpm test` ERASES types rather than
 * compiling them, and a TypeScript `enum` is a runtime value that erasure kills
 * — it takes the whole test FILE with it, silently, while `tsc --noEmit` stays
 * green.
 */
export type JurisdictionClass =
  | "STATE"
  | "COUNTY"
  | "CITY_OR_TOWN"
  | "SCHOOL_DISTRICT"
  | "DEPENDENT_SCHOOL_SYSTEM"
  | "COMMUNITY_COLLEGE_DISTRICT"
  | "SPECIAL_DISTRICT";

/** Which record class a source serves. A government publishes several. */
export type JurisdictionRecordClass =
  | "CAMPAIGN_FINANCE"
  | "BALLOT_AND_CANDIDATES"
  | "OFFICEHOLDERS"
  | "PUBLIC_COMMENT"
  | "PUBLIC_SERVICES"
  | "VOTER_ACCESS"
  | "PUBLIC_RECORDS"
  | "BALLOT_MEASURES"
  | "ADOPTED_BUDGETS"
  | "BUDGET_RESPONSIBILITIES"
  | "BUDGET_AMENDMENTS"
  | "MEETINGS";

/**
 * **THE SCOPE OF A ROUTE, kept apart from the scope of the record.**
 *
 * `STATEWIDE` means the route answers for the whole state and the row is one of
 * its subjects. `THIS_JURISDICTION` means the route belongs to this government
 * and to no other. Collapsing the two is exactly the error this registry
 * exists to prevent: the Pima EasyVote tenant is not an Arizona route, and
 * `ftp://ftp.azsos.gov/cfsdata2/` is not a Pima route.
 */
export type RouteScope = "STATEWIDE" | "PER_COUNTY" | "THIS_JURISDICTION";

/** Whether this repository can open the route today. */
export type SourceState =
  /** A route exists here and a machine can open it. */
  | "ADAPTED"
  /** The authority and the routing rule are known; the address is not. */
  | "DISCOVERY_OWED"
  /** The address is known and this process holds no client for it. */
  | "REQUIRES_NEW_ADAPTER";

export interface JurisdictionSource {
  readonly recordClass: JurisdictionRecordClass;
  /** The custodian by law or by published record. Never the vendor. */
  readonly authority: string;
  /** Where the statutory or documentary routing rule comes from. */
  readonly authorityBasis: string;
  readonly scope: RouteScope;
  /** The method-store route id, when one is registered. */
  readonly routeId: string | null;
  readonly url: string | null;
  readonly state: SourceState;
  /**
   * What is owed when `state` is not ADAPTED, in the imperative.
   *
   * Never "unknown" and never "TODO": a next move, or the sentence saying which
   * human or offline act is left. RULING 205's third close is a live obligation
   * and reads as one here.
   */
  readonly owed: string | null;
  readonly citation: string;
}

export interface Jurisdiction {
  /** `az:county:pima`, `az:city:tucson`, `az:school:tucson-unified-1`. */
  readonly id: string;
  /** Two-letter state. The registry is per state; this is carried for joins. */
  readonly stateCode: string;
  readonly name: string;
  readonly govClass: JurisdictionClass;
  /** The county this sits inside, where the enumeration states one. */
  readonly countyName: string | null;
  /**
   * The `enumerationSources` id that NAMED this government.
   *
   * A key rather than the citation text: the citation is one sentence and there
   * are 2,641 rows across three states, so inlining it wrote the same paragraph
   * a thousand times. The provenance is not weaker for being resolved — it is
   * resolved against a list in the same file, and a key with no entry is a
   * malformed registry rather than a row that quietly lost its source.
   */
  readonly enumeratedFrom: string;
  /**
   * The government's OWN published address, where the enumeration recorded one.
   *
   * It lives on the row rather than in the catalog because it is the one thing
   * about a source that is genuinely per-government — and because an address is
   * NOT an acquisition. `URL != RECORD`: this is where a discovery obligation
   * starts, never a route that has been walked.
   */
  readonly ownWebAddress: string | null;
  /**
   * Present only when `ownWebAddress` is not the Census record: the reviewed website correction applied to it, or
   * refused at promotion (C15, the website field only; `lib/civic-data/website-corrections.ts`).
   */
  readonly ownWebAddressCorrection?: WebsiteAddressCorrectionNote;
  /**
   * Keys into the registry's `sourceCatalog`.
   *
   * Indirection, and it earns its keep: one Arizona statute sentence routes 44
   * Pima County districts to one county officer, and writing that route out 44
   * times produced a 2.3 MB file whose every diff would be noise. The catalog
   * also makes the SHARING visible — a route used by 300 governments looks like
   * one route used by 300 governments, which is what it is.
   */
  readonly sourceIds: readonly string[];
  /**
   * A row read from a state's REGISTRATION (`lib/registration/jurisdictions.ts`) only: the Census division its
   * government is paired with, and the body registration minted there (`<ocdId>#governing`, `#board` for a
   * school district). Null when registration pairs the government with no division, so no body is minted for it.
   * Absent on every row of a reviewed registry.
   */
  readonly ocdId?: string | null;
  readonly bodyId?: string | null;
  /**
   * Registration rows only: that division's Census layer and GEOID (`county:39049`, `place:3918000`), the key its
   * sampled share of each ZCTA is read by (`data/derived/zip-governments.json`). Null with `ocdId`.
   */
  readonly censusDivision?: string | null;
  /** Registration rows only: the Census of Governments id (`pid6`), or `<layer>:<GEOID>` for a territory government. */
  readonly censusId?: string;
}

/**
 * Where a registry read from a state's registration came from (`lib/registration/jurisdictions.ts`). A reviewed
 * registry — the promoted operational reference, which wins wherever it exists — carries none.
 */
export interface RegistrationRegistryOrigin {
  readonly kind: "REGISTRATION";
  /** The promoted REGISTRATION version, the one readers use. */
  readonly versionId: string;
  /** sha256 of the committed reference (`data/derived/registration/<st>.json`) the version was built from. */
  readonly referenceSha256: string;
  /** The Census file each web address was read from, with its sha256 as the reference's index records it. */
  readonly webAddresses: string;
}

/** Which kind of registry a row of work came from, in the words Admin prints. */
export type JurisdictionRegistrySource = "REVIEWED_REGISTRY" | "REGISTRATION";

/**
 * A count from one enumeration that DISAGREES with another.
 *
 * Recorded, never reconciled by picking one. The Arizona Secretary of State's
 * own `Jurisdictions.txt` lists 93 city/town FILING jurisdictions; the 2022
 * Census of Governments lists 91 active Arizona MUNICIPAL governments. Those
 * are two authorities counting two slightly different things, and silently
 * choosing either number would be inventing a denominator.
 */
export interface EnumerationDisagreement {
  readonly about: string;
  readonly counts: readonly { readonly source: string; readonly count: number }[];
  readonly whyItIsNotReconciledHere: string;
}

export interface JurisdictionRegistry {
  readonly formatVersion: 1;
  readonly stateCode: string;
  readonly generatedBy: string;
  readonly generatedOn: string;
  readonly _note: readonly string[];
  /** Every enumeration read, with its own count. */
  readonly enumerationSources: readonly {
    readonly id: string;
    readonly describe: string;
    readonly path: string;
    readonly rowsRead: number;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly disagreements: readonly EnumerationDisagreement[];
  /** Every distinct route, once. Jurisdictions reference these by key. */
  readonly sourceCatalog: Readonly<Record<string, JurisdictionSource>>;
  readonly jurisdictions: readonly Jurisdiction[];
  /** Present only on a registry read from a state's registration; a reviewed registry carries none. */
  readonly registration?: RegistrationRegistryOrigin;
}

/** Whether a registry is a state's reviewed registry or was read from its registration. */
export function registrySourceOf(reg: Pick<JurisdictionRegistry, "registration">): JurisdictionRegistrySource {
  return reg.registration?.kind === "REGISTRATION" ? "REGISTRATION" : "REVIEWED_REGISTRY";
}

/* -------------------------------------------------------------- arithmetic */

/**
 * A jurisdiction's sources, resolved.
 *
 * A `sourceId` with no catalog entry THROWS rather than being skipped: a
 * dangling reference silently dropped is a government quietly losing a route,
 * which reads downstream as a government that never had one.
 */
export function sourcesOf(reg: JurisdictionRegistry, j: Jurisdiction): JurisdictionSource[] {
  return j.sourceIds.map((id) => sourceOf(reg, j, id));
}

/**
 * One of a jurisdiction's sources, by its catalog key, under the same rule:
 * a key with no catalog entry THROWS. For a caller that needs the key beside the
 * source (the key is the requirement's identity, MW-028).
 */
export function sourceOf(reg: JurisdictionRegistry, j: Jurisdiction, id: string): JurisdictionSource {
  const s = reg.sourceCatalog[id];
  if (!s) {
    throw new Error(
      `jurisdiction ${j.id} references source \`${id}\`, which is not in ${reg.stateCode}'s source ` +
        "catalog. A dangling reference dropped silently is a government quietly losing a route.",
    );
  }
  return s;
}

export function countByClass(reg: JurisdictionRegistry): Map<JurisdictionClass, number> {
  const out = new Map<JurisdictionClass, number>();
  for (const j of reg.jurisdictions) out.set(j.govClass, (out.get(j.govClass) ?? 0) + 1);
  return out;
}

/**
 * A jurisdiction is ADAPTED when at least one of its sources can be opened.
 *
 * Note what this does NOT mean. A statewide route that genuinely carries a
 * local government's records makes that government adapted — New Jersey ELEC
 * really does hold Rockaway Township's school-board committees — and that is
 * the right reading. It is also the reading that will flatter a report if it is
 * the only number quoted, which is why `adaptedSplit` reports it BESIDE the
 * local-scope count rather than instead of it.
 */
export function isAdapted(reg: JurisdictionRegistry, j: Jurisdiction): boolean {
  return sourcesOf(reg, j).some((s) => s.state === "ADAPTED");
}

/**
 * **THE NUMBER THAT CANNOT BE FLATTERED BY A STATEWIDE ROUTE.**
 *
 * True only when a route belonging to THIS government, or to the county its
 * records are filed with, can be opened. A state-level API that answers for
 * everybody does not make 1,400 municipal clerks adapted, and a report that
 * quoted only `adapted` would say it did.
 */
export function isLocallyAdapted(reg: JurisdictionRegistry, j: Jurisdiction): boolean {
  return sourcesOf(reg, j).some((s) => s.state === "ADAPTED" && s.scope !== "STATEWIDE");
}

export function adaptedSplit(reg: JurisdictionRegistry): {
  readonly enumerated: number;
  readonly adapted: number;
  readonly notYetAdapted: number;
  readonly locallyAdapted: number;
  readonly notYetLocallyAdapted: number;
} {
  const adapted = reg.jurisdictions.filter((j) => isAdapted(reg, j)).length;
  const locallyAdapted = reg.jurisdictions.filter((j) => isLocallyAdapted(reg, j)).length;
  return {
    enumerated: reg.jurisdictions.length,
    adapted,
    notYetAdapted: reg.jurisdictions.length - adapted,
    locallyAdapted,
    notYetLocallyAdapted: reg.jurisdictions.length - locallyAdapted,
  };
}

/* ------------------------------------------------------------- the loader */

/** Where a state's registry lives. One file per state, generated. */
export function jurisdictionRegistryPath(stateCode: string): string {
  const state = stateCode.toLowerCase();
  return `data/states/${state}/jurisdictions/${state}.json`;
}

/**
 * Read one state's registry.
 *
 * `readFile` is injected so a caller with no filesystem — a test, a bundled
 * runtime — can supply the bytes. A missing file THROWS: this project's own
 * store failing to read is never the same fact as a state with no governments,
 * and returning an empty registry would make the two indistinguishable.
 */
export function loadRegistry(
  stateCode: string,
  readFile: (path: string) => string,
  root = ".",
): JurisdictionRegistry {
  const path = [root, jurisdictionRegistryPath(stateCode)].join("/");
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    throw new Error(
      `the ${stateCode} jurisdiction registry could not be read at ${path} ` +
        `(${error instanceof Error ? error.message : String(error)}). Regenerate it with ` +
        "`pnpm jurisdictions:enumerate`. A failed read of our own store is never a state with no " +
        "local government.",
    );
  }
  const reg = JSON.parse(text) as JurisdictionRegistry;
  if (!Array.isArray(reg.jurisdictions) || reg.jurisdictions.length === 0) {
    throw new Error(
      `${path} parsed and holds ZERO jurisdictions. A zero-row read is a FAILED read, never an empty state.`,
    );
  }
  return reg;
}

/**
 * The registry's own refusal to be read as complete.
 *
 * Returned as a sentence so a report cannot print the counts without it. There
 * is no state in the union whose local-government universe this project has
 * exhausted, and a registry that did not say so would be read as one that had.
 */
export function completenessCaveat(reg: JurisdictionRegistry): string {
  const s = adaptedSplit(reg);
  return (
    `${reg.stateCode}: ${s.enumerated} jurisdiction(s) ENUMERATED from ` +
    `${reg.enumerationSources.length} authoritative enumeration(s); ${s.adapted} reachable by SOME ` +
    `route (statewide routes included), of which ${s.locallyAdapted} by a route belonging to that ` +
    `government or its county — ${s.notYetLocallyAdapted} NOT YET ADAPTED at local scope. This is what ` +
    "the project knows NOW. A government absent from every enumeration read here is absent from this " +
    "file — never absent from the state."
  );
}
