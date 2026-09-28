import type { ChecklistOfficialFieldEvidence } from "@/lib/control-plane/readiness/checklist-official-field-evidence.ts";
import { displayNameOf } from "@/lib/control-plane/display-name.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { plainText } from "@/lib/control-plane/plain-words.ts";
import { Section, mw as s } from "./ui.tsx";

const note = `${s.note} ${s.cText}`;
const fieldNames: Readonly<Record<string, string>> = { name: "Name", office: "Office", title: "Title", phone: "Phone",
  email: "Email", officialUrl: "Official page", profileUrl: "Profile page", contactKind: "Contact type", bodyName: "Body name",
  bodyType: "Body type", address: "Address", parentId: "Parent government", jurisdictionId: "Jurisdiction" };
function sourceLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password &&
      ![...url.searchParams.keys()].some(key => /token|secret|password|credential|api.?key|auth/i.test(key)) ? url.href : null;
  } catch { return null; }
}

export function ChecklistFieldEvidence(props: {
  rows: readonly ChecklistOfficialFieldEvidence[] | null; query: string; requestedPage: number;
  pageHref: (page: number) => string; workHref: (id: string) => string; predicateHref: (id: string) => string;
}) {
  const rows = props.rows?.filter(row => !props.query || [row.recordLabel, row.recordId, row.subjectId,
    ...row.fields.map(field => field.name), ...row.relatedPredicates.map(predicate => predicate.id)]
    .join(" ").toLowerCase().includes(props.query.toLowerCase())) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const page = Number.isSafeInteger(props.requestedPage) ? Math.max(1, Math.min(props.requestedPage, pages)) : 1;
  const shown = rows.slice((page - 1) * 25, page * 25);
  return <section id="official-field-evidence" className={s.stack14} style={{ overflowWrap: "anywhere" }}>
    <Section title="Evidence behind official fields" />
    <p className={note}>Follow captured names, offices, public contacts and government-directory fields. A source passage or accepted record does not prove the complete checklist requirement.</p>
    {props.rows === null ? <p className={note}>This saved census does not contain field-level official evidence yet. Missing evidence is not a count of missing officials or governments.</p>
      : <><p className={note}>{rows.length} of {props.rows.length} captured records with linked evidence match the checklist search; showing {shown.length} on page {page} of {pages}. The complete inventory of officials and governments remains unproved.</p>
        {shown.map(row => {
          const source = sourceLink(row.sourceUrl);
          const download = `/api/admin/evidence/${encodeURIComponent(row.workItemId)}/${encodeURIComponent(row.acquisitionAttemptId)}/${encodeURIComponent(row.artifactId)}`;
          return <details key={JSON.stringify([row.subjectId, row.recordClass, row.recordId])} className={s.inset}>
            <summary className={s.titleStrong14}>Captured record: {plainText(row.recordLabel || displayNameOf(row.subjectId).short)}</summary>
            <div className={s.stack14}>
              <p className={note}>{displayNameOf(row.subjectId).short} · captured {formatEastern(row.observedAt, { year: true })}. Effective term or period: unresolved. Public visibility of each field: not measured.</p>
              <div className={s.row10}>{source && <a className={s.btnLink} href={source} target="_blank" rel="noreferrer">Open the publisher’s page</a>}
                <a className={s.btnLink} href={download}>Request the saved capture</a>
                <a className={s.btnLink} href={props.workHref(row.workItemId)}>Follow this work and its checks</a>
              </div>
              <p className={note}>The publisher’s page may have changed. Saved-capture access requires the private copy to have arrived; an unavailable copy stays unavailable.</p>
              <div className={s.stack8}>{row.fields.map(field => <div key={field.name} className={s.inset}>
                <p className={s.text14}><strong>{fieldNames[field.name] ?? plainText(field.name)}</strong> · {field.spanIds.length} linked source {field.spanIds.length === 1 ? "passage" : "passages"}</p>
                <p className={note}>Captured value: {["phone", "email"].includes(field.name) && !field.officialContactEligible
                  ? "withheld because public-office contact eligibility is not established"
                  : field.capturedValueState === "AVAILABLE_IN_CAPTURE" ? "available in the saved capture; too long for this census summary"
                    : field.capturedValue === undefined ? "not recorded in this census" : String(field.capturedValue)}.</p>
                <p className={note}>Record survived verification and audit: {field.recordSurvivedChecks ? "yes" : "not proved"}. This field independently matched: {field.independentlyMatched ? "yes" : "not proved"}. Public field check: not measured.</p>
                {["phone", "email"].includes(field.name) && <p className={note}>Public-office contact classification: {field.officialContactEligible ? "recorded" : "not established; no official-contact credit"}.</p>}
                <details><summary className={note}>Source passage references</summary><p className={note}>{field.spanIds.join(", ")}</p></details>
              </div>)}</div>
              <p className={note}>{row.reader.state === "EXACT_READER_BINDING_ACCEPTED"
                ? `The publication receipt accepts this captured row. Publication recorded ${row.reader.publishedAt ? formatEastern(row.reader.publishedAt) : "at an unknown time"}; each field’s appearance on the public site remains unchecked.`
                : "This captured row has not been connected to an accepted public record."}</p>
              <div className={s.stack8}><h4 className={s.h4}>What is still needed</h4>{row.relatedPredicates.map(predicate =>
                <p key={predicate.id} className={note}><a href={props.predicateHref(predicate.id)} className={s.btnLink}>{predicate.id}</a>: {predicate.residual}</p>)}</div>
              <details><summary className={note}>Exact evidence references</summary>
                <p className={note}>Artifact: {row.artifactId}. Hash: {row.contentHash}. Acquisition: {row.acquisitionAttemptId}. Parser: {row.parserResultId}. Validator: {row.validatorResultId ?? "not recorded"}. Auditor: {row.auditorResultId ?? "not recorded"}. Public record: {row.reader.objectId ?? "not recorded"}. Accepted version: {row.reader.versionId ?? "not recorded"}.</p>
              </details>
            </div>
          </details>;
        })}
        {shown.length === 0 && <p className={note}>No captured field evidence matches this view. This does not prove that the requested officials or governments are absent.</p>}
        <div className={s.row10}>{page > 1 && <a href={props.pageHref(page - 1)} className={s.btnLink}>Previous 25</a>}
          {page < pages && <a href={props.pageHref(page + 1)} className={s.btnLink}>Next 25</a>}</div>
      </>}
  </section>;
}
