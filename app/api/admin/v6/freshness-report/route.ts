import type { NextRequest,NextResponse } from "next/server";
import { v6FreshnessReportGet } from "@/lib/control-plane/admin-view/freshness-report-route.ts";

export const dynamic="force-dynamic";
export const revalidate=0;
export const runtime="nodejs";

export async function GET(request:NextRequest):Promise<NextResponse>{return v6FreshnessReportGet(request);}
