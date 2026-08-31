/**
 * **THE OWNER FEEDBACK SWEEP.** (Session B WS2, 2026-08-30.)
 *
 * ## What this is for
 *
 * The owner records a testing pass and leaves it in `feedback/<M.D.YY>/` —
 * captures, a dictated commentary, sometimes a spreadsheet breaking the
 * dictation into rows. Before this existed, a session read what it happened to
 * read. The A.1 sweep listed all twenty captures of 8.30.26 as
 * "unidentifiable — deferred", which is an honest accounting and is not a
 * sweep: nothing was diagnosed and nothing was fixed.
 *
 * So the sweep is a typed obligation with a gate behind it. **A date folder,
 * or an item inside one, that a sweep neither PROCESSES nor lists as
 * UNIDENTIFIABLE fails.** Silence about an item is the one disposition that is
 * refused, because silence is what a deferral decays into.
 *
 * ## Where the record lives, and why it is split
 *
 * ```
 *   data/feedback/sweeps/<M.D.YY>.json   COMMITTED. The machine-owned record.
 *   feedback/SWEPT.md                    GENERATED view, beside the owner's
 *                                        folders, for the owner to read.
 * ```
 *
 * `feedback/` is gitignored — RULING 20 refuses committed binaries and the
 * owner's captures are binaries. A gate cannot read an ignored file on CI, so
 * the authority is the committed JSON and `SWEPT.md` is its rendering. Nothing
 * is ever written INSIDE an owner date folder: that folder is the owner's
 * input, and a machine writing into it makes the input unreadable as input.
 *
 * ## The dictation outranks the spreadsheet
 *
 * Where the two disagree the dictation wins, and an item present in the
 * dictation or in a capture but absent from the spreadsheet is ADDED. The
 * spreadsheet is an LLM's reading of the owner; the dictation is the owner.
 *
 * ## The standing instruction, which is the whole point
 *
 * Every named person, body, zip and district in an owner report is an EXAMPLE.
 * If the defect exists at that instance it exists at the CLASS, and the fix
 * belongs at the class. `instancesFound` and `instancesFixed` are on every
 * item for that reason: a fix that leaves the same defect on another page is
 * recorded here as what it is, which is not a fix.
 */

/** Every disposition an item may hold. There is no fourth, and no default. */
export const ITEM_DISPOSITIONS = [
  /** Diagnosed, fixed class-wide, and verified on the rendered surface. */
  "FIXED_VERIFIED",
  /** Diagnosed and fixed; the verification a check needs is not yet possible. */
  "FIXED_UNVERIFIED",
  /** Diagnosed, and open with the exact blocker named. Never a silent defer. */
  "OPEN_BLOCKED",
  /** The owner recorded it as working. Kept so a later change cannot break it. */
  "POSITIVE_KEPT",
  /** Read, and not identifiable. Carries a best guess and ONE owner question. */
  "UNIDENTIFIABLE",
] as const;
export type ItemDisposition = (typeof ITEM_DISPOSITIONS)[number];

/** Where the item came from. Reconciliation needs to know which. */
export const ITEM_SOURCES = ["DICTATION", "SPREADSHEET", "SCREENSHOT", "OWNER_WORKBOOK"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

export interface SweptItem {
  /** The owner's own id where they gave one, else one assigned by the sweep. */
  readonly id: string;
  /** Every source that carries this item. An item in two is reconciled, not doubled. */
  readonly sources: readonly ItemSource[];
  /** The capture filenames evidencing it, as named in the owner's folder. */
  readonly screenshots: readonly string[];
  readonly surface: string;
  readonly zip: string | null;
  /** One sentence: what the owner met. */
  readonly reported: string;
  /**
   * What the SOURCE says is right — never the owner's phrasing.
   *
   * The owner's report says what is wrong; the source record says what is
   * right. Null only for an item whose correct state is a product decision
   * rather than a fact about a government.
   */
  readonly correctState: string | null;
  /** The failure class, from the shared twelve-class taxonomy where one fits. */
  readonly failureClass: string;
  readonly disposition: ItemDisposition;
  /** The control-plane WorkItem id. Null only for POSITIVE_KEPT. */
  readonly workItemId: string | null;
  /** Instances of the CLASS found by auditing every surface and ZIP. */
  readonly instancesFound: number;
  readonly instancesFixed: number;
  /** The permanent check: a ReaderQuestion or VisualAcceptanceCheck id. */
  readonly checkId: string | null;
  /** What that check said on its last run. Null when it has not run. */
  readonly checkResult: string | null;
  /** Required on OPEN_BLOCKED and on UNIDENTIFIABLE. The exact blocker/question. */
  readonly blocker: string | null;
}

export interface SweepRecord {
  /** The owner's folder name, exactly: `M.D.YY`. */
  readonly folder: string;
  /** Every file the sweep inventoried, by name. Stated N equals rendered rows. */
  readonly filesInventoried: readonly string[];
  readonly sweptAtSha: string | null;
  readonly sweptAt: string;
  readonly items: readonly SweptItem[];
}

/** A problem with a sweep. Empty means the sweep is well-formed. */
export function validateSweep(sweep: SweepRecord): string[] {
  const problems: string[] = [];
  if (!/^\d{1,2}\.\d{1,2}\.\d{2}$/.test(sweep.folder)) {
    problems.push(`folder ${JSON.stringify(sweep.folder)} is not an M.D.YY owner date folder`);
  }
  if (sweep.filesInventoried.length === 0) {
    problems.push("no files inventoried — a sweep that read nothing swept nothing");
  }
  const ids = new Set<string>();
  for (const item of sweep.items) {
    if (ids.has(item.id)) problems.push(`duplicate item id ${item.id}`);
    ids.add(item.id);
    if (!(ITEM_DISPOSITIONS as readonly string[]).includes(item.disposition)) {
      problems.push(`${item.id}: ${JSON.stringify(item.disposition)} is not a disposition`);
    }
    /* A blocked item without a named blocker is a silent defer wearing a
       status. That is the shape this whole module exists to refuse. */
    if (
      (item.disposition === "OPEN_BLOCKED" || item.disposition === "UNIDENTIFIABLE") &&
      !item.blocker
    ) {
      problems.push(
        `${item.id} is ${item.disposition} and names no blocker or question. A deferral with ` +
          "no reason is the disposition this gate exists to refuse.",
      );
    }
    /* An item with no check is not closed (W2.4). A fix nothing can re-check
       is a fix that regresses silently, which is how BAL-32 came back. */
    if (item.disposition === "FIXED_VERIFIED" && !item.checkId) {
      problems.push(
        `${item.id} is FIXED_VERIFIED with no permanent check. An item with no check is not ` +
          "closed: the same defect was reported on 8/28 and shipped again by 8/30.",
      );
    }
    if (item.disposition !== "POSITIVE_KEPT" && !item.workItemId) {
      problems.push(`${item.id} carries no WorkItem id`);
    }
    if (item.instancesFixed > item.instancesFound) {
      problems.push(
        `${item.id} claims ${item.instancesFixed} instance(s) fixed of ${item.instancesFound} ` +
          "found — more fixed than found is a counting error, never a bonus",
      );
    }
    /* The standing instruction, mechanically. */
    if (
      item.disposition === "FIXED_VERIFIED" &&
      item.instancesFound > item.instancesFixed
    ) {
      problems.push(
        `${item.id} is FIXED_VERIFIED with ${item.instancesFound - item.instancesFixed} ` +
          "instance(s) of the same class left unfixed. A fix that leaves the same defect on " +
          "another page is not a fix — that is the owner's standing instruction, and it has " +
          "now been given in four consecutive sessions.",
      );
    }
  }
  return problems;
}

/**
 * The gate: is every owner date folder swept, and every item disposed?
 *
 * `folders` is what is actually on disk under `feedback/`; `sweeps` is what
 * has been recorded. A folder with no sweep is the seeded failure, and so is
 * an item whose disposition is missing — the two ways a pass can be silently
 * skipped.
 */
export interface SweepGateVerdict {
  readonly passed: boolean;
  readonly unswept: readonly string[];
  readonly problems: readonly string[];
}

export function checkSweepGate(
  folders: readonly string[],
  sweeps: readonly SweepRecord[],
): SweepGateVerdict {
  const byFolder = new Map(sweeps.map((s) => [s.folder, s]));
  const unswept = folders.filter((f) => !byFolder.has(f));
  const problems: string[] = [];
  for (const sweep of sweeps) problems.push(...validateSweep(sweep));
  for (const folder of unswept) {
    problems.push(
      `feedback/${folder}/ has no sweep record at data/feedback/sweeps/${folder}.json. An owner ` +
        "pass that nothing has read is not deferred, it is dropped: the difference is that a " +
        "deferral names what it is deferring.",
    );
  }
  return { passed: unswept.length === 0 && problems.length === 0, unswept, problems };
}

/** The counts a sweep report leads with. Derived, never typed. */
export interface SweepCounts {
  readonly filesInventoried: number;
  readonly itemsFound: number;
  readonly itemsProcessed: number;
  readonly unidentifiable: number;
  /** What the owner reported as broken — the pair's left-hand number. */
  readonly reportedDefects: number;
  /** What is verified fixed on the rendered surface — the right-hand number. */
  readonly verifiedFixed: number;
  readonly openBlocked: number;
  readonly positivesKept: number;
  readonly instancesFound: number;
  readonly instancesFixed: number;
}

export function countSweep(sweep: SweepRecord): SweepCounts {
  const by = (d: ItemDisposition): number =>
    sweep.items.filter((i) => i.disposition === d).length;
  return {
    filesInventoried: sweep.filesInventoried.length,
    itemsFound: sweep.items.length,
    itemsProcessed: sweep.items.filter((i) => i.disposition !== "UNIDENTIFIABLE").length,
    unidentifiable: by("UNIDENTIFIABLE"),
    reportedDefects: sweep.items.filter((i) => i.disposition !== "POSITIVE_KEPT").length,
    verifiedFixed: by("FIXED_VERIFIED"),
    openBlocked: by("OPEN_BLOCKED"),
    positivesKept: by("POSITIVE_KEPT"),
    instancesFound: sweep.items.reduce((n, i) => n + i.instancesFound, 0),
    instancesFixed: sweep.items.reduce((n, i) => n + i.instancesFixed, 0),
  };
}
