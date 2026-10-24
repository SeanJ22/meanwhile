/**
 * The vault-first rule as a mechanism: a parser never touches the network; it
 * reads bytes the vault issued it and nothing else. `ParserInput` carries a
 * brand only `issueParserInput` can apply, and `assertNoNetwork` refuses a
 * parser role holding any network capability before it runs.
 */

import { contentHash } from "../ids.ts";
import { RestrictedArtifactRefused, type Artifact, type ArtifactTier } from "./artifact.ts";

/** ------------------------------------------------------- capabilities */

/** Capability prefixes meaning "can reach something outside itself". Prefix-matched so a new capability fails closed. */
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

/** A role that may not reach the network asked for or was granted it. Distinct from a transport failure. */
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

/** Refuse a parser carrying any network capability, before it runs: the grant is the defect, not the call. */
export function assertNoNetwork(
  capabilities: readonly string[],
  role: string = "PARSER",
): void {
  const offending = capabilities.filter(isNetworkCapability);
  if (offending.length > 0) throw new NetworkAccessDenied(role, offending);
}

/** ------------------------------------------------------- parser input */

/** The vault's signature: a module-private symbol, so `ParserInput` cannot be constructed elsewhere. */
const VAULT_ISSUED: unique symbol = Symbol("control-plane/evidence/vault-issued");

/** Bytes a parser may read, with the artifact id and content hash travelling with them. */
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
  readonly sourceDocument?: { readonly artifactId: string; readonly contentHash: string; readonly kind: "PDF_TEXT" | "PDF_TABLES" };
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
 * The only constructor of `ParserInput`. Refuses a `RESTRICTED_RAW` artifact
 * by name (naming the derivative when known), and bytes that do not hash to the
 * artifact's recorded `contentHash`.
 */
export function issueParserInput(
  artifact: Artifact,
  text: string,
  options: { sanitizedDerivativeId?: string | null; role?: string } = {},
): ParserInput {
  const role = options.role ?? "PARSER";

  if (artifact.tier === "EXTRACTED_DERIVED" && (!artifact.extraction?.complete || artifact.retentionPolicy === "DIAGNOSTIC")) {
    throw new Error("DOCUMENT_EXTRACTION_INCOMPLETE");
  }

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
    ...(artifact.extraction ? { sourceDocument: { artifactId: artifact.extraction.parent.id,
      contentHash: artifact.extraction.parent.contentHash, kind: artifact.extraction.kind } } : {}),
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

/** Run a parser under the boundary: capabilities checked, input vault-issued. */
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
