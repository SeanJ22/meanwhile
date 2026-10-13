import { NextResponse } from "next/server";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
import { readFederalMoneyForPlace } from "@/lib/federal-money/reader";
import { ensureReaderAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const divisionId = query.get("division") ?? "";
  const bodyId = query.get("body") || undefined;
  if (!jurisdictionFromOcdId(divisionId) || divisionId.length > 512 || (bodyId && bodyId.length > 512)) {
    return NextResponse.json({ error: "A US division is required." }, { status: 400 });
  }
  const manifest = await readReaderManifest().catch(() => null);
  const edge = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, []).catch(() => null) : null;
  const result = await withReaderAuthorityEdge({ ...edge, edgeOnly: true }, () => readFederalMoneyForPlace({ divisionId, bodyId }));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
