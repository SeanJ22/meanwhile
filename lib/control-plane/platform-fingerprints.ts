import fingerprintData from "./playbooks/platform-fingerprints.json" with { type: "json" };
import { newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";

interface FingerprintData {
  id: string; label: string; haveAdapter: boolean; hostPattern: string; flags?: string;
  markup?: readonly { pattern: string; flags?: string; why: string }[];
}
export interface PlatformFingerprint {
  readonly id: string; readonly label: string; readonly haveAdapter: boolean; readonly hostPattern: RegExp;
  readonly markup: readonly { readonly pattern: RegExp; readonly why: string }[];
}

function defaults(): FingerprintData[] {
  return fingerprintData as FingerprintData[];
}

function compile(row: FingerprintData): PlatformFingerprint {
  return { ...row, hostPattern: new RegExp(row.hostPattern, (row.flags ?? "i").replace(/[gy]/g, "")),
    markup: (row.markup ?? []).map(f => ({ pattern: new RegExp(f.pattern, (f.flags ?? "i").replace(/[gy]/g, "")), why: f.why })) };
}

export function defaultPlatformFingerprints(): PlatformFingerprint[] { return defaults().map(compile); }

/** Bank entries override seed data by platform ID; new kinds need no code list edit. */
export function platformFingerprints(entries: readonly FieldManualEntry[]): PlatformFingerprint[] {
  const byId = new Map(defaults().map(row => [row.id, row]));
  for (const entry of [...entries].sort((a, b) => (a.observedAt ?? "").localeCompare(b.observedAt ?? ""))) {
    if (entry.kind !== "PLATFORM_FINGERPRINT") continue;
    const p = entry.payload as Partial<FingerprintData> | null;
    if (typeof p?.id !== "string" || typeof p.label !== "string" || typeof p.hostPattern !== "string") continue;
    // Accept the old seeded /pattern/flags payload without discarding its identity.
    const legacy = /^\/(.*)\/([a-z]*)$/.exec(p.hostPattern);
    const prior = byId.get(p.id);
    const row: FingerprintData = { ...prior, ...p, id: p.id, label: p.label,
      haveAdapter: p.haveAdapter ?? prior?.haveAdapter ?? false,
      hostPattern: legacy?.[1] ?? p.hostPattern, flags: legacy?.[2] ?? p.flags ?? "i" };
    try { compile(row); byId.set(row.id, row); } catch { console.error("[Bank] a platform fingerprint has an invalid regular expression and was left unchanged."); }
  }
  return [...byId.values()].map(compile);
}

export function platformFingerprintEntries(): FieldManualEntry[] {
  return defaults().map(row => newFieldManualEntry("platform-fingerprint", row.id, {
    role: "SHARED", kind: "PLATFORM_FINGERPRINT", title: `${row.label} tenancy`, summary: `Recognize ${row.label} by its saved host and markup patterns`,
    platforms: [row.id], recordClasses: ["meetings"], outcome: "REFERENCE", payload: row,
  }));
}
