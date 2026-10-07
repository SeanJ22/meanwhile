/**
 * The promotion tail's first half: acquire, vault, extract, normalize, snapshot, STAGED. Writes only under
 * `.runtime/control-plane/staging/`. A wall or a missing normalizer stages as a STAGED_GAP with its reason;
 * a zero-row normalization of a non-empty document is a failure, never a snapshot of nothing.
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
  /** The total the publisher stated for this response; null only when it states none. */
  readonly declaredTotal: number | null;
  /** What this normalization deliberately did not conclude, in full sentences. */
  readonly unresolved: readonly string[];
  /** A legitimate empty answer from a publisher that answers a query with an empty list. Staged as a named no-hit, never a failed normalization. */
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


/** NH CFS `data.items[]`: filer-level totals only, and the record says so. */
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

/** AZ SeeTheMoney `data[]`: several rows per `EntityID`, so no cycle total is derived. */
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
      /* Carried verbatim, including the publisher's `<br>(id)` markup; cleaning belongs to promotion. */
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

/** Marginalia `results[]`: pointers only (the index's licensed description is never kept). An empty `results` is a named no-hit. */
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


export interface StagedEntry {
  readonly obligationId: string;
  readonly providerId: string;
  readonly recordClass: string;
  readonly subjectId: string;
  readonly routeId: string;
  readonly state: StagedState;
  /** The stamp this entry was staged on. From the caller; no clock is read. */
  readonly stagedOn: string;
  readonly nextDueAt: string | null;
  readonly disposition: string | null;
  /** Rows in the staged snapshot. Zero only for a STAGED_GAP entry. */
  readonly rowCount: number;
  /** What the publisher said the whole index holds. Null when it said nothing. */
  readonly declaredTotal: number | null;
  /** True only when the rows staged are the whole of what the publisher declared for this request. */
  readonly complete: boolean;
  /** Where the staged snapshot lives, relative to the repo root. Null for a gap. */
  readonly snapshotPath: string | null;
  /** The plain sentence a reader surface renders: whose gap it is, or what was acquired and what is unresolved. */
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

/** Run the tail for one dispatched route. Never throws for a route-level condition; each is a named STAGED_GAP. */
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
    /* A wall stages as a gap naming whose gap it is, with the next-due showing it is still worked. */
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

  /* Complete against this query, never against the source universe: the wording names the query. */
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

/** Write the manifest, merged rather than replaced, so untouched entries keep their staged state. */
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
