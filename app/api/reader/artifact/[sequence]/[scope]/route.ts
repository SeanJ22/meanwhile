import { artifactKey } from "@/lib/meetings/edge-artifacts";
import { resolveReaderArtifactStore } from "@/lib/meetings/edge-store";

/**
 * One immutable, content-addressed geographic serving artifact, served from the
 * CDN edge. The URL carries the publication sequence, so a given URL's bytes
 * never change: `max-age=31536000, immutable` lets both the CDN and the browser
 * keep it forever, the function fires at most once per (sequence, scope) to fill
 * the edge, and a new publication is simply a new URL — no purge is ever needed.
 * This is the shared artifact thousands of readers in one state fetch from the
 * edge without any per-visitor composition.
 */
export const runtime = "nodejs";

const IMMUTABLE_HEADERS = {
  "content-type": "application/json",
  "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

const NOT_FOUND_HEADERS = {
  "content-type": "application/json",
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ sequence: string; scope: string }> },
) {
  const { sequence, scope } = await context.params;
  if (!/^[0-9]{1,15}$/.test(sequence) || !/^[a-z]{2,3}$/.test(scope)) {
    return new Response(JSON.stringify({ error: "malformed artifact address" }), {
      status: 400,
      headers: NOT_FOUND_HEADERS,
    });
  }
  const store = resolveReaderArtifactStore();
  const artifact = store
    ? await store.readArtifact(artifactKey(Number(sequence), scope)).catch(() => null)
    : null;
  if (!artifact) {
    return new Response(JSON.stringify({ error: "artifact not found" }), {
      status: 404,
      headers: NOT_FOUND_HEADERS,
    });
  }
  return new Response(JSON.stringify(artifact), { status: 200, headers: IMMUTABLE_HEADERS });
}
