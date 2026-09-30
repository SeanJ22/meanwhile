/**
 * **PREVIEW A SEND OF MANY HUNTS, AND LIST WHAT CAN BE PICKED.** (S11.)
 *
 * ```
 *   GET  ?list=county|congressional_district&state=AZ   what can be picked
 *   POST { text?, picks?, budget, priority? }            the list of ZIPs, each
 *                                                        with its budget, and
 *                                                        everything left out
 * ```
 *
 * It changes nothing. The send itself is the one gateway action
 * `expansion.scope.setMany`, posted to `/api/admin/action` with the `items` this
 * returns, so there is still one door for every change.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { BULK_MAX_ZIPS, parseZips } from "@/lib/control-plane/bulk-hunts/parse.ts";
import { planBudgets, type BudgetSpec } from "@/lib/control-plane/bulk-hunts/plan.ts";
import { describeZips, pickable, validPick, zipsForPick } from "@/app/(admin)/_mw/data/bulk-places.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT_MAX_CHARS = 2_000_000;
const PICKS_MAX = 80;
const headers = { "cache-control": "private, no-store, max-age=0" };

function budgetSpecOf(raw: unknown): BudgetSpec | null {
  if (raw === null || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (b.mode === "split") return { mode: "split", totalUsd: Number(b.totalUsd) };
  if (b.mode === "same") return { mode: "same", eachUsd: Number(b.eachUsd) };
  if (b.mode === "each") {
    const byZip: Record<string, number> = {};
    if (b.byZip !== null && typeof b.byZip === "object") {
      for (const [zip, v] of Object.entries(b.byZip as Record<string, unknown>)) if (/^\d{5}$/.test(zip) && Number.isFinite(Number(v))) byZip[zip] = Number(v);
    }
    return { mode: "each", defaultUsd: Number(b.defaultUsd), byZip };
  }
  return null;
}

async function guard(request: NextRequest, write: boolean) {
  return guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: write,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const verdict = await guard(request, false);
  if (!verdict.ok) {
    return verdict.status === 404 ? new NextResponse(null, { status: 404, headers }) : NextResponse.json({ says: verdict.says }, { status: verdict.status, headers });
  }
  const type = request.nextUrl.searchParams.get("list");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if ((type !== "county" && type !== "congressional_district") || !/^[A-Za-z]{2}$/.test(state)) {
    return NextResponse.json({ says: "Say which list (county or congressional_district) and which state." }, { status: 400, headers });
  }
  const read = await pickable(state.toUpperCase(), type);
  return read.ok ? NextResponse.json({ items: read.items }, { headers }) : NextResponse.json({ says: read.why }, { status: 503, headers });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const verdict = await guard(request, true);
  if (!verdict.ok) {
    return verdict.status === 404 ? new NextResponse(null, { status: 404, headers }) : NextResponse.json({ says: verdict.says }, { status: verdict.status, headers });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ says: "That request could not be read, so nothing was previewed." }, { status: 400, headers });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > TEXT_MAX_CHARS) return NextResponse.json({ says: "That file is too large to read here. Split it and send it in parts." }, { status: 413, headers });
  const rawPicks = Array.isArray(body.picks) ? body.picks : [];
  if (rawPicks.length > PICKS_MAX) return NextResponse.json({ says: `Pick at most ${PICKS_MAX} places at a time.` }, { status: 400, headers });
  const spec = budgetSpecOf(body.budget);
  if (spec === null) return NextResponse.json({ says: "Choose how the budget works: one total for all, the same for each, or one for each." }, { status: 400, headers });

  // 1. ZIPs from the paste or file, then from each pick. The first group a ZIP was seen under is the one it keeps.
  const parsed = parseZips(text);
  const groupOf = new Map<string, string | null>();
  for (const z of parsed.zips) groupOf.set(z.zip, z.group);
  const pickNotes: string[] = [];
  for (const raw of rawPicks) {
    const pick = validPick(raw);
    if (pick === null) {
      pickNotes.push("A pick was not understood and was left out.");
      continue;
    }
    const got = await zipsForPick(pick);
    if (!got.ok) {
      pickNotes.push(got.why);
      continue;
    }
    for (const z of got.zips) if (!groupOf.has(z.zip)) groupOf.set(z.zip, z.group);
  }
  if (groupOf.size === 0) {
    return NextResponse.json({ ok: false, says: pickNotes[0] ?? "No ZIPs were found in what you pasted, uploaded or picked.", skipped: parsed.skipped, pickNotes }, { status: 200, headers });
  }
  if (groupOf.size > BULK_MAX_ZIPS) {
    return NextResponse.json({ ok: false, says: `That is ${groupOf.size.toLocaleString("en-US")} ZIPs; one send takes at most ${BULK_MAX_ZIPS.toLocaleString("en-US")}. Split it.`, pickNotes }, { status: 200, headers });
  }

  // 2. Which of them the national ZIP index knows, and which state each is in.
  const facts = await describeZips([...groupOf.keys()]);
  const known = facts.filter((f) => f.stateAbbr !== null);
  const unknown = facts.filter((f) => f.stateAbbr === null).map((f) => f.zip);

  // 3. The budgets, over the ZIPs that will actually be sent.
  const planned = planBudgets(known.map((f) => f.zip), spec);
  if (!planned.ok) return NextResponse.json({ ok: false, says: planned.why, pickNotes }, { status: 200, headers });
  const stateOf = new Map(known.map((f) => [f.zip, f.stateAbbr as string]));
  const items = planned.items.map((i) => ({ zip: i.zip, stateAbbr: stateOf.get(i.zip)!, budgetUsd: i.budgetUsd, group: groupOf.get(i.zip) ?? null }));
  const groups = new Map<string, number>();
  for (const i of items) groups.set(i.group ?? "No group", (groups.get(i.group ?? "No group") ?? 0) + 1);
  return NextResponse.json(
    {
      ok: true,
      items,
      totalUsd: planned.totalUsd,
      words: planned.words,
      groups: [...groups.entries()].map(([name, count]) => ({ name, count })),
      skipped: parsed.skipped,
      paddedZeros: parsed.paddedZeros,
      duplicates: parsed.duplicates,
      notInIndex: { count: unknown.length, examples: unknown.slice(0, 8) },
      columns: parsed.columns,
      pickNotes,
    },
    { headers },
  );
}
