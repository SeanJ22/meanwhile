"use client";

/**
 * **UPDATES — on Now (BR-24).** What changed, each with an honest label (Proven, Testing, Expected). An update shows
 * here once: the page that first reads it keeps it until reload, and the next load does not show it again. An
 * expected item is never listed as a win.
 */
import { useEffect, useState } from "react";

import type { UpdateLine, UpdatesView } from "@/lib/control-plane/admin-view/updates-read.ts";

import { Card, cx, Pill } from "./ui.tsx";
import s from "./v6.module.css";

export function UpdatesPanel() {
  const [kept, setKept] = useState<readonly UpdateLine[]>([]);
  useEffect(() => {
    let live = true;
    // Each read marks what it returns as shown, so the page keeps what it has been given until it reloads.
    const load = async () => {
      try {
        const response = await fetch("/api/admin/v6/updates", { cache: "no-store", headers: { accept: "application/json" } });
        if (!response.ok) return;
        const body = (await response.json()) as { readonly data?: UpdatesView };
        const fresh = body.data?.updates ?? [];
        if (live && fresh.length) setKept((old) => [...fresh.filter((u) => !old.some((o) => o.id === u.id)), ...old]);
      } catch { /* the next read tries again */ }
    };
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    return () => { live = false; clearTimeout(first); clearInterval(timer); };
  }, []);
  if (!kept.length) return null;
  return (
    <Card title="Updates" id="updates">
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
