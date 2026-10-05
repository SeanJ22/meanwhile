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
    // The country view joins saved hunts (policy row), the published work index (snapshot) and held data for place scores (research);
    // scores come from a five-minute memo, so the read repeats on the worker clock bucket and fills in scores that were not ready.
    sections.national = { contract: "admin-v6/national@1", href: "/api/admin/v6/national",
      revision: `national:${common}:${input.researchRevision ?? "unread"}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  if (input.snapshotRevision !== null) {
    // The place score reads held data for the place itself; the published snapshot revision moves when the runner finishes a cycle.
    sections.checklist = { contract: "admin-v6/checklist@1", href: "/api/admin/v6/place", revision: `checklist:${input.snapshotRevision}:${input.researchRevision ?? "unread"}` };
    sections.stuck = { contract: "admin-v6/stuck@1", href: "/api/admin/v6/stuck", revision: `stuck:${input.snapshotRevision}` };
    sections.sameCause = { contract: "admin-v6/sameCause@1", href: "/api/admin/v6/same-cause", revision: `sameCause:${input.snapshotRevision}` };
    // What readers can see: the published pipeline counts for a country or state, and the place's own owed list for a ZIP or county, so it re-reads with the snapshot and on the worker clock bucket.
    sections.results = { contract: "admin-v6/results@1", href: "/api/admin/v6/results", revision: `results:${input.snapshotRevision}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  if (input.snapshotRevision !== null || input.researchRevision !== null) {
    sections.spend = { contract: "admin-v6/spend@1", href: "/api/admin/v6/spend", revision: `spend:${input.snapshotRevision ?? "unread"}:${input.researchRevision ?? "unread"}:${input.workerAgeBucket ?? "clock-unread"}` };
    sections.sends = { contract: "admin-v6/sends@1", href: "/api/admin/v6/sends", revision: `sends:${input.researchRevision ?? "unread"}:${input.heartbeatRevision ?? "unread"}` };
    sections.reliability = { contract: "admin-v6/reliability@1", href: "/api/admin/v6/reliability", revision: `reliability:${input.heartbeatRevision ?? "unread"}:${input.workerAgeBucket ?? "clock-unread"}` };
    sections.agents = { contract: "admin-v6/agents@1", href: "/api/admin/v6/agents", revision: `agents:${input.heartbeatRevision ?? "unread"}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  if (input.configRevision !== null && input.researchRevision !== null) {
    sections.workers = { contract: "admin-v6/workers@1", href: "/api/admin/v6/workers",
      revision: `workers:${input.configRevision}:${input.researchRevision}:${input.heartbeatRevision ?? "unread"}:${input.sourceProgressId ?? "none"}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  if (input.historyRevision !== undefined && input.historyRevision !== null) {
    sections.history = { contract: "admin-v6/history@1", href: "/api/admin/v6/history", revision: `history:${input.historyRevision}:${input.heartbeatRevision ?? "unread"}:${input.workerAgeBucket ?? "clock-unread"}` };
    // The fix queue changes when an action is saved (history moves) and when the decision sync opens a row (the worker clock bucket).
    sections.fixes = { contract: "admin-v6/fixes@1", href: "/api/admin/v6/fixes", revision: `fixes:${input.historyRevision}:${input.workerAgeBucket ?? "clock-unread"}` };
  }
  // Publication status reads the reader store's promotion pointers and readbacks, so it needs neither policy nor snapshot; it re-reads on the worker clock bucket.
  sections.publication = { contract: "admin-v6/publication@1", href: "/api/admin/v6/publication", revision: `publication:${input.workerAgeBucket ?? "clock-unread"}` };
  // Weekly Scout series: the same for every place, so it needs no policy or snapshot; it re-reads on the worker clock bucket.
  sections.learning = { contract: "admin-v6/learning@1", href: "/api/admin/v6/learning", revision: `learning:${input.workerAgeBucket ?? "clock-unread"}` };
  return { ...ADMIN_V6_CAPABILITIES, sections };
}

export const ADMIN_V6_CAPABILITY_REVISION = "admin-v6/1:receipt/1:history/1:hunts/1:money/1:workers/1:learning/1:fixes/1:checklist/place1:stuck/1:agents/1:spend/1:sends/1:reliability/1:publication/1:results/1:national/1";
