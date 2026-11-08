import {readerStateResponse} from "@/lib/reader/state-response";

export const runtime = "nodejs";
export const GET = (request: Request) => readerStateResponse(request);
