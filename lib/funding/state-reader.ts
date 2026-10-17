import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { FederalMoneyIndex, federalMoneyArtifactKey, readFederalMoneyJson } from "../federal-money/edge.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { readCampaignFinancePage, type CampaignFinancePageRef } from "./state-pages.ts";
import { campaignFinanceDirectoryKey, campaignFinanceGovernmentIssue, campaignFinancePublicationIssue, type CampaignFinanceFiler, type CampaignFinanceGovernment, type CampaignFinanceState } from "./state-projection.ts";
import { campaignFinanceNativeScope } from "./state-sources.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";

export interface CampaignFinancePlaceRead {
  readonly division: string;
  readonly state: string;
  readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
  readonly checkedAt: string | null;
  readonly records: readonly CampaignSourceRecord[];
  readonly count: number | null;
  readonly nextCursor: string | null;
}
interface Cursor { readonly division: string; readonly root: string; readonly group: string; readonly page: number }
interface Options { readonly artifactStore?: ReaderArtifactStore | null; readonly cursor?: string | null }
function cursorOf(encoded: string | undefined | null, division: string): Cursor | null {
  if (!encoded) return null;
  if (encoded.length > 4096) throw new Error("The campaign records page is invalid.");
  let value: Cursor;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("The campaign records page is invalid."); }
  if (value?.division !== division || !federalMoneyArtifactKey(value.root) || !/^[a-f0-9]{64}$/.test(value.group) ||
      !Number.isSafeInteger(value.page) || value.page < 0) throw new Error("The campaign records page is invalid.");
  return value;
}

export async function readCampaignFinanceForPlace(division: string, options: Options = {}): Promise<CampaignFinancePlaceRead> {
  const identity = jurisdictionFromOcdId(division);
  if (!identity) throw new Error("Campaign records require a state or local division.");
  const state = identity.usps, scope = campaignFinanceNativeScope(state), cursor = cursorOf(options.cursor, division);
  const store = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  const result = (status: CampaignFinancePlaceRead["status"], checkedAt: string | null = null): CampaignFinancePlaceRead => ({ division, state, status, checkedAt, records: [], count: null, nextCursor: null });
  if (!store) return result("UNAVAILABLE");
  let root: string | null = null, count: number | null = 0, checkedAt: string | null = null;
  const stateDivision = `ocd-division/country:us/${identity.prefix}:${identity.slug}`;
  const isState = division === stateDivision;
  {
    const held = await store.readJsonPointer<CampaignFinanceState>(campaignFinanceDirectoryKey(state));
    if (!held) return result("NOT_HELD");
    if (campaignFinancePublicationIssue({ kind: "campaign-finance-source-state", state, records: [held.value] }, state)) throw new Error("The campaign directory is invalid for this state.");
    checkedAt = held.value.checkedAt;
    if (isState) { root = held.value.groups; count = held.value.count; }
    else {
      const places = new FederalMoneyIndex(store, `${scope}:places`), key = await places.get(held.value.places, division);
      if (!key) return result("NOT_HELD", checkedAt);
      const place = await readFederalMoneyJson<CampaignFinanceGovernment>(store, key);
      if (place.id !== division || campaignFinanceGovernmentIssue(place, state)) throw new Error("Campaign records cross the requested government.");
      root = place.filers; count = place.count;
    }
  }
  if (cursor) { if (cursor.root !== root) count = null; root = cursor.root; }
  const groups = new FederalMoneyIndex(store, isState ? `${scope}:groups` : `${scope}:government:${division}:filers`);
  const entry = await groups.next(root, cursor?.group ?? ""), page = cursor?.page ?? 0;
  if (!entry) {
    if (cursor) throw new Error("The campaign records page is invalid.");
    return { ...result("NOT_HELD", checkedAt), count };
  }
  if (cursor && entry.key !== cursor.group) throw new Error("The campaign records page is invalid.");
  const filer = await readFederalMoneyJson<CampaignFinanceFiler>(store, entry.value);
  if (campaignFinancePublicationIssue({ kind: "campaign-finance-source-filer", state, records: [filer] }, state) || filer.id !== entry.key ||
      !isState && filer.governmentOcdId !== division || page >= filer.pageCount) throw new Error("Campaign filer records cross the requested place or page.");
  const pages = new FederalMoneyIndex(store, `${scope}:filer:${filer.id}:pages`), key = await pages.get(filer.pages, String(page).padStart(12, "0"));
  if (!key) throw new Error("The campaign filer is missing its declared page.");
  const ref = await readFederalMoneyJson<CampaignFinancePageRef>(store, key), records = await readCampaignFinancePage(store, ref, state);
  if (!isState && records.some(row => row.governmentOcdId !== division)) throw new Error("Campaign facts cross the requested government.");
  const next = page + 1 < filer.pageCount ? { group: entry.key, page: page + 1 } : await groups.next(root, entry.key, true).then(row => row ? { group: row.key, page: 0 } : null);
  return { division, state, status: "HELD", checkedAt, records, count,
    nextCursor: next ? Buffer.from(JSON.stringify({ division, root, ...next })).toString("base64url") : null };
}
