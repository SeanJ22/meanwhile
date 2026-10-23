import { NATIONAL_LINK_LABEL, NATIONAL_PATH } from "@/lib/national/link";

/** One door to the National section, the same on the Federal filter and on the Who-governs list. */
export function NationalLink({ className = "national-link" }: { readonly className?: string }) {
  return <a href={NATIONAL_PATH} className={className} data-national-link>{NATIONAL_LINK_LABEL}</a>;
}
