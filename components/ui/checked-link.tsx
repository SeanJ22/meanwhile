"use client";

import type { AnchorHTMLAttributes } from "react";
import { useReaderDeadLink } from "@/hooks/use-reader-link-health";

/** A recorded dead address keeps its held label. */
export function CheckedLink({ href, children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const dead = useReaderDeadLink(href);
  return dead ? <span className={className} data-dead-link={href}>{children}</span>
    : <a href={href} className={className} {...props}>{children}</a>;
}
