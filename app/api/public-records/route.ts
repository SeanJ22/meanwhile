import { NextResponse } from "next/server";
import { readPublicRecords } from "@/lib/civic-data/public-records";
import { isScopedManualContractScope, scopedManualContractScope } from "@/lib/civic-data/scoped-manual-contracts";

export async function GET(request: Request) {
  const division = new URL(request.url).searchParams.get("division") ?? "";
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
