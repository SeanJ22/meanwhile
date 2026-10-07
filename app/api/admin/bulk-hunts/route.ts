/**
 * ```
 *   GET  ?list=county|congressional_district|cbsa|state_leg_upper|state_leg_lower&state=<code>
 *                                                        what can be picked
 *   POST { text?, picks?, budget, priority? }            the ZIPs pasted or uploaded and one
 *                                                        mission for each pick, each with its
 *                                                        budget, and everything left out
 * ```
 *
 * It changes nothing. The send itself is `expansion.scope.setMany`, posted to `/api/admin/action` with the `items` this returns.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { BULK_MAX_ZIPS, ZIP_COLUMN, parseZips } from "@/lib/control-plane/bulk-hunts/parse.ts";
// The repository's own workbook reader (there is no spreadsheet library here): a ZIP of XML parts, read without one.
import { readWorkbook, toCsv } from "../../../../scripts/xlsx.mjs";
import { planBudgets, type BudgetSpec } from "@/lib/control-plane/bulk-hunts/plan.ts";
import { PICKABLE_TYPES, describeZips, missionForPick, pickable, validPick, type PickableType } from "@/app/(admin)/_mw/data/bulk-places.ts";
import { scopeKeyOf } from "@/lib/control-plane/expansion/scopes.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT_MAX_CHARS = 2_000_000;
const NOTHING_FOUND = "No ZIPs were found in what you pasted, uploaded or picked.";
const NO_GROUP = "No group";
/** A workbook arrives as base64 text: about 5 MB of file. */
const XLSX_MAX_CHARS = 7_000_000;
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
  if (type === null || !(PICKABLE_TYPES as readonly string[]).includes(type) || !/^[A-Za-z]{2}$/.test(state)) {
    return NextResponse.json({ says: `Say which list (${PICKABLE_TYPES.join(", ")}) and which state.` }, { status: 400, headers });
  }
  const read = await pickable(state.toUpperCase(), type as PickableType);
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
  let text = typeof body.text === "string" ? body.text : "";
  const workbook = typeof body.xlsx === "string" ? body.xlsx : "";
  if (workbook.length > XLSX_MAX_CHARS) return NextResponse.json({ says: "That workbook is too large to read here. Save it as CSV and send it in parts." }, { status: 413, headers });
  if (workbook !== "") {
    // The first sheet that has a column named zip. Every other sheet is left alone.
    try {
      const sheets = readWorkbook(Buffer.from(workbook, "base64")) as { name: string; rows: string[][] }[];
      const sheet = sheets.find((s) => (s.rows[0] ?? []).some((h) => ZIP_COLUMN.test(String(h).trim())));
      if (!sheet) return NextResponse.json({ ok: false, says: "No sheet in that workbook has a column named zip." }, { status: 200, headers });
      text = toCsv(sheet.rows[0], sheet.rows.slice(1)) as string;
    } catch {
      return NextResponse.json({ ok: false, says: "That file could not be read as an Excel workbook. Save it as CSV and upload that." }, { status: 200, headers });
    }
  }
  if (text.length > TEXT_MAX_CHARS) return NextResponse.json({ says: "That file is too large to read here. Split it and send it in parts." }, { status: 413, headers });
  const rawPicks = Array.isArray(body.picks) ? body.picks : [];
  if (rawPicks.length > PICKS_MAX) return NextResponse.json({ says: `Pick at most ${PICKS_MAX} places at a time.` }, { status: 400, headers });
  const spec = budgetSpecOf(body.budget);
  if (spec === null) return NextResponse.json({ says: "Choose how the budget works: one total for all, the same for each, or one for each." }, { status: 400, headers });

  // 1. ZIPs from the paste or file. Each pick is one mission of its own, never expanded into ZIPs.
  const parsed = parseZips(text);
  const groupOf = new Map<string, string | null>();
  for (const z of parsed.zips) groupOf.set(z.zip, z.group);
  const pickNotes: string[] = [];
  const missions: { readonly key: string; readonly geography: { readonly type: string; readonly geoid: string; readonly version: string; readonly label: string; readonly stateAbbr: string } }[] = [];
  for (const raw of rawPicks) {
    const pick = validPick(raw);
    if (pick === null) {
      pickNotes.push("A pick was not understood and was left out.");
      continue;
    }
    const got = await missionForPick(pick);
    if (!got.ok) {
      pickNotes.push(got.why);
      continue;
    }
    const key = scopeKeyOf(got.geography);
    if (!missions.some((m) => m.key === key)) missions.push({ key, geography: got.geography });
  }
  if (groupOf.size === 0 && missions.length === 0) {
    return NextResponse.json({ ok: false, says: pickNotes[0] ?? NOTHING_FOUND, skipped: parsed.skipped, pickNotes }, { status: 200, headers });
  }
  if (groupOf.size > BULK_MAX_ZIPS) {
    return NextResponse.json({ ok: false, says: `That is ${groupOf.size.toLocaleString("en-US")} ZIPs; one send takes at most ${BULK_MAX_ZIPS.toLocaleString("en-US")}. Split it.`, pickNotes }, { status: 200, headers });
  }

  // 2. Which of them the national ZIP index knows, and which state each is in.
  const facts = await describeZips([...groupOf.keys()]);
  const known = facts.filter((f) => f.stateAbbr !== null);
  const unknown = facts.filter((f) => f.stateAbbr === null).map((f) => f.zip);

  // 3. The budgets, over the ZIPs that will actually be sent.
  const planned = planBudgets([...known.map((f) => f.zip), ...missions.map((m) => m.key)], spec);
  if (!planned.ok) return NextResponse.json({ ok: false, says: planned.why, pickNotes }, { status: 200, headers });
  const stateOf = new Map(known.map((f) => [f.zip, f.stateAbbr as string]));
  const missionKeys = new Set(missions.map((m) => m.key));
  const items = planned.items.filter((i) => !missionKeys.has(i.zip)).map((i) => ({ zip: i.zip, stateAbbr: stateOf.get(i.zip)!, budgetUsd: i.budgetUsd, group: groupOf.get(i.zip) ?? null }));
  const budgetOf = new Map(planned.items.map((i) => [i.zip, i.budgetUsd]));
  const missionItems = missions.map((m) => ({ key: m.key, geography: m.geography, label: m.geography.label, budgetUsd: budgetOf.get(m.key) ?? 0 }));
  const groups = new Map<string, number>();
  for (const i of items) groups.set(i.group ?? NO_GROUP, (groups.get(i.group ?? NO_GROUP) ?? 0) + 1);
  return NextResponse.json(
    {
      ok: true,
      items,
      missions: missionItems,
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
