/**
 * May only read the control plane, fetch production's build identity, and forward a confirmed action to
 * `POST /api/admin/action`. The forward goes through the action route's own handler in process, with this
 * request's verified headers and `caller: OPERATOR_CHAT`, so there is one action path, not two.
 * Refusals are decided before anything is read. Answers are JSON because a component renders the body.
 */

// `NextRequest` is a VALUE here, not only a type: the forwarded request handed
// to the action route's own handler is constructed, not received.
import { NextRequest, NextResponse } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  isAdminHostRequest,
  originAllowed,
  verifySession,
} from "@/lib/control-plane/admin-auth.ts";
import { CHAT_MESSAGE_MAX_CHARS, type ChatInput, type ChatResponse } from "@/lib/control-plane/operator-chat/contract.ts";
import { operatorChatGateway, type ChatActionDoor } from "@/lib/control-plane/operator-chat/gateway-binding.ts";
import { readEnvironments } from "@/lib/control-plane/operator-chat/environments.ts";
import { readOperatorContext } from "@/lib/control-plane/operator-chat/read-context.ts";
import { readsFor, respondToOperator } from "@/lib/control-plane/operator-chat/turn.ts";
import type { GatewaySubmission } from "@/lib/control-plane/operator-chat/actions.ts";
import type { ContextRead, OperatorContext } from "@/lib/control-plane/operator-chat/context.ts";
import type { ReadOutcome } from "@/lib/control-plane/admin-data.ts";
import type { ActionOutcome } from "@/lib/control-plane/gateway/contract.ts";
import { CHAT_PAGE } from "@/lib/control-plane/operator-chat/surface.ts";
import { POST as submitThroughTheGateway } from "@/app/api/admin/action/route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function says(sentence: string, status: number): NextResponse {
  return NextResponse.json({ says: sentence }, { status });
}

/**
 * The gateway's one door, reached in process.
 *
 * The forwarded request carries THIS request's headers — host, origin and the
 * session cookie — so the action route runs the same guard against the same
 * credentials rather than being handed a trusted result. `caller` says
 * `OPERATOR_CHAT`, which the gateway reads as a CEILING it may lower the
 * owner's session to; a body can never raise its own authority.
 */
function gatewayDoor(request: NextRequest): ChatActionDoor {
  return async (action): Promise<GatewaySubmission> => {
    const forwarded = new NextRequest(new URL("/api/admin/action", request.url), {
      method: "POST",
      headers: new Headers({
        host: request.headers.get("host") ?? "",
        origin: request.headers.get("origin") ?? "",
        cookie: request.headers.get("cookie") ?? "",
        "content-type": "application/json",
        accept: "application/json",
      }),
      body: JSON.stringify({
        type: action.type,
        subject: action.subject,
        stateVersion: action.stateVersion,
        idempotencyKey: action.idempotencyKey,
        caller: action.caller,
        input: action.input,
      }),
    });
    const response = await submitThroughTheGateway(forwarded);
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200) {
      const sentence =
        body !== null && typeof body === "object" && typeof (body as { says?: unknown }).says === "string"
          ? (body as { says: string }).says
          : "The console could not put that through, and did not say why.";
      return { ok: false, says: sentence };
    }
    return { ok: true, outcome: body as ActionOutcome };
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) {
    return says("This request did not come from the console, so nothing was read or done.", 403);
  }
  const verdict = await verifySession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    process.env[ADMIN_SESSION_KEY_VAR],
    Math.floor(Date.now() / 1000),
  );
  if (!verdict.ok) {
    return says("You are not signed in to the console, so nothing was read or done.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return says("The message could not be read, so nothing was done with it.", 400);
  }
  const fields = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof fields.text === "string" ? fields.text.trim() : "";
  if (text === "") {
    return says("There was no question in that message, so there is nothing to answer.", 400);
  }
  if (text.length > CHAT_MESSAGE_MAX_CHARS) {
    return says(`That message is longer than the ${CHAT_MESSAGE_MAX_CHARS} characters this console accepts, so nothing was read from it.`, 400);
  }
  const from = typeof fields.from === "string" ? fields.from : CHAT_PAGE;
  const confirmToken = typeof fields.confirmToken === "string" ? fields.confirmToken : null;
  const proposedAt = typeof fields.proposedAt === "string" ? fields.proposedAt : null;

  const binding = operatorChatGateway(gatewayDoor(request));
  // A proposal still does nothing. After confirmation, this verified owner session
  // uses the same authority as the owner pressing the corresponding button.
  const gateway = binding ? { ...binding, caller: "OWNER_SESSION" as const } : null;
  const nowIso = new Date().toISOString();
  const reads = readsFor(text, gateway?.registry ?? []);

  /*
   * Only what the question needs, and the environments only through the route
   * because nothing under `lib/` imports from `app/`. A message that is refused
   * outright reads nothing at all: `readsFor` returns an empty set for it, so
   * the control plane is never opened.
   */
  const wantsEnvironments = reads.includes("environments" as ContextRead);
  const controlPlaneReads = reads.filter((r) => r !== "environments");

  const [reading, environments] = await Promise.all([
    controlPlaneReads.length > 0
      ? readOperatorContext({ reads: controlPlaneReads, nowIso, from, asked: text })
      : Promise.resolve({ context: { nowIso, from, stateVersion: null } as OperatorContext, storeRefusedBecause: null }),
    /*
     * Both readers report a bad response as a reading rather than a throw, but
     * a reach across the network is the one place in this route where something
     * unforeseen can escape — so it is caught here and reported as what it is:
     * the other environments could not be asked. Never as "there is no build".
     */
    wantsEnvironments
      ? readEnvironments()
          .then((value): ReadOutcome<Awaited<ReturnType<typeof readEnvironments>>> => ({ kind: "HELD", value }))
          .catch(
            (): ReadOutcome<Awaited<ReturnType<typeof readEnvironments>>> => ({
              kind: "STORE_UNREACHABLE",
              detail: "Production and staging could not be asked what they are running just now.",
            }),
          )
      : Promise.resolve(null),
  ]);

  const context: OperatorContext = {
    ...reading.context,
    ...(environments === null ? {} : { environments }),
  };

  const confirm =
    confirmToken !== null && proposedAt !== null ? { token: confirmToken, proposedAt } : undefined;
  const input: ChatInput = { text, from, confirm };

  const turn = await respondToOperator(
    { gateway, actorRef: verdict.session.sid },
    context,
    input,
  );

  const answer: ChatResponse = {
    turn,
    asked: text,
    at: nowIso,
    storeRefusedBecause: reading.storeRefusedBecause,
    controlsConnected: gateway !== null,
  };
  return NextResponse.json(answer, { status: 200 });
}
