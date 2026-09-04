/**
 * THE EVIDENCE PLANE, PART THREE — THE VAULT-FIRST RULE AS A MECHANISM.
 *
 * ## The rule
 *
 *     A PARSER NEVER TOUCHES THE NETWORK. IT READS BYTES THE VAULT ISSUED IT,
 *     AND NOTHING ELSE.
 *
 * ## Why it is a mechanism and not a convention
 *
 * Written as a convention this rule holds until the first parser that needs one
 * more page. Somebody adds a `fetch` for a detail view, the parse now depends on
 * a live server, and three things break at once and none of them loudly:
 *
 *   - **Replay dies.** Re-running the parser over stored evidence no longer
 *     reproduces the original output, because half its input came from a server
 *     whose page has since changed. The reproducibility gate starts failing for
 *     reasons unrelated to truth, and a gate that cries wolf is a gate everyone
 *     learns to ignore.
 *   - **The permission ladder is bypassed.** Every governed retrieval goes
 *     through the route/attempt machinery that reads robots, records the rung,
 *     names the wall and separates permission from transport. A `fetch` inside a
 *     parser has none of that. It is an unrecorded retrieval, and RULING 182's
 *     distinction cannot be made about a request nobody wrote down.
 *   - **Provenance silently becomes fiction.** The artifact says the claim came
 *     from this body. It came from this body plus something else, and the
 *     something else has no hash, no timestamp and no attribution.
 *
 * So the boundary is enforced by construction. `ParserInput` carries a brand
 * that only this module can apply, and `issueParserInput` is the only function
 * that applies it. A parser cannot be handed bytes that did not come through the
 * vault, because there is no way to build the value that represents them.
 *
 * ## The capability half
 *
 * The brand stops a parser being GIVEN network bytes. `assertNoNetwork` stops a
 * parser being granted the ABILITY to go get them: a parser role holding any
 * network capability is refused before it runs, by name, naming the capability.
 * Both halves are needed — one guards the input, the other guards the process.
 */

import { contentHash } from "../ids.ts";
import { RestrictedArtifactRefused, type Artifact, type ArtifactTier } from "./artifact.ts";

/** ------------------------------------------------------- capabilities */

/**
 * Capability prefixes that mean "this role can reach something outside itself".
 *
 * Prefix-matched rather than enumerated, and deliberately so: an enumerated list
 * fails OPEN the moment somebody adds `net.http3`, and a capability guard that
 * fails open is a capability guard that is not there. A new capability under a
 * known prefix is refused for a parser without anybody remembering to update
 * this file.
 */
export const NETWORK_CAPABILITY_PREFIXES = [
  "net.",
  "http.",
  "https.",
  "dns.",
  "socket.",
  "browser.",
  "fetch.",
  "proxy.",
] as const;

/** Capability names that are network access without carrying a prefix. */
export const NETWORK_CAPABILITY_NAMES = [
  "network",
  "egress",
  "outbound",
  "playwright",
  "curl",
  "network_public_read",
  "browser_drive",
] as const;

export function isNetworkCapability(capability: string): boolean {
  const c = capability.trim().toLowerCase();
  if (NETWORK_CAPABILITY_NAMES.includes(c as (typeof NETWORK_CAPABILITY_NAMES)[number])) {
    return true;
  }
  return NETWORK_CAPABILITY_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * A role that may not reach the network asked for, or was granted, network
 * access.
 *
 * Named so a caller can tell it apart from an ordinary transport failure. "The
 * parser was denied the network" and "the network did not answer" produce the
 * same empty result and mean opposite things — one is our policy working and
 * one is a wall, and only one of them is ever a reason to re-walk a route.
 */
export class NetworkAccessDenied extends Error {
  readonly role: string;
  readonly capabilities: readonly string[];

  constructor(role: string, capabilities: readonly string[]) {
    super(
      `Role ${role} may not hold network capability: ${capabilities.join(", ")}. ` +
        "A parser reads bytes the vault issued it. A retrieval belongs to a route " +
        "attempt, where the rung, the permission and the transport are recorded.",
    );
    this.name = "NetworkAccessDenied";
    this.role = role;
    this.capabilities = [...capabilities];
  }
}

/**
 * REFUSE A PARSER THAT CARRIES ANY NETWORK CAPABILITY.
 *
 * Checked before the parser runs rather than when it first tries to fetch,
 * because a check at the moment of use only catches the paths that execute. A
 * parser with a network capability behind a rarely-taken branch is already
 * wrong; the grant is the defect, not the call.
 */
export function assertNoNetwork(
  capabilities: readonly string[],
  role: string = "PARSER",
): void {
  const offending = capabilities.filter(isNetworkCapability);
  if (offending.length > 0) throw new NetworkAccessDenied(role, offending);
}

/** ------------------------------------------------------- parser input */

/**
 * The vault's signature.
 *
 * A module-private symbol, never exported. It is the entire enforcement: a value
 * of type `ParserInput` cannot be constructed anywhere else in the program,
 * because the key of the required property is not nameable outside this file.
 * A structural type with an ordinary boolean field would be trivially forged by
 * an object literal, which is the same as no boundary at all.
 */
const VAULT_ISSUED: unique symbol = Symbol("control-plane/evidence/vault-issued");

/**
 * BYTES A PARSER MAY READ, AND PROOF OF WHERE THEY CAME FROM.
 *
 * The artifact id and the content hash travel WITH the bytes rather than beside
 * them, so a parser's output can be attributed without the caller having to
 * remember to pass provenance separately — which is the step that gets skipped.
 */
export interface ParserInput {
  readonly [VAULT_ISSUED]: true;
  readonly artifactId: string;
  readonly tier: ArtifactTier;
  readonly contentHash: string;
  readonly canonicalUrl: string;
  readonly retrievedAt: string;
  readonly sourceId: string;
  readonly methodRouteId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly text: string;
}

/** Is this value one the vault actually issued? */
export function isParserInput(value: unknown): value is ParserInput {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[VAULT_ISSUED] === true
  );
}

/**
 * THE ONLY CONSTRUCTOR OF `ParserInput`, AND THEREFORE THE VAULT-FIRST RULE.
 *
 * Two refusals:
 *
 *   - a `RESTRICTED_RAW` artifact is refused BY NAME, with the derivative named
 *     when one is known — a parser reads the sanitized body or it reads nothing;
 *   - the bytes must hash to the artifact's recorded `contentHash`. Without that
 *     check the brand would certify only that something called this function,
 *     not that the bytes are the ones the vault stored, and a caller that fetched
 *     a page and passed the artifact's metadata alongside it would launder live
 *     network bytes into a "vault-issued" value. That is precisely the hole the
 *     brand exists to close.
 */
export function issueParserInput(
  artifact: Artifact,
  text: string,
  options: { sanitizedDerivativeId?: string | null; role?: string } = {},
): ParserInput {
  const role = options.role ?? "PARSER";

  if (artifact.tier === "RESTRICTED_RAW") {
    throw new RestrictedArtifactRefused(
      artifact.id,
      role,
      options.sanitizedDerivativeId ?? null,
    );
  }

  const hash = contentHash(text);
  if (hash !== artifact.contentHash) {
    throw new NotVaultIssued(artifact.id, artifact.contentHash, hash);
  }

  return {
    [VAULT_ISSUED]: true,
    artifactId: artifact.id,
    tier: artifact.tier,
    contentHash: artifact.contentHash,
    canonicalUrl: artifact.canonicalUrl,
    retrievedAt: artifact.retrievedAt,
    sourceId: artifact.sourceId,
    methodRouteId: artifact.methodRouteId,
    workItemId: artifact.workItemId,
    attemptId: artifact.attemptId,
    text,
  };
}

/** The bytes offered as an artifact's are not that artifact's. */
export class NotVaultIssued extends Error {
  readonly artifactId: string;
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(artifactId: string, expectedHash: string, actualHash: string) {
    super(
      `Bytes offered as artifact ${artifactId} hash to ${actualHash}, not to the ` +
        `stored ${expectedHash}. Only bytes the vault holds may reach a parser.`,
    );
    this.name = "NotVaultIssued";
    this.artifactId = artifactId;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

/**
 * Run a parser under the boundary: capabilities checked, input vault-issued.
 *
 * The parser signature takes a `ParserInput` and not a string, so a parser
 * written against this cannot accidentally be called with a body from anywhere
 * else. That is the point of threading the branded type all the way in rather
 * than unwrapping it at the door.
 */
export function runParser<T>(
  input: ParserInput,
  capabilities: readonly string[],
  parse: (input: ParserInput) => T,
  role: string = "PARSER",
): T {
  assertNoNetwork(capabilities, role);
  if (!isParserInput(input)) {
    throw new NotVaultIssued("<unbranded>", "<vault-issued>", "<forged>");
  }
  return parse(input);
}
