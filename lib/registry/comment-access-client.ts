import type { OcdId } from "../sources/types.ts";

/** Public-comment instructions already projected by the meetings route. */
export interface CommentAccess {
  bodyId: string;
  ocdId: OcdId | null;
  bodyNames?: string[];
  commentPeriod: "YES" | "NO" | "UNKNOWN";
  commentPeriodDetail: string | null;
  signup: string | null;
  writtenComment: string | null;
  attend: string | null;
  timeLimit: string | null;
  sourceUrl: string;
  collectedAt: string;
  verifiedAt: string | null;
  /** Field attribution when complementary verified captures are combined. */
  fieldSources?: Partial<Record<"commentPeriod" | "commentPeriodDetail" | "signup" | "writtenComment" | "attend" | "timeLimit", {
    quote?: string; sourceUrl: string; collectedAt: string; verifiedAt: string | null; retainedFromVersion?: string;
  }>>;
}

/** Match only within records the server already projected to the client. */
export function projectedCommentAccessFor(
  ocdId: OcdId | null,
  bodyName: string | undefined,
  bodyId: string | null | undefined,
  records: readonly CommentAccess[],
): CommentAccess | undefined {
  // A resolved body is authoritative. Never fall through to another body's
  // standing rules when its own record is absent or ambiguous.
  if (bodyId) {
    const exact = records.filter((record) => record.bodyId === bodyId);
    return exact.length === 1 && exact[0].ocdId === ocdId ? exact[0] : undefined;
  }
  // Null is not a shared civic identity for unrelated divisionless bodies.
  if (ocdId === null) return undefined;
  const rows = records.filter((record) => record.ocdId === ocdId);
  if (rows.length === 0 || !bodyName) return undefined;

  const wanted = bodyName.trim().toLowerCase();
  const named = rows.filter((record) =>
    record.bodyNames?.some((name) => name.trim().toLowerCase() === wanted),
  );
  return named.length === 1 ? named[0] : undefined;
}
