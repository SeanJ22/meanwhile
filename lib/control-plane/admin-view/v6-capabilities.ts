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
  readonly workerAgeBucket?: number | null }): AdminV6CapabilityManifest {
  const sections: Record<string, { contract: string; href: string; revision: string }> = {};
  if (input.configRevision !== null && input.snapshotRevision !== null) {
    const common = `${input.configRevision}:${input.snapshotRevision}`;
    sections.hunts = { contract: "admin-v6/hunts@1", href: "/api/admin/v6/hunts", revision: `hunts:${common}` };
    sections.money = { contract: "admin-v6/money@1", href: "/api/admin/v6/money",
      revision: `money:${common}:${input.researchRevision ?? "unread"}` };
  }
  if (input.snapshotRevision !== null) {
    // The place score reads held data for the place itself; the published snapshot revision moves when the runner finishes a cycle.
    sections.checklist = { contract: "admin-v6/checklist@1", href: "/api/admin/v6/place", revision: `checklist:${input.snapshotRevision}:${input.researchRevision ?? "unread"}` };
    sections.stuck = { contract: "admin-v6/stuck@1", href: "/api/admin/v6/stuck", revision: `stuck:${input.snapshotRevision}` };
    sections.sameCause = { contract: "admin-v6/sameCause@1", href: "/api/admin/v6/same-cause", revision: `sameCause:${input.snapshotRevision}` };
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
  return { ...ADMIN_V6_CAPABILITIES, sections };
}

export const ADMIN_V6_CAPABILITY_REVISION = "admin-v6/1:receipt/1:hunts/1:money/1:workers/1:checklist/place1:stuck/1:agents/1:spend/1:sends/1:reliability/1";
