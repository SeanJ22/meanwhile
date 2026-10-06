export const FINANCE_DOOR_KINDS = ["campaign-finance-csv", "campaign-finance-search-api", "campaign-finance-bulk-zip"] as const;
export type FinanceDoorKind = typeof FINANCE_DOOR_KINDS[number];
