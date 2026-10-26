import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "./changes.ts";
import type { RoutineDataStore, SourceHead } from "./store.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { UnchangedConfirmationRetrieval } from "./unchanged-confirmation.ts";
import type { RoutineRunnerReceipt } from "./runner-receipt.ts";

interface SourceBytes {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly body?: string;
  readonly capture?: { readonly rawHash: string };
  readonly request?: unknown;
  readonly extractedFrom?: { readonly requestedUrl: string; readonly member: string };
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** A current-office SPARQL query keeps its identity as its observation date advances. */
export function sourceContentAddress(address: string): string {
  const url = new URL(address);
  if (url.hostname === "query.wikidata.org" && url.pathname === "/sparql" && url.searchParams.has("query"))
    url.searchParams.set("query", url.searchParams.get("query")!.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "SOURCE_CHECK_TIME"));
  return url.href;
}

/** A source's bytes and logical addresses decide change; observation and archive release stamps do not. */
export function sourceContentHash(pages: readonly SourceBytes[], inputs: unknown = null): string {
  const records = pages.map(page => {
    const content = page.body === undefined ? page.capture?.rawHash : digest(page.body);
    if (!content || !/^[a-f0-9]{64}$/.test(content)) throw new Error("SOURCE_CONTENT_HASH_MISSING_BYTES");
    const address = page.extractedFrom
      ? `${new URL(page.extractedFrom.requestedUrl).origin}${new URL(page.extractedFrom.requestedUrl).pathname.replace(/\/(?:zip|archive)\/[a-f0-9]{40}(?:\.zip)?$/, "")}/${page.extractedFrom.member}`
      : sourceContentAddress(page.finalUrl);
    return canonicalCivicDataJson([address, page.request ?? null, content]);
  });
  return digest(canonicalCivicDataJson({ inputs, records: [...new Set(records)].sort() }));
}

export interface SourceHashConfirmation {
  readonly head: SourceHead;
  readonly at: string;
}

/** Confirm the exact pointed source without reading its payload or event history. Partial work always continues. */
export async function confirmSourceHashUnchanged(input: {
  readonly store: Pick<RoutineDataStore, "readSourceHead" | "confirmUnchanged" | "eventObservedAt">;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  readonly rawHash: string;
  readonly retrieval: UnchangedConfirmationRetrieval;
  readonly now: string;
  readonly complete: boolean;
}): Promise<SourceHashConfirmation | null> {
  if (!input.complete || !input.store.confirmUnchanged) return null;
  const head = await input.store.readSourceHead(input.recordClass, input.scope);
  if (!head || head.sourceId !== input.sourceId || head.recordClass !== input.recordClass || head.scope !== input.scope ||
    head.candidateState !== "PROMOTED" || !head.acquisitionSucceeded || head.imported ||
    head.versionId !== head.lastKnownGoodVersionId || head.rawHash !== input.rawHash ||
    head.parserVersion !== input.parserVersion || !head.normalizedHash || input.retrieval.rawHash !== input.rawHash) return null;
  const observedAt = input.store.eventObservedAt
    ? await input.store.eventObservedAt(input.recordClass, input.scope, input.now) : input.now;
  const result = await input.store.confirmUnchanged({
    sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope, parserVersion: input.parserVersion,
    pointerVersionId: head.versionId, readModelHash: head.normalizedHash, basis: "RAW_HASH_UNCHANGED", retrieval: input.retrieval,
  }, observedAt);
  return result.kind === "CONFIRMED" ? { head, at: result.at } : null;
}

/** The existing runner receipt describes a confirmation directly, without inventing a held candidate body. */
export function sourceHashReceiptFields(confirmed: SourceHashConfirmation): Omit<RoutineRunnerReceipt, "source" | "structuralReleaseContract"> {
  return { candidateId: confirmed.head.versionId, acquisitionSucceeded: true, state: "PROMOTED", decision: "GOOD",
    promotedVersion: confirmed.head.versionId, lastKnownGoodVersion: confirmed.head.versionId, confirmedAt: confirmed.at };
}
