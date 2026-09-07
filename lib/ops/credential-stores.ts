/**
 * **WHERE A CREDENTIAL LIVES, AS THREE WORDS AND NOTHING ELSE.**
 * (Admin Pass C, 2026-09-06.)
 *
 * The vocabulary lived in `lib/ops/credential-report.ts` beside the report
 * writer, which is where it belonged until an admin PAGE needed it. That module
 * reads files — `readFileSync(resolve(root, path))` with a computed path — and
 * Next's file tracer, seeing a path it cannot evaluate, includes the whole
 * `lib/ops/` directory in that page's deploy as a precaution. Fifty-two modules
 * rode in behind three strings, one of them a fixture file carrying a
 * credential-shaped test value, and `scripts/check-build-output.mjs` refused
 * the build by name.
 *
 * That refusal was correct and the fix is not to widen its allowlist. The
 * vocabulary has no filesystem in it, so it lives here, and both the report
 * writer and the source registry import it. One list, in the module with the
 * fewest dependencies that can hold it.
 *
 * PURE. Three constants and a type.
 */

/**
 * The three places a credential can actually be read from, as a PROCESS sees
 * them — never as a path and never as a variable name.
 *
 * This is a different question from where the OWNER can find the plaintext, and
 * conflating the two is what the source registry had to be built around: the
 * deployed console runs as the website, so it can see the website's own
 * settings and nothing else. A key that lives in the repository's saved secrets
 * is absent from that process every time, and a page that read `process.env`
 * and printed "not configured" would be stating a falsehood with a tick beside
 * it.
 */
export const CREDENTIAL_STORES = ["SITE_RUNTIME", "REFRESH_JOB", "WORKSTATION"] as const;
export type CredentialStore = (typeof CREDENTIAL_STORES)[number];

/** Each store as the owner would say it. */
export const CREDENTIAL_STORE_SAYS: Readonly<Record<CredentialStore, string>> = {
  SITE_RUNTIME: "the website's own server settings",
  REFRESH_JOB: "the repository's saved secrets, which the nightly refresh reads",
  WORKSTATION: "the private settings file on the machine the build and hunt commands run on",
};
