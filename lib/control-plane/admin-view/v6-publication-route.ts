import { BALLOT_STATES } from "../../ballot/state-scopes.ts";
import { NextResponse, type NextRequest } from "next/server";
import { readRoutinePublicationStatus } from "../../civic-data/observability-server.ts";
import { readLatestBallotPublication, readLatestBallotPublicationSummary } from "../../civic-data/ballot-publication.ts";
import { openControlPlane } from "../admin-data.ts";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { ADMIN_V6_PUBLICATION_CONTRACT, publicationView, type AdminV6Publication } from "./v6-publication-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const MEMO_MS = 120_000;
let memo: { scope: string; at: number; asOf: string; view: AdminV6Publication } | null = null;

export async function v6PublicationGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  if (!memo || memo.scope !== query.scopeKey || Date.now() - memo.at > MEMO_MS) {
    const [read, opened] = await Promise.all([readRoutinePublicationStatus(), openControlPlane()]);
    if (read.kind !== "HELD") return NextResponse.json({ state: "UNREAD", says: `${read.detail} No publication count is claimed.` }, { status: 503, headers: NO_STORE });
    if (!opened.ok) return NextResponse.json({ state: "UNREAD", says: opened.detail }, { status: 503, headers: NO_STORE });
    const requestedState = query.scope && "state" in query.scope ? query.scope.state.toUpperCase() : null;
    const states = requestedState ? BALLOT_STATES.filter(state => state === requestedState) : BALLOT_STATES;
    const reports = await Promise.all(states.map(state => requestedState
      ? readLatestBallotPublication(opened.repos, state) : readLatestBallotPublicationSummary(opened.repos, state)));
    const ballotPublications = Object.fromEntries(reports.flatMap(report => report ? [[report.state, report]] : []));
    memo = { scope: query.scopeKey, at: Date.now(), asOf: read.asOf, view: { ...publicationView(read.view), ballotPublications } };
  }
  const { view, asOf } = memo;
  return NextResponse.json({ contract: ADMIN_V6_PUBLICATION_CONTRACT, scope: query.scopeKey,
    revision: `publication:${view.counts.map((c) => c.count).join("-")}:${view.latestAttemptFailing}:${view.notVisible[0]?.publishedAt ?? "none"}:${Object.values(view.ballotPublications ?? {}).map(row => row.at).sort().at(-1) ?? "none"}`,
    asOf, data: view, missingParts: [] }, { headers: NO_STORE });
}
