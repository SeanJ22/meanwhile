import { NextResponse } from "next/server";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
import { readCampaignFinanceForPlace } from "@/lib/funding/state-reader";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams, division = query.get("division") ?? "", cursor = query.get("cursor");
  if (!jurisdictionFromOcdId(division) || division.length > 512 || cursor && cursor.length > 4096) return NextResponse.json({ error: "A state or local division and valid records page are required." }, { status: 400 });
  try {
    return NextResponse.json(await readCampaignFinanceForPlace(division, { cursor }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The campaign records page is unavailable." }, { status: 400 });
  }
}
