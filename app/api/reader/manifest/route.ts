import { resolveReaderArtifactStore } from "@/lib/meetings/edge-store";

/**
 * The mutable reader pointer, served from the CDN edge.
 *
 * A CDN HIT returns these bytes without invoking this function (no cold start,
 * no Blobs read, no database). `durable` keeps the pointer in Netlify's global
 * cache across deploys; the short `s-maxage` + `stale-while-revalidate` means a
 * reader always gets an instant answer while a new publication propagates in the
 * background, and the runner can `POST /api/v1/purge` the `reader-manifest` tag
 * for instant switchover. New data therefore appears with no rebuild or deploy.
 */
export const runtime = "nodejs";

const PRESENT_HEADERS = {
  "content-type": "application/json",
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=600",
  "Netlify-Cache-Tag": "reader-manifest",
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

// Absent pointer (initial rollout): cache only briefly so the reader picks up
// the first publication quickly, and never as `durable`.
const ABSENT_HEADERS = {
  "content-type": "application/json",
  "Netlify-CDN-Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

export async function GET() {
  const store = resolveReaderArtifactStore();
  const stored = store ? await store.readManifest().catch(() => null) : null;
  if (!stored) {
    return new Response(JSON.stringify({ formatVersion: 1, available: false }), {
      status: 200,
      headers: ABSENT_HEADERS,
    });
  }
  return new Response(JSON.stringify({ available: true, ...stored.manifest }), {
    status: 200,
    headers: PRESENT_HEADERS,
  });
}
