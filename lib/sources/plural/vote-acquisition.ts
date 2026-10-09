import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { AZ_PLURAL_JURISDICTION, PLURAL_VOTES_PARSER, PLURAL_VOTES_SOURCE, parseArizonaPluralBill, type PluralBillEvidence } from "./votes.ts";

export const AZ_PLURAL_BILLS_URL = "https://v3.openstates.org/bills?jurisdiction=Arizona&sort=updated_desc&per_page=10&page=1";
const DAY = 86_400_000;
type SharedOptions = Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now">;
export type ArizonaBillResult = ReturnType<typeof parseArizonaPluralBill> & { evidence: PluralBillEvidence };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function billIds(bytes: Uint8Array): string[] {
  const root = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (!Array.isArray(root.results) || root.results.length > 10) throw new Error("PLURAL_BILL_LIST_INVALID");
  const ids = root.results.map(value => {
    const bill = object(value);
    if (typeof bill.id !== "string" || !/^ocd-bill\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bill.id) ||
      object(bill.jurisdiction).id !== AZ_PLURAL_JURISDICTION) throw new Error("PLURAL_BILL_LIST_IDENTITY_INVALID");
    return bill.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error("PLURAL_BILL_LIST_DUPLICATE");
  return ids;
}

/** Only this known Arizona query and the returned native bill details are read.
 * It deliberately makes no complete-session or no-vote claim. */
export async function acquireArizonaVotes(input: SharedOptions & {
  signal: AbortSignal; apiKey?: string;
  onBill?: (result: ArizonaBillResult) => Promise<void>;
}) {
  const apiKey = input.apiKey ?? process.env.PLURAL_API_KEY;
  const transport = input.fetchImpl ?? fetch;
  const fetchImpl: typeof fetch = async (url, options) => {
    if (!apiKey) throw new Error("PLURAL_API_KEY_UNAVAILABLE");
    return transport(url, options);
  };
  const shared = { store: input.store, locks: input.locks, fetchImpl, now: input.now,
    sourceId: PLURAL_VOTES_SOURCE, parserVersion: PLURAL_VOTES_PARSER, checkAfterMs: DAY,
    signal: input.signal, headers: apiKey ? { "X-API-KEY": apiKey } : undefined, allowedHosts: ["v3.openstates.org"] };
  const listing = await acquireKnownRelease({ ...shared, releaseId: "az-recent-bills", url: AZ_PLURAL_BILLS_URL,
    maxBytes: 2 * 1024 * 1024, validate: bytes => { billIds(bytes); } });
  const results: ArizonaBillResult[] = [], held: { key: string; detail: string }[] = [];
  for (const id of billIds(listing.bytes)) {
    input.signal.throwIfAborted();
    const url = `https://v3.openstates.org/bills/${id}?include=votes`;
    let result: ArizonaBillResult;
    try {
      const release = await acquireKnownRelease({ ...shared, releaseId: `bill:${id}`, url, maxBytes: 8 * 1024 * 1024,
        validate: (bytes, release) => {
          parseArizonaPluralBill({ requestedUrl: url, finalUrl: release.finalUrl, body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            retrievedAt: release.retrievedAt, sha256: release.sha256 });
        } });
      const evidence: PluralBillEvidence = { requestedUrl: url, finalUrl: release.finalUrl,
        body: new TextDecoder("utf-8", { fatal: true }).decode(release.bytes), retrievedAt: release.retrievedAt, sha256: release.sha256,
        sourceCheck: knownReleaseSourceCheck(release) };
      result = { ...parseArizonaPluralBill(evidence), evidence };
    } catch (error) {
      input.signal.throwIfAborted();
      held.push({ key: id, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    results.push(result); held.push(...result.held);
    // Publication exceptions remain our persistence error, never a source failure.
    await input.onBill?.(result);
  }
  return { results, held };
}
