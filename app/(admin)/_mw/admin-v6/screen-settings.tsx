"use client";

import type { playbookEditView } from "@/lib/control-plane/playbook-edit.ts";
import { PlaybookEditor, type PlaybookSend } from "./playbook-editor.tsx";
import { savePlaybook } from "./playbook-send.ts";
import type { SettingRow, SettingsView } from "@/lib/control-plane/admin-view/v6-settings-read.ts";

import type { ActionRef } from "./model.ts";
import { mst } from "./model.ts";
import { Actions, Card, cx, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export const PLAYBOOKS_ROUTE = "/api/admin/v6/playbooks";
type PlaybooksView = { observedAt: string; safetyFrame: string; rows: ReturnType<typeof playbookEditView>[] };

export const SETTINGS_ROUTE = "/api/admin/v6/settings";

/** Change and Undo for one row, as sends. The machine key is the target and is never shown. */
export function settingActions(row: SettingRow): readonly ActionRef[] {
  if (row.control === "ceiling") {
    return [
      { kind: "global-ceiling", target: "us", label: "Change", payload: { amount: "" } },
      ...(row.undo ? [{ kind: "global-ceiling" as const, target: "us", label: `Undo (back to ${row.undo.valueWords})`, payload: { amount: row.undo.value } }] : []),
    ];
  }
  return [
    { kind: "setting-set", target: row.key, label: "Change", payload: { name: row.label, control: row.control, current: row.valueInput, now: row.valueWords, ...(row.choices ? { choices: JSON.stringify(row.choices) } : {}) } },
    ...(row.undo ? [{ kind: "setting-undo" as const, target: row.key, label: `Undo (back to ${row.undo.valueWords})`,
      payload: { name: row.label, now: row.valueWords, value: row.undo.value, valueWords: row.undo.valueWords, undoOf: row.undo.changeId } }] : []),
  ];
}

export function inForceWords(row: SettingRow): { readonly words: string; readonly tone: "good" | "neutral" | "warn" } {
  if (row.inForce.where === "next-read") return { words: "Used from the next round", tone: "neutral" };
  if (row.inForce.yes === null) return { words: row.inForce.where === "runner" ? "Runner hasn't reported it yet" : "—", tone: "neutral" };
  if (row.inForce.yes) return { words: row.inForce.where === "runner" ? `In force since ${mst(row.inForce.since)}` : "Readers have it", tone: "good" };
  return { words: row.inForce.where === "runner" ? "Waiting for the runner's next round" : "Waiting to reach readers", tone: "warn" };
}

function SettingCard(props: { readonly row: SettingRow }) {
  const { row } = props;
  const force = inForceWords(row);
  return (
    <div className={s.stack} style={{ gap: 6, borderTop: "1px solid var(--panel-border)", paddingTop: 10 }}>
      <div className={s.inline}>
        <strong style={{ fontSize: 14 }}>{row.label}</strong>
        <Pill tone={row.isDefault ? "neutral" : "info"}>{row.valueWords}</Pill>
        <Pill tone={force.tone}>{force.words}</Pill>
      </div>
      <p className={cx(s.small, s.meta)}>{row.changedAt ? `Changed ${mst(row.changedAt)}` : "Never changed"}</p>
      <Actions actions={settingActions(row)} />
      {row.log.length > 0 && (
        <details>
          <summary className={s.small}>Earlier values ({row.log.length.toLocaleString("en-US")})</summary>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">When</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {row.log.map((entry, n) => (
                  <tr key={`${entry.at}-${n}`}>
                    <td>{mst(entry.at)}</td>
                    <td>{entry.beforeWords}</td>
                    <td>{entry.afterWords}{entry.wasUndo ? " (undo)" : ""}</td>
                    <td>{[entry.why, entry.by ? `Changed by ${entry.by}` : null].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

export function SettingsScreen() {
  const { reading, reload } = useReading<SettingsView>(SETTINGS_ROUTE, 20_000);
  const books = useReading<PlaybooksView>(PLAYBOOKS_ROUTE, 20_000);
  async function sendPlaybook(send: PlaybookSend, key: string) {
    const says = await savePlaybook(send, key);
    books.reload();
    return says;
  }
  const data = reading.kind === "ready" ? reading.data : null;
  return (
    <Card title="Settings" id="settings">
      {reading.kind === "loading" && <Loading what="the settings" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      <div className={s.stack}>
        <h3 className={s.h3}>Worker instructions</h3>
        {books.reading.kind === "loading" && <Loading what="the worker instructions" />}
        {books.reading.kind === "failed" && <p role="status">Worker instructions could not be read. <button className={s.btn} onClick={books.reload}>Try again</button></p>}
        {books.reading.kind === "ready" && <>
          {books.reading.stale && <p role="status">These instructions could not be refreshed. <button className={s.btn} onClick={books.reload}>Try again</button></p>}
          <details><summary>Required safety rules (read only)</summary><p>{books.reading.data.safetyFrame}</p></details>
          {books.reading.data.rows.map(row => <details key={row.role}><summary>{row.label}{row.stuck ? " · Stuck" : ""}</summary>
            <PlaybookEditor key={`${row.role}:${row.version}`} row={row} onSend={sendPlaybook} />
          </details>)}
        </>}
      </div>
      {data && (
        <div className={s.stack}>
          {!data.rows.length && <Empty>No settings</Empty>}
          {data.rows.map((row) => <SettingCard key={row.key} row={row} />)}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}</p>
        </div>
      )}
    </Card>
  );
}

export function RunnerSettingsPanel() {
  const { reading } = useReading<SettingsView>(SETTINGS_ROUTE, 30_000);
  const rows = reading.kind === "ready" ? reading.data.rows.filter((row) => row.inForce.where === "runner") : [];
  if (reading.kind !== "ready" || !rows.length) return null;
  return (
    <Card title="Runner settings" id="runner-settings">
      <div className={s.stack} style={{ gap: 6 }}>
        {rows.map((row) => {
          const force = inForceWords(row);
          return (
            <div key={row.key} className={s.inline}>
              <span>{row.label}</span>
              <Pill tone="info">{row.valueWords}</Pill>
              <Pill tone={force.tone}>{force.words}</Pill>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
