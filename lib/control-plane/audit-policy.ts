/**
 * How the live audit samples published facts. The owner changes it in Admin
 * Settings (`audit.policy`). Only the settings map is imported, so Settings can
 * list it without loading the audit.
 */
import { registerSetting } from "./settings.ts";

export interface LiveAuditPolicy {
  /** Facts audited per area per pass. */
  readonly perAreaPerPass: number;
  /** Areas looked at per pass, so one pass stays small however many areas exist. */
  readonly areasPerPass: number;
  /** A fact audited more recently than this is passed over. */
  readonly minHoursBetweenAudits: number;
  /** The most facts one area hands the sampler to choose from. */
  readonly poolPerArea: number;
  /** A routine refresh newer than this, and unchanged, stands in for a re-read. */
  readonly refreshMaxAgeHours: number;
  /** The most new fetches one pass makes. */
  readonly maxFetchesPerPass: number;
  /** Extra facts an area gets when it holds past-refresh or high-demand facts. */
  readonly boostExtraPerArea: number;
  /** A boosted fact may be audited again after this long, sooner than an ordinary one. */
  readonly boostedMinHoursBetweenAudits: number;
}

export const LIVE_AUDIT_DEFAULT_POLICY: LiveAuditPolicy = {
  perAreaPerPass: 1,
  areasPerPass: 40,
  minHoursBetweenAudits: 7 * 24,
  poolPerArea: 50,
  refreshMaxAgeHours: 36,
  maxFetchesPerPass: 60,
  boostExtraPerArea: 1,
  boostedMinHoursBetweenAudits: 48,
};

const POSITIVE_INTEGER_LIMITS: Readonly<Record<keyof LiveAuditPolicy, number>> = {
  perAreaPerPass: 20, areasPerPass: 1_000, minHoursBetweenAudits: 24 * 90, poolPerArea: 1_000,
  refreshMaxAgeHours: 24 * 30, maxFetchesPerPass: 1_000, boostExtraPerArea: 20, boostedMinHoursBetweenAudits: 24 * 90,
};

/** A whole policy, every field a whole number in its range (boostExtraPerArea may be 0). */
export function isLiveAuditPolicy(value: unknown): value is LiveAuditPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(POSITIVE_INTEGER_LIMITS) as (keyof LiveAuditPolicy)[];
  if (Object.keys(v).length !== keys.length) return false;
  return keys.every((key) => {
    const n = v[key];
    const min = key === "boostExtraPerArea" ? 0 : 1;
    return typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= POSITIVE_INTEGER_LIMITS[key];
  });
}

/** The setting's key. Registered here, beside its default and its check, so the audit owns it. */
export const AUDIT_POLICY_SETTING = "audit.policy";
registerSetting<LiveAuditPolicy & { readonly [key: string]: number }>({
  key: AUDIT_POLICY_SETTING, label: "How the live audit samples published facts",
  defaultValue: { ...LIVE_AUDIT_DEFAULT_POLICY }, readerFacing: false, control: "json",
  validate: (value): value is LiveAuditPolicy & { readonly [key: string]: number } => isLiveAuditPolicy(value),
});
