import { NextResponse } from "next/server";
import { readPublicRecords } from "@/lib/civic-data/public-records";
import { isScopedManualContractScope, scopedManualContractScope } from "@/lib/civic-data/scoped-manual-contracts";
import { governmentListingsForState } from "@/lib/registry/server";
import { ensureReaderAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { FIPS_TO_STATE } from "@/lib/ocd/fips";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("kind") === "governments") {
    const state = (params.get("state") ?? "").toUpperCase();
    const offset = Number(params.get("offset") ?? "0");
    if (!Object.values(FIPS_TO_STATE).some(row => row.postal === state) || !Number.isSafeInteger(offset) || offset < 0) {
      return NextResponse.json({ error: "A US state or territory and a valid offset are required." }, { status: 400 });
    }
    try {
      const manifest = await readReaderManifest().catch(() => null);
      const edge = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, []) : null;
      const page = await withReaderAuthorityEdge(edge, () => governmentListingsForState(state, offset));
      return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
    } catch { return NextResponse.json({ status: "UNAVAILABLE", records: [] }, { status: 503 }); }
  }
  const division = params.get("division") ?? "";
  try {
    if (!isScopedManualContractScope("public-records", scopedManualContractScope("public-records", division))) throw new Error("invalid division");
  } catch {
    return NextResponse.json({ error: "A US division is required." }, { status: 400 });
  }
  try {
    const read = await readPublicRecords(division);
    if (read.kind === "STORE_UNREACHABLE") return NextResponse.json({ status: "UNAVAILABLE", records: [] }, { status: 503 });
    return NextResponse.json({ division, status: read.kind === "PROMOTED" ? "HELD" : "NOT_HELD",
      records: read.kind === "PROMOTED" ? read.value.records : [], versionId: read.metadata.versionId },
    { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "UNAVAILABLE", records: [] }, { status: 503 });
  }
}
