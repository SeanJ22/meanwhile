import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, minified third-party assets served as-is.
    "public/**",
    /*
     * Session scratch (2026-08-17, g10). `.gitignore` already says this
     * directory "must never be type-checked by the deploy or reviewed as
     * work", and neither gate honoured it: `pnpm lint` reported a one-off
     * probe's `any` as thirteen ERRORS, and `tsconfig.json`'s mts glob would
     * have taken the same files into the build the ship gate runs.
     * A throwaway probe that can fail the ship is a probe nobody writes,
     * and the ladder needs probes. Excluded in both places, together.
     */
    ".scratch/**",
    /*
     * Agent worktrees (2026-08-30, Session A). `.claude/worktrees/` holds
     * transient git worktrees parallel subagents work in — each a full copy
     * of the repository. Linting them re-reports every finding N times and,
     * worse, a leftover worktree from a MERGED branch failed the lint gate
     * with 417 errors that belonged to no current code. The worktree's own
     * branch is gated when it integrates; the copy is never the subject.
     */
    ".claude/worktrees/**",
  ]),
  /*
   * THE `^_` DISCARD CONVENTION (g18, 2026-08-18, the author's ruling A).
   *
   * A leading underscore is this repo's existing way of writing "deliberately
   * unused" — `_whichVote` keeps a signature honest, `_ok` and `_d` absorb a
   * stub lambda's arguments. Three of them sat in `lint-allowlist.json`, which
   * is a file for warnings we have LOOKED AT and tolerated. A deliberate
   * discard is not a tolerated warning; it is not a warning at all, and
   * carrying it in the allowlist made the allowlist's count mean less.
   *
   * THE RULING NAMED `varsIgnorePattern`, AND THAT ALONE WOULD LEGALIZE NONE
   * OF THEM. All three are function PARAMETERS, so `argsIgnorePattern` is the
   * option that reaches them — recorded here rather than silently substituted,
   * because the next reader comparing this file to the ruling deserves to find
   * the difference stated. Both are set: `varsIgnorePattern` as ruled, and
   * `argsIgnorePattern` because it is what makes the ruling do what it says.
   *
   * `caughtErrorsIgnorePattern` is deliberately NOT set. There is no warning
   * of that class today, so setting it would legalize an empty category — a
   * change nobody can check, which is the shape of change this repo refuses
   * everywhere else.
   */
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
