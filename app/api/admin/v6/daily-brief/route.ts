import type { NextRequest } from "next/server";
import { briefGet } from "@/lib/control-plane/admin-view/brief-route.ts";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:NextRequest){return briefGet(request,"daily-brief");}
