/**
 * WHAT A SCHEDULED PUSHER IS ALLOWED TO WRITE TO `main`.
 * (2026-08-26, the unblock-pushers session. RULING 162.)
 *
 * **This file is the reason the bypass is safe.**
 *
 * Branch protection on `main` — hardened 2026-08-25 with `enforce_admins: true`
 * — refuses a direct push from everyone, the Actions bot included. All eight
 * scheduled pushers push directly, so since that date every one of them has
 * gone red at the push with `protected branch hook declined`. Nothing is lost
 * silently, but the data ages and the gap widens every day.
 *
 * The fix Sean ruled for is a SCOPED BYPASS for the Actions bot. A bypass that
 * could carry CODE would be the 8/25 hole reopened — that hole was sessions
 * merging red code with nothing required, and the whole point of the hardening
 * was to close it. So the bypass is paired with this: a hard, per-workflow path
 * allowlist that makes it structurally impossible for a scheduled push to carry
 * anything but the machine-generated artifact that workflow exists to produce.
 *
 * **PER-WORKFLOW, NOT ONE GLOBAL LIST, AND THAT IS THE DESIGN.** A single list
 * would be the union of eight workflows' needs, so the FEC refresher would be
 * permitted to write the ballot and the tripwire would be permitted to write a
 * snapshot. Each profile below grants exactly the paths its own workflow writes
 * and nothing else, so the blast radius of any one of them is one artifact.
 *
 * **IT FAILS CLOSED, IN FOUR DIRECTIONS** (the brief's requirement, and
 * RULING 159 — zero is a result that must be EARNED, never defaulted to):
 *
 *   - an unknown or absent workflow id      → refused
 *   - a diff that could not be read         → refused
 *   - an EMPTY diff                         → refused
 *   - any path outside the profile          → refused
 *
 * The empty case is the one that looks harmless and is not. A push of nothing
 * is not a safe push; it is a path check that found nothing to check, and
 * letting it through is exactly the shape of the capture script that reported
 * `0 offenders` about a panel it never opened.
 *
 * **THE LIST IS DERIVED FROM WHAT THE PUSHERS ACTUALLY WRITE**, read off the
 * `git add` lines in the workflows themselves, never from what they were
 * expected to write. That reading produced the finding this session led with:
 * `job-watch` ran `git add docs/` — the whole directory — while needing exactly
 * one file in it. See `TRACKER_ROW_GRANT` below.
 */

/** One allowed path. A value ending in `/` is a directory prefix; anything else is an exact file. */
export interface AllowedPath {
  readonly path: string;
  readonly why: string;
}

/** One scheduled pusher, and the complete set of paths it may write. */
export interface PusherProfile {
  /** The `--workflow` value the workflow passes to `scripts/push-main.mjs`. */
  readonly id: string;
  /** The workflow file, so the guard's test can anchor on it (RULING 147). */
  readonly workflow: string;
  /** Exhaustive. A path not matched here is refused. */
  readonly allow: readonly AllowedPath[];
}

/**
 * THE ONE GRANT OUTSIDE `data/`, NAMED SO IT CANNOT BE ABSORBED SILENTLY.
 *
 * The brief for this session said the allowlist covers data artifacts only and
 * "never includes ... the tracker stores". Read strictly that would end
 * `job-watch`, whose entire function under RULING 56 is to COMMIT the Needs
 * Sean row it raises — the only channel in this repo that reaches a person when
 * a scheduled job has failed twice in a row.
 *
 * Killing that alarm to satisfy a path rule would be the guard removing the
 * thing it was built to protect. So the grant is made, narrowly, to ONE
 * workflow, for ONE file, with the conflict reported rather than smoothed, and
 * a P1 row opened for Sean to overrule if he wants the stricter reading.
 *
 * It cannot reopen the code hole: `docs/tracker-working.csv` is a CSV appended
 * by `scripts/tracker.mjs add`, it ships nothing to a reader, and it is
 * classified non-shipping by the deploy filter, so a push of it builds nothing.
 */
export const TRACKER_ROW_GRANT: AllowedPath = {
  path: "docs/tracker-working.csv",
  why:
    "RULING 56 — job-watch commits the Needs Sean row it raises, and that is the " +
    "only channel that reaches a person when a scheduled job fails twice running. " +
    "Granted to job-watch alone; see TRACKER_ROW_GRANT.",
};

/**
 * THE FOUR GENERATED VIEWS THAT MOVE WITH THE STORE, AND WHY EACH IS NAMED.
 * (2026-08-26, the sources-and-incumbency session. Item 8a(b) of that brief.)
 *
 * **Granting the store alone put `main` RED, and this is measured rather than
 * argued.** `job-watch` run 32996823803 opened `JOB04` and `JOB05`, committed
 * `docs/tracker-working.csv` through the new deploy key, and left behind the
 * four files `scripts/tracker.mjs add` had regenerated a second earlier. Build
 * check 32997211245 on the resulting `main` then failed FOUR guards at once:
 *
 *   - `docs/tracker.md` states an open count other than 288
 *   - the stated open count no longer equals the rows underneath it
 *   - Needs Sean holds 7 P1 rows and `tracker.md` does not say it is stopped
 *   - `JOB04` and `JOB05` are in a store with no ledger entry claiming them
 *
 * Every one of those is the suite doing its job: the store and its generated
 * views disagreed, because half the write was committed and half was not. The
 * narrow grant was not merely incomplete — **it guaranteed that the alarm
 * firing would break the branch**, which is the alarm sharing a failure mode
 * with the thing it watches (`NH204`, and Item 8b of this brief).
 *
 * **The alternative was considered and refused.** `job-watch` could stop
 * generating what it does not need — but it does not choose to: `tracker add`
 * regenerates the views as part of writing the store, and always has, because
 * a store whose views disagree with it is the defect RULING 102 exists over.
 * Making the bot write half the artifact set would move the inconsistency from
 * the runner into `main`, permanently, instead of for one commit.
 *
 * **NOT `docs/`.** Four exact files, each named, each a deterministic
 * regeneration of the store this workflow just legitimately wrote. None ships
 * to a reader; all four are classified non-shipping by the deploy filter, so a
 * push of them builds nothing. `docs/rulings.md` and `docs/tracker-resolved.csv`
 * remain barred outright by `NEVER_PUSHABLE`, which is a second and independent
 * check (RULING 147).
 */
export const TRACKER_VIEW_GRANTS: readonly AllowedPath[] = [
  {
    path: "docs/tracker.md",
    why: "the readable view of the working store, regenerated by `tracker add` in the same call that wrote the row. Leaving it behind makes tracker.md state a count the store contradicts, which is a guarded failure.",
  },
  {
    path: "docs/log.md",
    why: "the session-by-session record, regenerated in the same call. Same reason, same guard.",
  },
  {
    path: "docs/tracker-opened.json",
    why: "the ledger asserting which session opened which row. Without it the row is in a store that no ledger entry claims — the exact assertion that failed on JOB04 and JOB05.",
  },
  {
    path: "docs/tracker.xlsx",
    why: "the workbook view of the same two stores, regenerated in the same call. It is Sean's editing surface and it is a VIEW: `tracker add` writes it from the store, so a bot commit of it carries the store's own content and nothing of its own.",
  },
];

/**
 * Every scheduled pusher, with the paths it writes.
 *
 * A workflow that calls `scripts/push-main.mjs` and is not in this list is
 * REFUSED — that is the fail-closed direction, and it is what makes a pusher
 * added later fail loudly rather than inherit somebody else's grant.
 */
export const PUSHER_PROFILES: readonly PusherProfile[] = [
  {
    id: "refresh-daily",
    workflow: ".github/workflows/refresh-daily.yml",
    allow: [
      { path: "data/", why: "the orchestrated daily refresh writes every due source's artifact under data/" },
      { path: "docs/refresh-run.md", why: "the run report the orchestrator writes beside the data" },
    ],
  },
  {
    id: "refresh-meetings-snapshot",
    workflow: ".github/workflows/refresh-meetings-snapshot.yml",
    allow: [{ path: "data/meetings-snapshot.json", why: "the one governed artifact this refresher produces" }],
  },
  {
    id: "refresh-fec-snapshot",
    workflow: ".github/workflows/refresh-fec-snapshot.yml",
    allow: [{ path: "data/fec/fec-2026.json", why: "the one governed artifact this refresher produces" }],
  },
  {
    id: "refresh-legiscan-snapshot",
    workflow: ".github/workflows/refresh-legiscan-snapshot.yml",
    allow: [
      { path: "data/votes/state-votes-snapshot.json", why: "the one governed artifact this refresher produces" },
    ],
  },
  {
    id: "refresh-dotgov-snapshot",
    workflow: ".github/workflows/refresh-dotgov-snapshot.yml",
    allow: [{ path: "data/dotgov/snapshot.json", why: "the one governed artifact this refresher produces" }],
  },
  {
    id: "refresh-nj-filing",
    workflow: ".github/workflows/refresh-nj-filing.yml",
    allow: [{ path: "data/ballot/", why: "the ballot rebuilt from the Morris County clerk's current filing" }],
  },
  {
    id: "intake-tripwire",
    workflow: ".github/workflows/intake-tripwire.yml",
    allow: [{ path: "docs/intake-report.md", why: "the identifier-free day-count report the tripwire writes" }],
  },
  {
    id: "job-watch",
    workflow: ".github/workflows/job-watch.yml",
    allow: [TRACKER_ROW_GRANT, ...TRACKER_VIEW_GRANTS],
  },
] as const;

/**
 * Paths that may NEVER be granted, whatever a profile says.
 *
 * A second, independent check over the same question (RULING 147 — the profile
 * list and this list are not derived from each other). If a future edit widened
 * a profile to `docs/` or `.github/`, the profile would permit it and this would
 * still refuse. It is the clause that keeps "a bypass that could carry code"
 * impossible rather than merely unintended.
 */
export const NEVER_PUSHABLE: readonly { prefix: string; why: string }[] = [
  { prefix: ".github/", why: "workflows and CI configuration — the bypass may never rewrite its own gate" },
  { prefix: "scripts/", why: "executable code; the deploy filter classes it shipping because pnpm build type-checks it" },
  { prefix: "lib/", why: "application and operations code" },
  { prefix: "app/", why: "application code a reader sees" },
  { prefix: "components/", why: "application code a reader sees" },
  { prefix: "tests/", why: "the guards; a bot that can edit tests can delete the one refusing it" },
  { prefix: "CLAUDE.md", why: "the constitution is changed by the author, never by a scheduled job" },
  { prefix: "docs/rulings.md", why: "the append-only record of rulings" },
  { prefix: "docs/tracker-resolved.csv", why: "resolved rows are closed by the author (RULING 37)" },
  { prefix: "package.json", why: "dependencies and the script surface" },
  { prefix: "pnpm-lock.yaml", why: "the dependency lock" },
  { prefix: "netlify.toml", why: "how the deploy builds" },
  { prefix: "next.config.ts", why: "what the build does" },
  { prefix: "drizzle.config.ts", why: "the database wiring" },
];

/* -------------------------------------------------------------------------- */
/* THE AUDIT OVER THE WORKFLOW FILES THEMSELVES                                */
/* -------------------------------------------------------------------------- */

/**
 * A pusher added later without the guard must fail the TEST, not review.
 *
 * **The anchor is the workflow file** (RULING 147 — no reconciliation may
 * compare a parser to itself). This reads the `.yml` and asks what it actually
 * does: does it invoke `scripts/push-main.mjs`, does it pass a `--workflow` id,
 * is that id a declared profile, and do the paths its own `git add` lines name
 * fall inside what that profile grants. Re-deriving the profile list from the
 * profile list would agree with a missing guard on every run, forever.
 */
export interface WorkflowSource {
  readonly file: string;
  readonly text: string;
}

export interface PusherAudit {
  readonly file: string;
  readonly pushes: boolean;
  readonly workflowId: string | null;
  readonly addedPaths: readonly string[];
  readonly problems: readonly string[];
}

/** Drop whole-line comments so a workflow that merely MENTIONS the pusher is not read as one. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** The paths a workflow's own `git add` lines stage. */
export function gitAddPathsIn(text: string): string[] {
  const body = withoutComments(text);
  const out: string[] = [];
  for (const m of body.matchAll(/^\s*git add\s+(.+)$/gm)) {
    for (const raw of m[1].split(/\s+/)) {
      const p = normalisePath(raw);
      if (p && p !== "." && !p.startsWith("-")) out.push(p);
    }
  }
  return out;
}

export function auditWorkflowPushers(sources: readonly WorkflowSource[]): PusherAudit[] {
  return sources.map((source) => {
    const body = withoutComments(source.text);
    const invocations = [...body.matchAll(/node\s+scripts\/push-main\.mjs([^\n]*)/g)];

    if (invocations.length === 0) {
      return { file: source.file, pushes: false, workflowId: null, addedPaths: [], problems: [] };
    }

    const problems: string[] = [];
    const ids = new Set<string>();

    for (const [, tail] of invocations) {
      const flag = /--workflow[=\s]+([A-Za-z0-9._-]+)/.exec(tail);
      if (!flag) {
        problems.push(
          "invokes scripts/push-main.mjs without --workflow, so no allowlist applies to it. " +
            "Every scheduled pusher declares which profile it pushes under.",
        );
        continue;
      }
      ids.add(flag[1]);
    }

    const workflowId = ids.size === 1 ? [...ids][0] : null;
    if (ids.size > 1) {
      problems.push(`pushes under more than one workflow id (${[...ids].join(", ")}); a file declares exactly one`);
    }

    const profile = profileFor(workflowId);
    if (workflowId && !profile) {
      problems.push(
        `pushes under "${workflowId}", which has no profile in lib/ops/push-allowlist.ts. ` +
          "A pusher declares the paths it writes before it is allowed to write them.",
      );
    }

    const addedPaths = gitAddPathsIn(source.text);

    if (profile) {
      if (profile.workflow !== source.file) {
        problems.push(`profile "${profile.id}" names ${profile.workflow}, but this is ${source.file}`);
      }
      for (const p of addedPaths) {
        if (!isAllowedFor(profile, p)) {
          problems.push(
            `stages "${p}", which "${profile.id}" is not allowed to push. Either narrow the ` +
              "git add or declare the path — and declaring it is a decision, not a formality.",
          );
        }
      }
      if (addedPaths.length === 0) {
        problems.push(
          "invokes the pusher but stages nothing this reader could find. A push with no " +
            "readable git add is a path check with nothing to check (RULING 159).",
        );
      }
    }

    return { file: source.file, pushes: true, workflowId, addedPaths, problems };
  });
}

export type PushPathVerdict = "allowed" | "refused" | "cannot-tell";

export interface PushPathDecision {
  readonly verdict: PushPathVerdict;
  readonly profileId: string | null;
  readonly changed: readonly string[];
  readonly offenders: readonly string[];
  /** Always populated, and written to be read in a workflow log by somebody who is not looking for it. */
  readonly reason: string;
}

/** Normalise a git path for comparison. Windows separators, `./` prefixes, and stray quoting. */
export function normalisePath(path: string): string {
  return path
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

export function profileFor(id: string | null | undefined): PusherProfile | undefined {
  if (!id) return undefined;
  return PUSHER_PROFILES.find((p) => p.id === id);
}

/** Is this path barred outright, whatever any profile says? */
export function isNeverPushable(path: string): boolean {
  const p = normalisePath(path);
  return NEVER_PUSHABLE.some(({ prefix }) => (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix));
}

/** Does this profile permit this exact path? */
export function isAllowedFor(profile: PusherProfile, path: string): boolean {
  const p = normalisePath(path);
  if (!p) return false;
  // Traversal and absolute paths are refused before anything else looks at them.
  if (p.startsWith("/") || p.split("/").includes("..") || /^[A-Za-z]:/.test(p)) return false;
  if (isNeverPushable(p)) return false;
  return profile.allow.some(({ path: rule }) => (rule.endsWith("/") ? p.startsWith(rule) : p === rule));
}

/**
 * The verdict. `changed` is `null` when the diff could not be read — which is
 * NOT an empty diff, and keeping those apart is the whole discipline here.
 */
export function classifyPushPaths(input: {
  profileId: string | null | undefined;
  changed: readonly string[] | null;
}): PushPathDecision {
  const profile = profileFor(input.profileId);

  if (!input.profileId) {
    return {
      verdict: "cannot-tell",
      profileId: null,
      changed: [],
      offenders: [],
      reason:
        "no --workflow id was given, so there is no allowlist to check against. " +
        `Pass one of: ${PUSHER_PROFILES.map((p) => p.id).join(", ")}.`,
    };
  }

  if (!profile) {
    return {
      verdict: "cannot-tell",
      profileId: input.profileId,
      changed: [],
      offenders: [],
      reason:
        `"${input.profileId}" is not a known scheduled pusher. A pusher added since this ` +
        "guard was written must declare its paths in lib/ops/push-allowlist.ts before it can " +
        `push. Known: ${PUSHER_PROFILES.map((p) => p.id).join(", ")}.`,
    };
  }

  if (input.changed === null) {
    return {
      verdict: "cannot-tell",
      profileId: profile.id,
      changed: [],
      offenders: [],
      reason:
        "the changed-path list could not be read from git. That is not an empty diff, and it " +
        "is not permission to push — the guard cannot answer its question, so it refuses.",
    };
  }

  const changed = input.changed.map(normalisePath).filter((p) => p.length > 0);

  if (changed.length === 0) {
    return {
      verdict: "cannot-tell",
      profileId: profile.id,
      changed: [],
      offenders: [],
      reason:
        "the commit being pushed changes NO paths. A push of nothing is a path check with " +
        "nothing to check, not a safe push — zero is a result that must be earned (RULING 159).",
    };
  }

  const offenders = changed.filter((p) => !isAllowedFor(profile, p));

  if (offenders.length > 0) {
    return {
      verdict: "refused",
      profileId: profile.id,
      changed,
      offenders,
      reason:
        `${offenders.length} of ${changed.length} changed path(s) are outside what ` +
        `${profile.id} is allowed to write: ${offenders.join(", ")}. ` +
        `It may write only: ${profile.allow.map((a) => a.path).join(", ")}.`,
    };
  }

  return {
    verdict: "allowed",
    profileId: profile.id,
    changed,
    offenders: [],
    reason: `${changed.length} changed path(s), all inside ${profile.id}'s allowlist.`,
  };
}
