import { handleSavedPicks } from "@/lib/ballot/saved-picks-handler";

export const runtime = "nodejs";
export const GET = (request: Request) => handleSavedPicks(request);
export const PUT = (request: Request) => handleSavedPicks(request);
export const PATCH = (request: Request) => handleSavedPicks(request);
