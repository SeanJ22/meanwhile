import type { PollingPlaceLink } from "@/lib/ballot/polling-place-links";
import { formatDateMDY } from "@/lib/map/format";

export function PollingLookupFallback({ links }: { links: readonly PollingPlaceLink[] }) {
  if (!links.length) return null;
  return <div className="mt-3 t-detail leading-relaxed" data-polling-lookup-fallback>
    <p>Official voting lookups</p>
    <ul className="mt-1 space-y-3">
      {links.map((link) => <li key={link.state} data-polling-lookup-state={link.state}>
        <a href={link.url} target="_blank" rel="noreferrer noopener" data-leaves-app
          className="text-link underline decoration-dotted underline-offset-2"
          aria-label={`${link.sourceOrg}: ${link.label} — opens the authority's tool in a new tab`}>
          {link.sourceOrg} ↗
        </a>
        <p className="text-paper-dim">{link.note}</p>
        <p className="text-muted">Verified {formatDateMDY(link.verifiedAt)}.</p>
      </li>)}
    </ul>
  </div>;
}
