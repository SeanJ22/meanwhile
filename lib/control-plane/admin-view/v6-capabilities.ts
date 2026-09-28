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
  readonly snapshotRevision: number | null; readonly researchRevision: number | null }): AdminV6CapabilityManifest {
  if (input.configRevision === null || input.snapshotRevision === null) return ADMIN_V6_CAPABILITIES;
  const common = `${input.configRevision}:${input.snapshotRevision}`;
  return { ...ADMIN_V6_CAPABILITIES, sections: {
    hunts: { contract: "admin-v6/hunts@1", href: "/api/admin/v6/hunts", revision: `hunts:${common}` },
    money: { contract: "admin-v6/money@1", href: "/api/admin/v6/money",
      revision: `money:${common}:${input.researchRevision ?? "unread"}` },
  } };
}

export const ADMIN_V6_CAPABILITY_REVISION = "admin-v6/1:receipt/1:hunts/1:money/1";
