import type { AskContact } from "../../lib/ask/contacts";
import { contactReadLine } from "../../lib/ask/contact-render";
import { readerText } from "@/lib/text/reader-names";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";

/** One sourced contact answer shared by map and ballot Ask. */
export function AskAnswerContacts({ contacts }: { contacts: readonly AskContact[] }) {
  if (!contacts.length) return null;
  return (
    <details className="mt-2" data-ask-contacts={contacts.length}>
      <summary className="cursor-pointer t-caption text-link">
        Who this is ({contacts.length})
      </summary>
      <ul className="mt-0.5 space-y-2">
        {contacts.map((c) => (
          <li key={c.id} data-ask-contact-id={c.id} data-ask-contact-basis={c.basis} className="t-detail leading-relaxed text-paper-dim">
            <p><span className="text-paper">{readerText(c.name, "name")}</span> — {readerText(c.relationship, "sentence", [c.name])}</p>
            {c.officeTitle && !c.relationship.includes(c.officeTitle) ? <p className="text-muted">{readerOfficeTitle(c.officeTitle)}</p> : null}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 break-words">
              {c.email ? <a href={`mailto:${c.email}`} className="underline decoration-dotted underline-offset-2 hover:text-link">{c.email}</a> : null}
              {c.phone ? <a href={`tel:${c.phone}`} className="underline decoration-dotted underline-offset-2 hover:text-link">{c.phone}</a> : null}
              {c.websiteUrl ? <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-link">Published website</a> : null}
            </div>
            {c.sourceUrl ? (
              <p className="text-muted"><a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-link">{readerText(contactReadLine(c) ?? c.sourceUrl, "title")}</a></p>
            ) : contactReadLine(c) ? <p className="text-muted">{readerText(contactReadLine(c)!, "title")}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
