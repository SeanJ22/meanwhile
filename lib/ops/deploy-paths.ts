/**
 * WHICH COMMITS ARE ALLOWED TO COST A DEPLOY.
 *
 * Every production deploy costs build credits, and a commit no reader can see
 * (docs, records, tests) gains nothing from one. So only commits that change
 * what a reader is served are allowed to cost a deploy.
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
    why: "Immutable historical engineering evidence the deploy never reads. Mutable production integrity and runtime operations now live in canonical stores and have no Git writer. Tests/deploy-paths.test.ts checks the no-trace claim against real trace manifests.",
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
  // Standing data updates publish through the data plane. Diagnostics and
  // proof harnesses do not change the application Netlify serves.
  if (p.startsWith("data/")) return true;
  if (/^scripts\/(?:lib\/)?[^/]*(?:proof|census|verify-|audit-)[^/]*\.[cm]?[jt]sx?$/.test(p)) return true;
  if (p.startsWith("lib/holdings/") && /(?:census|proof)/.test(p)) return true;
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
