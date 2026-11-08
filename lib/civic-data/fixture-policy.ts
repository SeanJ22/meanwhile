export interface CivicDataFixtureEnvironment {
  readonly NODE_ENV?: string;
  readonly NODE_TEST_CONTEXT?: string;
}

/**
 * The single admission rule for bundled deterministic evidence.
 *
 * `NODE_TEST_CONTEXT` is useful evidence that Node's test runner created the
 * process, but it is still an environment variable.  A production process
 * must remain production-closed even if that marker is accidentally inherited
 * or explicitly set.
 */
export function mayUseTestFixture(
  env: CivicDataFixtureEnvironment = (globalThis as { process?: { env: CivicDataFixtureEnvironment } }).process?.env ?? {},
): boolean {
  return env.NODE_ENV !== "production" &&
    (env.NODE_ENV === "test" || env.NODE_TEST_CONTEXT !== undefined);
}
