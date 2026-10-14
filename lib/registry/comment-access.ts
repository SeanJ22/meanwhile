import type { OcdId } from "../sources/types.ts";
import { readFactCommentAccess } from "../facts/comment-read.ts";
import { factReader, factsVersion } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import {
  projectedCommentAccessFor,
  type CommentAccess,
} from "./comment-access-client.ts";

export type { CommentAccess } from "./comment-access-client.ts";

/** The comment-access family on the reader edge. */
export interface CommentAccessProjection {
  readonly kind: "comment-access";
  readonly records: readonly (CommentAccess & { readonly id: string })[];
}

let held: { readonly records: readonly CommentAccess[]; readonly versionId: string } | null = null;

/** Comment rules composed from live facts; the version moves whenever any fact does. */
export async function readCommentAccessFacts(query: Query | null = factReader()): Promise<{ readonly value: CommentAccessProjection; readonly versionId: string }> {
  const records = query ? await readFactCommentAccess(query) : [];
  held = { records, versionId: await factsVersion(query) };
  return { value: { kind: "comment-access", records: records.map(record => ({ id: `comment-access:${record.bodyId}`, ...record })) }, versionId: held.versionId };
}

/** From a validated edge serving copy, with no database read. */
export function primeCommentAccess(value: CommentAccessProjection, versionId: string): void {
  held = { records: value.records.map(({ id: _id, ...record }) => record), versionId };
}

export function currentCommentAccess(): readonly CommentAccess[] {
  if (!held) throw new Error("Comment rules have not been read for this process.");
  return held.records;
}

/**
 * The comment-access record for a meeting, if one is curated.
 *
 * A canonical body identity or unique explicit published-name alias is
 * required. A division with one held policy can still contain other bodies.
 */
export function commentAccessFor(
  ocdId: OcdId | null,
  bodyName?: string,
  bodyId?: string | null,
  projection?: readonly CommentAccess[],
): CommentAccess | undefined {
  let records = projection;
  if (!records) {
    try {
      records = currentCommentAccess();
    } catch {
      // A missing/unreachable comment-rule pointer withholds only this
      // optional family. It must not make the independent meetings corpus or
      // another source's Reader answer fail.
      records = [];
    }
  }
  return projectedCommentAccessFor(ocdId, bodyName, bodyId, records);
}
