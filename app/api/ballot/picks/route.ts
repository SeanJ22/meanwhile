import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { handleSavedPicks } from "@/lib/ballot/saved-picks-handler";

export const runtime = "nodejs";
const picks = async (request: Request) => { await loadWebsiteSavedKeys(); return handleSavedPicks(request); };
export const GET = picks;
export const PUT = picks;
export const PATCH = picks;
