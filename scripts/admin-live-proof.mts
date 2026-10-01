/**
 * **THE LIVE END-TO-END PROOF.** (ADM-C10.)
 *
 * The brief will not accept tests alone: *"Perform a bounded live proof against
 * the real production Admin/control-plane environment without changing public
 * Reader truth."* The loop it names is the whole point of Admin C:
 *
 * ```
 *   1  Admin reads live state
 *   2  the owner initiates a safe permitted action
 *   3  the Gateway validates it
 *   4  the canonical system receives it
 *   5  a durable receipt is written
 *   6  the Admin reads the result back
 * ```
 *
 * ## What this proves, and against what
 *
 * The REAL production control plane (`WTP_CONTROL_PLANE_DATABASE_URL`), through
 * a REAL admin session signed with the real key, over the REAL HTTP route the
 * console's own buttons post to — never the gateway's function called directly,
 * because calling it directly would prove the gateway and not the door.
 *
 * ## What it deliberately does not do
 *
 * It runs `fleet.requestReadback`, which is `READ_ONLY`: it asks the control
 * plane what it currently holds and records that it asked. Nothing is promoted,
 * no record class is opened, no reader truth changes, no code ships. §ADM-C10
 * asks for a low-risk non-promotion, non-reader action and this is the lowest
 * one that still exercises every leg of the loop.
 *
 * Then it proves the three refusals the same door has to give, on the same
 * live plane: a duplicate submission returns the FIRST receipt rather than
 * acting twice, a prohibited action is refused by name, and an unknown one
 * fails closed.
 *
 * ## Usage
 *
 *   pnpm admin:live-proof                                    # a local production build on :3100
 *   ADMIN_PROOF_BASE=$ADMIN_ORIGIN pnpm admin:live-proof              # the deployed Admin host
 *
 * The deployed base must equal ADMIN_ORIGIN exactly. It is not written out here:
 * the production host is named in lib/ops/origins.ts and nowhere else, so that
 * changing it is one edit rather than a search.
 *
 * On the LOCAL run the server must be the local production build, and the
 * CONTROL PLANE it reads is production's — that was the point of ADM-C10: the
 * proof is about the data plane, and a local reader is how a session drives the
 * console without a browser.
 *
 * On the DEPLOYED run every part is production's: the host, the route code the
 * host is serving, the session, and the plane. It additionally asks the host
 * which build it is serving and reads one authenticated page over real HTTPS —
 * the two things a local server structurally cannot prove.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { join } from "node:path";

import { ADMIN_SESSION_COOKIE, signSession } from "../lib/control-plane/admin-auth.ts";
import { ADMIN_RECEIPT_LOG_KEY, receiptIdFor, type ActionOutcome } from "../lib/control-plane/gateway/contract.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

/** The admin host, derived from the one origins module rather than retyped. */
const ADMIN_HOST = new URL(ADMIN_ORIGIN).host;

const BASE = process.env.ADMIN_PROOF_BASE ?? "http://localhost:3100";

/**
 * **TWO HOSTS, AND NO THIRD.** (ACLOSE-5.)
 *
 * ADM-C10's proof drove the real Admin route code, a real signed session and
 * the real production control plane — and the application server was a local
 * production build. That is a genuine proof of the data plane and it leaves one
 * gap open: nothing had exercised the door on the machine that actually serves
 * it. So this now accepts exactly one more base, the canonical Admin origin,
 * and still nothing else.
 *
 * The allowlist is two exact shapes rather than a pattern, because a pattern is
 * how "any host that looks admin-ish" gets in. `ADMIN_ORIGIN` comes from the
 * one origins module; there is no way to name a proof host from the command
 * line that is not one of these two.
 */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DEPLOYED = BASE === ADMIN_ORIGIN;
if (!LOCAL.test(BASE) && !DEPLOYED) {
  throw new Error(
    `admin:live-proof refuses ${BASE}. It drives either a LOCAL production build ` +
      `(localhost or 127.0.0.1) or the canonical Admin origin ${ADMIN_ORIGIN}, and nothing else. ` +
      "An arbitrary proof host is a proof about a host nobody named.",
  );
}
const key = process.env.WTP_ADMIN_SESSION_KEY;
if (!key) throw new Error("WTP_ADMIN_SESSION_KEY is not set, so no admin session can be signed and the door would refuse.");
const planeUrl = controlPlaneUrlFromEnv();
if (planeUrl === null) throw new Error("WTP_CONTROL_PLANE_DATABASE_URL is not set, so there is no live plane to prove anything against.");

const nowSeconds = Math.floor(Date.now() / 1000);
const sid = `adm_liveproof${nowSeconds}`;
const cookie = await signSession({ sid, iat: nowSeconds, exp: nowSeconds + 900, via: "google" }, key);

/** One submission through the console's own door, exactly as a button makes it. */
async function submit(envelope: Record<string, unknown>): Promise<{ status: number; outcome: ActionOutcome | null; raw: string }> {
  const response = await fetch(`${BASE}/api/admin/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`,
      /*
       * `x-forwarded-host` is sent ONLY against a local build, and it is not a
       * spoof there: it is how a local server is told which of its own hosts
       * this request is for, because undici will not send a bare Host header.
       *
       * Against the deployed Admin it is deliberately ABSENT. The request goes
       * to the canonical Admin origin over HTTPS and the host gate reads the real
       * host. Sending a forwarded-host header there would be asserting the very
       * thing the deployed proof exists to observe, which would make the proof
       * about our header rather than about the host (ACLOSE-5).
       */
      ...(DEPLOYED ? {} : { "x-forwarded-host": ADMIN_HOST }),
      origin: ADMIN_ORIGIN,
    },
    body: JSON.stringify(envelope),
  });
  const raw = await response.text();
  let outcome: ActionOutcome | null = null;
  try {
    outcome = JSON.parse(raw) as ActionOutcome;
  } catch {
    /* a non-JSON body is itself the finding; `raw` carries it */
  }
  return { status: response.status, outcome, raw };
}

const startedAt = new Date().toISOString();
const idempotencyKey = `live-proof-${startedAt}`;
const legs: { leg: string; ok: boolean; says: string }[] = [];

/**
 * 0 — WHAT IS THIS HOST ACTUALLY SERVING, before anything is asked of it.
 * (ACLOSE-5.)
 *
 * Only on the deployed run, and first, because every leg after it is a claim
 * about a particular build and a proof that never asked which build it was
 * talking to is a proof about an unknown. `WTP_EXPECT_SHA`, when set, turns the
 * reading into an assertion; without it the SHA is recorded and not judged,
 * which is still the difference between naming the build and assuming it.
 */
let deployedSha: string | null = null;
if (DEPLOYED) {
  /*
   * ASKED OF THE ADMIN HOST ITSELF, not of the reader host.
   *
   * `/api/build` is the SITE's build-identity endpoint and the admin origin
   * correctly 404s it — the middleware confines that origin to admin paths, and
   * reading the identity from the public host instead would prove which build
   * the READER is serving and then infer the admin's from it. The Changes page
   * renders the code identity the admin host is itself running, which is the
   * thing this leg is supposed to observe rather than deduce.
   */
  try {
    const shipping = await fetch(`${BASE}/admin/changes`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`, accept: "text/html", "cache-control": "no-cache" },
      redirect: "manual",
    });
    const html = shipping.status === 200 ? await shipping.text() : "";
    const expected = process.env.WTP_EXPECT_SHA ?? null;
    const found = [...new Set([...html.matchAll(/running build ([0-9a-f]{7})\b/g)].map((m) => m[1]))];
    const matchesExpected = expected !== null && found.some((short) => expected.startsWith(short));
    deployedSha = matchesExpected ? expected : (found[0] ?? null);
    legs.push({
      leg: "the deployed host names the build it is serving",
      ok: shipping.status === 200 && (expected === null ? deployedSha !== null : matchesExpected),
      says:
        shipping.status !== 200
          ? `GET ${BASE}/admin/changes returned ${shipping.status}, so the host said nothing about its build.`
          : expected === null
            ? `The Changes page on ${BASE} names ${found.length} build identit(ies); the first is ${deployedSha ?? "none"}.`
            : matchesExpected
              ? `The Changes page on ${BASE} carries ${expected}, which is the build this proof is about.`
              : `The Changes page on ${BASE} does not carry ${expected}. It names: ${found.join(", ") || "no build identity at all"}.`,
    });
  } catch (error) {
    legs.push({
      leg: "the deployed host names the build it is serving",
      ok: false,
      says: `GET ${BASE}/admin/changes could not be read (${(error as Error)?.message ?? "error"}).`,
    });
  }

  /*
   * And an AUTHENTICATED page, over real HTTPS, with a real session — the half
   * ADM-C10 could not do from a local server. A 200 here proves the deployed
   * host's own middleware admitted this session on its own hostname.
   */
  try {
    const page = await fetch(`${BASE}/admin/agents`, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}`, accept: "text/html", "cache-control": "no-cache" },
      redirect: "manual",
    });
    const html = page.status === 200 ? await page.text() : "";
    legs.push({
      leg: "an authenticated admin page is served by the deployed host",
      ok: page.status === 200 && html.includes("Agents"),
      says:
        page.status === 200
          ? `GET ${BASE}/admin/agents returned 200 and ${html.length} bytes of the Agents page to a signed session.`
          : `GET ${BASE}/admin/agents returned ${page.status}, so no authenticated page was served.`,
    });
  } catch (error) {
    legs.push({
      leg: "an authenticated admin page is served by the deployed host",
      ok: false,
      says: `GET ${BASE}/admin/agents failed (${(error as Error)?.message ?? "error"}).`,
    });
  }
}

/* 1–5 — a real permitted action through the real door. */
const first = await submit({
  type: "fleet.requestReadback",
  subject: "control-centre",
  input: { subject: "control-centre" },
  idempotencyKey,
  returnTo: "/admin",
});
const receipt = first.outcome?.receipt ?? null;
legs.push({
  leg: "permitted action",
  ok: first.status === 200 && first.outcome?.ok === true && receipt?.outcome === "DONE",
  says: receipt?.says ?? `status ${first.status}: ${first.raw.slice(0, 200)}`,
});

/* 6 — the receipt read back out of the live plane, not out of the response. */
const repos = await createPgRepositories(planeUrl, new Date().toISOString(), { skipBootstrap: true });
const rows = await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
const wantedId = receiptIdFor("fleet.requestReadback", idempotencyKey);
const stored = rows.find((r) => (r as { receiptId?: string }).receiptId === wantedId) ?? null;
legs.push({
  leg: "durable receipt read back from the live control plane",
  ok: stored !== null,
  says: stored ? `receipt ${wantedId} is on the log, ${rows.length} receipt(s) in all` : `receipt ${wantedId} is NOT on the log (${rows.length} receipt(s) read)`,
});

/* The duplicate: the same key must return the FIRST receipt and act once. */
const again = await submit({
  type: "fleet.requestReadback",
  subject: "control-centre",
  input: { subject: "control-centre" },
  idempotencyKey,
  returnTo: "/admin",
});
const rowsAfter = await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
const sameId = again.outcome?.receipt?.receiptId === receipt?.receiptId;
const noSecondRow = rowsAfter.filter((r) => (r as { receiptId?: string }).receiptId === wantedId).length === 1;
legs.push({
  leg: "duplicate submission",
  ok: again.outcome?.replayed === true && sameId && noSecondRow,
  says: `replayed=${String(again.outcome?.replayed)}, same receipt=${String(sameId)}, exactly one row=${String(noSecondRow)}`,
});

/* The unknown action: fails closed. */
const unknown = await submit({
  type: "definitely.not.an.action",
  subject: "nothing",
  input: {},
  idempotencyKey: `${idempotencyKey}-unknown`,
  returnTo: "/admin",
});
legs.push({
  leg: "unknown action fails closed",
  ok: unknown.outcome?.ok === false && unknown.outcome.receipt.refusal === "UNKNOWN_ACTION",
  says: unknown.outcome?.receipt.says ?? `status ${unknown.status}: ${unknown.raw.slice(0, 200)}`,
});

/* A stale submission: the gateway refuses a control drawn against a world that moved. */
const stale = await submit({
  type: "decision.record",
  subject: "LIVE-PROOF-NO-SUCH-ROW",
  input: { subjectId: "LIVE-PROOF-NO-SUCH-ROW", chosenOption: "Acknowledge", consequenceShown: "nothing", ownerAnswer: null },
  stateVersion: "a-revision-this-console-never-rendered",
  idempotencyKey: `${idempotencyKey}-stale`,
  returnTo: "/admin",
});
legs.push({
  leg: "stale state refused",
  ok: stale.outcome?.ok === false && stale.outcome.receipt.refusal === "STALE_STATE",
  says: stale.outcome?.receipt.says ?? `status ${stale.status}: ${stale.raw.slice(0, 200)}`,
});

const finishedAt = new Date().toISOString();
const record = {
  formatVersion: 1,
  startedAt,
  finishedAt,
  base: BASE,
  mode: DEPLOYED ? "DEPLOYED_ADMIN_HOST" : "LOCAL_PRODUCTION_BUILD",
  deployedSha,
  controlPlane: "the production control plane named by WTP_CONTROL_PLANE_DATABASE_URL",
  adminSessionRef: sid,
  idempotencyKey,
  receiptId: wantedId,
  receipt,
  legs,
};
mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
writeFileSync(join(process.cwd(), ".scratch", "admin-live-proof.json"), `${JSON.stringify(record, null, 2)}\n`);

for (const leg of legs) console.log(`admin:live-proof · ${leg.ok ? "PROVEN" : "NOT PROVEN"} · ${leg.leg} — ${leg.says}`);
console.log(floorLine(floored("proof legs", "the legs this proof runs", legs.length, legs.filter((l) => l.ok).length)));
process.exitCode = legs.every((l) => l.ok) ? 0 : 1;
