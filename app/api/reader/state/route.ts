import {readerStateResponse} from "@/lib/reader/state-response";

export const runtime = "nodejs";
// Only for a ZIP whose state has no published files yet (reader/zip3 and /api/answer answer the rest); this route goes when every state is published.
export const GET = readerStateResponse;
