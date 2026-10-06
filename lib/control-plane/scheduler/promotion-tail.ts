/**
 * **THE PROMOTION TAIL — RULING 224, IMPLEMENTED.**
 * (Session C, PART D4, 2026-08-31.)
 *
 * > Acquisition without promotion is inventory, not product. An acquisition
 * > obligation's completion contract extends to the READER: the WorkItem does
 * > not close when evidence reaches the vault; it closes when the reader-facing
 * > surface reflects the acquired truth or renders the honest gap state. Held
 * > data with no live promotion tail is a defect.
 *
 * Research promotion is ON (docs/rulings.md §3, §9; the activation gate in
 * `promotion/activation-policy.ts`). A staged record publishes as soon as it
 * passes §3, through the typed reader door for its class; a class with no door
 * yet stays staged as the named gap it is.
 *
 * ## The split this file draws
 *
 * ```
 *   HERE, EVERY CYCLE, NO OPERATOR
 *     acquire -> vault -> extract -> normalize -> snapshot -> STAGED
 *
 *   THE PUBLICATION DOORS, EVERY CYCLE, NO OPERATOR
 *     STAGED -> §3 -> reader-visible
 * ```
 *
 * This module does the first line only. **This module writes only under `.runtime/control-plane/staging/`
 * and can write nowhere else** — it never touches `data/funding/`,
 * `data/meetings-snapshot.json`, `data/ballot/` or any other reader-content
 * path, and `tests/obligation-registry.test.ts` asserts that over the module's
 * own output rather than over a promise in this comment.
 *
 * ## THE STAGED STATE IS A FILE, not a status
 *
 * A later session must be able to point at it. So each staged record set is a
 * real JSON file named for its obligation, and
 * `.runtime/control-plane/staging/manifest.json` lists every entry with its state,
 * its date, the obligation it answers, the route it came from, its next due
 * time and its path. An in-memory "staged" would prove nothing tomorrow.
 *
 * ## A WALL STAGES TOO, and that is the second half of RULING 224
 *
 * The contract is satisfied EITHER by the surface reflecting acquired truth OR
 * by it rendering the honest gap state, and the second is not a lesser outcome.
 * So a route that hit `REQUIRES_NEW_ADAPTER` or `BLOCKED_CURRENTLY` produces a
 * `STAGED_GAP` entry carrying the NAMED wall, the obligation that is still
 * live, and the persisted next-due — everything a reader surface needs to say
 * whose gap it is and that it is still being worked. A wall that resolved
 * silently to a generic placeholder would not satisfy anything.
 *
 * ## Normalization is HONEST about what it could not parse
 *
 * A route with no normalizer produces `STAGED_GAP` with state
 * `NORMALIZER_MISSING` and the next move named. It does NOT produce an empty
 * record set: a zero-row normalization of a document that carried 370 rows is a
 * FAILED normalization, and it may never be staged as a snapshot of nothing.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { RouteDescriptor } from "./registry.ts";

/** The one directory this module may write to. Enforced, not just documented. */
export const STAGING_DIR = [".runtime", "control-plane", "staging"] as const;
export const STAGING_MANIFEST = "manifest.json";

export const STAGED_STATES = [
  /** Normalized, snapshotted, and ready for a session to carry the last mile. */
  "STAGED_PROMOTION_READY",
  /** A named wall or a missing normalizer. The honest gap a surface renders. */
  "STAGED_GAP",
] as const;
export type StagedState = (typeof STAGED_STATES)[number];

/** One normalized row. Deliberately open — each normalizer states its own shape. */
export type NormalizedRow = Readonly<Record<string, unknown>>;

export interface Normalization {
  readonly normalizerId: string;
  readonly rows: readonly NormalizedRow[];
  /**
   * **THE DENOMINATOR THE PUBLISHER ITSELF STATED.**
   *
   * Null only when the response declares none. A staged snapshot that reported
   * its own row count and nothing else would present page one of an index as
   * the index — which is shipping partial data as complete, and is the failure
   * both of these routes make available for free: Arizona's response carries
   * `recordsTotal` and New Hampshire's carries `data.totalItems`, so the
   * publisher hands us the denominator and we only have to state it.
   */
  readonly declaredTotal: number | null;
  /**
   * What this normalization deliberately did NOT conclude, in full sentences.
   *
   * Arizona's row semantics are undetermined at THIS route — several rows share
   * one EntityID with differing Income/Expense and an identical CashBalance — so
   * the normalizer carries the fields and states that no per-person cycle total
   * is derived from them. A staged snapshot that quietly picked one would put a
   * wrong figure on a named person's card.
   *
   * **The 134-of-255 figure this comment used to cite is withdrawn**, because
   * the test that produced it was invalid rather than merely discouraging.
   * `CashBalance` repeats identically on every row of an entity and does not
   * move with the query window: it is a pre-cycle balance. Checking a
   * within-window SUM against an across-window BALANCE compares incommensurable
   * quantities, and the 134 that "agreed" were simply the committees that
   * started from zero. Against a commensurable source — the publisher's own
   * itemised ledger — income and expense reconcile **255 of 255**. The caution
   * here stands; the number that justified it does not.
   */
  readonly unresolved: readonly string[];
  /**
   * A LEGITIMATE EMPTY ANSWER, NAMED. (2026-09-25.) Set only by a normalizer
   * whose publisher answers a query with an empty list as a real result — a
   * search index with no hit. The tail stages it as a named no-hit, never as a
   * failed normalization and never as a snapshot of nothing. It is a dated fact
   * about one query to one index, never a fact about the subject.
   */
  readonly noHit?: string;
  /**
   * The rows are POINTERS (a URL and what the index called it), never records.
   * A pointer is staged for the verifier that reads its origin; it is never
   * promoted as it stands.
   */
  readonly pointerOnly?: boolean;
}

/** Raised by a normalizer that read a document and produced nothing from it. */
export class FailedNormalization extends Error {
  constructor(normalizerId: string, detail: string) {
    super(
      `${normalizerId} read the artifact and produced ZERO rows: ${detail}. A zero-row ` +
        "normalization is a FAILED normalization, never an empty document, and it may not be " +
        "staged as a snapshot of nothing.",
    );
    this.name = "FailedNormalization";
  }
}

/** A normalizer, keyed by the route id whose bytes it understands. */
export type Normalizer = (body: string) => Normalization;

/* ------------------------------------------------------------ normalizers */

/**
 * NEW HAMPSHIRE CFS — `data.items[]`, filer-level.
 *
 * Filer-level TOTALS only, and the record says so: the CFS holds contribution
 * and expenditure detail behind endpoints nobody has derived, and a staged
 * snapshot that presented filer totals as the whole of a committee's money
 * would overstate what we hold.
 */
export const normalizeNhCfs: Normalizer = (body) => {
  const parsed = JSON.parse(body) as {
    data?: { items?: readonly Record<string, unknown>[]; totalItems?: number };
  };
  const items = parsed.data?.items ?? [];
  if (items.length === 0) {
    throw new FailedNormalization("nh-cfs-filing-entity-details", "data.items[] was empty");
  }
  const total = typeof parsed.data?.totalItems === "number" ? parsed.data.totalItems : null;
  return {
    normalizerId: "nh-cfs-filing-entity-details",
    declaredTotal: total,
    rows: items.map((row) => ({
      filerEntityId: row.filerEntityId ?? null,
      filerName: row.filerName ?? null,
      candidateName: row.firstnameLastname ?? null,
      committeeName: row.committeeName ?? null,
      officeSought: row.officeSoughtName ?? null,
      officeType: row.officeTypeDesc ?? null,
      district: row.districtName ?? null,
      town: row.town ?? null,
      electionYear: row.electionYear ?? null,
      electionCycle: row.electionCycle ?? null,
      politicalParty: row.politicalParty ?? null,
      totalRaised: row.totalRaised ?? null,
      totalSpent: row.totalSpent ?? null,
      filerType: row.filerTypeDesc ?? null,
      filerStatus: row.filerStatus ?? null,
      makingIndependentExpenditure: row.isMakingIndependentExpenditure ?? null,
    })),
    unresolved: [
      "THE QUERY IS UNFILTERED BY CYCLE. `filerName: \"\"` asks the index for everything it holds, " +
        "so rows carry election years across many cycles and each row states its own " +
        "`electionYear`. Filtering to one cycle is the promotion step's decision, not a " +
        "normalizer's — a normalizer that dropped rows would make the staged file smaller than " +
        "what was acquired.",
      "FILER-LEVEL TOTALS ONLY. The CFS holds contribution and expenditure DETAIL behind endpoints " +
        "this project has not derived (route nh-cfs-transaction-detail, REQUIRES_NEW_ADAPTER), so " +
        "these totals are what the filer reported and are not an itemized record of their money.",
      "NO BALLOT JOIN IS PERFORMED HERE. Matching a filer to a candidacy needs name AND office AND " +
        "year, plus the county and district guards `lib/funding/state-money.ts` states; that " +
        "judgement belongs to the promotion step and not to a normalizer.",
    ],
  };
};

/**
 * ARIZONA SEETHEMONEY — `data[]`, entity-level, TOTALS DELIBERATELY UNRESOLVED.
 *
 * The endpoint returns several rows per `EntityID` with differing Income and
 * Expense and an identical CashBalance. Summing and taking the largest
 * disagree, and the arithmetic that looked like proof was tested over the
 * population on 2026-08-31 and REFUTED: `sum(Income) - sum(Expense) ==
 * CashBalance` holds for 134 of 255 entities and breaks for 121, including for
 * single-row entities where there is nothing to sum.
 *
 * So this normalizer carries the fields and derives NO cycle total. That is the
 * whole reason it is safe to run unattended.
 */
export const normalizeAzSeeTheMoney: Normalizer = (body) => {
  const parsed = JSON.parse(body) as {
    data?: readonly Record<string, unknown>[];
    recordsTotal?: number;
  };
  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    throw new FailedNormalization(
      "az-sos-seethemoney-datatables",
      `data[] was empty while recordsTotal reported ${JSON.stringify(parsed.recordsTotal)}`,
    );
  }
  return {
    normalizerId: "az-sos-seethemoney-datatables",
    declaredTotal: typeof parsed.recordsTotal === "number" ? parsed.recordsTotal : null,
    rows: rows.map((row) => ({
      entityId: row.EntityID ?? null,
      entityFirstName: row.EntityFirstName ?? null,
      /* Carried VERBATIM. The publisher embeds `<br>(id)` in this field and a
         normalizer that stripped it would be editing a government's record on a
         guess about its intent. Cleaning belongs to promotion, where it can be
         checked. */
      entityLastNameRaw: row.EntityLastName ?? null,
      entityType: row.EntityTypeName ?? null,
      committeeName: row.CommitteeName ?? null,
      officeName: row.OfficeName ?? null,
      partyName: row.PartyName ?? null,
      reportedIncome: row.Income ?? null,
      reportedExpense: row.Expense ?? null,
      independentExpenditureSupport: row.IESupport ?? null,
      independentExpenditureOpposition: row.IEOpposition ?? null,
      reportedCashBalance: row.CashBalance ?? null,
    })),
    unresolved: [
      "`entityLastNameRaw` carries the publisher's own presentation markup — " +
        "`\"Accalia, Jayme <br>(102162)\"` — verbatim. Splitting it into a name is a promotion-step " +
        "decision that can be checked against the ballot; doing it here would edit a government's " +
        "record on a guess.",
      "NO PER-ENTITY CYCLE TOTAL IS DERIVED. Several rows share one EntityID with differing " +
        "Income/Expense and an identical CashBalance. Tested over the population 2026-08-31: " +
        "sum(Income) - sum(Expense) equals CashBalance for 134 of 255 entities and BREAKS for 121, " +
        "including single-row entities where there is nothing to sum. Publishing either aggregation " +
        "as a named person's campaign total would be a wrong figure on a card.",
      "What would settle it: ExportEntityTransactions (itemized, summable), the filed reports, or " +
        "the ftp://ftp.azsos.gov/cfsdata2/ bulk drop — 8,828 committees, reachable 2026-08-26, and " +
        "unwalked for this purpose because this process holds no FTP client.",
    ],
  };
};

/**
 * MARGINALIA — `results[]`, POINTERS ONLY. (2026-09-25.)
 *
 * `api.marginalia.nu/public/search/<query>` answers `{license, page, pages,
 * query, results[]}`, each result `{url, title, description, quality, format,
 * resultsFromDomain, details}` (read from the 563 held responses in the
 * runner's vault; docs/sources.md documented only `license` and `results`).
 * The index is CC-BY-NC-SA and may only POINT: a row carries the URL, the
 * title the index gave it, its format and rank — never the description, which
 * is the index's licensed text — and every row is a lead for
 * `lib/candidates/campaign-site-verifier.ts`, which reads the origin itself.
 *
 * An empty `results` is a NO-HIT: the index answered and had nothing for this
 * query. That is a legitimate answer, named as such; it is not a failed
 * normalization and never an absence about the person searched for.
 */
export const normalizeMarginaliaSearch: Normalizer = (body) => {
  const parsed = JSON.parse(body) as { license?: unknown; query?: unknown; results?: unknown };
  if (typeof parsed.license !== "string" || !Array.isArray(parsed.results)) {
    throw new FailedNormalization(
      "candidate-marginalia-index",
      "the response carries no `license` string and `results` array, so it is not the documented search answer",
    );
  }
  const query = typeof parsed.query === "string" ? parsed.query : null;
  const rows = (parsed.results as readonly Record<string, unknown>[]).flatMap((row, index) =>
    typeof row?.url === "string" && /^https?:\/\//.test(row.url)
      ? [{ kind: "POINTER", url: row.url, title: typeof row.title === "string" ? row.title : null, format: typeof row.format === "string" ? row.format : null, rank: index + 1 }]
      : [],
  );
  const unresolved = [
    `POINTERS ONLY (${parsed.license}): each row is a URL the index returned for ${JSON.stringify(query)}. ` +
      "A row is a lead for the campaign-site verifier, which reads the origin robots-first; the index is never a source of record.",
  ];
  if (rows.length === 0) {
    return {
      normalizerId: "candidate-marginalia-index",
      declaredTotal: 0,
      rows,
      pointerOnly: true,
      noHit: `NO_HIT: the index answered ${JSON.stringify(query)} with no result — a dated fact about one query to one index, never a statement about the candidate`,
      unresolved,
    };
  }
  return { normalizerId: "candidate-marginalia-index", declaredTotal: null, rows, pointerOnly: true, unresolved };
};

/** Every normalizer this project holds, by route id. A floor, never complete. */
export const NORMALIZERS: Readonly<Record<string, Normalizer>> = {
  "nh-cfs-filing-entity-details": normalizeNhCfs,
  "az-sos-seethemoney-datatables": normalizeAzSeeTheMoney,
  "candidate-marginalia-index": normalizeMarginaliaSearch,
};

/* ---------------------------------------------------------------- staging */

export interface StagedEntry {
  readonly obligationId: string;
  readonly providerId: string;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly routeId: string;
  readonly state: StagedState;
  /** The stamp this entry was staged on. From the caller; no clock is read. */
  readonly stagedOn: string;
  /** The persisted next-due for the obligation. A gap that is still worked. */
  readonly nextDueAt: string | null;
  /** The disposition the cycle committed for this route. */
  readonly disposition: string | null;
  /** Rows in the staged snapshot. Zero only for a STAGED_GAP entry. */
  readonly rowCount: number;
  /** What the publisher said the whole index holds. Null when it said nothing. */
  readonly declaredTotal: number | null;
  /**
   * True only when the rows staged are the WHOLE of what the publisher declared.
   *
   * A partial index is still stageable and still promotion-ready — as a
   * PARTIAL. What is forbidden is staging page one of 5,738 rows under a name
   * that reads like the index, and this flag plus `readerSentence`'s "N of M"
   * is what stops that happening by omission.
   */
  readonly complete: boolean;
  /** Where the staged snapshot lives, relative to the repo root. Null for a gap. */
  readonly snapshotPath: string | null;
  /**
   * THE SENTENCE A READER SURFACE RENDERS.
   *
   * Whose gap it is, in plain language, with no enum value and no
   * `NO_SOURCE_FOUND` in it. Present on every entry — a promotion-ready one
   * states what was acquired and what is still unresolved about it.
   */
  readonly readerSentence: string;
  readonly unresolved: readonly string[];
}

export interface StagingManifest {
  readonly stagedOn: string;
  /** The activation gate's decision when the manifest was written. */
  readonly promotionEnabled: boolean;
  readonly entries: readonly StagedEntry[];
}

export interface StagedSnapshot {
  readonly obligationId: string;
  readonly routeId: string;
  readonly normalizerId: string;
  readonly stagedOn: string;
  readonly sourceArtifactIds: readonly string[];
  readonly rowCount: number;
  readonly declaredTotal: number | null;
  readonly complete: boolean;
  /** "N of M row(s) the publisher itself declares", ready to quote. */
  readonly coverage: string;
  readonly rows: readonly NormalizedRow[];
  readonly unresolved: readonly string[];
  /** Structural. This file is not read by any reader surface. */
  readonly promotedToReaderTruth: false;
}

export interface StageInput {
  readonly root: string;
  readonly obligationId: string;
  readonly providerId: string;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly route: RouteDescriptor;
  readonly disposition: string | null;
  readonly artifactIds: readonly string[];
  /** The retrieved bytes, read back from the vault. Null when none were held. */
  readonly body: string | null;
  readonly nextDueAt: string | null;
  /** Whatever the cycle recorded about this dispatch, for the gap sentence. */
  readonly detail: string;
  readonly stagedOn: string;
}

function stagingDir(root: string): string {
  return join(root, ...STAGING_DIR);
}

/** A filesystem-safe name for an obligation id. Ids carry `:` and `#`. */
export function stagedFileName(obligationId: string): string {
  return `${obligationId.replace(/[^A-Za-z0-9._-]/g, "_")}.staged.json`;
}

/**
 * Run the tail for ONE dispatched route, and return what was staged.
 *
 * Never throws for a route-level condition: a missing normalizer, an
 * unparseable body and a wall are all STAGED_GAP entries with their reason
 * named, because each of them is a state a reader surface has to be able to
 * render honestly.
 */
export function stageOne(input: StageInput): StagedEntry {
  const base = {
    obligationId: input.obligationId,
    providerId: input.providerId,
    recordClass: input.recordClass,
    subjectId: input.subjectId,
    routeId: input.route.routeId,
    stagedOn: input.stagedOn,
    nextDueAt: input.nextDueAt,
    disposition: input.disposition,
  };

  const gap = (sentence: string, unresolved: readonly string[]): StagedEntry => ({
    ...base,
    state: "STAGED_GAP",
    rowCount: 0,
    declaredTotal: null,
    complete: false,
    snapshotPath: null,
    readerSentence: sentence,
    unresolved,
  });

  if (input.disposition !== "INGESTED" || input.body === null) {
    /*
     * A WALL, STAGED. RULING 224's second half: the honest gap state is not a
     * lesser outcome. The sentence names WHOSE gap it is and the next-due says
     * the obligation is still being worked, which is what stops it resolving to
     * a generic placeholder.
     */
    const what =
      input.disposition === null
        ? "we have not yet reached it"
        : `the route closed ${input.disposition}`;
    return gap(
      `${input.route.label}: ${what}. ${
        input.route.open.kind === "NOT_MACHINE_EXECUTABLE"
          ? input.route.open.reason
          : input.detail
      }`,
      [
        input.route.awaitingAdapter ??
          "no next move is recorded on this route descriptor, which is itself a gap worth closing",
        input.nextDueAt === null
          ? "no next-due is persisted for this obligation, so nothing schedules the retry — a defect"
          : `still owed, and scheduled to be tried again at ${input.nextDueAt}`,
      ],
    );
  }

  const normalizer = NORMALIZERS[input.route.routeId];
  if (normalizer === undefined) {
    return gap(
      `${input.route.label}: the record was ACQUIRED and is held, and this project has no reader ` +
        "yet for its shape.",
      [
        `NORMALIZER MISSING for route ${input.route.routeId}. The bytes are vaulted and cited; what ` +
          "is absent is code that turns them into rows. That is a gap in OUR tooling, not in their " +
          "publication, and the artifact is not lost while it waits.",
        `artifact(s): ${input.artifactIds.join(", ") || "none recorded"}`,
      ],
    );
  }

  let normalized: Normalization;
  try {
    normalized = normalizer(input.body);
  } catch (error) {
    return gap(
      `${input.route.label}: the record was acquired and could not be read into rows.`,
      [
        `NORMALIZATION FAILED: ${error instanceof Error ? error.message : String(error)}`,
        "The bytes are held and the failure is ours to fix. Nothing is staged as a snapshot of " +
          "nothing, and the obligation stays live.",
      ],
    );
  }

  /*
   * A NAMED NO-HIT stages as the honest gap it is: the query was answered and
   * had nothing. Never NORMALIZER MISSING, never NORMALIZATION FAILED, and
   * never a snapshot of nothing presented as data.
   */
  if (normalized.rows.length === 0 && normalized.noHit !== undefined) {
    return gap(
      `${input.route.label}: the index answered and returned no result for this query. That is a fact ` +
        "about one search, never about the subject.",
      [normalized.noHit, `artifact(s): ${input.artifactIds.join(", ") || "none recorded"}`, ...normalized.unresolved],
    );
  }

  const rowCount = normalized.rows.length;
  const declaredTotal = normalized.declaredTotal;
  const complete = declaredTotal === null ? false : rowCount >= declaredTotal;

  /*
   * COMPLETE AGAINST THIS QUERY, NEVER AGAINST THE SOURCE UNIVERSE.
   *
   * `declaredTotal` is what the publisher declared **for the request we sent**.
   * Retrieving all of it means this RESPONSE is whole. It does not mean the
   * index is, and RULING 207 is explicit that one route's success never
   * collapses the source universe.
   *
   * Measured, not theorised. Arizona's `GetNEWTableData` declared 370 and
   * returned 370, so this said `complete: true` — and Kevin Volk, who is on the
   * 85701 ballot with $173,742 filed, is **not among those 370**. Three filters
   * over the same endpoint union to 860 rows across 732 entities, 16 of them
   * reachable from no other filter. The 370 was a complete answer to a narrow
   * question, and the sentence read as though it were the whole index.
   *
   * So the wording names the query. A reader of this file, or of the digest it
   * feeds, must not be able to mistake a whole response for a whole index.
   */
  const coverage =
    declaredTotal === null
      ? `${rowCount} row(s) acquired; the publisher declared no total, so what fraction of the ` +
        "index this is CANNOT BE ASSERTED"
      : `${rowCount} of the ${declaredTotal} row(s) this query's own response declares — ` +
        "whole for THIS request, which is not a claim that the index is whole (RULING 207)";

  const dir = stagingDir(input.root);
  mkdirSync(dir, { recursive: true });
  const file = stagedFileName(input.obligationId);
  const snapshot: StagedSnapshot = {
    obligationId: input.obligationId,
    routeId: input.route.routeId,
    normalizerId: normalized.normalizerId,
    stagedOn: input.stagedOn,
    sourceArtifactIds: input.artifactIds,
    rowCount,
    declaredTotal,
    complete,
    coverage,
    rows: normalized.rows,
    unresolved: normalized.unresolved,
    promotedToReaderTruth: false,
  };
  writeFileSync(join(dir, file), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  if (normalized.pointerOnly === true) {
    /* Pointers are staged for the verifier that reads their origins; they are never promoted as they stand. */
    return {
      ...base,
      state: "STAGED_PROMOTION_READY",
      rowCount,
      declaredTotal,
      complete,
      snapshotPath: `${STAGING_DIR.join("/")}/${file}`,
      readerSentence:
        `${input.route.label}: ${rowCount} pointer lead(s) staged for the campaign-site verifier. An index ` +
        "points at pages and is never the record; nothing here reaches a reader until the origin is read and verified.",
      unresolved: normalized.unresolved,
    };
  }

  return {
    ...base,
    state: "STAGED_PROMOTION_READY",
    rowCount,
    declaredTotal,
    complete,
    snapshotPath: `${STAGING_DIR.join("/")}/${file}`,
    readerSentence:
      `${input.route.label}: ${coverage}, normalized and staged. Not yet shown to readers — a ` +
      "session carries the last mile.",
    unresolved: complete
      ? normalized.unresolved
      : [
          `PARTIAL: this staged file holds ${coverage}. It may not be promoted as the whole index; ` +
            "the remaining pages are still owed and the obligation stays live.",
          ...normalized.unresolved,
        ],
  };
}

/**
 * Write the manifest.
 *
 * MERGED, not replaced. A cycle that only worked two routes must not erase the
 * staged state of everything it did not touch — a manifest that shrank every
 * cycle would report the pipeline as having lost work it never ran.
 */
export function writeStagingManifest(
  root: string,
  entries: readonly StagedEntry[],
  stagedOn: string,
): { readonly path: string; readonly total: number; readonly written: number } {
  const dir = stagingDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, STAGING_MANIFEST);

  const merged = new Map<string, StagedEntry>();
  if (existsSync(path)) {
    try {
      const prior = JSON.parse(readFileSync(path, "utf8")) as StagingManifest;
      for (const entry of prior.entries ?? []) merged.set(entry.obligationId, entry);
    } catch {
      /* An unreadable manifest is rebuilt from this cycle rather than throwing;
         the entries it holds are all derivable from the control plane and the
         staged files beside it, and refusing to write would lose this cycle too. */
    }
  }
  for (const entry of entries) merged.set(entry.obligationId, entry);

  const manifest: StagingManifest = {
    stagedOn,
    promotionEnabled: true, // Legacy manifest field; verified facts are not class-gated.
    entries: [...merged.values()].sort((a, b) =>
      a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0,
    ),
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path, total: manifest.entries.length, written: entries.length };
}

/** Read the manifest back. Absent is absent; unreadable throws. */
export function readStagingManifest(root: string): StagingManifest | null {
  const path = join(stagingDir(root), STAGING_MANIFEST);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as StagingManifest;
}

/** The digest lines for the tail. Both states counted, always. */
export function promotionLines(entries: readonly StagedEntry[]): string[] {
  const ready = entries.filter((e) => e.state === "STAGED_PROMOTION_READY");
  const gaps = entries.filter((e) => e.state === "STAGED_GAP");
  const out: string[] = [];
  out.push(
    `  promotion tail     ${entries.length} entry(ies) staged — ${ready.length} PROMOTION-READY, ` +
      `${gaps.length} honest gap(s). Verified facts publish through their reader doors.`,
  );
  for (const e of ready) {
    out.push(
      `      READY ${e.obligationId} — ${e.rowCount} of ${e.declaredTotal ?? "an undeclared total"}` +
        `${e.complete ? " (RESPONSE WHOLE — not the whole index)" : " (PARTIAL — the rest is still owed)"} at ${e.snapshotPath}`,
    );
  }
  for (const e of gaps) {
    out.push(`      GAP   ${e.obligationId} — ${e.readerSentence}`);
  }
  return out;
}
