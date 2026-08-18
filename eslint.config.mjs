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
  ]),
]);

export default eslintConfig;
