"use client";

import type { AnchorHTMLAttributes } from "react";
import { useReaderDeadLink } from "@/hooks/use-reader-link-health";
import { WorkingOnIt } from "@/components/demand/working-on-it";

/** A recorded dead address keeps its label and names the open hunt. */
export function CheckedLink({ href, children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const dead = useReaderDeadLink(href);
  return dead ? <><span className={className} data-dead-link={href}>{children}</span>{" "}<WorkingOnIt inline /></>
    : <a href={href} className={className} {...props}>{children}</a>;
}
