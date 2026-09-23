"use client";

/**
 * **THE EXPANSION CONTROLS, THROUGH THE ONE GATEWAY DOOR.**
 *
 * A `fetch` to `/api/admin/action` with `Accept: application/json`, exactly like
 * the spend-ceiling dial (`../fleet-spend-ceiling.tsx`) and for the same reason:
 * the gateway's no-JS form path answers with a redirect built from the request
 * URL, which on Netlify is the deploy-permalink host, not the admin domain. On
 * success the page is refreshed, which re-reads the policy row server-side — the
 * read-back that shows the write landed.
 *
 * Nothing here decides anything: the gateway validates, authorizes (owner
 * session only), records and writes the receipt. This file only sends what the
 * owner chose and shows the receipt's own sentence.
 *
 * No data-plane import: the geography list arrives as props from the server
 * page, which read the published Census lookup once.
 */
import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

import type { ExpansionScopeGeography } from "@/lib/control-plane/expansion/scopes.ts";

type Said = { readonly ok: boolean; readonly says: string } | null;

async function send(actionRoute: string, body: Record<string, unknown>): Promise<{ ok: boolean; says: string }> {
  try {
    const res = await fetch(actionRoute, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as { ok?: boolean; receipt?: { says?: string } } | null;
    if (!res.ok || parsed?.ok === false) {
      return { ok: false, says: parsed?.receipt?.says ?? `Nothing was recorded. The server answered ${res.status}.` };
    }
    return { ok: true, says: parsed?.receipt?.says ?? "Recorded." };
  } catch (e) {
    return { ok: false, says: e instanceof Error ? e.message : "The console could not reach the server; nothing was recorded." };
  }
}

/** Parse the two numbers the way the gateway will, so an obvious typo is caught before the round trip. */
function readNumbers(priority: string, budget: string): { priority: number; budgetUsd: number } | string {
  const p = Number(priority.trim());
  if (!Number.isInteger(p) || p < 1) return "Priority is a whole number, 1 or more — 1 runs first.";
  const b = Number(budget.trim());
  if (budget.trim() === "" || !Number.isFinite(b) || b < 0) return "Budget is a dollar amount, $0 or more — $0 means no paid work there.";
  return { priority: p, budgetUsd: b };
}

/** Choose one geography from the published lookup, and set its priority and budget. */
export function SelectScopeControl(props: {
  readonly actionRoute: string;
  readonly instances: readonly ExpansionScopeGeography[];
  readonly defaultPriority: number;
  readonly selectedKeys: readonly string[];
}) {
  const router = useRouter();
  const ids = { geo: useId(), priority: useId(), budget: useId(), note: useId() };
  const [choice, setChoice] = useState<string>("");
  const [priority, setPriority] = useState(String(props.defaultPriority));
  const [budget, setBudget] = useState("0");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<Said>(null);

  const submit = useCallback(async () => {
    const geography = props.instances.find((g) => `${g.version}/${g.geoid}` === choice);
    if (!geography) {
      setSaid({ ok: false, says: "Choose a geography from the list first." });
      return;
    }
    const numbers = readNumbers(priority, budget);
    if (typeof numbers === "string") {
      setSaid({ ok: false, says: numbers });
      return;
    }
    setSending(true);
    setSaid(null);
    const out = await send(props.actionRoute, {
      type: "expansion.scope.set",
      subject: geography.label,
      input: { geography, priority: numbers.priority, budgetUsd: numbers.budgetUsd, note: note.trim() === "" ? null : note },
      // A nonce per submit: a value-keyed key would swallow a deliberate re-set.
      idempotencyKey: `expansion-set:${geography.geoid}:${Date.now()}`,
    });
    setSaid(out);
    setSending(false);
    if (out.ok) router.refresh();
  }, [props.instances, props.actionRoute, choice, priority, budget, note, router]);

  return (
    <div className="runner-control expansion-select-control">
      <label htmlFor={ids.geo}>Geography</label>
      <select id={ids.geo} value={choice} disabled={sending} onChange={(e) => setChoice(e.target.value)}>
        <option value="">— choose one of {props.instances.length.toLocaleString("en-US")} —</option>
        {props.instances.map((g) => {
          const key = `${g.version}/${g.geoid}`;
          return (
            <option key={key} value={key}>
              {g.label}
              {props.selectedKeys.includes(key) ? " (already selected — this changes it)" : ""}
            </option>
          );
        })}
      </select>
      <label htmlFor={ids.priority}>Priority (1 runs first)</label>
      <input id={ids.priority} type="number" min={1} step={1} inputMode="numeric" value={priority} disabled={sending} onChange={(e) => setPriority(e.target.value)} />
      <label htmlFor={ids.budget}>Paid-work budget, rolling 24 hours ($)</label>
      <input id={ids.budget} type="number" min={0} step="0.01" inputMode="decimal" value={budget} disabled={sending} onChange={(e) => setBudget(e.target.value)} />
      <label htmlFor={ids.note}>Why (optional)</label>
      <input id={ids.note} type="text" maxLength={500} value={note} disabled={sending} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="primary" disabled={sending} onClick={() => void submit()}>
        {sending ? "Recording…" : "Select this geography"}
      </button>
      {said !== null && <span className={said.ok ? "state-green" : "refusal"}>{said.says}</span>}
    </div>
  );
}

/** Change one selected scope's priority or budget, or remove it. Its note is carried through unchanged. */
export function EditScopeControl(props: {
  readonly actionRoute: string;
  readonly geography: ExpansionScopeGeography;
  readonly priority: number;
  readonly budgetUsd: number;
  readonly note: string | null;
}) {
  const router = useRouter();
  const ids = { priority: useId(), budget: useId() };
  const [priority, setPriority] = useState(String(props.priority));
  const [budget, setBudget] = useState(String(props.budgetUsd));
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  const key = `${props.geography.version}/${props.geography.geoid}`;

  const save = useCallback(async () => {
    const numbers = readNumbers(priority, budget);
    if (typeof numbers === "string") {
      setSaid({ ok: false, says: numbers });
      return;
    }
    setSending(true);
    setSaid(null);
    const out = await send(props.actionRoute, {
      type: "expansion.scope.set",
      subject: props.geography.label,
      input: { geography: props.geography, priority: numbers.priority, budgetUsd: numbers.budgetUsd, note: props.note },
      idempotencyKey: `expansion-set:${props.geography.geoid}:${Date.now()}`,
    });
    setSaid(out);
    setSending(false);
    if (out.ok) router.refresh();
  }, [props.actionRoute, props.geography, props.note, priority, budget, router]);

  const remove = useCallback(async () => {
    setSending(true);
    setSaid(null);
    const out = await send(props.actionRoute, {
      type: "expansion.scope.remove",
      subject: key,
      input: { key },
      idempotencyKey: `expansion-remove:${props.geography.geoid}:${Date.now()}`,
    });
    setSaid(out);
    setSending(false);
    if (out.ok) router.refresh();
  }, [props.actionRoute, props.geography.geoid, key, router]);

  return (
    <div className="runner-control expansion-edit-control">
      <label htmlFor={ids.priority}>Priority</label>
      <input id={ids.priority} type="number" min={1} step={1} inputMode="numeric" value={priority} disabled={sending} onChange={(e) => setPriority(e.target.value)} />
      <label htmlFor={ids.budget}>Budget ($ per rolling 24 hours)</label>
      <input id={ids.budget} type="number" min={0} step="0.01" inputMode="decimal" value={budget} disabled={sending} onChange={(e) => setBudget(e.target.value)} />
      <button type="button" className="primary" disabled={sending} onClick={() => void save()}>
        {sending ? "Recording…" : "Save"}
      </button>
      <button type="button" disabled={sending} onClick={() => void remove()}>
        Remove from expansion
      </button>
      {said !== null && <span className={said.ok ? "state-green" : "refusal"}>{said.says}</span>}
    </div>
  );
}
