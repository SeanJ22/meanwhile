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

export const ADMIN_V6_CAPABILITY_REVISION = "admin-v6/1:receipt/1";
