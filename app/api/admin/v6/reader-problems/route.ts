import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { briefGet } from "@/lib/control-plane/admin-view/brief-route.ts";
export const dynamic="force-dynamic";
export const runtime="nodejs";
async function get(request:NextRequest){return briefGet(request,"reader-problems");}

export const GET = adminRead(get);
