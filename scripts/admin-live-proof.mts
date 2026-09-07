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
 *   pnpm admin:live-proof          # against a local production build on :3100
 *
 * The server must be the local production build; the CONTROL PLANE it reads is
 * production's, which is the point — the proof is about the data plane, and a
 * local reader is how a session drives the console without a browser.
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
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  throw new Error(`admin:live-proof refuses ${BASE}: it drives a LOCAL server. The control plane it reads is production's.`);
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
      // The host gate reads this; undici will not send a bare Host header.
      "x-forwarded-host": ADMIN_HOST,
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

/* The prohibited action: refused by name, and the refusal is itself a record. */
const prohibited = await submit({
  type: "prohibited.promotionOn",
  subject: "promotion",
  input: {},
  idempotencyKey: `${idempotencyKey}-prohibited`,
  returnTo: "/admin",
});
legs.push({
  leg: "prohibited action refused",
  ok: prohibited.outcome?.ok === false && prohibited.outcome.receipt.refusal === "PROHIBITED_ACTION",
  says: prohibited.outcome?.receipt.says ?? `status ${prohibited.status}: ${prohibited.raw.slice(0, 200)}`,
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
