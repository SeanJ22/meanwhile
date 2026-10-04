"use client";

/**
 * **START MISSIONS AND HUNTS IN ONE GO.** (S11.)
 *
 * Three ways in, one list out:
 *
 * ```
 *   paste    ZIPs separated by spaces, commas or lines
 *   file     a spreadsheet saved as CSV (a column named zip; a district column
 *            groups them) — the Cook toss-up file reads as 21 groups
 *   pick     a whole state, counties, congressional or state legislative
 *            districts, or metro areas. Each pick is ONE mission, never a pile
 *            of ZIP hunts: the runner works out its ZIPs when it plans
 * ```
 *
 * and three ways to budget: one total for all (shared evenly), the same amount
 * for each, or a budget for each. "Check the list" asks the server to read it
 * and shows exactly what will be sent and what was left out and why; Send is
 * off until that check has been run on what is on screen now, so nothing is
 * sent that was not shown. The send itself is the one gateway action, through
 * the same executor every other control uses, and its receipt reads Done only
 * when the runner confirms.
 */
import { useEffect, useId, useRef, useState } from "react";

import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { cx } from "./ui.tsx";
import s from "./v6.module.css";

export interface BulkItem {
  readonly zip: string;
  readonly stateAbbr: string;
  readonly budgetUsd: number;
  readonly group: string | null;
}

/** One pick, sent as one mission with its own budget. */
export interface BulkMission {
  readonly key: string;
  readonly geography: { readonly type: string; readonly geoid: string; readonly version: string; readonly label: string; readonly stateAbbr: string };
  readonly label: string;
  readonly budgetUsd: number;
}

export type PickType = "congressional_district" | "county" | "cbsa" | "state_leg_upper" | "state_leg_lower";
const PICK_WORDS: Readonly<Record<PickType | "state", string>> = {
  state: "The whole state", congressional_district: "Congressional districts", county: "Counties", cbsa: "Metro and micro areas",
  state_leg_upper: "State senate districts", state_leg_lower: "State house districts",
};

export interface BulkPick {
  readonly kind: "state" | PickType;
  readonly state: string;
  readonly geoid?: string;
  readonly label: string;
}

interface Preview {
  readonly items: readonly BulkItem[];
  readonly missions?: readonly BulkMission[];
  readonly totalUsd: number;
  readonly words: string;
  readonly groups: readonly { readonly name: string; readonly count: number }[];
  readonly skipped: readonly { readonly why: string; readonly count: number; readonly examples: readonly string[] }[];
  readonly paddedZeros: number;
  readonly duplicates: number;
  readonly notInIndex: { readonly count: number; readonly examples: readonly string[] };
  readonly pickNotes: readonly string[];
}

type Mode = "split" | "same" | "each";
type Source = "paste" | "file" | "pick";

/** The pick a place key stands for (`st:az`, `geo:az.county.04019`), or null for a place a pick cannot carry. */
export function bulkPickOf(target: string, name: string): BulkPick | null {
  const st = /^st:([a-z]{2})$/.exec(target);
  if (st) return { kind: "state", state: st[1].toUpperCase(), label: `All of ${name}` };
  const geo = /^geo:([a-z]{2}).(county|congressional_district|cbsa|state_leg_upper|state_leg_lower).([0-9A-Za-z]{2,12})$/.exec(target);
  if (geo) return { kind: geo[2] as PickType, state: geo[1].toUpperCase(), geoid: geo[3], label: name };
  return null;
}

const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SHOWN_ROWS = 100;
const LIST_UNREAD = "—";
const CHECK_FAILED = "Check failed";

export function BulkHunts(props: {
  readonly initialPick?: BulkPick | null;
  /** Why sending is off (the connection, or no spending permission), or null. */
  readonly blocked: string | null;
  readonly onSend: (send: { readonly items: readonly BulkItem[]; readonly missions: readonly BulkMission[]; readonly priority: number }) => void;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Source>(props.initialPick ? "pick" : "paste");
  const [pasted, setPasted] = useState("");
  const [fileText, setFileText] = useState("");
  /** An Excel workbook, as base64, when that is what was uploaded; the server reads it. */
  const [fileXlsx, setFileXlsx] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [picks, setPicks] = useState<readonly BulkPick[]>(props.initialPick ? [props.initialPick] : []);
  const [pickState, setPickState] = useState(props.initialPick?.state ?? "AZ");
  const [pickType, setPickType] = useState<"state" | PickType>("congressional_district");
  const [lists, setLists] = useState<Readonly<Record<string, { readonly items: readonly { readonly geoid: string; readonly label: string }[] | null; readonly note: string | null }>>>({});
  const [mode, setMode] = useState<Mode>("same");
  const [amount, setAmount] = useState("5");
  const [priority, setPriority] = useState("1");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [sent, setSent] = useState(false);

  const invalidate = () => { setPreview(null); setProblem(null); setEdits({}); };

  useEffect(() => { dialogRef.current?.focus(); }, []);

  // The districts or counties of the chosen state, when picking those. Each answer is kept under the question it answers.
  const listKey = source === "pick" && pickType !== "state" ? `${pickType}:${pickState}` : null;
  const held = listKey === null ? null : lists[listKey] ?? null;
  const choices = held?.items ?? null;
  const choiceNote = listKey === null ? null : held === null ? "Reading the list…" : held.note;
  useEffect(() => {
    if (listKey === null || lists[listKey] !== undefined) return;
    const ctl = new AbortController();
    const [type, state] = listKey.split(":");
    const keep = (value: { items: readonly { geoid: string; label: string }[] | null; note: string | null }) => { if (!ctl.signal.aborted) setLists((m) => ({ ...m, [listKey]: value })); };
    fetch(`/api/admin/bulk-hunts?list=${type}&state=${state}`, { signal: ctl.signal, headers: { accept: "application/json" } })
      .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => null)) as { items?: { geoid: string; label: string }[]; says?: string } | null }))
      .then(({ ok, body }) => {
        if (ok && body?.items) keep({ items: body.items, note: body.items.length === 0 ? "None" : null });
        else keep({ items: null, note: body?.says ?? LIST_UNREAD });
      })
      .catch(() => keep({ items: null, note: LIST_UNREAD }));
    return () => ctl.abort();
  }, [listKey, lists]);

  const addPick = (p: BulkPick) => { setPicks((list) => (list.some((x) => x.kind === p.kind && x.state === p.state && x.geoid === p.geoid) ? list : [...list, p])); invalidate(); };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (/\.xlsx$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setFileXlsx(btoa(bin));
      setFileText("");
    } else {
      setFileXlsx("");
      setFileText(await file.text());
    }
    invalidate();
  };

  const budget = () => mode === "split" ? { mode, totalUsd: Number(amount) } : mode === "same" ? { mode, eachUsd: Number(amount) } : { mode, defaultUsd: Number(amount), byZip: {} };

  const check = async () => {
    setChecking(true);
    setProblem(null);
    setPreview(null);
    setEdits({});
    try {
      const res = await fetch("/api/admin/bulk-hunts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text: source === "paste" ? pasted : source === "file" ? fileText : "", xlsx: source === "file" ? fileXlsx : "", picks: source === "pick" ? picks.map((p) => ({ kind: p.kind, state: p.state, geoid: p.geoid })) : [], budget: budget() }),
      });
      const body = (await res.json().catch(() => null)) as (Preview & { ok?: boolean; says?: string }) | null;
      if (res.ok && body?.ok) setPreview(body);
      else setProblem(body?.says ?? CHECK_FAILED);
    } catch {
      setProblem(CHECK_FAILED);
    } finally {
      setChecking(false);
    }
  };

  const items: readonly BulkItem[] = preview
    ? preview.items.map((i) => (mode === "each" && edits[i.zip] !== undefined && Number.isFinite(Number(edits[i.zip])) ? { ...i, budgetUsd: Math.round(Number(edits[i.zip]) * 100) / 100 } : i))
    : [];
  const missions: readonly BulkMission[] = preview
    ? (preview.missions ?? []).map((m) => (mode === "each" && edits[m.key] !== undefined && Number.isFinite(Number(edits[m.key])) ? { ...m, budgetUsd: Math.round(Number(edits[m.key]) * 100) / 100 } : m))
    : [];
  const count = items.length + missions.length;
  const total = Math.round([...items, ...missions].reduce((sum, i) => sum + Math.round(i.budgetUsd * 100), 0)) / 100;
  const priorityNum = Number(priority);
  const badPriority = !Number.isInteger(priorityNum) || priorityNum < 1 || priorityNum > 999;
  const reason = props.blocked ?? (badPriority ? "Priority: 1 to 999." : null);
  const canSend = preview !== null && count > 0 && !reason && !sent;

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); props.onClose(); } };

  return (
    <div className={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={s.dialog} onKeyDown={onKeyDown} style={{ maxWidth: 820, maxHeight: "90vh", overflow: "auto" }}>
        <h2 id={titleId} className={s.h2}>Start missions or hunts</h2>

        <div className={s.inline} role="tablist" aria-label="Where the list comes from">
          {([["paste", "Paste ZIPs"], ["file", "Upload a file"], ["pick", "Pick a state, counties, districts or metro areas"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={source === id} className={cx(s.btn, source === id ? s.btnPrimary : s.btnGhost)} onClick={() => { setSource(id); invalidate(); }}>{label}</button>
          ))}
        </div>

        {source === "paste" && (
          <label className={s.stack} style={{ gap: 4 }}>
            <span className={s.small}>ZIPs, separated by spaces, commas or new lines</span>
            <textarea className={s.textarea} rows={6} value={pasted} onChange={(e) => { setPasted(e.target.value); invalidate(); }} placeholder="85635 85641 85901" />
          </label>
        )}

        {source === "file" && (
          <div className={s.stack} style={{ gap: 6 }}>
            <label className={s.stack} style={{ gap: 4 }}>
              <span className={s.small}>Excel or CSV file (column: zip, optional: district)</span>
              <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            {fileName && <span className={s.meta}>{fileName} · {fileXlsx ? "Excel workbook ready to read" : `${fileText.length.toLocaleString("en-US")} characters read`}</span>}
          </div>
        )}

        {source === "pick" && (
          <div className={s.stack} style={{ gap: 8 }}>
            <div className={s.inline}>
              <label className={s.small}>State{" "}
                <select className={cx(s.input, s.select)} value={pickState} onChange={(e) => setPickState(e.target.value)}>
                  {US_STATES.map((st) => <option key={st.code} value={st.code.toUpperCase()}>{st.name}</option>)}
                </select>
              </label>
              <label className={s.small}>Pick{" "}
                <select className={cx(s.input, s.select)} value={pickType} onChange={(e) => setPickType(e.target.value as typeof pickType)}>
                  {(Object.keys(PICK_WORDS) as (keyof typeof PICK_WORDS)[]).filter((k) => k !== "state").map((k) => <option key={k} value={k}>{PICK_WORDS[k]}</option>)}
                  <option value="state">{PICK_WORDS.state}</option>
                </select>
              </label>
              {pickType === "state" && (
                <button type="button" className={cx(s.btn, s.btnGhost)} onClick={() => addPick({ kind: "state", state: pickState, label: `All of ${US_STATES.find((x) => x.code.toUpperCase() === pickState)?.name ?? pickState}` })}>Add the whole state</button>
              )}
            </div>
            {pickType !== "state" && (
              <div className={s.stack} style={{ gap: 2, maxHeight: 180, overflow: "auto" }}>
                {choiceNote && <span className={s.meta}>{choiceNote}</span>}
                {(choices ?? []).map((c) => (
                  <button key={c.geoid} type="button" className={cx(s.btn, s.btnGhost)} style={{ textAlign: "left" }} onClick={() => addPick({ kind: pickType, state: pickState, geoid: c.geoid, label: c.label })}>Add {c.label}</button>
                ))}
              </div>
            )}
            {picks.length > 0 && (
              <div className={s.inline} aria-label="Picked">
                {picks.map((p) => (
                  <span key={`${p.kind}:${p.state}:${p.geoid ?? ""}`} className={s.pill}>
                    {p.label}{" "}
                    <button type="button" aria-label={`Remove ${p.label}`} className={s.btnGhost} onClick={() => { setPicks((list) => list.filter((x) => x !== p)); invalidate(); }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <fieldset className={s.stack} style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend className={s.small}>Budget for paid work</legend>
          {([["split", "One budget for all, shared evenly", "Total for the whole list"], ["same", "The same amount for each hunt", "Amount for each hunt"], ["each", "A budget for each hunt", "Starting amount (change any below)"]] as const).map(([id, label]) => (
            <label key={id} className={s.check}>
              <input type="radio" name="bulk-budget" checked={mode === id} onChange={() => { setMode(id); invalidate(); }} />
              <span>{label}{mode === id ? <> — {id === "split" ? "total" : "each"} $ <input className={s.input} style={{ width: 90 }} inputMode="decimal" aria-label="Dollars" value={amount} onChange={(e) => { setAmount(e.target.value); invalidate(); }} /></> : null}</span>
            </label>
          ))}
          <label className={s.small}>Priority (1 runs first){" "}
            <input className={s.input} style={{ width: 70 }} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
        </fieldset>

        <div className={s.inline}>
          <button type="button" className={cx(s.btn, s.btnPrimary)} aria-disabled={checking ? "true" : undefined} onClick={() => { if (!checking) void check(); }}>{checking ? "Checking…" : "Check the list"}</button>
          <button type="button" className={cx(s.btn, s.btnGhost)} onClick={props.onClose}>Cancel</button>
        </div>
        {problem && <p className={s.why} role="alert">{problem}</p>}

        {preview && (
          <section className={s.stack} aria-label="What will be sent" style={{ gap: 6 }}>
            <strong>{missions.length > 0 ? `${missions.length.toLocaleString("en-US")} mission${missions.length === 1 ? "" : "s"}${items.length > 0 ? " and " : ""}` : ""}{items.length > 0 || missions.length === 0 ? `${items.length.toLocaleString("en-US")} hunt${items.length === 1 ? "" : "s"}` : ""} · {money(total)} of paid-work budget</strong>
            {preview.groups.length > 1 && <span className={s.meta}>{preview.groups.length} groups: {preview.groups.slice(0, 30).map((g) => `${g.name} (${g.count})`).join(", ")}{preview.groups.length > 30 ? ", …" : ""}</span>}
            {preview.paddedZeros > 0 && <span className={s.meta}>{preview.paddedZeros.toLocaleString("en-US")} leading zeros fixed</span>}
            {preview.duplicates > 0 && <span className={s.meta}>{preview.duplicates.toLocaleString("en-US")} repeats counted once</span>}
            {preview.notInIndex.count > 0 && <span className={s.why}>Left out {preview.notInIndex.count.toLocaleString("en-US")}, not ZIP areas: {preview.notInIndex.examples.join(", ")}{preview.notInIndex.count > preview.notInIndex.examples.length ? ", …" : ""}</span>}
            {preview.skipped.map((k) => <span key={k.why} className={s.meta}>Left out {k.count.toLocaleString("en-US")}: {k.why}{k.examples.length ? ` (${k.examples.join(", ")}…)` : ""}</span>)}
            {preview.pickNotes.map((n) => <span key={n} className={s.why}>{n}</span>)}
            {missions.length > 0 && (
              <table className={s.small} style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th align="left">Mission</th><th align="right">Budget</th></tr></thead>
                <tbody>
                  {missions.map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td align="right">{mode === "each"
                        ? <input className={s.input} style={{ width: 80, textAlign: "right" }} inputMode="decimal" aria-label={`Budget for ${m.label}`} value={edits[m.key] ?? String(m.budgetUsd)} onChange={(e) => setEdits((prev) => ({ ...prev, [m.key]: e.target.value }))} />
                        : money(m.budgetUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {items.length > 0 && <table className={s.small} style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th align="left">ZIP</th><th align="left">State</th><th align="left">Group</th><th align="right">Budget</th></tr></thead>
              <tbody>
                {items.slice(0, SHOWN_ROWS).map((i) => (
                  <tr key={i.zip}>
                    <td>{i.zip}</td><td>{i.stateAbbr}</td><td>{i.group ?? ""}</td>
                    <td align="right">{mode === "each"
                      ? <input className={s.input} style={{ width: 80, textAlign: "right" }} inputMode="decimal" aria-label={`Budget for ${i.zip}`} value={edits[i.zip] ?? String(i.budgetUsd)} onChange={(e) => setEdits((m) => ({ ...m, [i.zip]: e.target.value }))} />
                      : money(i.budgetUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
            {items.length > SHOWN_ROWS && <span className={s.meta}>First {SHOWN_ROWS} of {items.length.toLocaleString("en-US")}</span>}
            {reason && <p className={s.why} role="alert">{reason}</p>}
            <div className={s.inline}>
              <button type="button" className={cx(s.btn, s.btnPrimary)} aria-disabled={canSend ? undefined : "true"} onClick={() => { if (!canSend) return; setSent(true); props.onSend({ items, missions, priority: priorityNum }); }}>
                {sent ? "Sending…" : missions.length > 0 && items.length === 0 ? `Send ${missions.length.toLocaleString("en-US")} mission${missions.length === 1 ? "" : "s"}` : `Send ${count.toLocaleString("en-US")} hunts`}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
