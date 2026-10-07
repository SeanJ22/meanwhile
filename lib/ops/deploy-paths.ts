/** Which commits are allowed to cost a deploy: only those that change what a reader is served. */

/** Path prefixes whose contents cannot change what a reader sees, each with its reason. */
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

/** The whole decision from the changed-file list. `null` means the list could not be computed, not that nothing changed. */
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
