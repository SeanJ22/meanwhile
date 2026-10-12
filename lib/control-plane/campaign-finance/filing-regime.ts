/**
 * The filing-regime registry: routing as data
 * (`data/campaign-finance/filing-regimes.json`), refusal as code. This module
 * loads and validates the registry (refusing malformed or ambiguous records by
 * stable code), selects the regime for a (jurisdiction, office class, date)
 * question, and reports NO_REGIME_ON_RECORD when nothing governs it. That is a
 * claim about this registry, never about a government, and there is no
 * fall-through default.
 *
 * `effective.from`/`through` bound a regime; a null bound is unbounded for
 * routing and an open provenance question on `effective.openQuestion`. Two
 * regimes may overlap only when linked by `supersedes`/`supersededBy`;
 * otherwise the whole registry is refused (`REGIME_AMBIGUOUS_OVERLAP`).
 *
 * Nothing here reads a clock. Without `asOf`, selection uses supersession.
 */

import {
  DISPOSITIONS,
  PERMISSION_STATES,
  TRANSPORT_STATES,
  type Disposition,
  type PermissionState,
  type TransportState,
} from "../../workstate/types.ts";
import {
  FILING_AUTHORITY_LEVELS,
  FILING_RECORD_CLASSES,
  OFFICE_LEVELS,
  type FilingAuthority,
  type FilingAuthorityLevel,
  type FilingRecordClass,
  type FilingRegime,
  type FilingRoutingRule,
  type OfficeLevel,
  type PlannedRoute,
} from "./model.ts";

/** The registry format this reader understands. A file claiming another is refused. */
export const FILING_REGIME_FORMAT_VERSION = 1;

/** Where the committed registry lives, relative to the repository root. */
export const FILING_REGIME_REGISTRY_PATH = ["data", "campaign-finance", "filing-regimes.json"];

/* ── The registry shape ───────────────────────────────────────────────────── */

/** How the concrete custodian is pinned down inside one regime: one for the whole jurisdiction, per county, or per municipality. */
export const CUSTODIAN_SCOPES = [
  /** One custodian for the whole jurisdiction. `scopeKey` is null. */
  "JURISDICTION_WIDE",
  /** One custodian per county. `scopeKey` is the county name, lower case. */
  "PER_COUNTY",
  /** One custodian per city or town. `scopeKey` is the municipality name, lower case. */
  "PER_MUNICIPALITY",
] as const;
export type CustodianScope = (typeof CUSTODIAN_SCOPES)[number];

/**
 * Who serves the records, which may be neither the office nor the authority
 * (e.g. a commercial vendor). `isVendorPlatform` keeps the permission question
 * separate from the custody question.
 */
export interface RegimePublisher {
  readonly name: string;
  readonly url: string | null;
  readonly isVendorPlatform: boolean;
  readonly note: string;
}

export interface RegimeCustodian {
  /** Null for a JURISDICTION_WIDE regime; otherwise the county or municipality key, lower case. */
  readonly scopeKey: string | null;
  readonly authority: FilingAuthority;
  readonly publisher: RegimePublisher | null;
}

/**
 * The provenance that makes this regime a claim. `statutoryQuote` is the
 * operative sentence verbatim, never a paraphrase. When the statute has not been
 * read, it and `statutoryBasis` are null and `openQuestion` says what is owed.
 */
export interface RegimeProvenance {
  readonly statutoryBasis: string | null;
  readonly statutoryQuote: string | null;
  readonly statutorySourceUrl: string | null;
  readonly statutoryReadOn: string | null;
  readonly openQuestion: string | null;
  /** Official records corroborating the routing — repo paths or walked URLs. */
  readonly officialRecord: readonly string[];
}

export interface RegimeEffectivePeriod {
  /** ISO date, or null for unbounded-in-the-past. Never a guess. */
  readonly from: string | null;
  /** ISO date, or null for still in force so far as we have read. */
  readonly through: string | null;
  /** What we do NOT know about the window. A null bound is not a claim of eternity. */
  readonly openQuestion: string | null;
}

export interface FilingRegimeRecord {
  readonly regimeId: string;
  /** Two-letter postal code, upper case, or "US" for the federal regime. */
  readonly jurisdiction: string;
  /** The contest / office / measure classes this rule routes. */
  readonly officeLevels: readonly OfficeLevel[];
  /** The filing authority's level, which MAY DIFFER from every office level above. */
  readonly authorityLevel: FilingAuthorityLevel;
  /** The custodian role, in the statute's own words. */
  readonly custodianRole: string;
  readonly custodianScope: CustodianScope;
  readonly provenance: RegimeProvenance;
  readonly effective: RegimeEffectivePeriod;
  /** The regime id this one replaced, when it replaced one. Both stay in the file. */
  readonly supersedes: string | null;
  /** The regime id that replaced this one. Both stay traceable. */
  readonly supersededBy: string | null;
  /** Route ids in the project method store (`data/method/knowledge.json`). */
  readonly methodRouteIds: readonly string[];
  /** Adapter route ids that bear on this regime's records. */
  readonly applicableRouteIds: readonly string[];
  readonly custodians: readonly RegimeCustodian[];
  /** Authorities regulating the same money without being the filing officer. */
  readonly coRegulators: readonly FilingAuthority[];
  /** Said when the routing rule is known and the concrete custodian is not. `{scope}` is substituted. */
  readonly custodianUnresolvedNote: string;
  readonly custodianUnresolvedRoutes: readonly PlannedRoute[];
}

export interface RegimeJurisdiction {
  readonly jurisdiction: string;
  readonly name: string;
  /** True when filing is split across custodians rather than centralised. */
  readonly federated: boolean;
  /** From the government's OWN table. Null when unknown — never estimated. */
  readonly filingJurisdictionCount: number | null;
  readonly filingJurisdictionBreakdown: string | null;
  readonly denominatorSource: string | null;
  readonly statutoryBasis: string | null;
  readonly statutorySourceUrl: string | null;
  readonly statutoryReadOn: string | null;
  readonly statutoryOpenQuestion: string | null;
}

export interface FilingRegimeRegistry {
  readonly formatVersion: number;
  /** The file's own statement of what it is and is not. Carried, never summarised. */
  readonly note: readonly string[];
  readonly jurisdictions: readonly RegimeJurisdiction[];
  readonly regimes: readonly FilingRegimeRecord[];
  /** Routes owed when NO regime governs the question. Never empty in a valid registry. */
  readonly noRegimeRoutes: readonly PlannedRoute[];
  /** Where this registry was read from, for every downstream citation. */
  readonly source: string;
}

/* ── Refusals, by stable code ─────────────────────────────────────────────── */

/** Every way a registry can be refused. Codes are stable; messages may be reworded. */
export const REGISTRY_ISSUE_CODES = [
  /** The file does not parse as a registry object at all. */
  "REGISTRY_MALFORMED",
  /** `formatVersion` is absent or is not the version this reader understands. */
  "REGISTRY_FORMAT_VERSION_UNSUPPORTED",
  /** No `noRegimeRoutes` — the unresolved path would have nothing to offer. */
  "REGISTRY_NO_UNRESOLVED_ROUTES",
  /** Two regimes share a `regimeId`. */
  "REGIME_ID_DUPLICATED",
  /** A regime names a jurisdiction with no `jurisdictions` row. */
  "REGIME_JURISDICTION_NOT_DECLARED",
  /** A required field is missing or the wrong type. */
  "REGIME_FIELD_INVALID",
  /** An office level, authority level, record class or scope outside the governed vocabulary. */
  "REGIME_VOCABULARY_UNKNOWN",
  /** A regime routes no office class, so nothing could ever select it. */
  "REGIME_NO_OFFICE_LEVELS",
  /** A regime has no custodian and no unresolved-custodian route — a dead end. */
  "REGIME_NO_CUSTODIANS",
  /** A custodian's `scopeKey` disagrees with the regime's `custodianScope`. */
  "REGIME_CUSTODIAN_SCOPE_MISMATCH",
  /** Two custodians in one regime claim the same scope key. */
  "REGIME_CUSTODIAN_SCOPE_DUPLICATED",
  /** `effective.through` is before `effective.from`. */
  "REGIME_EFFECTIVE_PERIOD_INVERTED",
  /** `supersedes` or `supersededBy` names a regime that is not in the file. */
  "REGIME_SUPERSESSION_DANGLING",
  /** A regime supersedes itself. */
  "REGIME_SUPERSESSION_SELF",
  /** Two regimes claim the same jurisdiction and office class over overlapping dates with no supersession link. */
  "REGIME_AMBIGUOUS_OVERLAP",
  /** A regime carries neither a quoted statute nor any official record. */
  "REGIME_PROVENANCE_ABSENT",
  /** A `statutoryBasis` with no `statutoryQuote`, or a quote with no basis. */
  "REGIME_PROVENANCE_INCOMPLETE",
  /** A planned route in the registry is malformed. */
  "REGIME_ROUTE_INVALID",
] as const;
export type RegistryIssueCode = (typeof REGISTRY_ISSUE_CODES)[number];

export interface RegistryIssue {
  readonly code: RegistryIssueCode;
  /** The regime the issue belongs to, or null for a whole-file issue. */
  readonly regimeId: string | null;
  readonly detail: string;
  /** What accepting this record anyway would have caused. Never omitted. */
  readonly whatItPrevents: string;
}

export class FilingRegimeRegistryInvalid extends Error {
  /** Declared explicitly: strip-types mode does not parse parameter properties. */
  readonly issues: readonly RegistryIssue[];
  readonly source: string;

  constructor(issues: readonly RegistryIssue[], source: string) {
    super(
      `The campaign-finance filing-regime registry at ${source} was REFUSED with ` +
        `${issues.length} issue(s): ` +
        issues.map((i) => `${i.code} (${i.regimeId ?? "registry"}) — ${i.detail}`).join(" | ") +
        ". A registry is refused whole rather than partly loaded: a partial routing table " +
        "sends money questions to the wrong government and reports the answer as a fact.",
    );
    this.name = "FilingRegimeRegistryInvalid";
    this.issues = issues;
    this.source = source;
  }
}

/* ── Validation ───────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function issue(
  code: RegistryIssueCode,
  regimeId: string | null,
  detail: string,
  whatItPrevents: string,
): RegistryIssue {
  return { code, regimeId, detail, whatItPrevents };
}

function validateAuthority(
  raw: unknown,
  regimeId: string,
  where: string,
  issues: RegistryIssue[],
): FilingAuthority | null {
  if (!isRecord(raw)) {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        regimeId,
        `${where} is not an object`,
        "A custodian that is not an object would resolve to undefined and be reported as a named authority.",
      ),
    );
    return null;
  }
  const level = raw.level;
  if (typeof level !== "string" || !(FILING_AUTHORITY_LEVELS as readonly string[]).includes(level)) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        regimeId,
        `${where}.level is ${JSON.stringify(level)}, which is not a FilingAuthorityLevel`,
        "A level outside the vocabulary cannot be compared against an office level, so the " +
          "level-mismatch finding — the whole point of this domain — would silently not fire.",
      ),
    );
    return null;
  }
  const recordClasses = raw.recordClasses;
  if (
    !isStringArray(recordClasses) ||
    !recordClasses.every((c) => (FILING_RECORD_CLASSES as readonly string[]).includes(c))
  ) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        regimeId,
        `${where}.recordClasses is not a list of FilingRecordClass values`,
        "An unknown record class would make a custodian look like it holds records it does not.",
      ),
    );
    return null;
  }
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.jurisdiction !== "string" ||
    !nullableString(raw.statutoryBasis) ||
    !nullableString(raw.statutoryQuote) ||
    !nullableString(raw.statutoryOpenQuestion) ||
    !isStringArray(raw.discoveredVia) ||
    !nullableString(raw.filingsUrl) ||
    !nullableString(raw.vendorPlatform)
  ) {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        regimeId,
        `${where} is missing a required FilingAuthority field or has one of the wrong type`,
        "A half-typed custodian renders as a named office with unchecked provenance.",
      ),
    );
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    level: level as FilingAuthorityLevel,
    jurisdiction: raw.jurisdiction,
    recordClasses: recordClasses as readonly FilingRecordClass[],
    statutoryBasis: raw.statutoryBasis,
    statutoryQuote: raw.statutoryQuote,
    statutoryOpenQuestion: raw.statutoryOpenQuestion,
    discoveredVia: raw.discoveredVia,
    filingsUrl: raw.filingsUrl,
    vendorPlatform: raw.vendorPlatform,
  };
}

function validateRoute(
  raw: unknown,
  regimeId: string | null,
  where: string,
  issues: RegistryIssue[],
): PlannedRoute | null {
  if (!isRecord(raw)) {
    issues.push(
      issue("REGIME_ROUTE_INVALID", regimeId, `${where} is not an object`, "An owed route that is " +
        "not a route leaves an unresolved custodian with nothing to walk, which reads as nothing to do."),
    );
    return null;
  }
  const disposition = raw.disposition;
  const permission = raw.permission;
  const transport = raw.transport;
  if (typeof disposition !== "string" || !(DISPOSITIONS as readonly string[]).includes(disposition)) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        regimeId,
        `${where}.disposition is ${JSON.stringify(disposition)}, outside the governed Disposition vocabulary`,
        "A disposition outside the vocabulary cannot be classified as open or terminal, so an " +
          "open route could be counted as finished.",
      ),
    );
    return null;
  }
  if (typeof permission !== "string" || !(PERMISSION_STATES as readonly string[]).includes(permission)) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        regimeId,
        `${where}.permission is ${JSON.stringify(permission)}, outside PERMISSION_STATES`,
        "Permission and transport are orthogonal; an unrecognised permission value " +
          "collapses that distinction.",
      ),
    );
    return null;
  }
  if (
    transport !== null &&
    (typeof transport !== "string" || !(TRANSPORT_STATES as readonly string[]).includes(transport))
  ) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        regimeId,
        `${where}.transport is ${JSON.stringify(transport)}, outside TRANSPORT_STATES`,
        "An unattempted route has NO transport reading; inventing one is a measurement nobody took.",
      ),
    );
    return null;
  }
  if (
    typeof raw.routeId !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.target !== "string" ||
    typeof raw.note !== "string" ||
    typeof raw.citation !== "string" ||
    raw.citation.trim().length === 0 ||
    !nullableNumber(raw.rung) ||
    !nullableString(raw.lastAttemptedOn)
  ) {
    issues.push(
      issue(
        "REGIME_ROUTE_INVALID",
        regimeId,
        `${where} is missing routeId/label/target/note/citation/rung/lastAttemptedOn or has one of the wrong type`,
        "A route with no citation is an assertion; a route with no note is a next move nobody can take.",
      ),
    );
    return null;
  }
  return {
    declaration: { routeId: raw.routeId, label: raw.label, target: raw.target },
    disposition: disposition as Disposition,
    note: raw.note,
    citation: raw.citation,
    permission: permission as PermissionState,
    transport: transport as TransportState | null,
    rung: raw.rung,
    lastAttemptedOn: raw.lastAttemptedOn,
  };
}

function validateRegime(raw: unknown, issues: RegistryIssue[]): FilingRegimeRecord | null {
  if (!isRecord(raw) || typeof raw.regimeId !== "string") {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        null,
        "a regime entry has no string regimeId",
        "A regime with no id cannot be superseded, cited or refused by name.",
      ),
    );
    return null;
  }
  const id = raw.regimeId;
  const before = issues.length;

  const officeLevels = raw.officeLevels;
  if (!isStringArray(officeLevels) || officeLevels.length === 0) {
    issues.push(
      issue(
        "REGIME_NO_OFFICE_LEVELS",
        id,
        "officeLevels is absent or empty",
        "A regime routing no office class can never be selected, so its jurisdiction would fall " +
          "to NO_REGIME_ON_RECORD while looking present in the file.",
      ),
    );
  } else if (!officeLevels.every((l) => (OFFICE_LEVELS as readonly string[]).includes(l))) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        id,
        `officeLevels contains a value outside OFFICE_LEVELS: ${officeLevels.join(", ")}`,
        "An office class nobody can ask about is a routing rule that never fires.",
      ),
    );
  }

  const authorityLevel = raw.authorityLevel;
  if (
    typeof authorityLevel !== "string" ||
    !(FILING_AUTHORITY_LEVELS as readonly string[]).includes(authorityLevel)
  ) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        id,
        `authorityLevel is ${JSON.stringify(authorityLevel)}, outside FILING_AUTHORITY_LEVELS`,
        "The authority level is half of the level-mismatch finding.",
      ),
    );
  }

  const custodianScope = raw.custodianScope;
  if (
    typeof custodianScope !== "string" ||
    !(CUSTODIAN_SCOPES as readonly string[]).includes(custodianScope)
  ) {
    issues.push(
      issue(
        "REGIME_VOCABULARY_UNKNOWN",
        id,
        `custodianScope is ${JSON.stringify(custodianScope)}, outside CUSTODIAN_SCOPES`,
        "Without a scope the resolver cannot know WHICH query field pins the custodian, and would " +
          "have to guess between a county and a municipality.",
      ),
    );
  }

  if (typeof raw.jurisdiction !== "string" || typeof raw.custodianRole !== "string") {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        id,
        "jurisdiction or custodianRole is missing or not a string",
        "The custodian role is the statute's own words for who holds the records.",
      ),
    );
  }

  const provenanceRaw = raw.provenance;
  let provenance: RegimeProvenance | null = null;
  if (
    !isRecord(provenanceRaw) ||
    !nullableString(provenanceRaw.statutoryBasis) ||
    !nullableString(provenanceRaw.statutoryQuote) ||
    !nullableString(provenanceRaw.statutorySourceUrl) ||
    !nullableString(provenanceRaw.statutoryReadOn) ||
    !nullableString(provenanceRaw.openQuestion) ||
    !isStringArray(provenanceRaw.officialRecord)
  ) {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        id,
        "provenance is absent or a field has the wrong type",
        "Provenance is the field whose whole job is being checkable.",
      ),
    );
  } else {
    const hasQuote =
      typeof provenanceRaw.statutoryQuote === "string" && provenanceRaw.statutoryQuote.trim().length > 0;
    const hasBasis =
      typeof provenanceRaw.statutoryBasis === "string" && provenanceRaw.statutoryBasis.trim().length > 0;
    if (hasQuote !== hasBasis) {
      issues.push(
        issue(
          "REGIME_PROVENANCE_INCOMPLETE",
          id,
          hasQuote
            ? "a statutory QUOTE is present with no statutoryBasis naming the provision it came from"
            : "a statutoryBasis is cited with no verbatim quote of the operative sentence",
          "A quote with no citation cannot be checked, and a citation with no quote invites a " +
            "paraphrase later — and a paraphrase of a routing rule is a different routing rule.",
        ),
      );
    }
    if (!hasQuote && provenanceRaw.officialRecord.length === 0) {
      issues.push(
        issue(
          "REGIME_PROVENANCE_ABSENT",
          id,
          "neither a quoted statute nor any official record backs this regime",
          "An unbacked regime record is a fabricated claim about which government holds a " +
            "candidate's money.",
        ),
      );
    }
    provenance = {
      statutoryBasis: provenanceRaw.statutoryBasis,
      statutoryQuote: provenanceRaw.statutoryQuote,
      statutorySourceUrl: provenanceRaw.statutorySourceUrl,
      statutoryReadOn: provenanceRaw.statutoryReadOn,
      openQuestion: provenanceRaw.openQuestion,
      officialRecord: provenanceRaw.officialRecord,
    };
  }

  const effectiveRaw = raw.effective;
  let effective: RegimeEffectivePeriod | null = null;
  if (
    !isRecord(effectiveRaw) ||
    !nullableString(effectiveRaw.from) ||
    !nullableString(effectiveRaw.through) ||
    !nullableString(effectiveRaw.openQuestion)
  ) {
    issues.push(
      issue(
        "REGIME_FIELD_INVALID",
        id,
        "effective is absent or a bound has the wrong type",
        "Without a window, a repealed regime routes a current contest.",
      ),
    );
  } else {
    if (
      typeof effectiveRaw.from === "string" &&
      typeof effectiveRaw.through === "string" &&
      effectiveRaw.through < effectiveRaw.from
    ) {
      issues.push(
        issue(
          "REGIME_EFFECTIVE_PERIOD_INVERTED",
          id,
          `effective.through ${effectiveRaw.through} is before effective.from ${effectiveRaw.from}`,
          "An inverted window is effective on NO date, so the regime silently never applies.",
        ),
      );
    }
    effective = {
      from: effectiveRaw.from,
      through: effectiveRaw.through,
      openQuestion: effectiveRaw.openQuestion,
    };
  }

  if (!nullableString(raw.supersedes) || !nullableString(raw.supersededBy)) {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "supersedes/supersededBy must be a string or null", "A " +
        "supersession link that is not a link loses one of the two versions."),
    );
  }
  if (raw.supersedes === id || raw.supersededBy === id) {
    issues.push(
      issue(
        "REGIME_SUPERSESSION_SELF",
        id,
        "the regime names itself in supersedes/supersededBy",
        "A self-superseding regime makes the successor search non-terminating and the lineage unreadable.",
      ),
    );
  }

  if (!isStringArray(raw.methodRouteIds) || !isStringArray(raw.applicableRouteIds)) {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "methodRouteIds/applicableRouteIds must be string lists", "A " +
        "regime with no route ids is a custodian nobody knows how to reach."),
    );
  }

  const custodiansRaw = raw.custodians;
  const custodians: RegimeCustodian[] = [];
  if (!Array.isArray(custodiansRaw)) {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "custodians is not a list", "Without a custodian list the " +
        "regime resolves to nothing while claiming to route."),
    );
  } else {
    const seenScopes = new Set<string>();
    for (const [index, entry] of custodiansRaw.entries()) {
      if (!isRecord(entry)) {
        issues.push(
          issue("REGIME_FIELD_INVALID", id, `custodians[${index}] is not an object`, "A malformed " +
            "custodian resolves to undefined and is reported as a named authority."),
        );
        continue;
      }
      const scopeKey = entry.scopeKey;
      if (!nullableString(scopeKey)) {
        issues.push(
          issue("REGIME_FIELD_INVALID", id, `custodians[${index}].scopeKey must be a string or null`,
            "A scope key of the wrong type never matches, so a known custodian reads as unknown."),
        );
        continue;
      }
      if (custodianScope === "JURISDICTION_WIDE" && scopeKey !== null) {
        issues.push(
          issue(
            "REGIME_CUSTODIAN_SCOPE_MISMATCH",
            id,
            `custodianScope is JURISDICTION_WIDE but custodians[${index}].scopeKey is ${JSON.stringify(scopeKey)}`,
            "A keyed custodian under a jurisdiction-wide scope is unreachable — the resolver looks " +
              "for the null key and reports the custodian unresolved.",
          ),
        );
      }
      if (custodianScope !== "JURISDICTION_WIDE" && scopeKey === null) {
        issues.push(
          issue(
            "REGIME_CUSTODIAN_SCOPE_MISMATCH",
            id,
            `custodianScope is ${custodianScope} but custodians[${index}].scopeKey is null`,
            "An unkeyed custodian under a per-county scope would answer for ALL counties — which is " +
              "the fall-through this registry exists to make impossible.",
          ),
        );
      }
      const key = scopeKey === null ? "\u0000JURISDICTION_WIDE" : scopeKey.toLowerCase();
      if (seenScopes.has(key)) {
        issues.push(
          issue(
            "REGIME_CUSTODIAN_SCOPE_DUPLICATED",
            id,
            `two custodians claim scope key ${JSON.stringify(scopeKey)}`,
            "Two custodians for one place is the same coin flip as two regimes for one contest.",
          ),
        );
      }
      seenScopes.add(key);

      const authority = validateAuthority(entry.authority, id, `custodians[${index}].authority`, issues);
      if (!authority) continue;

      let publisher: RegimePublisher | null = null;
      if (entry.publisher !== null && entry.publisher !== undefined) {
        const p = entry.publisher;
        if (
          !isRecord(p) ||
          typeof p.name !== "string" ||
          !nullableString(p.url) ||
          typeof p.isVendorPlatform !== "boolean" ||
          typeof p.note !== "string"
        ) {
          issues.push(
            issue("REGIME_FIELD_INVALID", id, `custodians[${index}].publisher has a bad field`,
              "The publisher may be neither the office nor the authority; a malformed one credits " +
                "a government with a vendor's platform or the reverse."),
          );
          continue;
        }
        publisher = { name: p.name, url: p.url, isVendorPlatform: p.isVendorPlatform, note: p.note };
      }
      custodians.push({ scopeKey, authority, publisher });
    }
  }

  const unresolvedRoutes: PlannedRoute[] = [];
  if (!Array.isArray(raw.custodianUnresolvedRoutes)) {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "custodianUnresolvedRoutes is not a list", "An unresolved " +
        "custodian with no owed routes reads as nothing left to do."),
    );
  } else {
    for (const [index, entry] of raw.custodianUnresolvedRoutes.entries()) {
      const route = validateRoute(entry, id, `custodianUnresolvedRoutes[${index}]`, issues);
      if (route) unresolvedRoutes.push(route);
    }
  }

  if (custodians.length === 0 && unresolvedRoutes.length === 0) {
    issues.push(
      issue(
        "REGIME_NO_CUSTODIANS",
        id,
        "the regime names no custodian and no route toward one",
        "A regime that resolves to nobody and owes nothing is a dead end wearing a routing rule's face.",
      ),
    );
  }

  const coRegulators: FilingAuthority[] = [];
  if (Array.isArray(raw.coRegulators)) {
    for (const [index, entry] of raw.coRegulators.entries()) {
      const authority = validateAuthority(entry, id, `coRegulators[${index}]`, issues);
      if (authority) coRegulators.push(authority);
    }
  } else {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "coRegulators is not a list", "A model with one custodian " +
        "slot per contest silently drops a second authority over the same money."),
    );
  }

  if (typeof raw.custodianUnresolvedNote !== "string") {
    issues.push(
      issue("REGIME_FIELD_INVALID", id, "custodianUnresolvedNote is not a string", "An unresolved " +
        "custodian must say what is unresolved and against which denominator."),
    );
  }

  if (issues.length !== before) return null;

  return {
    regimeId: id,
    jurisdiction: raw.jurisdiction as string,
    officeLevels: officeLevels as readonly OfficeLevel[],
    authorityLevel: authorityLevel as FilingAuthorityLevel,
    custodianRole: raw.custodianRole as string,
    custodianScope: custodianScope as CustodianScope,
    provenance: provenance as RegimeProvenance,
    effective: effective as RegimeEffectivePeriod,
    supersedes: raw.supersedes as string | null,
    supersededBy: raw.supersededBy as string | null,
    methodRouteIds: raw.methodRouteIds as readonly string[],
    applicableRouteIds: raw.applicableRouteIds as readonly string[],
    custodians,
    coRegulators,
    custodianUnresolvedNote: raw.custodianUnresolvedNote as string,
    custodianUnresolvedRoutes: unresolvedRoutes,
  };
}

/** Do two windows share at least one day? A null bound is unbounded on that side. */
export function effectivePeriodsOverlap(
  a: RegimeEffectivePeriod,
  b: RegimeEffectivePeriod,
): boolean {
  const aEndsBeforeBStarts = a.through !== null && b.from !== null && a.through < b.from;
  const bEndsBeforeAStarts = b.through !== null && a.from !== null && b.through < a.from;
  return !aEndsBeforeBStarts && !bEndsBeforeAStarts;
}

/** Is this regime in force on `asOf`? Null bounds are unbounded on their side. */
export function regimeEffectiveOn(regime: FilingRegimeRecord, asOf: string): boolean {
  if (regime.effective.from !== null && asOf < regime.effective.from) return false;
  if (regime.effective.through !== null && asOf > regime.effective.through) return false;
  return true;
}

/** The non-throwing validator. `loadFilingRegimeRegistry` is its throwing face. */
export function validateFilingRegimeRegistry(
  raw: unknown,
  source: string,
): { registry: FilingRegimeRegistry | null; issues: readonly RegistryIssue[] } {
  const issues: RegistryIssue[] = [];

  if (!isRecord(raw)) {
    issues.push(
      issue("REGISTRY_MALFORMED", null, `${source} did not parse as an object`, "A registry that " +
        "is not a registry would leave every jurisdiction unrouted while looking like a load failure."),
    );
    return { registry: null, issues };
  }
  if (raw.formatVersion !== FILING_REGIME_FORMAT_VERSION) {
    issues.push(
      issue(
        "REGISTRY_FORMAT_VERSION_UNSUPPORTED",
        null,
        `formatVersion is ${JSON.stringify(raw.formatVersion)}; this reader understands ${FILING_REGIME_FORMAT_VERSION}`,
        "Reading a later format with an earlier reader drops the fields the later format added — " +
          "silently, and exactly in the fields a new format was written to carry.",
      ),
    );
    return { registry: null, issues };
  }

  const jurisdictions: RegimeJurisdiction[] = [];
  if (!Array.isArray(raw.jurisdictions)) {
    issues.push(
      issue("REGISTRY_MALFORMED", null, "jurisdictions is not a list", "Without jurisdiction rows " +
        "there is no denominator for any coverage claim."),
    );
  } else {
    for (const [index, entry] of raw.jurisdictions.entries()) {
      if (
        !isRecord(entry) ||
        typeof entry.jurisdiction !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.federated !== "boolean" ||
        !nullableNumber(entry.filingJurisdictionCount) ||
        !nullableString(entry.filingJurisdictionBreakdown) ||
        !nullableString(entry.denominatorSource) ||
        !nullableString(entry.statutoryBasis) ||
        !nullableString(entry.statutorySourceUrl) ||
        !nullableString(entry.statutoryReadOn) ||
        !nullableString(entry.statutoryOpenQuestion)
      ) {
        issues.push(
          issue("REGISTRY_MALFORMED", null, `jurisdictions[${index}] has a missing or bad field`,
            "A half-typed jurisdiction row loses the filing-jurisdiction denominator, and a " +
              "coverage claim without its denominator is meaningless."),
        );
        continue;
      }
      jurisdictions.push({
        jurisdiction: entry.jurisdiction,
        name: entry.name,
        federated: entry.federated,
        filingJurisdictionCount: entry.filingJurisdictionCount,
        filingJurisdictionBreakdown: entry.filingJurisdictionBreakdown,
        denominatorSource: entry.denominatorSource,
        statutoryBasis: entry.statutoryBasis,
        statutorySourceUrl: entry.statutorySourceUrl,
        statutoryReadOn: entry.statutoryReadOn,
        statutoryOpenQuestion: entry.statutoryOpenQuestion,
      });
    }
  }

  const regimes: FilingRegimeRecord[] = [];
  if (!Array.isArray(raw.regimes)) {
    issues.push(
      issue("REGISTRY_MALFORMED", null, "regimes is not a list", "No regimes means every contest " +
        "resolves NO_REGIME_ON_RECORD, which is honest but would hide a broken file behind an " +
        "honest-looking state."),
    );
  } else {
    for (const entry of raw.regimes) {
      const regime = validateRegime(entry, issues);
      if (regime) regimes.push(regime);
    }
  }

  const noRegimeRoutes: PlannedRoute[] = [];
  if (!Array.isArray(raw.noRegimeRoutes) || raw.noRegimeRoutes.length === 0) {
    issues.push(
      issue(
        "REGISTRY_NO_UNRESOLVED_ROUTES",
        null,
        "noRegimeRoutes is absent or empty",
        "NO_REGIME_ON_RECORD must always name the next move. An unresolved jurisdiction with no " +
          "owed route is indistinguishable, to a later session, from a jurisdiction with nothing to find.",
      ),
    );
  } else {
    for (const [index, entry] of raw.noRegimeRoutes.entries()) {
      const route = validateRoute(entry, null, `noRegimeRoutes[${index}]`, issues);
      if (route) noRegimeRoutes.push(route);
    }
  }

  /* ── Cross-record checks: ids, jurisdictions, supersession, ambiguity ──── */

  const byId = new Map<string, FilingRegimeRecord>();
  for (const regime of regimes) {
    if (byId.has(regime.regimeId)) {
      issues.push(
        issue(
          "REGIME_ID_DUPLICATED",
          regime.regimeId,
          "two regimes share this id",
          "A duplicated id makes supersession links point at two records, so one version of the " +
            "law becomes unreachable.",
        ),
      );
    }
    byId.set(regime.regimeId, regime);
  }

  const declared = new Set(jurisdictions.map((j) => j.jurisdiction));
  for (const regime of regimes) {
    if (!declared.has(regime.jurisdiction)) {
      issues.push(
        issue(
          "REGIME_JURISDICTION_NOT_DECLARED",
          regime.regimeId,
          `jurisdiction "${regime.jurisdiction}" has no row in jurisdictions`,
          "The jurisdiction row carries the filing-jurisdiction denominator and the statute. A " +
            "regime without one can route money and cannot say how many filing jurisdictions it " +
            "is one of.",
        ),
      );
    }
    for (const link of [regime.supersedes, regime.supersededBy]) {
      if (link !== null && !byId.has(link)) {
        issues.push(
          issue(
            "REGIME_SUPERSESSION_DANGLING",
            regime.regimeId,
            `names regime "${link}", which is not in this registry`,
            "An amendment must keep BOTH versions traceable. A dangling link has already lost one.",
          ),
        );
      }
    }
  }

  for (let i = 0; i < regimes.length; i += 1) {
    for (let j = i + 1; j < regimes.length; j += 1) {
      const a = regimes[i];
      const b = regimes[j];
      if (a.jurisdiction !== b.jurisdiction) continue;
      const sharedClasses = a.officeLevels.filter((l) => b.officeLevels.includes(l));
      if (sharedClasses.length === 0) continue;
      if (!effectivePeriodsOverlap(a.effective, b.effective)) continue;
      const linked =
        a.supersedes === b.regimeId ||
        a.supersededBy === b.regimeId ||
        b.supersedes === a.regimeId ||
        b.supersededBy === a.regimeId;
      if (linked) continue;
      issues.push(
        issue(
          "REGIME_AMBIGUOUS_OVERLAP",
          a.regimeId,
          `"${a.regimeId}" and "${b.regimeId}" both claim ${a.jurisdiction} / ` +
            `${sharedClasses.join(", ")} over overlapping effective dates, and neither supersedes the other`,
          "Two routing rules for one contest is not a tie to be broken. Picking either one picks " +
            "WHICH GOVERNMENT we say holds a candidate's money, with no evidence for the choice — " +
            "and the wrong pick then produces a hunt against the wrong custodian and an absence " +
            "asserted about the right one.",
        ),
      );
    }
  }

  if (issues.length > 0) return { registry: null, issues };

  const note = isStringArray(raw._note) ? raw._note : typeof raw._note === "string" ? [raw._note] : [];

  return {
    registry: {
      formatVersion: FILING_REGIME_FORMAT_VERSION,
      note,
      jurisdictions,
      regimes,
      noRegimeRoutes,
      source,
    },
    issues: [],
  };
}

/** Load a registry from a parsed object, throwing `FilingRegimeRegistryInvalid` on any issue. Refusal is whole. */
export function loadFilingRegimeRegistry(raw: unknown, source: string): FilingRegimeRegistry {
  const { registry, issues } = validateFilingRegimeRegistry(raw, source);
  if (!registry) throw new FilingRegimeRegistryInvalid(issues, source);
  return registry;
}

/* ── Selection ────────────────────────────────────────────────────────────── */

export interface RegimeSelection {
  readonly regime: FilingRegimeRecord | null;
  /** Set when two unlinked regimes claim the question. Never resolved by guessing. */
  readonly ambiguity: RegistryIssue | null;
  /** The jurisdiction row, when one is declared. Carries the denominator. */
  readonly jurisdictionRecord: RegimeJurisdiction | null;
  readonly why: string;
}

export interface RegimeQuery {
  readonly jurisdiction: string;
  readonly officeLevel: OfficeLevel;
  /** The date the question is asked about. Omitted selects by supersession; nothing here reads a clock. */
  readonly asOf?: string | null;
}

/** A federal office files federally wherever it is on the ballot: a rule on office class, not state. */
function selectionJurisdiction(query: RegimeQuery): string {
  return query.officeLevel === "FEDERAL" ? "US" : query.jurisdiction;
}

/**
 * The regime governing one (jurisdiction, office class, date) question, or
 * null. No nearest match and no state or FEC default.
 */
export function selectRegime(registry: FilingRegimeRegistry, query: RegimeQuery): RegimeSelection {
  const jurisdiction = selectionJurisdiction(query);
  const jurisdictionRecord =
    registry.jurisdictions.find((j) => j.jurisdiction === jurisdiction) ?? null;

  const matching = registry.regimes.filter(
    (r) => r.jurisdiction === jurisdiction && r.officeLevels.includes(query.officeLevel),
  );

  if (matching.length === 0) {
    return {
      regime: null,
      ambiguity: null,
      jurisdictionRecord,
      why:
        `No filing regime in ${registry.source} governs ${jurisdiction} / ${query.officeLevel}. ` +
        "That is a fact about this registry and about nothing else: the statute has not been read, " +
        "so the custodian is NOT KNOWN — which is a different thing entirely from there being none.",
    };
  }

  const asOf = query.asOf ?? null;
  let inWindow =
    asOf === null
      ? matching.filter((r) => r.supersededBy === null)
      : matching.filter((r) => regimeEffectiveOn(r, asOf));

  if (inWindow.length === 0) {
    return {
      regime: null,
      ambiguity: null,
      jurisdictionRecord,
      why:
        `${matching.length} regime(s) govern ${jurisdiction} / ${query.officeLevel}, and none is in ` +
        `force ${asOf === null ? "un-superseded" : `on ${asOf}`}. The routing rule for that date has ` +
        "not been read from source, and the regime we HAVE read is evidence about its own period only.",
    };
  }

  if (inWindow.length > 1) {
    // On a boundary date the successor wins, only via an explicit supersession link.
    const successors = inWindow.filter(
      (r) => !inWindow.some((other) => other !== r && r.supersededBy === other.regimeId),
    );
    if (successors.length > 0) inWindow = successors;
  }

  if (inWindow.length > 1) {
    return {
      regime: null,
      ambiguity: issue(
        "REGIME_AMBIGUOUS_OVERLAP",
        inWindow[0].regimeId,
        `${inWindow.map((r) => r.regimeId).join(" and ")} all govern ${jurisdiction} / ` +
          `${query.officeLevel}${asOf === null ? "" : ` on ${asOf}`} with no supersession between them`,
        "Picking one would pick which government we say holds this money, with no evidence for the choice.",
      ),
      jurisdictionRecord,
      why:
        `AMBIGUOUS: ${inWindow.map((r) => r.regimeId).join(", ")} all claim this question. The ` +
        "registry loader refuses this shape, so reaching it means the registry was built in memory " +
        "rather than loaded. Nothing is selected, and nothing is guessed.",
    };
  }

  const regime = inWindow[0];
  return {
    regime,
    ambiguity: null,
    jurisdictionRecord,
    why:
      regime.provenance.statutoryQuote !== null
        ? `${regime.provenance.statutoryBasis}: "${regime.provenance.statutoryQuote}".`
        : `Regime ${regime.regimeId}, established by official record: ` +
          `${regime.provenance.officialRecord.join("; ")}. The statute itself is not read from ` +
          `source here — ${regime.provenance.openQuestion ?? "and that is owed"}.`,
  };
}

/**
 * The custodian for one place inside a regime, or null when the rule is known
 * and the office holding it is not. Never falls back to the jurisdiction-wide
 * custodian.
 */
export function selectCustodian(
  regime: FilingRegimeRecord,
  place: { county?: string | null; municipality?: string | null },
): { custodian: RegimeCustodian | null; scopeAsked: string | null } {
  if (regime.custodianScope === "JURISDICTION_WIDE") {
    return { custodian: regime.custodians.find((c) => c.scopeKey === null) ?? null, scopeAsked: null };
  }
  const asked =
    regime.custodianScope === "PER_COUNTY" ? (place.county ?? null) : (place.municipality ?? null);
  if (asked === null || asked.trim().length === 0) {
    return { custodian: null, scopeAsked: null };
  }
  const key = asked.trim().toLowerCase();
  return {
    custodian: regime.custodians.find((c) => (c.scopeKey ?? "").toLowerCase() === key) ?? null,
    scopeAsked: asked,
  };
}

/* ── Derived views ────────────────────────────────────────────────────────── */

/**
 * The jurisdiction's `FilingRegime`, assembled from the registry rows. One
 * routing row per (regime, office level), so an office level differing from its
 * authority level stays visible.
 */
export function jurisdictionFilingRegime(
  registry: FilingRegimeRegistry,
  jurisdiction: string,
  asOf?: string | null,
): FilingRegime | null {
  const row = registry.jurisdictions.find((j) => j.jurisdiction === jurisdiction);
  if (!row) return null;

  const regimes = registry.regimes
    .filter((r) => r.jurisdiction === jurisdiction)
    .filter((r) => (asOf === null || asOf === undefined ? r.supersededBy === null : regimeEffectiveOn(r, asOf)));

  const routing: FilingRoutingRule[] = [];
  for (const regime of regimes) {
    for (const officeLevel of regime.officeLevels) {
      routing.push({
        officeLevel,
        authorityLevel: regime.authorityLevel,
        custodianRole: regime.custodianRole,
        quote:
          regime.provenance.statutoryQuote ??
          "NOT QUOTED — the filing-officer provision for this regime has not been read from source " +
            "in this repository.",
      });
    }
  }

  return {
    jurisdiction: row.jurisdiction,
    statutoryBasis: row.statutoryBasis,
    statutorySourceUrl: row.statutorySourceUrl,
    statutoryReadOn: row.statutoryReadOn,
    federated: row.federated,
    filingJurisdictionCount: row.filingJurisdictionCount,
    filingJurisdictionBreakdown: row.filingJurisdictionBreakdown,
    denominatorSource: row.denominatorSource,
    routing,
  };
}

/** Every custodian and co-regulator in the registry, by authority id. */
export function authoritiesById(registry: FilingRegimeRegistry): ReadonlyMap<string, FilingAuthority> {
  const map = new Map<string, FilingAuthority>();
  for (const regime of registry.regimes) {
    for (const custodian of regime.custodians) map.set(custodian.authority.id, custodian.authority);
    for (const coRegulator of regime.coRegulators) map.set(coRegulator.id, coRegulator);
  }
  return map;
}

/** One authority by id, or a thrown refusal. Callers are import-time constants in `authority.ts`. */
export function requireAuthority(registry: FilingRegimeRegistry, id: string): FilingAuthority {
  const found = authoritiesById(registry).get(id);
  if (!found) {
    throw new FilingRegimeRegistryInvalid(
      [
        issue(
          "REGIME_FIELD_INVALID",
          null,
          `no custodian or co-regulator with id "${id}" is in the registry`,
          "Code that names a custodian the data no longer carries would resolve to undefined and " +
            "report an authority that does not exist.",
        ),
      ],
      registry.source,
    );
  }
  return found;
}
