import { MAX_PICKS_BYTES, PRIVATE_PICK_SECRET, parsePicksFile } from "./picks-file.ts";
import { privatePicksDigest, savedPicksStore } from "../db/saved-picks.ts";
import { isSameOriginSubmission } from "../signal/intake-limits.ts";
import { SlidingWindowLimiter } from "../signal/rate-limit.ts";

const limiter = new SlidingWindowLimiter(240, 60_000);
const createLimiter = new SlidingWindowLimiter(30, 60_000);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Vary": "Authorization" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** The capability is only accepted in a header, never a logged query or pathname. */
export async function handleSavedPicks(request: Request, store = savedPicksStore()) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!PRIVATE_PICK_SECRET.test(secret)) return json({ error: "A private picks code is required." }, 401);
  if (!limiter.allow(privatePicksDigest(secret)) || (request.method === "PUT" && !createLimiter.allow(request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown"))) return json({ error: "Try again shortly." }, 429);
  if (request.method !== "GET" && !isSameOriginSubmission(request)) return json({ error: "Open your ballot to save picks." }, 403);
  try {
    if (request.method === "GET") {
      const saved = await store.read(secret);
      return saved ? json(saved) : json({ error: "This private picks link was not found." }, 404);
    }
    const raw = await request.text();
    if (raw.length > MAX_PICKS_BYTES) return json({ error: "This list is too large." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid picks." }, 400); }
    const file = parsePicksFile(body?.file);
    if (!file) return json({ error: "Invalid picks." }, 400);
    if (request.method === "PUT") {
      const saved = await store.create(secret, file);
      return saved ? json(saved, 201) : json({ error: "This link already exists." }, 409);
    }
    if (request.method === "PATCH") {
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) return json({ error: "Invalid revision." }, 400);
      const saved = await store.update(secret, body.revision, file);
      return saved ? json(saved) : json({ error: "Reload the current picks before saving." }, 409);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch {
    return json({ error: "Picks could not sync. Your changes are kept on this device." }, 503);
  }
}
