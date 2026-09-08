"use client";

/**
 * **DEPLOY FLEET — WHICH NOW EXPLAINS ITSELF BEFORE IT ACTS.**
 * (ADM-8, 9.4.26; rebuilt for §9A.16, the 9.6.26 feedback.)
 *
 * The button landed on 9.4.26 and the owner then told us he had never pressed
 * it:
 *
 * > *"The owner has intentionally not used `Deploy fleet here` because the
 * > current UI does not explain what it will do. This control must not remain
 * > an unexplained black box."*
 *
 * So the flow is three steps, not one:
 *
 * ```
 *   1  Deploy fleet          say where, in your own words
 *   2  a PREVIEW             what this means · what it will do · how many
 *                            records match · what it will NOT do · what
 *                            happens after · what it can spend
 *   3  Send the fleet        the same typed Action Gateway every other
 *                            control uses, with a durable receipt
 * ```
 *
 * The preview is computed on the server, from the standing obligations the
 * console can actually see, and it says which of its numbers are measured. It
 * describes the action that is actually performed — a `DISPATCH` intent, which
 * reorders owed work and creates none — because a confirmation panel that
 * described a grander action than the button performs would be worse than no
 * panel at all.
 *
 * §9A.16 also asks that the row become a progress view afterwards. It does:
 * every dispatch and what the runner did with it is listed under
 * "Where you have sent the fleet" on the console home, from the same intent log.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import type { DeployPreview } from "@/lib/control-plane/deploy-preview.ts";
import { readRefusal } from "@/lib/control-plane/admin-refusal.ts";

type Step = "CLOSED" | "ASKING" | "PREVIEW" | "SENDING" | "SENT" | "FAILED";

export function DeployFleet(props: {
  readonly returnTo: string;
  readonly maxChars: number;
  /** The one gateway route every console control posts to. */
  readonly actionRoute?: string;
  /** Where the preview is computed. */
  readonly previewRoute?: string;
  /**
   * The instruction already written for him — a readiness row knows exactly
   * which ZIP and which gap it is about, so the button there opens straight
   * into the preview rather than asking him to retype what the row says.
   */
  readonly prefill?: string;
  /** The button's own words, where the surface calls it something else. */
  readonly label?: string;
}) {
  const router = useRouter();
  const actionRoute = props.actionRoute ?? "/api/admin/action";
  const previewRoute = props.previewRoute ?? "/api/admin/deploy-preview";
  const [step, setStep] = useState<Step>("CLOSED");
  const [note, setNote] = useState(props.prefill ?? "");
  const [preview, setPreview] = useState<DeployPreview | null>(null);
  const [says, setSays] = useState<string | null>(null);

  const ask = useCallback(async () => {
    setStep("PREVIEW");
    setPreview(null);
    setSays(null);
    try {
      const res = await fetch(`${previewRoute}?note=${encodeURIComponent(note)}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (!res.ok) {
        /*
         * ADM-49 (class): this used to throw the status and render it. The
         * refusal already carries its own sentence in the one admin refusal
         * shape; read it rather than printing the number.
         */
        const contentType = res.headers.get("content-type");
        const body: unknown = await res.json().catch(() => null);
        const refusal = readRefusal({ status: res.status, body, contentType });
        setSays(refusal.whatToDo === null ? refusal.says : `${refusal.says} ${refusal.whatToDo}`);
        return;
      }
      setPreview((await res.json()) as DeployPreview);
    } catch (e) {
      setSays(e instanceof Error ? e.message : "the console could not work out what this would do");
    }
  }, [note, previewRoute]);

  const send = useCallback(async () => {
    setStep("SENDING");
    try {
      const res = await fetch(actionRoute, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "fleet.deployHere",
          subject: note,
          input: { note },
          idempotencyKey: `deploy:${note}`,
          returnTo: props.returnTo,
        }),
      });
      const contentType = res.headers.get("content-type");
      const body = (await res.json().catch(() => null)) as { ok?: boolean; receipt?: { says?: string } } | null;
      if (!res.ok || body?.ok === false) {
        setStep("FAILED");
        /*
         * ADM-49 (class): a receipt means the gateway looked and refused on the
         * merits; anything else is a refusal before it, which `readRefusal`
         * turns into a sentence instead of a status code.
         */
        if (typeof body?.receipt?.says === "string" && body.receipt.says.trim() !== "") {
          setSays(body.receipt.says);
        } else {
          const refusal = readRefusal({ status: res.status, body, contentType });
          setSays(refusal.whatToDo === null ? refusal.says : `${refusal.says} ${refusal.whatToDo}`);
        }
        return;
      }
      setStep("SENT");
      setSays(body?.receipt?.says ?? "The fleet has been told where to go.");
      router.refresh();
    } catch (e) {
      setStep("FAILED");
      setSays(e instanceof Error ? e.message : "the console could not reach the server; nothing was sent");
    }
  }, [actionRoute, note, props.returnTo, router]);

  if (step === "CLOSED") {
    return (
      <div className="deploy">
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (props.prefill) {
                setStep("PREVIEW");
                void ask();
              } else {
                setStep("ASKING");
              }
            }}
          >
            {props.label ?? "Deploy fleet"}
          </button>
          <span className="note">Tell the fleet where to go next. It reorders the work it already has; it never invents work.</span>
        </div>
      </div>
    );
  }

  if (step === "SENT" || step === "FAILED") {
    return (
      <div className={`deploy deploy-${step.toLowerCase()}`}>
        <p className={step === "SENT" ? "state-green" : "refusal"}>
          <strong>{step === "SENT" ? "Sent." : "Not sent."}</strong> {says}
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              setStep("CLOSED");
              setNote("");
              setPreview(null);
              setSays(null);
            }}
          >
            Send somewhere else
          </button>
        </div>
      </div>
    );
  }

  if (step === "ASKING") {
    return (
      <div className="deploy">
        <label htmlFor="deploy-note">What do you want the fleet to go do?</label>
        <textarea
          id="deploy-note"
          value={note}
          maxLength={props.maxChars}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: deep dive on Illinois, or Pima County campaign finance"
          autoFocus
        />
        <div className="actions">
          <button type="button" className="primary" disabled={note.trim() === ""} onClick={() => void ask()}>
            Show me what this would do
          </button>
          <button type="button" onClick={() => setStep("CLOSED")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deploy deploy-preview">
      <h4>Before you send this</h4>
      {preview === null ? (
        <p className="note">{says ?? "Working out what this would do…"}</p>
      ) : (
        <>
          <p className="dp-means">{preview.means}</p>

          <h5>What it will do</h5>
          <ul className="dp-list">
            {preview.creates.map((line) => (
              <li key={line.says} className={line.measured ? "" : "dp-unmeasured"}>
                {line.says}
              </li>
            ))}
          </ul>

          <h5>What it will not do</h5>
          <ul className="dp-list dp-will-not">
            {preview.willNot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h5>What happens after you click</h5>
          <ol className="dp-after">
            {preview.after.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ol>

          <p className="note">{preview.roles}</p>
          <p className="note">{preview.ceilings}</p>
          <p className="needs-you needs-no">
            <strong>Needs you:</strong> No — nothing else is required from you once this is sent.
          </p>
        </>
      )}
      <div className="actions">
        <button type="button" className="primary" disabled={preview === null || step === "SENDING"} onClick={() => void send()}>
          {step === "SENDING" ? "Sending…" : "Send the fleet"}
        </button>
        <button type="button" onClick={() => setStep("ASKING")}>
          Change what I asked for
        </button>
        <button type="button" onClick={() => setStep("CLOSED")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
