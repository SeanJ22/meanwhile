/**
 * WHICH COMMITS ARE ALLOWED TO COST A DEPLOY.
 *
 * Sean's instruction of 2026-08-24, escalated twice the same day: deploys are
 * burning credits, cut them to the floor. Adopted as **RULING 124** in
 * `CLAUDE.md` and `docs/rulings.md`.
 *
 * ## What was actually being spent
 *
 * Six production deploys landed before 5 AM on 2026-08-24. Reading the commits
 * rather than counting them:
 *
 * | Commit    | Touched                         | Could a reader see it? |
 * | --------- | ------------------------------- | ---------------------- |
 * | `cdb5ce2` | `data/meetings-snapshot.json`   | YES                    |
 * | `ccda6ea` | `data/fec/fec-2026.json`        | YES                    |
 * | `ba0947c` | `docs/intake-report.md`         | no                     |
 * | `2a7e825` | `docs/context.md`, `state.md`   | no                     |
 * | `ae5b178` | `docs/context.md`               | no                     |
 *
 * Three of five production builds rebuilt and redeployed a byte-identical
 * application to serve paperwork. That is the whole finding, and it is why the
 * filter is keyed on PATHS rather than on commit messages or authors: the
 * question "can a reader see this" has an exact answer, and it is a fact about
 * files.
 *
 * ## THE PREDICATE IS ALLOWLIST-SHAPED, AND THAT DIRECTION IS THE RULE
 *
 * A path is non-shipping only if it MATCHES A NAMED PREFIX here. Everything
 * else — every path this file has never heard of, every directory added
 * tomorrow — is shipping and builds. A new directory that nobody thought about
 * costs one wasted build; a new directory silently classified as paperwork
 * serves stale data to readers with nothing going red. Those are not
 * comparable, and the allowlist direction is what keeps the cheap failure the
 * only one available.
 *
 * `scripts/` IS DELIBERATELY SHIPPING, and it is the entry most likely to look
 * like a mistake. Nothing under `scripts/` reaches a reader. But `pnpm build`
 * type-checks everything `tsconfig.json` includes, `scripts/` included, and
 * `postbuild` runs `scripts/check-build-output.mjs` — so a `scripts/`-only
 * commit genuinely can break the build, and RULING 76 exists because a session
 * script broke it. Cancelling that build would move the failure to whichever
 * unrelated commit built next.
 *
 * ## HOW THE CLAIM IS PROVED, rather than asserted
 *
 * `tests/deploy-paths.test.ts` reads the built `.nft.json` trace manifests and
 * fails if ANY file under a non-shipping prefix was traced into the deploy.
 * That is the RULING 113 shape — the step's product is observable, so it is
 * observed — and it is stronger than reading the list and agreeing with it:
 * measured on adoption, **0 files under `docs/`, `tests/`, `screenshots/` or
 * `.github/` appear in any of the 31 trace manifests.**
 *
 * ## AND THE UNKNOWN ANSWER IS "BUILD"
 *
 * `classifyDeploy` returns a THIRD verdict — `cannot-tell` — for the case where
 * the changed-file list could not be computed at all (no cached deploy ref, a
 * shallow clone, a git failure). RULING 24: a check that cannot reach its
 * subject must never print like a passing one. `cannot-tell` builds.
 */

/**
 * Path prefixes whose contents cannot change what a reader sees.
 *
 * Each entry carries the reason it qualifies, because a list of directories
 * with no reasons attached is a list the next session extends by vibe.
 */
export const NON_SHIPPING_PREFIXES: readonly { prefix: string; why: string }[] = [
  {
    prefix: "docs/",
    why: "Methodology, the tracker views, the standing record, the generated reports. Nothing under it is traced into the deploy and nothing under it is read at runtime.",
  },
  {
    prefix: "tests/",
    why: "The suite runs in CI and in the local gate. It is not bundled, not traced, and not served.",
  },
  {
    prefix: "screenshots/",
    why: "Session evidence. Read by people, never by the app.",
  },
  {
    prefix: ".github/",
    why: "Workflow definitions. They change what CI does; they change nothing Netlify serves.",
  },
  {
    prefix: ".vscode/",
    why: "Editor configuration. Never leaves a developer's machine.",
  },
  { prefix: "README.md", why: "Repository documentation." },
  { prefix: "AGENTS.md", why: "Session instructions." },
  { prefix: "CLAUDE.md", why: "The constitution. Law for sessions; invisible to readers." },
  {
    prefix: ".gitattributes",
    why: "Checkout behaviour for the recorded fixtures. It governs how bytes land in a clone, never what the deploy serves.",
  },
  {
    prefix: ".gitignore",
    why: "Which untracked files git hides. Every file the build reads is tracked, so this cannot change the deploy contents.",
  },
  {
    prefix: "data/ops/",
    why: "Operational records the deploy never reads — the production-integrity reading (NH273) and anything joining it. No route traces this directory, which tests/deploy-paths.test.ts checks against the real trace manifests rather than trusting this sentence. Without the entry, every integrity reading would cost a production build to publish a file no reader can see.",
  },
] as const;

export type DeployVerdict = "build" | "cancel" | "cannot-tell";

export interface DeployDecision {
  verdict: DeployVerdict;
  /** Why, in one sentence, for the log the deploy leaves behind. */
  reason: string;
  /** Changed paths that are shipping — the ones that earned the build. */
  shipping: string[];
  /** Changed paths that are not. */
  nonShipping: string[];
}

/** True when this exact path cannot change what a reader sees. */
export function isNonShippingPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return NON_SHIPPING_PREFIXES.some(({ prefix }) =>
    prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix,
  );
}

/**
 * The whole decision, from the changed-file list.
 *
 * `changed` of `null` means the list could not be computed — NOT that nothing
 * changed. The two are kept apart deliberately: an empty array is a real
 * measurement (a commit that touched nothing, which git allows) and `null` is
 * the absence of one.
 */
export function classifyDeploy(
  changed: readonly string[] | null,
  context: string = "production",
): DeployDecision {
  if (context && context !== "production") {
    return {
      verdict: "cancel",
      reason: `context is '${context}' — only production builds (RULING 124); previews and branch deploys duplicate a gate nobody reads`,
      shipping: [],
      nonShipping: [],
    };
  }

  if (changed === null) {
    return {
      verdict: "cannot-tell",
      reason:
        "the changed-file list could not be computed — building, because a check that cannot reach its subject must never print like a passing one (RULING 24)",
      shipping: [],
      nonShipping: [],
    };
  }

  const shipping = changed.filter((p) => !isNonShippingPath(p));
  const nonShipping = changed.filter((p) => isNonShippingPath(p));

  if (changed.length === 0) {
    return {
      verdict: "cannot-tell",
      reason: "no changed paths reported at all, which is not a state a real commit produces — building rather than guessing",
      shipping,
      nonShipping,
    };
  }

  if (shipping.length === 0) {
    return {
      verdict: "cancel",
      reason: `all ${nonShipping.length} changed path(s) are non-shipping — nothing a reader can see moved`,
      shipping,
      nonShipping,
    };
  }

  return {
    verdict: "build",
    reason: `${shipping.length} of ${changed.length} changed path(s) are shipping — first is ${shipping[0]}`,
    shipping,
    nonShipping,
  };
}
/* ══════════════════════════════════════════════════════════════════════════
 * THE SECOND QUESTION: WHAT DOES A COMMIT COST TO PROVE? (RULING 278)
 *
 * Everything above answers ONE question — *can a reader see this?* — and it is
 * the question Netlify asks. CI asks a WIDER one, and the two are not the same:
 * `tests/` and `.github/` cannot change what a reader sees and absolutely can
 * change whether a governed proof passes. So a workflow that reused
 * `classifyDeploy` to decide what to run would skip the suite on a commit that
 * edited the suite.
 *
 * The canonical question for COST is therefore:
 *
 *     Can these changed paths affect what is built, served, migrated, read by
 *     the reader, or required by governed proof?
 *
 * `classifyCommitCost` is the one answer, and every workflow consumes it rather
 * than keeping a path list of its own. There is no second truth table anywhere
 * in `.github/`, which `tests/ci-cost.test.ts` asserts by reading the workflow
 * files.
 *
 * ## WHAT WAS ACTUALLY BEING SPENT (measured 2026-09-05)
 *
 * `build-check.yml` runs on every push to `main`. The post-deploy observer
 * commits its reading to `main`, which is a push, which starts another full
 * check. Three readings landed on 2026-09-05 and each bought a complete
 * shipping-grade proof of a commit that cannot change one byte of the deploy:
 *
 * | Run          | Commit                                        | Cost     |
 * | ------------ | --------------------------------------------- | -------- |
 * | `33996825942`| `Post-deploy integrity reading: 22:44Z`        | 12m 09s  |
 * | `33995324563`| `Post-deploy integrity reading: 22:12Z`        |  9m 57s  |
 * | `33989352454`| `Post-deploy integrity reading: 20:09Z`        | 12m 01s  |
 * | `33991166798`| `Daily refresh: 20:46Z` (debt + run report)    | 11m 48s  |
 *
 * Inside the 12 minutes, the `Test` step alone is 8m 15s, the browser install
 * 14s, `state-manifest --check` 79s — none of which can reach a different
 * verdict because `data/ops/production-integrity.json` moved.
 *
 * ## THE DIRECTION OF THE PREDICATE IS THE WHOLE RULE, AGAIN
 *
 * `NON_SHIPPING_PREFIXES` above is allowlist-shaped, and this is allowlist-
 * shaped for the same reason and one degree stricter: **an entry here is an
 * EXACT FILE, never a prefix.** `data/**` is precisely the rule
 * `.github/workflows/build-check.yml` already records rejecting — `pnpm build`
 * reads committed data at build time, so a malformed snapshot under a
 * `data/`-wide skip would land on `main` unchecked. `docs/**` is no better:
 * `docs/states/*.md` are generated manifests a gate checks, `docs/rulings.md`
 * is governance law, and `docs/evidence/` carries the Reader closure proof.
 *
 * So: a commit is CHEAP only when EVERY path it touched is named below.
 * SHIPPING, mixed and unrecognised commits all take the full proof, and a
 * changed-path list that could not be read at all takes it too.
 *
 * ## WHY THESE SIX FILES, AND NOTHING ELSE
 *
 * Each one satisfies four conditions, and the fourth is the one that makes the
 * skip a proof rather than a hope:
 *
 * 1. It is non-shipping under `isNonShippingPath`, so it cannot reach the
 *    deploy — asserted against the real `.nft.json` trace manifests by
 *    `tests/deploy-paths.test.ts`, not by reading this sentence.
 * 2. It is written to `main` by exactly one SCHEDULED PUSHER, through
 *    `scripts/push-main.mjs`, whose per-workflow grant in
 *    `lib/ops/push-allowlist.ts` names it — and `NEVER_PUSHABLE` in that same
 *    file makes it impossible for such a grant to carry `app/`, `lib/`,
 *    `scripts/`, `tests/` or `.github/`. A person or a session changing one of
 *    these files arrives through a pull request instead, and a pull request is
 *    never CHEAP.
 * 3. That door already ran `guardGeneratedFreshness` before it advanced `main`,
 *    so a generated dependent cannot be stale behind it.
 * 4. Its own committed shape is RE-PROVED on the cheap path. The cheap path is
 *    not "run nothing": `CHEAP_PATH_PROOFS` names the guards that read these
 *    files from disk, they run, and `validateOpsArtifact` below is the shape
 *    contract they hold. Skipping a proof that could not have changed is the
 *    optimisation; skipping a proof that could have changed would be a lie.
 * ═════════════════════════════════════════════════════════════════════════ */

/** The shape contract a committed ops artifact must still satisfy. */
export type OpsArtifactShape =
  | { kind: "json"; requiredKeys: readonly string[] }
  | { kind: "markdown"; mustContain: readonly string[] };

/** One file a scheduled pusher writes that cannot change any governed verdict. */
export interface OpsOnlyArtifact {
  /** Exact repo-relative path. Never a prefix, never a glob. */
  path: string;
  /** The `PUSHER_PROFILES` id in `lib/ops/push-allowlist.ts` granted this path. */
  writtenBy: string;
  /** Why it cannot change what is built, served, migrated, read or proved. */
  why: string;
  /** The guards, from `CHEAP_PATH_PROOFS`, that read it from disk on the cheap path. */
  provenBy: readonly string[];
  /** What those guards require of its bytes. */
  shape: OpsArtifactShape;
}

/**
 * The test files the CHEAP path runs. They cost seconds, they read the ops
 * artifacts from disk, and between them they hold every invariant the full
 * suite holds ABOUT THOSE FILES. Nothing else in the suite reads them.
 */
export const CHEAP_PATH_PROOFS: readonly string[] = [
  // Reads `data/ops/production-integrity.json` and asserts the committed record
  // parses, declares formatVersion 1, names a known state and is not vacuous.
  "tests/production-integrity.test.ts",
  // Sweeps CLAUDE.md and every `docs/*.md` for a date later than today — which
  // is the only guard that reads `docs/status-ledger.md`, `docs/refresh-run.md`
  // and `docs/intake-report.md` as committed text.
  "tests/doc-dates.test.ts",
  // Parses the committed `docs/refresh-run.md` table through the canonical
  // Markdown fallback reader.
  "tests/nightly-window.test.ts",
  // The classifier's own guards, including the one that reads EVERY artifact
  // below and holds it to `validateOpsArtifact`.
  "tests/ci-cost.test.ts",
] as const;

/**
 * THE OPS-ONLY SET. A strict subset of the non-shipping set, asserted as one.
 *
 * Adding an entry is adding a claim that a scheduled job's output cannot change
 * a governed verdict. Prove it the way these six are proved, or leave it out —
 * an unrecognised path costs one wasted check, and a wrongly-skipped one puts
 * an unverified commit on `main`.
 */
export const OPS_ONLY_ARTIFACTS: readonly OpsOnlyArtifact[] = [
  {
    path: "data/ops/production-integrity.json",
    writtenBy: "post-deploy-integrity",
    why:
      "The post-deploy reading of production (NH273). Nothing builds from it and no route traces it; " +
      "the release-freeze gate READS it, and on a commit carrying only this file that gate is " +
      "NOT_APPLICABLE by its own `classifyDeploy` scoping. A REFUSED reading never reaches this file " +
      "at all — the observer exits 1 and commits nothing.",
    provenBy: ["tests/production-integrity.test.ts", "tests/ci-cost.test.ts"],
    shape: {
      kind: "json",
      requiredKeys: ["formatVersion", "deployedSha", "observed", "observedAt", "moment"],
    },
  },
  {
    path: "docs/status-ledger.md",
    writtenBy: "post-deploy-integrity",
    why:
      "The GENERATED view of the reading above, regenerated and committed in the SAME commit so the " +
      "view cannot lag its input. Its generator is registered in `lib/ops/generated-register.ts` and " +
      "the push door refuses a stale one.",
    provenBy: ["tests/doc-dates.test.ts", "tests/ci-cost.test.ts"],
    shape: { kind: "markdown", mustContain: ["# Status ledger", "pnpm status:ledger"] },
  },
  {
    path: "data/ops/refresh-debt.json",
    writtenBy: "refresh-daily",
    why:
      "The durable record of a source whose data the refresh gate REFUSED. It is read by the refresh " +
      "orchestrator on the next run and by the standing watch; no build, no route and no reader " +
      "surface reads it.",
    provenBy: ["tests/ci-cost.test.ts"],
    shape: { kind: "json", requiredKeys: ["formatVersion", "updatedOn", "debts"] },
  },
  {
    path: "docs/refresh-run.json",
    writtenBy: "refresh-daily",
    why:
      "The machine-readable report of one refresh run — per-source outcome, changed paths, next due " +
      "day. A report ABOUT work that already landed; the work itself arrives in the same run's own " +
      "governed paths, which are not on this list and take the full proof.",
    provenBy: ["tests/ci-cost.test.ts"],
    shape: { kind: "json", requiredKeys: ["formatVersion", "runDate", "sources"] },
  },
  {
    path: "docs/refresh-run.md",
    writtenBy: "refresh-daily",
    why: "The rendered view of `docs/refresh-run.json`, generated in the same run and never hand-edited.",
    provenBy: ["tests/doc-dates.test.ts", "tests/nightly-window.test.ts", "tests/ci-cost.test.ts"],
    shape: { kind: "markdown", mustContain: ["# The daily refresh run", "| Source |"] },
  },
  {
    path: "docs/intake-report.md",
    writtenBy: "intake-tripwire",
    why:
      "The identifier-free day-count report of the owner-intake tripwire. Every value in it is a date, " +
      "a count or a threshold, and nothing reads it back but a person.",
    provenBy: ["tests/doc-dates.test.ts", "tests/ci-cost.test.ts"],
    shape: { kind: "markdown", mustContain: ["# Intake tripwire report"] },
  },
] as const;

/** Look an exact path up in the ops-only set. */
export function opsOnlyArtifact(path: string): OpsOnlyArtifact | null {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return OPS_ONLY_ARTIFACTS.find((a) => a.path === p) ?? null;
}

/**
 * Hold one committed ops artifact to its declared shape.
 *
 * This is what makes the cheap path a REPLACEMENT proof rather than an absence
 * of one: the guards that read these files from disk are the guards the cheap
 * path runs, and this is the contract they enforce. Returns the reason it
 * failed, or `null` when it holds.
 */
export function validateOpsArtifact(path: string, text: string): string | null {
  const artifact = opsOnlyArtifact(path);
  if (!artifact) return `${path} is not an ops-only artifact — there is no shape to hold it to`;
  if (artifact.shape.kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return `${path} is not parseable JSON: ${(err as Error).message}`;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${path} parsed to ${Array.isArray(parsed) ? "an array" : String(parsed)}, not an object`;
    }
    const missing = artifact.shape.requiredKeys.filter((k) => !(k in (parsed as Record<string, unknown>)));
    if (missing.length) return `${path} is missing required key(s): ${missing.join(", ")}`;
    return null;
  }
  const absent = artifact.shape.mustContain.filter((needle) => !text.includes(needle));
  if (absent.length) return `${path} no longer contains ${absent.map((s) => JSON.stringify(s)).join(", ")}`;
  return null;
}

/** SHIPPING and UNKNOWN both take the full proof; only NON_SHIPPING is cheap. */
export type CommitClass = "NON_SHIPPING" | "SHIPPING" | "UNKNOWN";

/** What a commit costs to prove. */
export type ProofCost = "CHEAP" | "FULL";

export interface CommitCostDecision {
  klass: CommitClass;
  cost: ProofCost;
  /** Why, in one sentence, for the receipt the run leaves behind. */
  reason: string;
  /** Changed paths that are ops-only. */
  opsOnly: string[];
  /** Changed paths that are not — the ones that earn the full proof. */
  proofBearing: string[];
  /** The guards the cheap path must run. Empty when the cost is FULL. */
  proofs: string[];
}

/**
 * THE ONE ANSWER. `changed` of `null` means the list COULD NOT BE COMPUTED —
 * never that nothing changed. Both of those, and every path this file has never
 * heard of, are FULL.
 */
export function classifyCommitCost(changed: readonly string[] | null): CommitCostDecision {
  if (changed === null) {
    return {
      klass: "UNKNOWN",
      cost: "FULL",
      reason:
        "the changed-path list could not be computed — a commit nobody can classify is a commit that " +
        "gets the full proof (RULING 24)",
      opsOnly: [],
      proofBearing: [],
      proofs: [],
    };
  }

  if (changed.length === 0) {
    return {
      klass: "UNKNOWN",
      cost: "FULL",
      reason:
        "no changed paths were reported at all — a merge commit reads this way, and a merge is a " +
        "shipping candidate by construction",
      opsOnly: [],
      proofBearing: [],
      proofs: [],
    };
  }

  const normalised = changed.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
  const opsOnly = normalised.filter((p) => opsOnlyArtifact(p) !== null);
  const proofBearing = normalised.filter((p) => opsOnlyArtifact(p) === null);

  if (proofBearing.length > 0) {
    return {
      klass: "SHIPPING",
      cost: "FULL",
      reason:
        `${proofBearing.length} of ${normalised.length} changed path(s) can affect what is built, served, ` +
        `migrated, read or proved — first is ${proofBearing[0]}`,
      opsOnly,
      proofBearing,
      proofs: [],
    };
  }

  const proofs = [
    ...new Set(opsOnly.flatMap((p) => opsOnlyArtifact(p)?.provenBy ?? [])),
  ].sort();

  return {
    klass: "NON_SHIPPING",
    cost: "CHEAP",
    reason:
      `all ${opsOnly.length} changed path(s) are named operational artifacts written by a scheduled ` +
      `pusher — nothing built, served, migrated, read or proved can differ`,
    opsOnly,
    proofBearing,
    proofs,
  };
}
