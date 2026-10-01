/** Exact Admin v6 contracts that this deploy can actually serve. Pure and tiny. */
export interface AdminV6CapabilityManifest {
  readonly version: 1;
  readonly sections: Readonly<Record<string, { readonly contract: string; readonly href: string; readonly revision: string }>>;
  readonly actions: Readonly<Record<string, { readonly contract: string; readonly type: string }>>;
  readonly receiptLookup?: { readonly contract: "admin-v6/receipt@1"; readonly href: "/api/admin/v6/receipt" };
}

// Do not announce unfinished section/action contracts. Their UI stays recoverably unavailable.
export const ADMIN_V6_CAPABILITIES: AdminV6CapabilityManifest = Object.freeze({
  version: 1,
  sections: Object.freeze({}),
  actions: Object.freeze({}),
  receiptLookup: Object.freeze({ contract: "admin-v6/receipt@1", href: "/api/admin/v6/receipt" }),
});

/** Section revisions use the exact aggregate revisions already read by the pulse.
 * A failed/missing policy or snapshot withdraws these sections rather than
 * announcing an empty hunt or a zero-dollar account. */
export function adminV6ReadCapabilities(input: { readonly configRevision: number | null;
  readonly snapshotRevision: number | null; readonly researchRevision: number | null;
  readonly heartbeatRevision?: number | null; readonly sourceProgressId?: string | null;
  /** Existing pulse only: re-read time-derived status every five minutes even if no source changes. */
  readonly workerAgeBucket?: number | null;
  /** Moves whenever a receipt is saved or the runner honors an owner intent, so an open page re-reads History and sees "Done". */
  readonly historyRevision?: string | null }): AdminV6CapabilityManifest {
  const sections: Record<string, { contract: string; href: string; revision: string }> = {};
  if (input.configRevision !== null && input.snapshotRevision !== null) {
    const common = `${input.configRevision}:${input.snapshotRevision}`;
    sections.hunts = { contract: "admin-v6/hunts@1", href: "/api/admin/v6/hunts", revision: `hunts:${common}` };
    sections.money = { contract: "admin-v6/money@1", href: "/api/admin/v6/money",
      revision: `money:${common}:${input.researchRevision ?? "unread"}` };
  }
  if (input.configRevision !== null && input.researchRevision !== null) {
    sections.workers = { contract: "admin-v6/workers@1", href: "/api/admin/v6/workers",
      revision: `workers:${input.configRevision}:${input.researchRevision}:${input.heartbeatRevision ?? "unread"}:${input.sourceProgressId ?? "none"}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  if (input.historyRevision !== undefined && input.historyRevision !== null) {
    sections.history = { contract: "admin-v6/history@1", href: "/api/admin/v6/history", revision: `history:${input.historyRevision}` };
  }
  // Weekly Scout series: the same for every place, so it needs no policy or snapshot; it re-reads on the worker clock bucket.
  sections.learning = { contract: "admin-v6/learning@1", href: "/api/admin/v6/learning", revision: `learning:${input.workerAgeBucket ?? "clock-unread"}` };
  return { ...ADMIN_V6_CAPABILITIES, sections };
}

export const ADMIN_V6_CAPABILITY_REVISION = "admin-v6/1:receipt/1:history/1:hunts/1:money/1:workers/1:learning/1";
