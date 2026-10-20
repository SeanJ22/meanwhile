export const BILLING_PROVIDERS = [
  "anthropic-api",
  "anthropic-subscription",
  "openai-subscription",
  "brave",
  "exa",
  "neon",
  "netlify",
  "github",
  "maptiler",
  "dev-tools",
  "other",
] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

export const BILLING_FACT_KINDS = ["BILLED", "MONTH_TO_DATE", "SUBSCRIPTION", "BALANCE", "PURCHASE", "USAGE_IMPORT", "LIMIT"] as const;
export type BillingFactKind = (typeof BILLING_FACT_KINDS)[number];

/** How often a subscription bills (MONTHLY, ANNUAL) or a cap resets (DAILY, MONTHLY). */
export const CADENCES = ["DAILY", "MONTHLY", "ANNUAL"] as const;
export type Cadence = (typeof CADENCES)[number];
const SUBSCRIPTION_CADENCES: readonly Cadence[] = ["MONTHLY", "ANNUAL"];
const LIMIT_CADENCES: readonly Cadence[] = ["DAILY", "MONTHLY"];

export const BILLING_AMOUNT_MAX_USD = 1_000_000;
export const BILLING_SOURCE_MAX = 200;
export const BILLING_LABEL_MAX = 80;

export interface ProviderDefinition {
  readonly key: BillingProvider;
  readonly name: string;
  /** What kind of charge this is, in the owner's words. */
  readonly charge: string;
  /** The kinds of fact that make sense for it. The first is what the entry form offers first. */
  readonly kinds: readonly BillingFactKind[];
  /** What would read it automatically, and why nothing does. */
  readonly desiredSource: string;
  readonly accessNeeded: string;
  /** The manual path, in one imperative sentence. */
  readonly fallback: string;
  /** Serves the reader site as well as the fleet: never split across them without a documented basis. */
  readonly shared: boolean;
  /** A decision of the owner's can change it quickly, versus a charge the application cannot stop. */
  readonly controllable: boolean;
  /** Needs a name, because the key alone does not say which product it is. */
  readonly needsLabel: boolean;
}

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    key: "anthropic-api",
    name: "Anthropic — the bill",
    charge: "Billed model usage",
    kinds: ["MONTH_TO_DATE", "BILLED", "LIMIT"],
    desiredSource: "The Anthropic usage and cost report",
    accessNeeded: "an organisation admin key, which this system does not hold",
    fallback: "Enter the Console's month-to-date figure with the date you read it, or the closed month's invoice",
    shared: true,
    controllable: true,
    needsLabel: false,
  },
  {
    key: "anthropic-subscription",
    name: "Anthropic — subscription",
    charge: "Fixed subscription",
    kinds: ["SUBSCRIPTION"],
    desiredSource: "The subscription's invoice",
    accessNeeded: "none — an invoice figure",
    fallback: "Enter the amount, how often it bills and when it renews",
    shared: false,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "openai-subscription",
    name: "OpenAI — ChatGPT subscription",
    charge: "Fixed subscription",
    kinds: ["SUBSCRIPTION"],
    desiredSource: "The subscription's invoice",
    accessNeeded: "none — an invoice figure",
    fallback: "Enter the amount, how often it bills and when it renews",
    shared: false,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "brave",
    name: "Brave Search API",
    charge: "Prepaid search credits",
    kinds: ["BALANCE", "PURCHASE"],
    desiredSource: "The account's balance and request counts",
    accessNeeded: "account access — the API key reports no balance",
    fallback: "Enter the balance with the date you read it; enter a purchase separately",
    shared: false,
    controllable: true,
    needsLabel: false,
  },
  {
    key: "exa",
    name: "Exa",
    charge: "Search usage",
    kinds: ["USAGE_IMPORT", "BILLED"],
    desiredSource: "The dashboard's usage export",
    accessNeeded: "dashboard access",
    fallback: "Import the usage CSV, or enter the period's total",
    shared: false,
    controllable: true,
    needsLabel: false,
  },
  {
    key: "neon",
    name: "Neon — two databases",
    charge: "Usage: compute, storage, transfer",
    kinds: ["BILLED", "MONTH_TO_DATE"],
    desiredSource: "The Neon consumption API",
    accessNeeded: "an organisation API key, which the site does not hold",
    fallback: "Enter the invoice with its billing period",
    shared: true,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "netlify",
    name: "Netlify",
    charge: "Usage: builds, bandwidth, functions",
    kinds: ["BILLED", "MONTH_TO_DATE"],
    desiredSource: "The Netlify account usage API",
    accessNeeded: "a team token with billing scope; the deploy token is not used for it",
    fallback: "Enter the invoice with its billing period",
    shared: true,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "github",
    name: "GitHub",
    charge: "Actions and other charges",
    kinds: ["BILLED", "MONTH_TO_DATE"],
    desiredSource: "The organisation billing API",
    accessNeeded: "billing read access, which is not held",
    fallback: "Enter the invoice with its billing period",
    shared: true,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "maptiler",
    name: "MapTiler — the bill",
    charge: "Map plan and overage",
    kinds: ["BILLED", "SUBSCRIPTION"],
    desiredSource: "The account's invoices (requests are read automatically; dollars are not)",
    accessNeeded: "account access",
    fallback: "Enter the invoice with its billing period",
    shared: true,
    controllable: false,
    needsLabel: false,
  },
  {
    key: "dev-tools",
    name: "Development tools",
    charge: "Fixed subscriptions",
    kinds: ["SUBSCRIPTION"],
    desiredSource: "Each tool's invoice",
    accessNeeded: "none — invoice figures",
    fallback: "Enter each tool by name, with its amount and renewal date",
    shared: false,
    controllable: false,
    needsLabel: true,
  },
  {
    key: "other",
    name: "Another provider",
    charge: "Named on entry",
    kinds: ["BILLED", "MONTH_TO_DATE", "SUBSCRIPTION", "BALANCE", "PURCHASE", "USAGE_IMPORT"],
    desiredSource: "Its own bill",
    accessNeeded: "none — an invoice figure",
    fallback: "Enter it by name with its period",
    shared: false,
    controllable: false,
    needsLabel: true,
  },
];

export function providerDefinition(key: BillingProvider): ProviderDefinition {
  return PROVIDER_DEFINITIONS.find((p) => p.key === key)!;
}

export const KIND_WORDS: Readonly<Record<BillingFactKind, string>> = {
  BILLED: "Billed — a closed period's invoice",
  MONTH_TO_DATE: "Month to date — a running figure, not a final bill",
  SUBSCRIPTION: "Subscription — a fixed charge",
  BALANCE: "Balance — prepaid credit left",
  PURCHASE: "Purchase — prepaid credit bought",
  USAGE_IMPORT: "Usage — summed from the provider's export",
  LIMIT: "Account cap — a limit set in the provider's console, not a charge",
};

export interface BillingFact {
  /** Stable per slot: entering the same slot again replaces it, and the receipt keeps what it was. */
  readonly id: string;
  readonly provider: BillingProvider;
  readonly label: string | null;
  readonly kind: BillingFactKind;
  readonly amountUsd: number;
  /** YYYY-MM-DD, inclusive. Required for BILLED, MONTH_TO_DATE and USAGE_IMPORT. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** SUBSCRIPTION: how often it bills. LIMIT: how often the cap resets. */
  readonly cadence: Cadence | null;
  readonly renewsOn: string | null;
  /** YYYY-MM-DD: the day the owner read the figure. */
  readonly asOf: string;
  /** Where it was read — "Anthropic Console, Cost page". Provenance, in his words. */
  readonly source: string;
  /** USAGE_IMPORT only: the export it was summed from. */
  readonly imported: { readonly fileName: string; readonly rows: number } | null;
  readonly decidedAt: string;
  /** The admin session reference. Never a person's name. */
  readonly decidedBy: string;
  readonly receiptId: string;
}

export type BillingFactInput = Omit<BillingFact, "id" | "decidedAt" | "decidedBy" | "receiptId">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ") : null;
}

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

export function validateBillingFact(raw: Readonly<Record<string, unknown>>, todayUtc: string): Checked<BillingFactInput> {
  const provider = raw.provider;
  if (typeof provider !== "string" || !(BILLING_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, why: "choose which provider this figure is for" };
  }
  const def = providerDefinition(provider as BillingProvider);
  const kind = raw.kind;
  if (typeof kind !== "string" || !(def.kinds as readonly string[]).includes(kind)) {
    return { ok: false, why: `say what kind of figure this is — for ${def.name}: ${def.kinds.map((k) => KIND_WORDS[k].split(" — ")[0].toLowerCase()).join(", ")}` };
  }
  const label = text(raw.label);
  if (def.needsLabel && label === null) return { ok: false, why: "name the product or provider this figure is for" };
  if (label !== null && label.length > BILLING_LABEL_MAX) return { ok: false, why: `keep the name under ${BILLING_LABEL_MAX} characters` };

  const rawAmount = raw.amountUsd;
  const amount = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" ? Number(rawAmount.trim().replace(/^\$/, "").replace(/,/g, "")) : Number.NaN;
  if (!Number.isFinite(amount)) return { ok: false, why: "say the amount in dollars" };
  if (amount < 0) return { ok: false, why: "an amount cannot be negative — a credit is a balance or a purchase, entered as its own kind" };
  if (amount > BILLING_AMOUNT_MAX_USD) return { ok: false, why: "that amount is above what this form accepts; check it for a typo" };

  const asOf = raw.asOf;
  if (!isDate(asOf)) return { ok: false, why: "say the day you read this figure" };
  if (asOf > todayUtc) return { ok: false, why: "the day you read it cannot be after today" };

  const source = text(raw.source);
  if (source === null) return { ok: false, why: "say where you read it — the console page, the invoice or the export" };
  if (source.length > BILLING_SOURCE_MAX) return { ok: false, why: `keep where you read it under ${BILLING_SOURCE_MAX} characters` };

  const k = kind as BillingFactKind;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (k === "BILLED" || k === "MONTH_TO_DATE" || k === "USAGE_IMPORT") {
    if (!isDate(raw.periodStart) || !isDate(raw.periodEnd)) return { ok: false, why: "say the billing period it covers, first day and last day" };
    periodStart = raw.periodStart;
    periodEnd = raw.periodEnd;
    if (periodEnd < periodStart) return { ok: false, why: "the period ends before it starts" };
    if (periodStart > asOf) return { ok: false, why: "a figure cannot be read before its period starts" };
  }
  let cadence: Cadence | null = null;
  let renewsOn: string | null = null;
  if (k === "LIMIT") {
    if (typeof raw.cadence !== "string" || !(LIMIT_CADENCES as readonly string[]).includes(raw.cadence)) {
      return { ok: false, why: "say whether the cap is per day or per month" };
    }
    cadence = raw.cadence as Cadence;
  }
  if (k === "SUBSCRIPTION") {
    if (typeof raw.cadence !== "string" || !(SUBSCRIPTION_CADENCES as readonly string[]).includes(raw.cadence)) {
      return { ok: false, why: "say whether it bills monthly or yearly" };
    }
    cadence = raw.cadence as Cadence;
    if (raw.renewsOn !== null && raw.renewsOn !== undefined && raw.renewsOn !== "") {
      if (!isDate(raw.renewsOn)) return { ok: false, why: "say the renewal day as a date, or leave it empty" };
      renewsOn = raw.renewsOn;
    }
  }
  let imported: BillingFact["imported"] = null;
  if (k === "USAGE_IMPORT" && raw.imported !== null && raw.imported !== undefined) {
    const imp = raw.imported as Readonly<Record<string, unknown>>;
    const fileName = text(imp.fileName);
    const rows = imp.rows;
    if (fileName === null || fileName.length > 120 || typeof rows !== "number" || !Number.isInteger(rows) || rows < 1 || rows > 1_000_000) {
      return { ok: false, why: "the import did not say which file it summed and how many rows" };
    }
    imported = { fileName, rows };
  }
  return {
    ok: true,
    value: {
      provider: provider as BillingProvider,
      label,
      kind: k,
      amountUsd: Math.round(amount * 100) / 100,
      periodStart,
      periodEnd,
      cadence,
      renewsOn,
      asOf,
      source,
      imported,
    },
  };
}

export function billingFactId(input: Pick<BillingFactInput, "provider" | "label" | "kind" | "periodStart" | "asOf">): string {
  const who = input.label === null ? input.provider : `${input.provider}/${input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const when = input.kind === "SUBSCRIPTION" || input.kind === "LIMIT" ? "current" : input.kind === "BALANCE" || input.kind === "PURCHASE" ? input.asOf : input.periodStart ?? input.asOf;
  return `${who}:${input.kind}:${when}`;
}

function looksLikeFact(value: unknown): value is BillingFact {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.provider === "string" &&
    (BILLING_PROVIDERS as readonly string[]).includes(v.provider) &&
    typeof v.kind === "string" &&
    (BILLING_FACT_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.amountUsd === "number" &&
    Number.isFinite(v.amountUsd) &&
    isDate(v.asOf) &&
    typeof v.source === "string"
  );
}

/** A malformed billing entry is counted, never dropped silently or read as zero. */
export function billingFactsOf(config: { readonly billingFacts?: readonly unknown[] | null } | null): {
  readonly facts: readonly BillingFact[];
  readonly malformed: number;
} {
  const raw = config?.billingFacts;
  if (!Array.isArray(raw)) return { facts: [], malformed: 0 };
  const facts = raw.filter(looksLikeFact);
  return { facts, malformed: raw.length - facts.length };
}

/** Put a fact in its slot. Returns the new list and what the slot held before, for the receipt and its undo. */
export function withFactRecorded(
  facts: readonly BillingFact[],
  fact: BillingFact,
): { readonly facts: readonly BillingFact[]; readonly previous: BillingFact | null } {
  const previous = facts.find((f) => f.id === fact.id) ?? null;
  const rest = facts.filter((f) => f.id !== fact.id);
  const next = [...rest, fact].sort((a, b) => (a.asOf === b.asOf ? a.id.localeCompare(b.id) : a.asOf < b.asOf ? -1 : 1));
  return { facts: next, previous };
}

export function withFactRemoved(
  facts: readonly BillingFact[],
  id: string,
): { readonly facts: readonly BillingFact[]; readonly removed: BillingFact | null } {
  const removed = facts.find((f) => f.id === id) ?? null;
  return { facts: facts.filter((f) => f.id !== id), removed };
}

/** A figure as the owner reads it: the amount, and what kind of amount it is. */
export function factAmountWords(f: Pick<BillingFact, "kind" | "amountUsd" | "cadence">): string {
  const usd = `$${f.amountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  switch (f.kind) {
    case "SUBSCRIPTION":
      return `${usd} ${f.cadence === "ANNUAL" ? "a year" : "a month"}`;
    case "BALANCE":
      return `${usd} left`;
    case "PURCHASE":
      return `${usd} bought`;
    case "MONTH_TO_DATE":
      return `${usd} so far`;
    case "LIMIT":
      return `${usd} ${f.cadence === "DAILY" ? "a day" : "a month"}`;
    default:
      return usd;
  }
}

/** The period a figure covers, as the owner reads it. */
export function factPeriodWords(f: Pick<BillingFact, "kind" | "periodStart" | "periodEnd" | "cadence" | "renewsOn" | "asOf">): string {
  switch (f.kind) {
    case "SUBSCRIPTION":
      return `${f.cadence === "ANNUAL" ? "Yearly" : "Monthly"}${f.renewsOn ? ` · renews ${f.renewsOn}` : ""}`;
    case "BALANCE":
      return `Balance on ${f.asOf}, not a period`;
    case "PURCHASE":
      return `Bought on ${f.asOf}`;
    case "LIMIT":
      return `${f.cadence === "DAILY" ? "Daily" : "Monthly"} cap, read ${f.asOf}`;
    default:
      return `${f.periodStart} to ${f.periodEnd}`;
  }
}
