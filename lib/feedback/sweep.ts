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
  /**
   * **A HUMAN GATE, AND IT IS TERMINAL FOR A SESSION.** (RULING 221.)
   *
   * The row needs a decision, an account, a credential or an authorisation the
   * machine may not grant. It is NOT open executable work: no amount of session
   * effort changes it, and reporting it as merely "open" makes a session look
   * unfinished for a reason nothing it could do would close.
   *
   * This does not weaken RULING 208. *NEEDS SEAN never closes, pauses or
   * satisfies the obligation the row is about* — the record obligation stays
   * live on the frontier. What terminates is the row's status WITHIN a
   * session's denominator, and the obligation and the denominator are different
   * objects.
   *
   * `needsOwner` below is required on it, because a gate nobody can act on is
   * not a gate.
   */
  "NEEDS_SEAN",
] as const;
export type ItemDisposition = (typeof ITEM_DISPOSITIONS)[number];

/** Where the item came from. Reconciliation needs to know which. */
export const ITEM_SOURCES = ["DICTATION", "SPREADSHEET", "SCREENSHOT", "OWNER_WORKBOOK"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/**
 * An owner date folder: `M.D.YY`, or `M.D.YY.N` when the owner files a second
 * pass on the same day. Shared with `scripts/feedback-sweep.mts`, which lists
 * the folders on disk with it, so the gate and the record agree on what a
 * folder is — a folder the lister skipped would be exactly the silence the
 * gate exists to refuse.
 */
export const OWNER_FOLDER = /^\d{1,2}\.\d{1,2}\.\d{2}(?:\.\d{1,2})?$/;

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
  /**
   * Required on NEEDS_SEAN, and every field of it is load-bearing. (RULING 221.)
   *
   * A human gate that does not say what was tried reads as work nobody
   * attempted; one that does not name the authorisation cannot be acted on; one
   * that does not say what continues without it invites the whole hunt to stop
   * on a single lock, which the acquisition doctrine forbids by name.
   */
  readonly needsOwner?: {
    /** What the machine actually did before concluding it could not proceed. */
    readonly tried: string;
    /** Why the machine may not take the next step itself. */
    readonly whyMachineCannot: string;
    /** Exactly what the owner must grant or decide. One sentence, actionable. */
    readonly authorizationRequired: string;
    /** What work continues meanwhile. One blocked row never freezes the rest. */
    readonly continuesWithout: string;
    /** How many other rows are waiting behind this one. */
    readonly blockedDescendants: number;
  } | null;
}

/**
 * **A ROW WHOSE CITED CHECK DOES NOT EXIST, NAMED AND CARRIED.**
 * (2026-08-31, WGH-22's root cause.)
 *
 * Modelled on `walk-all.mts`'s quarantine list, and for the same reason: a
 * debt that is enumerated, dated and printed on every run is tracked and
 * hunted; a debt that fails the build immediately gets deleted by whoever is
 * shipping. What this list never does is let the row count as closed.
 *
 * **An item on this list is NOT counted in `verifiedFixed`.** That is the whole
 * point. The sweep's headline pair drops to the rows that have an instrument
 * behind them, which is the number the owner was actually being told.
 *
 * A row may only be added deliberately, in the committed record, with the
 * reason written down. Any UNLISTED unresolvable check id fails the gate
 * outright, so the class cannot recur silently even once.
 */
export interface CheckDebtEntry {
  /** The `SweptItem.id` whose `checkId` names nothing. */
  readonly itemId: string;
  /** Why it is carried rather than fixed or reopened. */
  readonly reason: string;
  /** The date the debt was recorded, from `pnpm stamp`. */
  readonly since: string;
}

export interface SweepRecord {
  /**
   * The owner's folder name, exactly: `M.D.YY`, or `M.D.YY.N` for a second pass
   * on the same day (the owner named the 2026-09-04 evening pass `9.4.26.2`).
   */
  readonly folder: string;
  /** Every file the sweep inventoried, by name. Stated N equals rendered rows. */
  readonly filesInventoried: readonly string[];
  readonly sweptAtSha: string | null;
  readonly sweptAt: string;
  readonly items: readonly SweptItem[];
  /** Rows whose cited check resolves to nothing. See {@link CheckDebtEntry}. */
  readonly checkDebt?: readonly CheckDebtEntry[];
}

/** A problem with a sweep. Empty means the sweep is well-formed. */
export function validateSweep(sweep: SweepRecord): string[] {
  const problems: string[] = [];
  if (!OWNER_FOLDER.test(sweep.folder)) {
    problems.push(`folder ${JSON.stringify(sweep.folder)} is not an M.D.YY (or M.D.YY.N) owner date folder`);
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
    if (item.disposition === "NEEDS_SEAN") {
      const n = item.needsOwner;
      if (!n) {
        problems.push(
          `${item.id} is NEEDS_SEAN with no \`needsOwner\` block. RULING 221 makes this state ` +
            "TERMINAL for a session, and a terminal state with no stated authorisation is a row " +
            "that has been set aside rather than escalated.",
        );
      } else {
        for (const [field, value] of [
          ["tried", n.tried],
          ["whyMachineCannot", n.whyMachineCannot],
          ["authorizationRequired", n.authorizationRequired],
          ["continuesWithout", n.continuesWithout],
        ] as const) {
          if (!String(value ?? "").trim()) {
            problems.push(`${item.id} is NEEDS_SEAN with an empty \`needsOwner.${field}\`.`);
          }
        }
      }
    }
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

/* ══════════ THE CHECK MUST EXIST, NOT MERELY BE NAMED (2026-08-31) ═══════ */

/**
 * **THE INSTRUMENT DEFECT BEHIND THREE RECURRENCES OF ONE DEFECT.**
 *
 * `validateSweep` refuses a `FIXED_VERIFIED` item with no `checkId`, and that
 * is where the requirement stopped: it tested for a NON-EMPTY STRING. Nothing
 * ever asked whether the string named anything.
 *
 * Measured on 2026-08-31, over the 8.30.26 sweep's own record:
 *
 * ```
 *   23 items cite a check
 *    9 resolve to a file, a test or a package script that exists
 *   12 cite `vac:<name>` — and `data/health/visual-checks.json` DOES NOT
 *      EXIST. The visual suite's last run recorded `checksLoaded: 0`.
 *    2 cite `rq:<name>` — and neither is in `data/health/reader-questions.json`,
 *      which is GENERATED from the owner's workbook and cannot hold a name a
 *      session invented.
 * ```
 *
 * So fourteen items were closed against instruments that do not exist. Their
 * `checkResult` strings are real one-off observations a session made by hand —
 * evidence of a verification, not a check — and a one-off observation cannot
 * catch a regression, which is exactly how WGH-12, WGH-15 and WGH-22 were each
 * marked fixed and each came back.
 *
 * **A check that cannot be run is not a check.** From here a `checkId` must
 * RESOLVE, by namespace, against something on disk.
 *
 * The resolver is deliberately structural rather than clever: it answers "does
 * this name something that exists", never "does that thing assert the right
 * claim". The second question is what the check itself is for.
 */
export interface CheckResolution {
  readonly resolved: boolean;
  /** Why not, addressed to the session that wrote the id. Empty when resolved. */
  readonly reason: string;
}

/** The filesystem facts the resolver needs. Injected so this stays pure. */
export interface CheckWorld {
  /** Does this repo-relative path exist? */
  readonly exists: (path: string) => boolean;
  /** A file's text, or null when it cannot be read. */
  readonly read: (path: string) => string | null;
  /** The `scripts` block of package.json. */
  readonly packageScripts: Readonly<Record<string, string>>;
}

const VISUAL_CHECKS_PATH = "data/health/visual-checks.json";
const READER_QUESTIONS_PATH = "data/health/reader-questions.json";
const WALK_CHECKS_PATH = "docs/walk-checks.txt";

/** Both tracker stores. A row the owner already resolved is still a row they saw. */
const TRACKER_STORES = ["docs/tracker-working.csv", "docs/tracker-resolved.csv"];

export function resolveCheckId(checkId: string, world: CheckWorld): CheckResolution {
  const id = checkId.trim();
  if (!id) return { resolved: false, reason: "the check id is empty" };

  /* `vac:<name>` — a VisualAcceptanceCheck in the committed visual suite. */
  if (id.startsWith("vac:")) {
    const raw = world.read(VISUAL_CHECKS_PATH);
    if (raw === null) {
      return {
        resolved: false,
        reason: `${VISUAL_CHECKS_PATH} does not exist, so no \`vac:\` id names anything. The visual suite loads zero checks`,
      };
    }
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(raw) as { check?: { id?: string } }[];
      ids = parsed.map((b) => b?.check?.id ?? "").filter(Boolean);
    } catch {
      return { resolved: false, reason: `${VISUAL_CHECKS_PATH} is not readable JSON` };
    }
    return ids.includes(id)
      ? { resolved: true, reason: "" }
      : {
          resolved: false,
          reason: `no VisualAcceptanceCheck with id ${id} in ${VISUAL_CHECKS_PATH} (it holds ${ids.length})`,
        };
  }

  /* `rq:<name>` — a template in the GENERATED owner corpus. */
  if (id.startsWith("rq:")) {
    const raw = world.read(READER_QUESTIONS_PATH);
    if (raw === null) {
      return { resolved: false, reason: `${READER_QUESTIONS_PATH} does not exist` };
    }
    const name = id.slice(3);
    return raw.includes(name)
      ? { resolved: true, reason: "" }
      : {
          resolved: false,
          reason:
            `no ReaderQuestion named ${name} in ${READER_QUESTIONS_PATH}. That corpus is ` +
            "GENERATED from the owner's workbook — a session cannot author a question into it, " +
            "so an `rq:` id a session invented can never resolve",
        };
  }

  /* `[SESSION] name` — a check identity in the standing walk. */
  if (id.startsWith("[")) {
    const raw = world.read(WALK_CHECKS_PATH);
    if (raw === null) return { resolved: false, reason: `${WALK_CHECKS_PATH} does not exist` };
    return raw.includes(id)
      ? { resolved: true, reason: "" }
      : { resolved: false, reason: `no walk check with identity ${id} in ${WALK_CHECKS_PATH}` };
  }

  /* `pnpm <script>` or `pnpm <script>::<case>` — a package script. */
  if (id.startsWith("pnpm ")) {
    const script = id.slice(5).split("::")[0].trim();
    return script in world.packageScripts
      ? { resolved: true, reason: "" }
      : { resolved: false, reason: `package.json has no script named ${JSON.stringify(script)}` };
  }

  /* A repo path, optionally `::<symbol or test name>` inside it. */
  if (id.includes("/")) {
    const [path, inner] = id.split("::");
    if (!world.exists(path)) return { resolved: false, reason: `${path} does not exist` };
    if (inner) {
      const source = world.read(path);
      if (source === null) return { resolved: false, reason: `${path} could not be read` };
      if (!source.includes(inner)) {
        return {
          resolved: false,
          reason: `${path} exists but contains nothing named ${JSON.stringify(inner)}`,
        };
      }
    }
    return { resolved: true, reason: "" };
  }

  return {
    resolved: false,
    reason:
      `${JSON.stringify(id)} is in no known check namespace. Use \`vac:\`, \`rq:\`, a walk ` +
      "identity `[SESSION] name`, `pnpm <script>`, or a repo path (optionally `path::symbol`)",
  };
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
  /**
   * The filesystem, for check-id resolution. Omitted, resolution is SKIPPED
   * and the gate says so — a caller that cannot read the repo is not evidence
   * that the checks exist, and silently passing would be the same defect this
   * resolver was added to close.
   */
  world?: CheckWorld,
): SweepGateVerdict {
  const byFolder = new Map(sweeps.map((s) => [s.folder, s]));
  const unswept = folders.filter((f) => !byFolder.has(f));
  const problems: string[] = [];
  for (const sweep of sweeps) problems.push(...validateSweep(sweep));
  if (world) {
    for (const sweep of sweeps) {
      const carried = new Map((sweep.checkDebt ?? []).map((d) => [d.itemId, d]));
      const seen = new Set<string>();
      for (const item of sweep.items) {
        if (!item.checkId) continue;
        const resolution = resolveCheckId(item.checkId, world);
        if (resolution.resolved) {
          /* A debt entry for a check that now resolves is stale bookkeeping,
             and a stale debt list is how a fixed thing keeps reading broken. */
          if (carried.has(item.id)) {
            problems.push(
              `${item.id} is on \`checkDebt\` but its check ${JSON.stringify(item.checkId)} now ` +
                "resolves. Remove the debt entry — a carried row that is no longer in debt " +
                "makes the debt list stop meaning anything.",
            );
          }
          continue;
        }
        seen.add(item.id);
        if (!carried.has(item.id)) {
          problems.push(
            `${item.id} cites check ${JSON.stringify(item.checkId)}, which does not exist: ` +
              `${resolution.reason}. A check that cannot be run is not a check — this is the ` +
              "gap that let one defect be marked fixed three times. Give it a check that runs, " +
              "or record it on `checkDebt` with a reason, where it stops counting as fixed.",
          );
        }
      }
      /*
       * **A NEEDS_SEAN ROW THE OWNER CANNOT SEE IS NOT AN ESCALATION.**
       * (The author's directive, 2026-08-31.)
       *
       * The owner could not see a single NEEDS_SEAN row: they lived only in
       * `data/feedback/sweeps/*.json` and `feedback/SWEPT.md`, neither of which
       * is where they look. A gate that is terminal for a session and invisible
       * to the one person who can clear it is a deferral wearing a status —
       * which is the exact shape this whole module refuses everywhere else.
       *
       * So the row must exist where the owner already reads. The match is on
       * the sweep id at the head of a tracker title, which is how
       * `scripts/tracker.mjs add` was fed, and it reads BOTH stores: a row the
       * owner has already resolved is still a row they saw.
       */
      for (const item of sweep.items) {
        if (item.disposition !== "NEEDS_SEAN") continue;
        const inTracker = TRACKER_STORES.some((store) => {
          const csv = world.read(store);
          return csv !== null && csv.includes(`"${item.id} —`);
        });
        if (!inTracker) {
          problems.push(
            `${item.id} is NEEDS_SEAN and has no row in the owner-facing tracker. It is ` +
              "terminal for a session (RULING 221) and only the owner can clear it, so a row " +
              "they cannot see is a deferral wearing a status. Add it with " +
              "`node scripts/tracker.mjs add <rows.json>` under the `needs-sean` section, " +
              `titled "${item.id} — <what the owner met>".`,
          );
        }
      }

      for (const debt of sweep.checkDebt ?? []) {
        if (!seen.has(debt.itemId)) {
          problems.push(
            `\`checkDebt\` names ${debt.itemId}, which is not a row with an unresolvable check. ` +
              "The list may only carry real debt.",
          );
        }
        if (!debt.reason.trim() || !debt.since.trim()) {
          problems.push(`\`checkDebt\` entry ${debt.itemId} has an empty reason or date.`);
        }
      }
    }
  }
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
  /** Rows the machine could still work. Only this reaching zero finishes a session. */
  readonly openExecutable: number;
  /** Rows terminal on a human gate. Never counted as open executable work. */
  readonly needsSean: number;
  /** Rows whose cited check resolves to nothing. Never counted verified fixed. */
  readonly checkDebt: number;
}

export function countSweep(sweep: SweepRecord): SweepCounts {
  const by = (d: ItemDisposition): number =>
    sweep.items.filter((i) => i.disposition === d).length;
  /*
   * **A ROW IN CHECK DEBT IS NOT A ROW VERIFIED FIXED.** (2026-08-31.)
   *
   * The headline pair is what the owner reads, and it said 19 of 32 while
   * fourteen of those nineteen rested on check ids that name nothing on disk.
   * The fix may be real; the VERIFICATION is not, and only the second is what
   * this number claims. Derived from the debt list rather than typed, so the
   * count and the list cannot disagree.
   */
  const inDebt = new Set((sweep.checkDebt ?? []).map((d) => d.itemId));
  return {
    filesInventoried: sweep.filesInventoried.length,
    itemsFound: sweep.items.length,
    itemsProcessed: sweep.items.filter((i) => i.disposition !== "UNIDENTIFIABLE").length,
    unidentifiable: by("UNIDENTIFIABLE"),
    reportedDefects: sweep.items.filter((i) => i.disposition !== "POSITIVE_KEPT").length,
    verifiedFixed: sweep.items.filter(
      (i) => i.disposition === "FIXED_VERIFIED" && !inDebt.has(i.id),
    ).length,
    checkDebt: (sweep.checkDebt ?? []).length,
    /*
     * **OPEN_EXECUTABLE AND NEEDS_SEAN ARE COUNTED SEPARATELY.** (RULING 221.)
     *
     * A single "open" number collapses "the machine could do this and has not"
     * with "a human must decide this", and only the first is work a session can
     * finish. Reporting them together is the reporting defect RULING 180's own
     * logic names: three independent statuses, and confusing them is a defect.
     */
    openExecutable: by("OPEN_BLOCKED"),
    needsSean: by("NEEDS_SEAN"),
    openBlocked: by("OPEN_BLOCKED"),
    positivesKept: by("POSITIVE_KEPT"),
    instancesFound: sweep.items.reduce((n, i) => n + i.instancesFound, 0),
    instancesFixed: sweep.items.reduce((n, i) => n + i.instancesFixed, 0),
  };
}
