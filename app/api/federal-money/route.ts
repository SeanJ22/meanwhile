import { NextResponse } from "next/server";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
import { readFederalMoneyForPlace } from "@/lib/federal-money/reader";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const divisionId = query.get("division") ?? "";
  const bodyId = query.get("body") || undefined;
  const bodyIds = [...new Set(query.getAll("recipient"))];
  const recipientNames = [...new Set(query.getAll("recipientName"))];
  const recipientState = query.get("recipientState") || undefined;
  const cursor = query.get("cursor");
  const year = query.get("year") || undefined;
  const state = jurisdictionFromOcdId(divisionId)?.usps;
  if (!state || divisionId.length > 512 || (bodyId && bodyId.length > 512) || bodyIds.length > 256 || bodyIds.some(id => !id || id.length > 512) || recipientNames.length > 16 || recipientNames.some(name => !name.trim() || name.length > 512) || recipientState !== undefined && recipientState !== state || (cursor && cursor.length > 8192)) {
    return NextResponse.json({ error: "A US division and valid records page are required." }, { status: 400 });
  }
  try {
    const result = await readFederalMoneyForPlace({ divisionId, bodyId, bodyIds, recipientNames, recipientState }, { cursor, year });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The federal records page is invalid." }, { status: 400 });
  }
}
