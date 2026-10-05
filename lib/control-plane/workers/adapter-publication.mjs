/**
 * Which route the adapter engineer's work takes to `main` (RL-06).
 *
 *   pr     the engineer opens an `engineer-adapter/<kind>` pull request and
 *          `.github/workflows/engineer-adapter-merge.yml` merges it once CI is
 *          green. Today's route, and the default until River's route is checked
 *          live.
 *   river  the engineer pushes a `READY: adapter <kind>` commit and its status
 *          record to `stream/adapter-<kind>`; River folds, tests and releases it
 *          with every other stream. No pull request is opened and the merge
 *          workflow merges nothing.
 *
 * Exactly one publisher is active for any reading of the switch: both the
 * runner and the merge workflow read it here. An unreadable value turns BOTH
 * off (the engineer records a blocker, the workflow merges nothing) rather than
 * guessing a route.
 *
 * The committed default below is the switch for a release. The environment
 * variable overrides it: the runner's own environment, and the repository
 * variable of the same name that the merge workflow passes to its script. It is
 * the way back without a deploy.
 *
 * Plain JavaScript with no imports, so the merge workflow can run it without
 * installing dependencies.
 */

export const ADAPTER_PUBLICATION_ENV = "WTP_ADAPTER_PUBLICATION";

/** @type {readonly ["pr", "river"]} */
export const ADAPTER_PUBLICATION_MODES = Object.freeze(/** @type {const} */ (["pr", "river"]));

/**
 * The committed switch. Stays `pr` until an adapter repair made by the runner
 * has reached `main` through River (RL-06 "done when").
 * @type {"pr" | "river"}
 */
export const ADAPTER_PUBLICATION_DEFAULT = "pr";

/**
 * @typedef {{ mode: "pr" | "river", source: "env" | "default", problem: null }
 *   | { mode: null, source: "env", problem: string }} AdapterPublication
 */

/**
 * Read the switch. An empty or absent variable means the committed default; a
 * value that is neither `pr` nor `river` means no route at all.
 * @param {Record<string, string | undefined>} [env]
 * @returns {AdapterPublication}
 */
export function readAdapterPublication(env = process.env) {
  const raw = `${env?.[ADAPTER_PUBLICATION_ENV] ?? ""}`.trim().toLowerCase();
  if (!raw) return { mode: ADAPTER_PUBLICATION_DEFAULT, source: "default", problem: null };
  if (raw === "pr" || raw === "river") return { mode: raw, source: "env", problem: null };
  return { mode: null, source: "env", problem: `${ADAPTER_PUBLICATION_ENV}=${raw} is neither pr nor river; no adapter route is active` };
}
