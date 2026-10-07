import type { BallotAbsence } from "./types.ts";

export interface GroupedAbsence {
  key: string;
  members: BallotAbsence[];
  statement: string;
  provenance: BallotAbsence["provenance"];
}

export function splitJurisdiction(
  statement: string,
): { before: string; jurisdiction: string; after: string } | null {
  // `[\s\S]` rather than the `s` (dotAll) flag — this repo's tsconfig target
  // predates ES2018, where `/s` is a compile error rather than a runtime one.
  const m = /^([\s\S]*\bfor )([^:]+)(:[\s\S]*)$/.exec(statement);
  if (!m) return null;
  const [, before, jurisdiction, after] = m;
  if (!before || !jurisdiction || !after) return null;
  return { before, jurisdiction: jurisdiction.trim(), after };
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function groupAbsences(absences: readonly BallotAbsence[]): GroupedAbsence[] {
  const order: string[] = [];
  const buckets = new Map<string, { parts: ReturnType<typeof splitJurisdiction>; members: BallotAbsence[] }>();

  for (const absence of absences) {
    const parts = splitJurisdiction(absence.statement);
    const p = absence.provenance;
    const key = parts
      ? `${parts.before}\u0000${parts.after}\u0000${p.sourceOrg ?? ""}\u0000${p.sourceUrl ?? ""}\u0000${p.collectedAt ?? ""}`
      : `solo\u0000${absence.ocdId}`;
    if (!buckets.has(key)) {
      buckets.set(key, { parts, members: [] });
      order.push(key);
    }
    buckets.get(key)!.members.push(absence);
  }

  return order.map((key) => {
    const bucket = buckets.get(key)!;
    const { parts, members } = bucket;
    const first = members[0]!;
    if (!parts || members.length === 1) {
      return {
        key: members.map((m) => m.ocdId).join("|"),
        members,
        statement: first.statement,
        provenance: first.provenance,
      };
    }
    const names = members
      .map((m) => splitJurisdiction(m.statement)?.jurisdiction)
      .filter((n): n is string => Boolean(n));
    return {
      key: members.map((m) => m.ocdId).join("|"),
      members,
      statement: `${parts.before}${listNames(names)}${parts.after}`,
      provenance: first.provenance,
    };
  });
}
