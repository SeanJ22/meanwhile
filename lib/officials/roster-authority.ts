import { ROSTER_FILES } from "../coverage/artifacts.ts";
import { mayUseTestFixture } from "../civic-data/fixture-policy.ts";

/**
 * Tracked officeholder projections that may participate in a production read.
 *
 * The state files in {@link ROSTER_FILES} were generated from the
 * Plural/OpenStates intermediary. They are retained only as historical
 * research and deterministic test fixtures. A production Reader must wait for
 * a proof-validated projection from the legislature that owns the record.
 */
export const PRODUCTION_OFFICEHOLDER_ROSTER_FILES = [
  "officeholders-us.json",
] as const;

/** Historical intermediary projections; never production authority. */
export const RETIRED_PLURAL_STATE_ROSTER_FILES = ROSTER_FILES.filter(
  (file) => file !== "officeholders-us.json",
);

/**
 * The sole exception to the production boundary is Node's explicit test
 * runner. This keeps recorded fixtures useful for deterministic contract tests
 * without turning them back into a deployable fallback.
 */
export function mayReadRetiredPluralRoster(
  nodeTestContext: string | null | undefined = process.env.NODE_TEST_CONTEXT,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return mayUseTestFixture({
    NODE_ENV: nodeEnv,
    ...(nodeTestContext == null ? {} : { NODE_TEST_CONTEXT: nodeTestContext }),
  });
}

/**
 * A Plural id is evidence of the retired intermediary projection, not a
 * production person authority. Keep those ids usable inside deterministic
 * fixture tests, while refusing every production bridge that could otherwise
 * reattach a portrait, statement, campaign link, vote, or candidacy by id.
 */
export function officeholderIdentityMayEnterReader(
  officeholderId: string,
  nodeTestContext: string | null | undefined = process.env.NODE_TEST_CONTEXT,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return !officeholderId.startsWith("plural:") || mayReadRetiredPluralRoster(nodeTestContext, nodeEnv);
}

export function officeholderRosterFiles(
  nodeTestContext: string | null | undefined = process.env.NODE_TEST_CONTEXT,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): readonly string[] {
  return mayReadRetiredPluralRoster(nodeTestContext, nodeEnv)
    ? ROSTER_FILES
    : PRODUCTION_OFFICEHOLDER_ROSTER_FILES;
}
