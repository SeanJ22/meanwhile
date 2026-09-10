/**
 * **THE SOFTWARE RELEASE REVIEW ROUTE — read the review state, record an owner decision.**
 * (Admin Pass B, 2026-09-06.)
 *
 * Behind the existing owner OAuth chain: `middleware.ts` refuses the public
 * host and an unauthenticated request before this file runs, and the handler
 * re-verifies the origin and the session because the row it appends says
 * "the owner decided this". GET returns the derived review state as JSON.
 * POST records exactly one thing — a section decision, feedback, the Raised
 * State variant, or the composite — by appending to the control plane's
 * `software_release_reviews` log after refetching the LIVE manifest and
 * refusing a stale SHA. It merges, pushes, deploys and promotes nothing.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_KEY_VAR, isAdminHostRequest, originAllowed, verifySession } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import {
  isOwnerReleaseReviewRecord,
  type SoftwareReleaseReviewRecord,
} from "@/lib/control-plane/software-release-review.ts";
import { productionIntegrityHistory } from "@/lib/ops/production-integrity-data-plane.ts";

import { HERE } from "../../../(admin)/admin/release-review/contract.ts";
import { readManifest, readProductionIdentity, refreshManifest } from "../../../(admin)/admin/release-review/manifest-source.ts";
import { buildReviewModel, type ReviewModel } from "../../../(admin)/admin/release-review/review-model.ts";
import { recordReview } from "../../../(admin)/admin/release-review/write.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authenticated(request: NextRequest): Promise<{ readonly ok: true; readonly sid: string } | { readonly ok: false; readonly response: NextResponse }> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) return { ok: false, response: new NextResponse(null, { status: 404 }) };
  const verdict = await verifySession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value, process.env[ADMIN_SESSION_KEY_VAR], Math.floor(Date.now() / 1000));
  if (!verdict.ok) return { ok: false, response: NextResponse.json({ error: "authentication required" }, { status: 401 }) };
  return { ok: true, sid: verdict.session.sid };
}

/** The derived review state, as the page renders it. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticated(request);
  if (!auth.ok) return auth.response;
  const [reading, production] = await Promise.all([readManifest(), readProductionIdentity()]);
  let store: ReviewModel["store"] = { ok: true };
  let rows: readonly SoftwareReleaseReviewRecord[] = [];
  const opened = await openControlPlane();
  if (!opened.ok) store = { ok: false, detail: opened.detail };
  else {
    try {
      rows = await opened.repos.softwareReleaseReviews.readAll();
    } catch (error) {
      store = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  const model = buildReviewModel({ reading, production, rows: rows.filter(isOwnerReleaseReviewRecord), store });
  const integrity = productionIntegrityHistory(rows);
  return NextResponse.json(
    {
      ...model,
      productionIntegrity: {
        authority: "cp_log_software_release_reviews/production-integrity",
        latest: integrity[0] ?? null,
        history: integrity,
      },
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) return new NextResponse(null, { status: 404 });
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) return NextResponse.json({ error: "origin refused" }, { status: 403 });
  const verdict = await verifySession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value, process.env[ADMIN_SESSION_KEY_VAR], Math.floor(Date.now() / 1000));
  if (!verdict.ok) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const form = await request.formData();
  const field = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  // A decision form carries no `action` field: the button that was pressed names
  // the decision, and pressing one means DECIDE; the feedback-only button carries its own action.
  const action = (field("action") ?? (field("decision") !== null ? "DECIDE" : "")).trim();
  const back = (notice: string, detail?: string): NextResponse => {
    const url = new URL(HERE, request.url);
    url.searchParams.set("notice", notice);
    if (detail) url.searchParams.set("detail", detail.slice(0, 400));
    return NextResponse.redirect(url, 303);
  };

  if (action === "REFRESH") {
    refreshManifest();
    return back("REFRESHED");
  }

  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ error: "not recorded", detail: opened.detail }, { status: 503 });

  const outcome = await recordReview(
    {
      reviews: opened.repos.softwareReleaseReviews,
      readLiveManifest: () => readManifest({ force: true }),
      now: () => new Date().toISOString(),
      actor: `session:${verdict.session.sid}`,
    },
    {
      action,
      stagingSha: field("stagingSha") ?? "",
      section: field("section"),
      decision: field("decision"),
      feedback: field("feedback"),
      choice: field("choice"),
    },
  );
  return outcome.ok ? back("RECORDED", outcome.detail) : back(outcome.code, outcome.detail);
}
