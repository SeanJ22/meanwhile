import type { DiscoveryOpen } from "../../lib/control-plane/discovery/meetings-discovery-executor.ts";

/** One recorded answer to a discovery walk's request. */
export type RecordedReply = { status: number; body?: string; contentType?: string; location?: string };

/** A discovery walk's `open` that answers from recorded replies; a URL with none recorded answers 404. */
export function recordedDiscoveryOpen(replies: Readonly<Record<string, RecordedReply>>): DiscoveryOpen {
  return async ({ url }) => {
    const r = replies[url] ?? { status: 404, body: "not found" };
    return { status: r.status, body: r.body ?? "", bytes: (r.body ?? "").length, contentType: r.contentType ?? "text/html", location: r.location ?? null, transportError: null };
  };
}
