import type { OcdId } from "../sources/types.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentCommentAccessEdge, currentReaderAuthorityEdge } from "./runtime-edge.ts";
import {
  projectedCommentAccessFor,
  type CommentAccess,
} from "./comment-access-client.ts";

export type { CommentAccess } from "./comment-access-client.ts";

export interface CommentAccessProjection {
  readonly kind: "comment-access";
  readonly records: readonly (CommentAccess & { readonly id: string })[];
}

const standalone = {};
const held = new WeakMap<object, readonly CommentAccess[]>();
const context = () => currentReaderSelection() ?? currentReaderAuthorityEdge() ?? standalone;

export function primeCommentAccess(value: CommentAccessProjection): void {
  held.set(context(), value.records.map(({ id: _id, ...record }) => record));
}

export function currentCommentAccess(): readonly CommentAccess[] {
  const edge = currentCommentAccessEdge();
  const records = edge ? edge.value.records.map(({ id: _id, ...record }) => record) : held.get(context());
  if (!records) throw new Error("Comment rules have not been read for this request.");
  return records;
}

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
      // Missing optional rules leave the independent meetings available.
      records = [];
    }
  }
  return projectedCommentAccessFor(ocdId, bodyName, bodyId, records);
}
