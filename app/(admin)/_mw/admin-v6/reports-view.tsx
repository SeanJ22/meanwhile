"use client";

import type { ReportRow, ReportsReading, SiteReports } from "@/lib/control-plane/reports/read-reports.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const SITE_WORDS = { live: "Live site", tester: "Tester site" } as const;

function Row({ row }: { readonly row: ReportRow }) {
  return (
    <li>
      <p className={s.p}>{row.message}</p>
      <p className={cx(s.meta)}>
        {mst(row.receivedAt)} · {SITE_WORDS[row.site]} · {row.origin}
        {` · about: ${row.about ? row.about : "—"}`}
        {row.zip ? ` · ZIP ${row.zip}` : ""}
        {row.recordId ? ` · record ${row.recordId}` : ""}
        {row.hasReplyAddress ? " · left a reply address" : ""}
        {row.suspectReason ? ` · held as suspect: ${row.suspectReason}` : ""}
      </p>
    </li>
  );
}

function Site({ result }: { readonly result: SiteReports }) {
  const title = SITE_WORDS[result.site];
  if (result.kind === "UNREADABLE") {
    return (
      <Card title={title} tone="warn">
        <p className={s.p}>—</p>
      </Card>
    );
  }
  return (
    <Card title={<>{title} <span className={s.meta}>({result.total} {result.total === 1 ? "report" : "reports"})</span></>} aside={<Pill tone="neutral">Read only</Pill>}>
      {result.rows.length === 0 ? <Empty>No reports</Empty> : <ul>{result.rows.map((row) => <Row key={`${row.site}-${row.id}`} row={row} />)}</ul>}
      {result.total > result.rows.length && <p className={cx(s.p, s.meta)}>Newest {result.rows.length} of {result.total}</p>}
    </Card>
  );
}

export function ReportsView() {
  const { reading, reload } = useReading<ReportsReading>("/api/admin/reports");
  return (
    <>
      <header>
        <p className={s.eyebrow}>From “Report a problem”</p>
        <h1 className={s.h1}>Reports</h1>
      </header>
      {reading.kind === "loading" && <Loading what="the reports" />}
      {reading.kind === "failed" && <Failed what="The reports" retry={reload} />}
      {reading.kind === "ready" && (
        <>
          <p className={cx(s.p, s.meta)}>Read {mst(reading.data.observedAt)}</p>
          {reading.data.sites.map((result) => <Site key={result.site} result={result} />)}
        </>
      )}
    </>
  );
}
