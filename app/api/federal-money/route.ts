import { NextResponse } from "next/server";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
import { readFederalMoneyForPlace } from "@/lib/federal-money/reader";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const divisionId = query.get("division") ?? "";
  const bodyId = query.get("body") || undefined;
  const cursor = query.get("cursor");
  const year = query.get("year") || undefined;
  if (!jurisdictionFromOcdId(divisionId) || divisionId.length > 512 || (bodyId && bodyId.length > 512) || (cursor && cursor.length > 4096)) {
    return NextResponse.json({ error: "A US division and valid records page are required." }, { status: 400 });
  }
  try {
    const result = await readFederalMoneyForPlace({ divisionId, bodyId }, { cursor, year });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The federal records page is invalid." }, { status: 400 });
  }
}
