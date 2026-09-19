"use client";

/**
 * **THE SPEND-CEILING DIAL, THROUGH THE ONE GATEWAY DOOR.**
 *
 * A `fetch` to `/api/admin/action` with `Accept: application/json`, exactly like
 * {@link ../deploy-fleet.tsx}. It is a client control rather than a plain
 * `<form method="post">` for one concrete reason: the gateway's no-JS form path
 * answers a submit with a 303 redirect built from `new URL(destination,
 * request.url)`, and on Netlify `request.url` carries the raw deploy-permalink
 * host, not the custom admin domain — so the redirect lands on a non-admin host
 * that middleware 404s. The JSON path returns a body and no redirect, so it is
 * correct on any host. On success it `router.refresh()`es, which re-reads the
 * policy row server-side so the "Spend ceiling" line above updates to the value
 * just recorded — the read-back that shows the write landed.
 */
import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

export function FleetSpendCeilingControl(props: {
  readonly actionRoute: string;
  readonly returnTo: string;
  /** The value in force now, the input's starting value. */
  readonly currentUsd: number;
  /** The largest value the control accepts (the server validates authoritatively). */
  readonly maxUsd: number;
}) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(String(props.currentUsd));
  const [sending, setSending] = useState(false);
  const [says, setSays] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const submit = useCallback(async () => {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setOk(false);
      setSays("Enter a dollar amount greater than $0 — to stop the Fleet, pause the runner instead.");
      return;
    }
    setSending(true);
    setSays(null);
    setOk(null);
    try {
      const res = await fetch(props.actionRoute, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "config.setFleetSpendCeiling",
          subject: "fleet spend ceiling",
          input: { rollingCeilingUsd: parsed },
          // A nonce per submit, never the value alone: a value-keyed idempotency
          // key would dedup a deliberate re-set of a previously-set amount and
          // silently keep the newer value.
          idempotencyKey: `set-fleet-ceiling:${parsed}:${Date.now()}`,
          returnTo: props.returnTo,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; receipt?: { says?: string } } | null;
      if (!res.ok || body?.ok === false) {
        setOk(false);
        setSays(body?.receipt?.says ?? `Nothing was recorded. The server answered ${res.status}.`);
        return;
      }
      setOk(true);
      setSays(body?.receipt?.says ?? "Recorded.");
      router.refresh();
    } catch (e) {
      setOk(false);
      setSays(e instanceof Error ? e.message : "The console could not reach the server; nothing was recorded.");
    } finally {
      setSending(false);
    }
  }, [props.actionRoute, props.returnTo, value, router]);

  return (
    <div className="runner-control spend-ceiling-control">
      <label htmlFor={inputId} className="spend-ceiling-label">New rolling 24-hour ceiling ($)</label>
      <input
        id={inputId}
        type="number"
        min={1}
        max={props.maxUsd}
        step="1"
        inputMode="decimal"
        value={value}
        disabled={sending}
        onChange={(e) => setValue(e.target.value)}
        aria-label="New rolling 24-hour spend ceiling in US dollars"
      />
      <button type="button" className="primary" disabled={sending} onClick={() => void submit()}>
        {sending ? "Setting…" : "Set the spend ceiling"}
      </button>
      {says !== null && <span className={ok ? "state-green" : "refusal"}>{says}</span>}
    </div>
  );
}
