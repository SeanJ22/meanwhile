"use client";

import type { OwedOverlayView } from "@/lib/control-plane/admin-view/owed-overlay-view.ts";

import { Actions, Card, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function OwedPanel() {
  const { reading, reload } = useReading<{ readonly data?: OwedOverlayView }>("/api/admin/v6/owed", 60_000);
  const data = reading.kind === "ready" ? reading.data.data ?? null : null;
  return (
    <Card title="What is owed" id="owed" aside={<button type="button" className={s.btn} onClick={reload}>Refresh</button>}>
      <div className={s.stack}>
        <Actions actions={[{ kind: "owed-add", target: "owed", label: "Add to what is owed" }]} primaryFirst />
        {reading.kind === "loading" && <Loading what="the log" />}
        {reading.kind === "failed" && <p className={s.p}>—</p>}
        {data && (
          <>
            <p className={s.small}>{data.added} added · {data.declined} declined</p>
            {!data.log.length && <Empty>No change yet.</Empty>}
            {data.log.map((e) => (
              <div key={e.changeId} className={s.row}>
                <span className={s.spread}>
                  <strong style={{ fontSize: 13 }}>{e.says}</strong>
                  <Pill tone={e.kind === "undo" ? "neutral" : e.kind === "add" ? "good" : "warn"}>{e.kind === "add" ? "Added" : e.kind === "decline" ? "Declined" : "Undone"}</Pill>
                </span>
                <span className={s.meta}>{e.when}{e.reason ? ` · ${e.reason}` : ""}</span>
                {e.canUndo && <Actions actions={[{ kind: "owed-undo", target: e.changeId, label: "Undo", payload: { what: e.says } }]} />}
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}
