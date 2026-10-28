"use client";

import { useState } from "react";

import type { UpdateLine, UpdatesView } from "@/lib/control-plane/admin-view/updates-read.ts";

import { Card, cx, Pill } from "./ui.tsx";
import s from "./v6.module.css";
import { useReading } from "./use-reading.ts";

export function UpdatesPanel() {
  const { reading, status } = useReading<{ readonly data?: UpdatesView }>("/api/admin/v6/updates");
  const [saved, setSaved] = useState<{ from: unknown; kept: readonly UpdateLine[] }>({ from: null, kept: [] });
  // Each read marks its updates as shown. Keep earlier updates in this mounted panel.
  if (reading.kind === "ready" && saved.from !== reading.data) {
    const fresh = reading.data.data?.updates ?? [];
    setSaved({ from: reading.data, kept: [...fresh.filter(u => !saved.kept.some(old => old.id === u.id)), ...saved.kept] });
  }
  const kept = saved.kept;
  return (
    <Card title="Updates" id="updates">
      {status}
      <div className={s.stack}>
        {kept.map((u) => (
          <div key={u.id} className={s.row}>
            <span className={s.spread}>
              <strong style={{ fontSize: 13 }}>{u.what}</strong>
              <Pill tone={u.label === "Proven" ? "good" : u.isWin ? "neutral" : "warn"}>{u.label}</Pill>
            </span>
            <span className={cx(s.p, s.meta)}>{u.when}</span>
            {(u.before || u.after) && <p className={cx(s.p, s.small)}>Before: {u.before ?? "—"} · After: {u.after ?? "—"}</p>}
            {u.evidenceHref && <a className={s.btnLink} href={u.evidenceHref}>See the before and after</a>}
          </div>
        ))}
      </div>
    </Card>
  );
}
