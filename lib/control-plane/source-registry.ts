/**
 * **THE SOURCE / API CAPABILITY REGISTRY — one truthful row per route.**
 * (ADM-C11 and §6/§7 of the Admin C brief, 2026-09-06.)
 *
 * The owner's question, and the whole of it: *"which sources do I actually
 * have, which of them are working, which are holding a key I am not spending,
 * and which one needs me?"* Nothing in this repository could answer it,
 * because the answer is spread across registers that were each built to
 * answer a different question and have never been compared:
 *
 * ```
 *   lib/civic-data/contracts.ts     routine production contracts
 *   lib/civic-data/manual-contracts.ts owner-invoked production contracts
 *   lib/sources/composite/wiring.ts thirteen meeting adapters
 *   lib/registry/source-wiring.ts   which government body each adapter serves
 *   lib/hunt/platform-tenancy.ts    which vendor platforms are recognised, and
 *                                   which of those have an adapter
 *   docs/sources.md                 the prose register of permission and licence
 *   docs/credential-ledger.md       what each credential returned when CALLED
 * ```
 *
 * **This module is the JOIN, not a seventh register.** Everything that can be
 * derived is derived at render time from the registers above, so a number here
 * cannot go stale in a way a diff would not show. What cannot be derived — a
 * provider's standing, a decision not to spend a key, a permission finding — is
 * declared once, in {@link DECLARED_ROUTES}, with the file or document that
 * carries the evidence named beside it.
 *
 * ## THE FOUR RULES THIS FILE IS BUILT AROUND
 *
 * **1. A credential is a NAME the page never shows and a VALUE it never
 * reads.** The row type has no field that can hold either. The variable names
 * live in {@link ROUTE_CREDENTIAL_VARS}, a lookup a server component uses to
 * turn `process.env` into presence booleans; a built {@link SourceRow} carries
 * only whether a credential is required and what a reading of it said.
 * `tests/admin-source-registry.test.ts` asserts that no built row contains a
 * string shaped like an environment variable.
 *
 * **2. "Not present here" is not "not configured".** The deployed console is a
 * Netlify function. It holds the credentials the WEBSITE needs and nothing
 * else; acquisition credentials live with the standing runner or in the
 * owner's private workstation settings. A page that read `process.env` and
 * printed "not configured" for an off-host key would be stating a falsehood
 * with a green tick beside it. So every credential
 * declares WHERE it must live ({@link CredentialHolder}), and a reading taken
 * somewhere else is returned as a named gap whose owner is `UNKNOWABLE_NOW` —
 * *this page cannot see that store* — never as a No.
 *
 * **3. No live source call, ever.** *"Do not burn API calls merely because a
 * key exists."* Nothing here fetches, and nothing here reads a file. The only
 * host observation supplied by the caller is credential presence.
 *
 * **4. Routine operation is shown once.** The canonical routine-data panel is
 * derived from `lib/civic-data/contracts.ts` and durable data-plane events.
 * This wider capability registry never reconstructs a second clock from
 * repository-maintained runtime records.
 *
 * ## WHY DISPOSITION AND HEALTH ARE TWO COLUMNS
 *
 * ADM-C11's acceptance is that seven states are distinguishable at a glance,
 * and two of them — *active healthy* and *broken* — differ only in whether the
 * thing is working. Folding that into one word would force a route to be either
 * ACTIVE or broken, and a route can be both in use and failing. So
 * {@link Disposition} answers *what standing does this route have* and health
 * answers *is it working*; between them the seven states are all reachable and
 * none collapses into another.
 *
 * PURE. No clock, no filesystem, no network, no environment.
 */
import { KNOWN_PLATFORMS, UNHANDLED_PLATFORMS } from "../hunt/platform-tenancy.ts";
import { CREDENTIAL_STORE_SAYS, type CredentialStore } from "../ops/credential-stores.ts";
import { CAPABILITIES, wiringForSourceName } from "../sources/composite/wiring.ts";
import { SOURCE_WIRING } from "../registry/source-wiring.ts";
import { KEY_VAR as CENSUS_KEY_VAR } from "../sources/census-acs-population/index.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../civic-data/manual-contracts.ts";
import {
  meetingPartitionsForSource,
  observableRoutineContracts,
} from "../civic-data/meeting-partitions.ts";
import {
  gap,
  held,
  measured,
  type CountClaim,
  type GapOwner,
  type HealthLevel,
  type Held,
  type Measured,
  type RenderedNumber,
} from "./owner-surface.ts";

/* ==========================================================================
 * 1. THE VOCABULARY
 * ========================================================================== */

/**
 * What standing a route has. The seven ADM-C11 dispositions, made mutually
 * exclusive so that exactly one is true of any route.
 *
 * These are machine constants and never reach the face as themselves: the page
 * renders each through `plainCode` from `lib/control-plane/plain-words.ts`,
 * with the row's own {@link SourceRow.dispositionWhy} sentence beside it.
 */
export type Disposition =
  /** A credential is required, it is held, and the route is in live use. */
  | "ACTIVE"
  /** No credential is required and the route is in live use. */
  | "CREDENTIAL_NOT_REQUIRED"
  /** A credential is held and deliberately not spent — a cheaper route serves the same fact. */
  | "INTENTIONALLY_NOT_SPENT"
  /** Held on purpose against a named later use. Nothing calls it today. */
  | "PRESERVE"
  /** Wanted or named, and no adapter reads it. Engineering is owed. */
  | "WIRE"
  /** Waiting on the provider — an application, an approval, an account. */
  | "PENDING_PROVIDER"
  /** This route cannot serve this product, and the row says why. */
  | "NOT_APPLICABLE";

export const DISPOSITIONS: readonly Disposition[] = [
  "ACTIVE",
  "CREDENTIAL_NOT_REQUIRED",
  "INTENTIONALLY_NOT_SPENT",
  "PRESERVE",
  "WIRE",
  "PENDING_PROVIDER",
  "NOT_APPLICABLE",
];

/**
 * What each disposition means to the owner, in one sentence.
 *
 * This is NOT a second copy of `PLAIN_WORDS` — that dictionary translates a
 * constant into words, and it carries no entry for six of these seven. The one
 * it does carry, `ACTIVE`, means something else entirely there (it describes
 * the research runner). So the page renders the WORDS through `plainCode` and
 * takes the MEANING from here, and never calls `plainMeaning` on a disposition.
 */
export const DISPOSITION_MEANS: Readonly<Record<Disposition, string>> = {
  ACTIVE: "A key is needed, the key is held, and this route is in use.",
  CREDENTIAL_NOT_REQUIRED: "This route needs no key at all, and it is in use.",
  INTENTIONALLY_NOT_SPENT: "A key is held and is deliberately not being spent, because a cheaper route already answers the same question.",
  PRESERVE: "A key is held and kept alive on purpose. Nothing calls it today, and that is a decision rather than a fault.",
  WIRE: "Nothing here reads this yet. It needs engineering before it can answer anything.",
  PENDING_PROVIDER: "Waiting on the provider. There is nothing to build until they answer.",
  NOT_APPLICABLE: "This route cannot serve this product, and the reason is stated beside it.",
};

/**
 * A health grade as the word an operator reads.
 *
 * `HEALTH_SCALE` in `lib/control-plane/plain-health.ts` already says what a
 * grade means — for the three PILOT CONTRACTS, whose amber is "not proven yet"
 * and whose green is "all three contracts are met". Neither sentence is true of
 * a source, so this is the same four grades wearing the words that fit a route,
 * and the two maps are deliberately not merged.
 */
export const HEALTH_WORDS: Readonly<Record<HealthLevel, string>> = {
  GREEN: "Working",
  AMBER: "Watch this",
  RED: "Failing",
  UNKNOWN: "Not measured",
};

/** The restrained semantic tone each disposition carries (§9A.15). */
export const DISPOSITION_TONE: Readonly<Record<Disposition, "ok" | "warn" | "bad" | "info" | "none">> = {
  ACTIVE: "ok",
  CREDENTIAL_NOT_REQUIRED: "ok",
  INTENTIONALLY_NOT_SPENT: "info",
  PRESERVE: "info",
  WIRE: "warn",
  PENDING_PROVIDER: "warn",
  NOT_APPLICABLE: "none",
};

/**
 * The kind of thing on the other end of the route. Human labels, not constants
 * — a family name is read directly and never passes through a translator.
 */
export type PlatformFamily =
  | "Federal API"
  | "Federal bulk file"
  | "State API"
  | "State portal"
  | "Meeting portal"
  | "Open-data platform"
  | "Geospatial service"
  | "Model provider"
  | "Map tiles";

export const PLATFORM_FAMILIES: readonly PlatformFamily[] = [
  "Federal API",
  "Federal bulk file",
  "State API",
  "State portal",
  "Meeting portal",
  "Open-data platform",
  "Geospatial service",
  "Model provider",
  "Map tiles",
];

/**
 * Which store must hold a credential for its consumer to work.
 *
 * This is the field that keeps rule 2 honest. A reading taken inside the
 * website's own process is evidence about `SITE_RUNTIME` and about nothing
 * else, and this says so per route rather than letting the page guess.
 *
 * The three real stores are declared by `lib/ops/credential-report.ts`, the
 * module that owns credentials — one vocabulary, not two (RULING 103). `NONE`
 * is added here and only here, because a route that needs no key is a fact
 * about a SOURCE and would be meaningless in a credential event log.
 */
export type CredentialHolder = CredentialStore | "NONE";

/** Where the owner keeps a credential, said in words rather than as a path. */
export const HOLDER_SAYS: Readonly<Record<CredentialHolder, string>> = {
  ...CREDENTIAL_STORE_SAYS,
  NONE: "nowhere — this route needs no key",
};

export interface CredentialNeed {
  readonly required: boolean;
  readonly holder: CredentialHolder;
  /** How many separate variables this route needs. Never their names. */
  readonly parts: number;
}

/** What a presence check actually established. Never a value, never a name. */
export interface CredentialReading {
  readonly configured: boolean;
  /** Where the reading was taken, in words. */
  readonly readIn: string;
}

export interface EvidenceLink {
  /** What a reader would find there, in words. */
  readonly what: string;
  /** A repository path or a document anchor. Belongs in a disclosure. */
  readonly at: string;
}

export interface AdapterFact {
  readonly active: boolean;
  /** The module that reads this route, when one exists. */
  readonly at: string | null;
  /** One sentence for the owner. */
  readonly says: string;
}

export interface ProductionOperation {
  /** Canonical production contracts this capability route feeds. */
  readonly contractIds: readonly string[];
  /** One sentence the owner reads. Cadence/outcomes remain in the canonical panel. */
  readonly says: string;
}

export interface Blocker {
  readonly what: string;
  readonly whose: GapOwner;
}

/** One truthful row of the registry. */
export interface SourceRow {
  readonly id: string;
  /** The route, named the way a person would say it. */
  readonly source: string;
  /** Who publishes it. The government or the company, never the vendor of a vendor. */
  readonly provider: string;
  readonly family: PlatformFamily;
  /** What this route can tell a reader. One plain sentence. */
  readonly capability: string;
  readonly disposition: Disposition;
  readonly dispositionWhy: string;
  readonly credential: CredentialNeed;
  readonly credentialReading: Held<CredentialReading>;
  readonly adapter: AdapterFact;
  /** What the product does with it today. */
  readonly productUsage: string;
  readonly operation: ProductionOperation;
  readonly lastSuccess: Held<string>;
  readonly nextDue: Held<string>;
  readonly health: HealthLevel;
  readonly healthWhy: string;
  readonly coverage: Held<Measured>;
  readonly spendConcern: string;
  readonly blocker: Blocker | null;
  /** What the owner should do, when anything. */
  readonly ownerAction: string | null;
  /**
   * True when the route is named in the owner's handoff inventory and appears
   * nowhere in this repository. Pinned by a sweep in the test, not typed by
   * hand — a row that starts being read stops being named-only on its own.
   */
  readonly namedOnly: boolean;
  readonly evidence: readonly EvidenceLink[];
}

/* ==========================================================================
 * 2. THE CREDENTIAL LOOKUP — names live here and nowhere near a row
 * ========================================================================== */

/**
 * Route id to the environment variables that route needs.
 *
 * **This map is the reason a row can be honest without carrying a name.** A
 * server component calls {@link readCredentialPresence} with `process.env`,
 * which returns route id to a boolean, and the boolean is all that travels.
 *
 * Two of these come from the existing governed pattern — a module exporting the
 * NAME of the key it reads and taking the value as a parameter
 * (`census-acs-population`'s `KEY_VAR`). **Every other credential in this
 * repository is a bare `process.env.X` read with no exported name**, so the
 * names below are typed here rather than imported. That is a real seam, not a
 * style preference: converting those reads to exported constants is what would
 * make this map derivable from code instead of maintained beside it.
 */
export const ROUTE_CREDENTIAL_VARS: Readonly<Record<string, readonly string[]>> = {
  "congress-api": ["CONGRESS_API_KEY"],
  "census-acs-api": [CENSUS_KEY_VAR],
  lda: ["LDA_API_KEY"],
  "fec-api": ["FEC_API_KEY"],
  "plural-api": ["PLURAL_API_KEY"],
  legiscan: ["LEGISCAN_API_KEY"],
  "data-gov-govinfo": ["DATA_GOV_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  maptiler: ["NEXT_PUBLIC_MAPTILER_KEY"],
  socrata: ["SOCRATA_APP_TOKEN", "SOCRATA_SECRET_TOKEN"],
  "google-civic": ["GOOGLE_CIVIC_API_KEY"],
  "sam-gov": ["SAM_GOV_API_KEY"],
  accela: ["ACCELA_APP_ID", "ACCELA_APP_SECRET"],
};

/**
 * Turn an environment into route-id-to-present, reading nothing else.
 *
 * A route counts as configured only when EVERY variable it needs carries a
 * non-empty value: half a credential pair is not a credential, and reporting it
 * as configured would send the owner looking for a bug in the adapter.
 */
export function readCredentialPresence(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const [routeId, names] of Object.entries(ROUTE_CREDENTIAL_VARS)) {
    out[routeId] = names.every((name) => (env[name] ?? "").trim() !== "");
  }
  return out;
}

/* ==========================================================================
 * 3. THE DECLARED ROUTES
 * ========================================================================== */

/** The declaration a row is built from. Everything else on a row is derived. */
interface DeclaredRoute {
  readonly id: string;
  readonly source: string;
  readonly provider: string;
  readonly family: PlatformFamily;
  readonly capability: string;
  readonly disposition: Disposition;
  readonly dispositionWhy: string;
  readonly credential: CredentialNeed;
  readonly adapter: AdapterFact;
  readonly productUsage: string;
  /** Joins this capability to the permanent routine or owner-invoked contract registry. */
  readonly productionContractIds: readonly string[];
  /** What this capability does operationally; never a second cadence or outcome claim. */
  readonly operationSays: string;
  /** Static health for a route the canonical production panel does not measure. */
  readonly restingHealth: HealthLevel;
  readonly restingHealthWhy: string;
  readonly spendConcern: string;
  readonly blocker: Blocker | null;
  readonly ownerAction: string | null;
  readonly namedOnly: boolean;
  readonly evidence: readonly EvidenceLink[];
}

const NO_KEY: CredentialNeed = { required: false, holder: "NONE", parts: 0 };

/** A route nothing calls has no health reading, and that is not an amber. */
const UNCALLED = "Nothing calls this route, so nothing measures it. That is a standing decision, not a failure.";

/**
 * Every source or outside API this repository can name, one row per ROUTE.
 *
 * A provider with two routes gets two rows on purpose. Plural Open States is
 * the clear case: the bulk file and the v3 API answer the same question
 * with different costs and different credentials, and a single row would have
 * to hide one of them to state the other. The same is true of the Census (a
 * keyed API and version-pinned reference files) and the FEC (a keyed API and a
 * version-pinned directory).
 *
 * Excluded on purpose, and stated rather than silently dropped: database
 * connection strings, the admin session and break-glass secrets, and the
 * deploy tokens. Those are infrastructure — they are not sources, they answer
 * no reader's question, and counting them here would inflate the denominator
 * of a registry about civic records.
 */
const DECLARED_ROUTES: readonly DeclaredRoute[] = [
  /* ---------------------------------------------------------- FEDERAL API */
  {
    id: "congress-api",
    source: "Congress.gov API",
    provider: "Library of Congress",
    family: "Federal API",
    capability: "Official House/Senate roll calls, reviewed key-question roll identities, and exact member positions.",
    disposition: "ACTIVE",
    dispositionWhy: "Owner-invoked acquisitions promote through the canonical civic-data candidate/event/promotion store. The absence of a clock is deliberate.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: {
      active: true,
      at: "scripts/fetch-votes.mts, scripts/fetch-key-vote-positions.mts",
      says: "Explicit commands acquire official chamber/Congress.gov records and can write only durable candidate/outcome/promotion rows.",
    },
    productUsage: "Federal recent and reviewed key-vote records served from proof-validated promoted projections.",
    productionContractIds: ["congress-rollcalls", "federal-key-votes"],
    operationSays: "Explicit owner invocation only. The two canonical manual contracts own receipts, promotion, and Reader delivery.",
    restingHealth: "UNKNOWN",
    restingHealthWhy:
      "The canonical Admin outcome projection owns attempt, promotion, hold, LKG, and source-history state; this older route registry does not infer it.",
    spendConcern: "One keyed read per chamber per run. No published ceiling for this key is recorded in this repository.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the key's last measured call — 5 New Jersey members, each stating New Jersey", at: "docs/credential-ledger.md" },
      { what: "the register row and its permission finding", at: "docs/sources.md — Congress.gov" },
    ],
  },
  {
    id: "fec-api",
    source: "OpenFEC API",
    provider: "Federal Election Commission",
    family: "Federal API",
    capability: "Federal candidates, their committees, filed totals and the largest reported contributions.",
    disposition: "ACTIVE",
    dispositionWhy: "The key is held by the standing machine and the production data-plane runner reads the route every week.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: true, at: "scripts/fetch-fec.mts, scripts/routine-civic-data-runner.mts", says: "Reads the API, validates a candidate version, and atomically promotes the runtime funding projection." },
    productUsage: "Who paid for a federal candidate's campaign, on the candidate's own card.",
    productionContractIds: ["fec-funding"],
    operationSays: "The standing runner invokes the canonical weekly contract; its durable events own cadence, health, and LKG.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The canonical production-data panel owns attempt, promotion, hold, LKG, and source-history state; this capability registry does not infer it.",
    spendConcern:
      "Committees file monthly or quarterly and the agency's own processing lag is measured in days, so the weekly cadence is already the point at which a faster read returns the same answer.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the fetch and what it writes", at: "scripts/fetch-fec.mts" },
      { what: "the single production contract, cadence, retry, store and projection", at: "lib/civic-data/contracts.ts" },
    ],
  },
  {
    id: "lda",
    source: "Senate Lobbying Disclosure Act database",
    provider: "United States Senate",
    family: "Federal API",
    capability: "Federal lobbying registrations — who is paid to lobby which federal office.",
    disposition: "PRESERVE",
    dispositionWhy:
      "The key works and the database is federal lobbying only: it carries no county, municipal or school-district layer, so it answers no question this product asks today.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: false, at: null, says: "No module reads it. The measured walk recorded that it closes no field at either pilot zip." },
    productUsage: "None today. A later who-is-lobbying-my-delegation surface is the named use it is held for.",
    productionContractIds: [],
    operationSays: "Nothing calls it, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made, so no quota is spent.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the measured walk — the API answers, and closes nothing at either pilot zip", at: "data/hunt/api-keys-walk.json" },
      { what: "the held-and-unread finding", at: "docs/sources.md — Not in use, the three held keys" },
    ],
  },
  {
    id: "data-gov-govinfo",
    source: "api.data.gov, fronting GovInfo",
    provider: "General Services Administration and the Government Publishing Office",
    family: "Federal API",
    capability: "The GovInfo collections, including the Congressional Directory — member offices, phones and staff.",
    disposition: "PRESERVE",
    dispositionWhy:
      "The key answered with 42 collections when it was last called and no module reads it. The federal money path holds its own key against the same upstream, so this one is kept for the directory rather than spent.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: false, at: null, says: "No module reads it. Its value was re-measured rather than assumed." },
    productUsage: "None today. The Congressional Directory is the named later use.",
    productionContractIds: [],
    operationSays: "Nothing calls it, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made, so no quota is spent.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "42 collections returned, including the Congressional Directory", at: "docs/credential-ledger.md" },
      { what: "the two federal routes that share this upstream", at: "docs/sources.md — Not in use, the three held keys" },
    ],
  },
  {
    id: "census-acs-api",
    source: "Census American Community Survey API",
    provider: "United States Census Bureau",
    family: "Federal API",
    capability: "Population by ZIP code tabulation area and by state, from the five-year American Community Survey.",
    disposition: "ACTIVE",
    dispositionWhy: "The key works and the standing runner promotes the official annual release through the canonical data plane.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: {
      active: true,
      at: "lib/sources/census-acs-population/index.ts",
      says: "The one adapter in this repository that exports the whole fetch, normalise and upsert triple, and it takes the key as a parameter rather than reading the environment itself.",
    },
    productUsage: "The promoted ACS population projection used by readiness and jurisdiction views.",
    productionContractIds: ["census-acs-population"],
    operationSays: "The standing runner invokes the canonical monthly contract; its durable events own cadence, health, and LKG.",
    restingHealth: "UNKNOWN",
    restingHealthWhy:
      "The canonical production-data panel owns the current release, attempts, promotion, hold, and LKG state; this capability registry does not infer it.",
    spendConcern:
      "One keyed call returns every ZIP code tabulation area and one returns every state, so a full acquisition is two calls. This host answers a rejected key with a success code and an error page, which is why the credential check compares the body rather than the status.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the adapter, and the key name it exports rather than reads", at: "lib/sources/census-acs-population/index.ts" },
      { what: "the re-measure that proved the key works, 2026-09-05", at: "docs/sources.md — the credentials, enumerated" },
    ],
  },

  /* ---------------------------------------------------- FEDERAL BULK FILE */
  {
    id: "congress-bulk",
    source: "unitedstates/congress-legislators",
    provider: "The @unitedstates project (public domain)",
    family: "Federal bulk file",
    capability: "The whole sitting federal roster in one request — names, parties, chambers, districts and terms.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "One public file, no key, no rate wall. It is preferred over the keyed API for the roster on purpose.",
    credential: NO_KEY,
    adapter: { active: true, at: "scripts/fetch-congress-legislators.mts", says: "Acquires the public roster only on explicit owner invocation and promotes it through the canonical data plane." },
    productUsage: "The federal half of who governs a reader's address.",
    productionContractIds: ["congress-bulk-roster"],
    operationSays: "Explicit owner invocation only. The canonical manual contract owns receipts, promotion, and Reader delivery.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The canonical production-data panel owns acquisition, validation, promotion, and LKG state; this capability registry does not infer it.",
    spendConcern: "One request for the whole country. No quota and no key.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the adapter and its bulk-over-API reasoning", at: "lib/sources/congress/index.ts" }],
  },
  {
    id: "census-bulk",
    source: "Census TIGER, ZCTA and the Census of Governments",
    provider: "United States Census Bureau",
    family: "Federal bulk file",
    capability: "District and ZIP boundaries, and the official count of American governments every coverage claim is measured against.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "Version-pinned public-domain engineering references. No key, and the denominators every readiness number is stated over come from here.",
    credential: NO_KEY,
    adapter: { active: true, at: "data/reference/census_govt_units_2022.csv, lib/geo/", says: "Adopted as a reviewed software reference, so a build cannot be blocked by an outage." },
    productUsage: "Every boundary the map draws, and the official universe behind every coverage figure.",
    productionContractIds: [],
    operationSays: "Static engineering reference. A new upstream edition requires a reviewed software change, not a runtime clock.",
    restingHealth: "GREEN",
    restingHealthWhy:
      "The version-pinned references ship with the software and the suite reads them on every run, so their presence and shape are certified rather than inferred.",
    spendConcern: "Nothing is fetched at run time. No quota.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the adopted universe and the coverage rule it anchors", at: "docs/sources.md — the keyless sources" }],
  },
  {
    id: "fec-directory-bulk",
    source: "FEC Combined Federal/State Disclosure Directory",
    provider: "Federal Election Commission",
    family: "Federal bulk file",
    capability: "Which office holds campaign-finance records in each state, with its own address, email and phone.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "A version-pinned public-domain reference: 349 offices across 56 jurisdictions, no key.",
    credential: NO_KEY,
    adapter: { active: true, at: "data/reference/fec_combined_federal_state_disclosure_directory.csv", says: "Adopted through a reviewed software change." },
    productUsage: "The route from a state to its own campaign-finance authority, which is how a state money hunt starts.",
    productionContractIds: [],
    operationSays: "Static engineering reference. A revised directory requires a reviewed software change, not a runtime clock.",
    restingHealth: "AMBER",
    restingHealthWhy: "The adopted version is software-certified; upstream revision discovery is not represented as live source health.",
    spendConcern: "Nothing is fetched at run time. No quota.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the register row and what the file holds", at: "docs/sources.md — the keyless sources" }],
  },
  {
    id: "dotgov",
    source: "The .gov domain registry",
    provider: "Cybersecurity and Infrastructure Security Agency",
    family: "Federal bulk file",
    capability: "Every domain in the .gov top-level domain with its registrant, city, state and CISA's own type.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "A public CSV with no key. The standing runner owns its monthly canonical production contract.",
    credential: NO_KEY,
    adapter: { active: true, at: "scripts/fetch-dotgov.mts", says: "Acquires the published CSV, validates a candidate, and promotes only through the canonical data plane." },
    productUsage: "A discovery rung — the cheapest first answer to whether a government publishes anything and where.",
    productionContractIds: ["dotgov"],
    operationSays: "The standing runner invokes the canonical monthly contract; its durable events own cadence, health, and LKG.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The canonical production-data panel owns attempt, promotion, hold, LKG, and source-history state; this capability registry does not infer it.",
    spendConcern:
      "The federal register gains and loses a handful of entries a month, so a daily read would be a build spent to learn nothing. This is why the cadence is monthly.",
    blocker: {
      what: "A government with no .gov domain is missing from this file entirely, so it can never be used as a count of governments.",
      whose: "THEIRS",
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the boundary — domains are not a denominator", at: "scripts/fetch-dotgov.mts" }],
  },

  /* ------------------------------------------------------------ STATE API */
  {
    id: "legiscan",
    source: "LegiScan",
    provider: "LegiScan (licensed, attribution required)",
    family: "State API",
    capability: "State bills and roll-call votes.",
    disposition: "INTENTIONALLY_NOT_SPENT",
    dispositionWhy: "The key is retained for licensed research but deliberately not spent: official legislative publishers own current vote acquisition and promotion.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: false, at: "lib/sources/legiscan/", says: "The retained parser can inspect already-held historical evidence; no executable source acquisition path calls the licensed API." },
    productUsage: "Historical research evidence only. It is not a production acquisition, freshness, or promotion authority.",
    productionContractIds: [],
    operationSays: "No production contract reads LegiScan; historical research has no acquisition or promotion door.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "No current source call is made, so the registry does not manufacture a health verdict from historical files.",
    spendConcern: "Deliberately zero: the official publisher path supplies production truth without spending this licensed key.",
    blocker: {
      what: "The licence requires attribution wherever the data appears, which is a standing obligation on every surface that shows a state vote.",
      whose: "THEIRS",
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the licence and the attribution obligation", at: "docs/sources.md — LegiScan" }],
  },
  {
    id: "plural-api",
    source: "Plural / Open States v3 API",
    provider: "Plural (Open States)",
    family: "State API",
    capability: "State legislators and their official contacts, per request.",
    disposition: "PRESERVE",
    dispositionWhy:
      "The credential is retained for bounded research only. Neither the API nor its bulk intermediary may supply production officeholder truth; an official legislature must own that projection.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: false, at: null, says: "No production adapter calls the API. Research use cannot promote or feed a Reader." },
    productUsage: "None in production. The key is preserved only for bounded research questions.",
    productionContractIds: [],
    operationSays: "Nothing calls it in production, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "Deliberately zero in production.",
    blocker: {
      what: "A third-party intermediary is not the authority for current legislative membership; each legislature's own publication must be promoted before Reader use.",
      whose: "OURS",
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the adapter's own account of why it reads the bulk file", at: "lib/sources/plural/index.ts" }],
  },
  {
    id: "plural-bulk",
    source: "Open States bulk legislators",
    provider: "Plural (Open States), CC-0",
    family: "Federal bulk file",
    capability: "Every current state legislator in the country, with official emails.",
    disposition: "NOT_APPLICABLE",
    dispositionWhy: "The CC-0 file remains useful research evidence, but a third-party intermediary cannot be the production authority for current legislative membership.",
    credential: NO_KEY,
    adapter: { active: false, at: "lib/sources/plural/index.ts", says: "Manual research parser only; no production Reader or tracked writer calls it." },
    productUsage: "None in production. Historical rows are retained as research/test evidence only.",
    productionContractIds: [],
    operationSays: "Research retrieval has no production acquisition, execution, or promotion door.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "Not a production source, so no production-health claim is made.",
    spendConcern: "No key and no quota.",
    blocker: {
      what: "Official-publisher state membership is not yet projected for every covered state; Reader surfaces therefore show the holding as unavailable instead of falling back here.",
      whose: "OURS",
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the retained historical roster and the licence", at: "docs/sources.md — the keyless sources" }],
  },

  /* --------------------------------------------------------- STATE PORTAL */
  {
    id: "az-sos-campaign-finance",
    source: "Arizona Secretary of State campaign-finance portal",
    provider: "Arizona Secretary of State",
    family: "State portal",
    capability: "Arizona statewide and legislative committee filings, itemised transactions, filed officers and the whole committee register.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "Four public routes, no key. Each carries facts the other three do not, so a success on one retires none of the others.",
    credential: NO_KEY,
    adapter: { active: true, at: "lib/sources/az-seethemoney/", says: "A four-route portfolio rather than one endpoint, because the portal splits the record four ways." },
    productUsage: "Arizona state campaign money on a candidate's card.",
    productionContractIds: ["az-sos-campaign-finance"],
    operationSays: "Explicit owner invocation only. The canonical manual contract owns receipts, promotion, and Reader delivery.",
    restingHealth: "UNKNOWN",
    restingHealthWhy:
      "The canonical production-data panel owns attempts, validation, promotion, hold, and LKG state; this capability registry does not infer it.",
    spendConcern: "A public portal with no published ceiling. The request pace is set in the route descriptors rather than by a quota.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the four routes and what each carries alone", at: "lib/sources/az-seethemoney/index.ts" },
      { what: "the statutory filing officer for these offices", at: "data/campaign-finance/filing-regimes.json" },
    ],
  },
  {
    id: "nj-elec",
    source: "New Jersey ELEC search",
    provider: "New Jersey Election Law Enforcement Commission",
    family: "State portal",
    capability: "New Jersey committees and the money they reported.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "Two public endpoints, no key, no terms document and no robots file encountered on the search host.",
    credential: NO_KEY,
    adapter: { active: true, at: "the state money path under lib/funding/", says: "Reads the committee endpoint and the filing-data endpoint." },
    productUsage: "New Jersey state campaign money on a candidate's card.",
    productionContractIds: ["nj-elec-campaign-finance"],
    operationSays: "Explicit owner invocation only. The canonical manual contract owns receipts, promotion, and Reader delivery.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The canonical production-data panel owns attempts, validation, promotion, hold, and LKG state; this capability registry does not infer it.",
    spendConcern: "A public search host with no published ceiling.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the register row, its access shape and its permission finding", at: "docs/sources.md — state, county and local campaign finance" }],
  },
  {
    id: "nj-morris-clerk",
    source: "Morris County Clerk filed-candidate record",
    provider: "Morris County Clerk, New Jersey",
    family: "State portal",
    capability: "The certified list of who filed to run, and the filed-candidate documents behind it.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "The clerk's own published page and its documents. No key.",
    credential: NO_KEY,
    adapter: { active: true, at: "lib/sources/ballot-nj-morris/, scripts/build-nj-morris-ballot.mts", says: "Builds a candidate version, checks it against the clerk's published count, and promotes it only through the canonical production data plane." },
    productUsage: "The New Jersey pilot ballot, and the questionnaire invitations generated from it.",
    productionContractIds: ["nj-morris-filing"],
    operationSays: "The standing runner invokes the canonical filing contract; its durable events own cadence, health, and LKG.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The canonical production-data panel owns attempt, promotion, hold, LKG, and source-history state; this capability registry does not infer it.",
    spendConcern: "A public clerk's page. No key and no published ceiling.",
    blocker: {
      what: "The clerk revises documents on their own schedule and leaves the old path reachable, so a superseded document can still answer.",
      whose: "THEIRS",
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [
      { what: "the single production contract, cadence, retry, store and projection", at: "lib/civic-data/contracts.ts" },
      { what: "the superseded-path check and fail-closed candidate builder", at: "scripts/build-nj-morris-ballot.mts" },
    ],
  },

  /* ------------------------------------------------------ GEOSPATIAL / MAP */
  {
    id: "arcgis",
    source: "ArcGIS REST services",
    provider: "County and state GIS offices (Esri platform)",
    family: "Geospatial service",
    capability: "Published boundary and land-record layers — the polygons a county actually holds, named layer by layer.",
    disposition: "CREDENTIAL_NOT_REQUIRED",
    dispositionWhy: "Public REST services on government GIS hosts. No key.",
    credential: NO_KEY,
    adapter: { active: true, at: "scripts/arcgis-catalog.mts, lib/geo/district-overlap.ts", says: "A catalogue walk that names every layer a server holds, so a boundary claim can cite the layer it came from." },
    productUsage: "District overlap and boundary evidence behind the map.",
    productionContractIds: [],
    operationSays: "An engineer invokes the catalogue walk for a bounded jurisdiction investigation; it is not production runtime authority.",
    restingHealth: "AMBER",
    restingHealthWhy:
      "A GIS host publishes its services under a path that is not guessable and has already answered with a not-found on the obvious one, so a route that worked is not evidence that the neighbouring route exists.",
    spendConcern: "Public services with no published ceiling. The walk is paced rather than throttled by a quota.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the catalogue walk and the path that answered a not-found", at: "scripts/arcgis-catalog.mts" }],
  },
  {
    id: "maptiler",
    source: "MapTiler vector tiles",
    provider: "MapTiler",
    family: "Map tiles",
    capability: "The basemap the entry map draws on.",
    disposition: "ACTIVE",
    dispositionWhy: "A key is required, the website holds it, and every map view spends it.",
    credential: { required: true, holder: "SITE_RUNTIME", parts: 1 },
    adapter: { active: true, at: "lib/map/style.ts", says: "Builds the style URL the map loads." },
    productUsage: "Every map a reader sees.",
    productionContractIds: [],
    operationSays: "Reader requests call this live service; it has no civic-data acquisition or promotion contract.",
    restingHealth: "GREEN",
    restingHealthWhy:
      "The key was last proven by fetching the style document and counting its layers rather than by reading a status code, and the same style URL the application builds is the one that was called.",
    spendConcern:
      "Billed per map load, so this is the one credential here whose cost rises with reader traffic. Nothing on this page measures that; the billing account is the only place it is stated.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the proof — a style document with 30 layers, not an error page", at: "docs/credential-ledger.md" }],
  },
  {
    id: "anthropic",
    source: "Anthropic API",
    provider: "Anthropic",
    family: "Model provider",
    capability: "The question classifier behind the ask box, and the research fleet's paid model work.",
    disposition: "ACTIVE",
    dispositionWhy: "A key is required, the website holds it, and the classifier spends it on reader questions.",
    credential: { required: true, holder: "SITE_RUNTIME", parts: 1 },
    adapter: { active: true, at: "lib/routing/classifier.ts", says: "Classifies a reader's question. The research fleet holds a separate credential of its own." },
    productUsage: "Routing a reader's typed question to the right answer path.",
    productionContractIds: [],
    operationSays: "Reader requests call this live service; it has no civic-data acquisition or promotion contract.",
    restingHealth: "GREEN",
    restingHealthWhy: "The key was last proven by listing models and confirming at least one of them is a Claude model, rather than by reading a status code.",
    spendConcern:
      "This is a paid route and the only one here billed by the token. Spend is governed and shown on the research console, not on this page, and this row deliberately does not restate a number that lives there.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the proof — five models listed, at least one of them Claude", at: "docs/credential-ledger.md" }],
  },

  /* ------------------------------- NAMED IN THE HANDOFF, ABSENT FROM HERE */
  {
    id: "socrata",
    source: "Socrata open-data portals",
    provider: "Tyler Technologies (Socrata platform)",
    family: "Open-data platform",
    capability: "Whatever a given government has chosen to publish as a dataset on its Socrata portal.",
    disposition: "WIRE",
    dispositionWhy: "Scouts and Detectives can query the public catalog and read verified datasets through their shared Socrata API tool.",
    credential: { required: true, holder: "WORKSTATION", parts: 2 },
    adapter: { active: true, at: "lib/control-plane/scheduler/scout-api.ts", says: "socrata_api searches the catalog and reads dataset rows with the environment's application token." },
    productUsage: "Official government datasets used to fill a hunt's remaining gaps.",
    productionContractIds: [],
    operationSays: "The shared research tool captures catalog and dataset responses; no standing source contract is inferred.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made. A Socrata token raises a rate ceiling rather than unlocking data, so the cost of not holding one is speed, not access.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the shared read-only catalog and dataset tool", at: "lib/control-plane/scheduler/scout-api.ts" }],
  },
  {
    id: "sam-gov",
    source: "SAM.gov",
    provider: "General Services Administration",
    family: "Federal API",
    capability: "Federal contracting registrations and awards.",
    disposition: "WIRE",
    dispositionWhy: "Scouts and Detectives can read public contracting opportunities with the shared SAM.gov API tool.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: true, at: "lib/control-plane/scheduler/scout-api.ts", says: "sam_gov_api captures public opportunities using the configured environment key." },
    productUsage: "Government contracting opportunities relevant to a resident's place.",
    productionContractIds: [],
    operationSays: "Available in the shared research toolkit; no standing acquisition contract is inferred.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the shared public opportunities tool", at: "lib/control-plane/scheduler/scout-api.ts" }],
  },
  {
    id: "accela",
    source: "Accela permitting and licensing",
    provider: "Accela",
    family: "Open-data platform",
    capability: "Permits, licences and code enforcement for a jurisdiction that runs on Accela.",
    disposition: "PENDING_PROVIDER",
    dispositionWhy: "The provider application is pending. There is nothing to build until they answer, and no credential to hold yet.",
    credential: { required: true, holder: "WORKSTATION", parts: 2 },
    adapter: { active: false, at: null, says: "No adapter, and none can be written against an account that does not exist yet." },
    productUsage: "None.",
    productionContractIds: [],
    operationSays: "Nothing reads it, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "Waiting on the provider. Nothing has been called, so nothing has been measured.",
    spendConcern: "No calls are made.",
    blocker: {
      what: "The provider application has not been answered.",
      whose: "THEIRS",
    },
    ownerAction: null,
    namedOnly: true,
    evidence: [
      { what: "the handoff inventory that names it as pending", at: "§6 of the Admin C brief" },
      {
        what: "not to be confused with the IQM2 meeting portal, which Accela also owns and which this product already reads",
        at: "lib/hunt/platform-tenancy.ts",
      },
    ],
  },
  {
    id: "ckan",
    source: "CKAN open-data portals",
    provider: "Open Knowledge Foundation (CKAN platform)",
    family: "Open-data platform",
    capability: "Whatever a given government has chosen to publish as a dataset on its CKAN portal.",
    disposition: "WIRE",
    dispositionWhy: "Named in the handoff inventory. Nothing in this repository reads a CKAN portal.",
    credential: NO_KEY,
    adapter: { active: false, at: null, says: "No adapter. CKAN's catalogue endpoints are open, so what is missing is code rather than permission." },
    productUsage: "None.",
    productionContractIds: [],
    operationSays: "Nothing reads it, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made. CKAN portals are keyless for reading.",
    blocker: {
      what: "No reader question has been stated for this platform, so there is nothing yet for an adapter to be correct about.",
      whose: "OURS",
    },
    ownerAction: "Say which reader question a CKAN portal should answer, or mark this one not applicable.",
    namedOnly: true,
    evidence: [{ what: "the handoff inventory that names it", at: "§6 of the Admin C brief" }],
  },
  {
    id: "openfema",
    source: "OpenFEMA",
    provider: "Federal Emergency Management Agency",
    family: "Federal API",
    capability: "Federal disaster declarations, assistance and public-assistance projects by county.",
    disposition: "WIRE",
    dispositionWhy: "Named in the handoff inventory. Nothing in this repository names it.",
    credential: NO_KEY,
    adapter: { active: false, at: null, says: "No adapter. OpenFEMA is keyless, so what is missing is code rather than permission." },
    productUsage: "None.",
    productionContractIds: [],
    operationSays: "Nothing reads it, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: UNCALLED,
    spendConcern: "No calls are made. The service is keyless.",
    blocker: {
      what: "No reader question has been stated for this source, so there is nothing yet for an adapter to be correct about.",
      whose: "OURS",
    },
    ownerAction: "Say which reader question federal disaster data should answer, or mark this one not applicable.",
    namedOnly: true,
    evidence: [{ what: "the handoff inventory that names it", at: "§6 of the Admin C brief" }],
  },
  {
    id: "arizona-spotlight",
    source: "Arizona Spotlight",
    provider: "Not established",
    family: "State portal",
    capability: "Not established — the handoff names it and nothing in this repository does.",
    disposition: "WIRE",
    dispositionWhy:
      "Named in the handoff inventory as a keyless Arizona source. This repository holds an Arizona Secretary of State campaign-finance portal route, and whether that is the same thing under a different name has not been established, so the two are kept apart rather than merged on a guess.",
    credential: NO_KEY,
    adapter: { active: false, at: null, says: "No adapter carries this name." },
    productUsage: "None under this name.",
    productionContractIds: [],
    operationSays: "Nothing reads it under this name, so it has no production execution contract.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "Nothing has been called, because it is not established what would be called.",
    spendConcern: "No calls are made.",
    blocker: {
      what: "It is not established which Arizona source this names.",
      whose: "UNKNOWABLE_NOW",
    },
    ownerAction:
      "Confirm whether this is the Arizona Secretary of State campaign-finance portal already in use, or a separate source, and name it.",
    namedOnly: true,
    evidence: [
      { what: "the handoff inventory that names it", at: "§6 of the Admin C brief" },
      { what: "the Arizona campaign-finance portal this repository does read", at: "lib/sources/az-seethemoney/" },
    ],
  },
  {
    id: "google-civic",
    source: "Google Civic Information API",
    provider: "Google",
    family: "Federal API",
    capability: "An address to its political divisions.",
    disposition: "WIRE",
    dispositionWhy:
      "The shared research tool exposes the divisions lookup for unresolved place identity; it does not call the retired representatives endpoint.",
    credential: { required: true, holder: "WORKSTATION", parts: 1 },
    adapter: { active: true, at: "lib/control-plane/scheduler/scout-api.ts", says: "google_civic_api only calls the current divisions lookup." },
    productUsage: "Resolve remaining political-division identity gaps after reusing the canonical registry.",
    productionContractIds: [],
    operationSays: "Available to research workers; no standing acquisition contract is inferred.",
    restingHealth: "UNKNOWN",
    restingHealthWhy: "The toolkit exposes the route; availability is established by each actual response.",
    spendConcern: "No calls are made.",
    blocker: null,
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the shared divisions-only tool", at: "lib/control-plane/scheduler/scout-api.ts" }],
  },
];

/* ===========================================================================
 * 4. PRODUCTION EXECUTION BOUNDARY — the capability table is not a clock
 * ========================================================================== */

/**
 * The explicit terminal census. A non-empty value is an architecture defect:
 * no capability route may acquire or promote routine civic data in Actions.
 */
export const GITHUB_ROUTINE_DATA_ROUTE_IDS: readonly string[] = [];

export interface ProductionExecutionBoundary {
  readonly state: "SOFTWARE_CI_ONLY";
  readonly githubRoutineDataRouteIds: readonly string[];
  readonly authority: string;
  readonly operations: string;
}

export const PRODUCTION_EXECUTION_BOUNDARY: ProductionExecutionBoundary = {
  state: "SOFTWARE_CI_ONLY",
  githubRoutineDataRouteIds: GITHUB_ROUTINE_DATA_ROUTE_IDS,
  authority:
    "The typed contracts and durable store clock determine what is due. GitHub Actions does not acquire, promote, commit, build, or deploy routine civic data.",
  operations:
    "Canonical current attempts, promotions, holds, retries, LKG, next-due times, and Reader delivery appear in the production-data panel.",
};

/* ==========================================================================
 * 5. THE DERIVED HALF
 * ========================================================================== */

/**
 * What one adapter reads, and how many wired governments depend on it.
 *
 * Derived from the composite's own capability table and the wiring rows, so
 * this cannot go stale: adding an adapter or wiring a body changes the page on
 * the next render with nothing here to edit.
 */
function meetingAdapterRows(): DeclaredRoute[] {
  const totalBodies = SOURCE_WIRING.length;
  return CAPABILITIES.map((capability) => {
    const bodies = wiringForSourceName(capability.name).length;
    const label = platformLabel(capability.name);
    const partitionContracts = meetingPartitionsForSource(capability.name);
    return {
      id: `meeting-${capability.name}`,
      source: label,
      provider: "The government bodies that publish on this platform",
      family: "Meeting portal" as PlatformFamily,
      capability:
        bodies > 0
          ? `Agendas, notices and sittings for ${bodies} of the ${totalBodies} governments wired to a meeting platform.`
          : "Agendas, notices and sittings. No government is wired to this platform today.",
      disposition: "CREDENTIAL_NOT_REQUIRED" as Disposition,
      dispositionWhy: "A published government portal. No key.",
      credential: NO_KEY,
      adapter: {
        active: true,
        at: `lib/sources/${capability.name}/`,
        says: "Built only from SOURCE_WIRING rows. A platform with no wired government contributes nothing rather than acquiring a hidden tenant.",
      },
      productUsage: "Meetings on the map, and the agenda behind each one.",
      productionContractIds: partitionContracts.map((contract) => contract.id),
      operationSays: "The standing runner invokes one canonical contract per wired source/body; each partition's durable events own cadence, health, and LKG.",
      restingHealth: "UNKNOWN" as HealthLevel,
      restingHealthWhy: "The canonical production-data panel owns attempts, promotion, holds, retries, LKG, and source history; this capability registry does not infer it.",
      spendConcern: "Public portals with no published ceiling. The meetings contract gives each adapter a fixed request budget per attempt.",
      blocker:
        bodies === 0
          ? {
              what: "No government is wired to this platform, so the adapter reads nothing on each contract attempt.",
              whose: "OURS" as GapOwner,
            }
          : null,
      ownerAction: null,
      namedOnly: false,
      evidence: [
        { what: "the capability table this row is derived from", at: "lib/sources/composite/wiring.ts" },
        { what: "the wired governments and their per-adapter settings", at: "lib/registry/source-wiring.ts" },
      ],
    };
  });
}

/** A recognised platform with no adapter is engineering owed, and it is named. */
function unadaptedPlatformRows(): DeclaredRoute[] {
  const adapted = new Set(CAPABILITIES.map((c) => c.name));
  return UNHANDLED_PLATFORMS.filter((p) => !adapted.has(p.id)).map((platform) => ({
    id: `meeting-${platform.id}`,
    source: platform.label,
    provider: "The government bodies that publish on this platform",
    family: "Meeting portal" as PlatformFamily,
    capability: "Agendas and sittings, for any government that publishes on this platform.",
    disposition: "WIRE" as Disposition,
    dispositionWhy:
      "The tenancy sweep can recognise this platform when a government sits on it, and nothing here can read it. That is work that can be scoped, which is a different thing from a government that publishes nothing readable at all.",
    credential: NO_KEY,
    adapter: { active: false, at: null, says: "Recognised by the tenancy sweep, read by nothing." },
    productUsage: "None. A government on this platform is invisible to the meetings surface.",
    productionContractIds: [],
    operationSays: "Nothing reads it, so it has no production execution contract.",
    restingHealth: "UNKNOWN" as HealthLevel,
    restingHealthWhy: "Nothing reads this platform, so nothing measures it. The governments on it are not absent; they are unread.",
    spendConcern: "No calls are made.",
    blocker: {
      what: "No adapter reads this platform, so a government that publishes here cannot be shown at all.",
      whose: "OURS" as GapOwner,
    },
    ownerAction: null,
    namedOnly: false,
    evidence: [{ what: "the recognised-but-unread list this row is derived from", at: "lib/hunt/platform-tenancy.ts" }],
  }));
}

/** The human label for an adapter id, from the tenancy register where it has one. */
function platformLabel(id: string): string {
  const known = KNOWN_PLATFORMS.find((p) => p.id === id);
  if (known) return known.label;
  const unhandled = UNHANDLED_PLATFORMS.find((p) => p.id === id);
  if (unhandled) return unhandled.label;
  if (id === "legistar-insite") return "Legistar portal calendar";
  if (id === "clerksboards") return "Tucson Clerk boards application";
  if (id === "ical") return "Published calendar feed";
  return id;
}

/* ==========================================================================
 * 6. WHERE THE REGISTERS DISAGREE — the finding, not the footnote
 * ========================================================================== */

export interface RegisterDisagreement {
  /** What the two registers disagree about, in words. */
  readonly about: string;
  /** What each says, and which one the page believes. */
  readonly says: string;
  /** Where the owner saw it, for the fix queue. */
  readonly where: string;
}

/**
 * Compare the registers against each other and report where they differ.
 *
 * A registry that picks one register and calls it truth would ship one of these
 * disagreements as a fact. Deriving them instead means a disagreement that gets
 * fixed disappears from the page by itself, and a new one appears without
 * anybody remembering to look.
 */
export function registerDisagreements(): readonly RegisterDisagreement[] {
  const out: RegisterDisagreement[] = [];
  const adapted = new Set(CAPABILITIES.map((c) => c.name));

  for (const platform of UNHANDLED_PLATFORMS) {
    if (!adapted.has(platform.id)) continue;
    out.push({
      about: platform.label,
      says:
        `The tenancy sweep lists ${platform.label} as a platform with no adapter, and the meetings composite has ` +
        `one that reads ${wiringForSourceName(platform.id).length} wired meeting route(s). The composite is the one that runs, so the sweep is the register that is behind.`,
      where: "Sources · where the registers disagree",
    });
  }

  for (const platform of KNOWN_PLATFORMS) {
    if (adapted.has(platform.id)) continue;
    out.push({
      about: platform.label,
      says:
        `The tenancy sweep counts ${platform.label} as a platform this product already reads, and the meetings composite has no adapter by that name. ` +
        "A tenancy hit on it would be reported as cheap coverage that cannot actually be collected.",
      where: "Sources · where the registers disagree",
    });
  }

  for (const capability of CAPABILITIES) {
    if (wiringForSourceName(capability.name).length > 0) continue;
    out.push({
      about: platformLabel(capability.name),
      says:
        `An adapter for ${platformLabel(capability.name)} is registered on the meetings composite and no government is wired to it, so it reads nothing at every run.`,
      where: "Sources · where the registers disagree",
    });
  }

  return out;
}

/* ==========================================================================
 * 7. BUILDING THE VIEW
 * ========================================================================== */

export interface SourceRegistryInput {
  /** When the page rendered, for the as-of line. */
  readonly nowIso: string;
  /** Route id to whether every variable it needs is present, from {@link readCredentialPresence}. */
  readonly credentialPresence: Readonly<Record<string, boolean>>;
  /** Where that reading was taken, in words. Never a store's address. */
  readonly credentialReadIn: string;
}

export interface FamilyGroup {
  readonly family: PlatformFamily;
  readonly rows: readonly SourceRow[];
}

export interface SourceRegistryView {
  readonly asOf: string;
  readonly rows: readonly SourceRow[];
  readonly families: readonly FamilyGroup[];
  readonly byDisposition: Readonly<Record<Disposition, number>>;
  /** How many rows the page renders. The denominator every share below is over. */
  readonly routeCount: number;
  readonly inUse: Measured;
  readonly credentialsHeldAndUnspent: Measured;
  readonly namedOnly: Measured;
  readonly githubRoutineDataRoutes: Measured;
  readonly meetingCoverage: Measured;
  readonly needsYou: readonly SourceRow[];
  readonly executionBoundary: ProductionExecutionBoundary;
  readonly disagreements: readonly RegisterDisagreement[];
  /** Where current production-operation truth is read, said plainly. */
  readonly productionOutcomeAuthority: string;
}

/**
 * A credential reading, scoped to where it was taken.
 *
 * The whole of rule 2 lives in this function. A key present in this process is
 * evidence wherever it is supposed to live — presence is presence. A key ABSENT
 * from this process is evidence only about `SITE_RUNTIME`; anywhere else it is
 * a fact about what this page can see, and it is returned as a gap that says so.
 */
function credentialReadingFor(
  route: DeclaredRoute,
  presence: Readonly<Record<string, boolean>>,
  readIn: string,
): Held<CredentialReading> {
  if (!route.credential.required) {
    return held({ configured: false, readIn: HOLDER_SAYS.NONE });
  }
  const present = presence[route.id] === true;
  if (present) return held({ configured: true, readIn });
  if (route.credential.holder === "SITE_RUNTIME") {
    return held({ configured: false, readIn });
  }
  return gap(
    "UNKNOWABLE_NOW",
    `This key belongs in ${HOLDER_SAYS[route.credential.holder]}, which this page cannot see. It is not here, and that is not evidence either way.`,
  );
}

/**
 * Assemble every row. Nothing is fetched and nothing is read from disk; the
 * measured half arrives in `input`.
 */
export function buildSourceRegistry(input: SourceRegistryInput): SourceRegistryView {
  const declared: DeclaredRoute[] = [...DECLARED_ROUTES, ...meetingAdapterRows(), ...unadaptedPlatformRows()];
  const totalBodies = SOURCE_WIRING.length;
  const knownContractIds = new Set<string>([
    ...observableRoutineContracts().map((contract) => contract.id),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => contract.id),
  ]);

  const rows: SourceRow[] = declared.map((route) => {
    // This is a capability-to-contract join, not a second membership registry.
    // Membership, cadence and health remain solely in the permanent contract
    // registries and canonical outcome projection.
    for (const contractId of route.productionContractIds) {
      if (!knownContractIds.has(contractId)) {
        throw new Error(`${route.id}: unknown canonical production contract ${contractId}`);
      }
    }
    const canonicalProductionCapability = route.productionContractIds.length > 0;
    const operation: ProductionOperation = {
      contractIds: route.productionContractIds,
      says: route.operationSays,
    };
    const health = canonicalProductionCapability
      ? {
          level: "UNKNOWN" as const,
          why: "This capability table does not duplicate current production-data health. The canonical production-data panel derives it from durable events.",
        }
      : { level: route.restingHealth, why: route.restingHealthWhy };

    /*
     * LAST SUCCESS IS A CLAIM ABOUT A READ, NOT ABOUT A RUN. A source that was
       * This static capability registry does not own current source attempts.
       * Production contract rows get those dates from the canonical projection;
       * every other route gets a named gap rather than a manufactured date.
     */
    const lastSuccess: Held<string> = gap(
      "OURS",
      canonicalProductionCapability
        ? "Current attempt and success times are shown only in the canonical production-data panel above."
        : "Nothing records when this route last answered; no per-route history is published.",
    );

    const nextDue: Held<string> = gap(
      "OURS",
      canonicalProductionCapability
        ? "Current execution policy and next due time are shown only in the canonical production-data panel above."
        : "Nothing schedules this route, so nothing is owed on a date.",
    );

    const isMeetingAdapter = route.id.startsWith("meeting-") && route.adapter.active;
    const coverage: Held<Measured> = isMeetingAdapter
      ? held(
          measured(
            wiringForSourceName(route.id.slice("meeting-".length)).length,
            totalBodies,
            "the wired meeting routes this platform reads, out of every wired meeting route",
            "the wiring table, counted at render time",
          ),
        )
      : route.family === "Meeting portal"
        ? held(
            measured(
              0,
              totalBodies,
              "the wired meeting routes this platform reads, out of every wired meeting route",
              "the wiring table, counted at render time",
            ),
          )
        : gap(
            "OURS",
            "No per-route coverage figure is published anywhere this page can reach. Coverage by capability and by state is on the readiness panel; coverage by SOURCE is not measured by anything today.",
          );

    return {
      id: route.id,
      source: route.source,
      provider: route.provider,
      family: route.family,
      capability: route.capability,
      disposition: route.disposition,
      dispositionWhy: route.dispositionWhy,
      credential: route.credential,
      credentialReading: credentialReadingFor(route, input.credentialPresence, input.credentialReadIn),
      adapter: route.adapter,
      productUsage: route.productUsage,
      operation,
      lastSuccess,
      nextDue,
      health: health.level,
      healthWhy: health.why,
      coverage,
      spendConcern: route.spendConcern,
      blocker: route.blocker,
      ownerAction: route.ownerAction,
      namedOnly: route.namedOnly,
      evidence: route.evidence,
    };
  });

  const byDisposition = Object.fromEntries(
    DISPOSITIONS.map((d) => [d, rows.filter((r) => r.disposition === d).length]),
  ) as Record<Disposition, number>;

  const families: FamilyGroup[] = PLATFORM_FAMILIES.map((family) => ({
    family,
    rows: rows.filter((r) => r.family === family),
  })).filter((g) => g.rows.length > 0);

  const heldCredentials = rows.filter((r) => r.credential.required);
  const unspent = heldCredentials.filter(
    (r) => r.disposition === "PRESERVE" || r.disposition === "INTENTIONALLY_NOT_SPENT",
  );
  /*
   * THE UNIT ON BOTH SIDES IS A WIRING ROW, NOT A GOVERNMENT. A government can
   * hold two wiring rows — a portal and a calendar feed — and counting distinct
   * governments against a denominator of rows produced 119 of 123, a fraction
   * whose two halves were measured over different populations. That is the
   * exact shape `measured()` refuses elsewhere, so both sides are rows here and
   * the contract says so.
   */
  const readableTypes = new Set(CAPABILITIES.flatMap((c) => c.types));
  const readableRows = SOURCE_WIRING.filter((w) => readableTypes.has(w.agendaSourceType)).length;

  return {
    asOf: input.nowIso,
    rows,
    families,
    byDisposition,
    routeCount: rows.length,
    inUse: measured(
      rows.filter((r) => r.disposition === "ACTIVE" || r.disposition === "CREDENTIAL_NOT_REQUIRED").length,
      rows.length,
      "routes something in this product actually reads, out of every source or outside interface this repository can name; connection strings and admin secrets are infrastructure and are deliberately not counted here",
      "the declared routes plus the adapters and recognised platforms, counted at render time",
    ),
    credentialsHeldAndUnspent: measured(
      unspent.length,
      heldCredentials.length,
      "routes whose key is held and deliberately not spent, out of every route that needs a key",
      "counted from the built rows at render time",
    ),
    namedOnly: measured(
      rows.filter((r) => r.namedOnly).length,
      rows.length,
      "routes named in the handoff inventory that appear nowhere in this repository, out of every route on this page",
      "counted from the built rows at render time",
    ),
    githubRoutineDataRoutes: measured(
      GITHUB_ROUTINE_DATA_ROUTE_IDS.length,
      rows.length,
      "capability routes whose routine acquisition or promotion executes in GitHub Actions, out of every route on this page",
      "the explicit terminal-zero route census, checked against workflow files by deterministic tests",
    ),
    meetingCoverage: measured(
      readableRows,
      totalBodies,
      "wired meeting routes an adapter can actually read, out of every wired meeting route; a government holding two routes counts twice on both sides",
      "the composite's capability table checked against the wiring table at render time",
    ),
    needsYou: rows.filter((r) => r.ownerAction !== null),
    executionBoundary: PRODUCTION_EXECUTION_BOUNDARY,
    disagreements: registerDisagreements(),
    productionOutcomeAuthority:
      "Current production outcomes are read only from canonical candidates, events, and promotion pointers by the panel above. This capability table accepts no run record or mutable operations file.",
  };
}

/* ==========================================================================
 * 8. THE PAGE'S CHECKS ON ITSELF
 * ========================================================================== */

/** Every stated N, against the rows that will actually render beneath it. */
export function sourceRegistryCountClaims(view: SourceRegistryView): readonly CountClaim[] {
  const claims: CountClaim[] = [
    { label: "routes on this page", stated: view.routeCount, rendered: view.rows.length },
    {
      label: "routes that need you",
      stated: view.needsYou.length,
      rendered: view.rows.filter((r) => r.ownerAction !== null).length,
    },
    {
      label: "routes named in the handoff and absent from this repository",
      stated: view.namedOnly.value,
      rendered: view.rows.filter((r) => r.namedOnly).length,
    },
    {
      label: "routes using GitHub for routine data",
      stated: view.githubRoutineDataRoutes.value,
      rendered: view.executionBoundary.githubRoutineDataRouteIds.length,
    },
  ];
  for (const group of view.families) {
    claims.push({
      label: `rows under ${group.family}`,
      stated: group.rows.length,
      rendered: view.rows.filter((r) => r.family === group.family).length,
    });
  }
  return claims;
}

/** Every number the page is about to show, with its denominator and contract. */
export function sourceRegistryRenderedNumbers(view: SourceRegistryView): readonly RenderedNumber[] {
  const push = (label: string, m: Measured): RenderedNumber => ({
    label,
    value: m.value,
    denominator: m.denominator,
    contract: m.contract,
  });
  const numbers: RenderedNumber[] = [
    push("routes something reads", view.inUse),
    push("keys held and not spent", view.credentialsHeldAndUnspent),
    push("named in the handoff, absent here", view.namedOnly),
    push("using GitHub for routine data", view.githubRoutineDataRoutes),
    push("wired governments an adapter can read", view.meetingCoverage),
  ];
  for (const row of view.rows) {
    if (row.coverage.held) numbers.push(push(`coverage — ${row.source}`, row.coverage.value));
  }
  return numbers;
}
