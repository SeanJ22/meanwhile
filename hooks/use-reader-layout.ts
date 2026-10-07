"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The reader's layout arithmetic. Breakpoints: phone < 640, tablet 640–1023,
 * desktop ≥ 1024, wide ≥ 1180 (one-row header). The collapsed header's bottom
 * edge is measured once painted (66/118/169/223 are fallbacks). `mapInsets`
 * is the unobstructed map area, used as camera padding.
 */
export type ReaderBreakpoint = "phone" | "tablet" | "desktop" | "wide";

export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const FALLBACK_HEADER_BOTTOM: Record<ReaderBreakpoint, number> = {
  phone: 223,
  tablet: 169,
  desktop: 118,
  wide: 66,
};

function breakpointFor(width: number): ReaderBreakpoint {
  if (width < 640) return "phone";
  if (width < 1024) return "tablet";
  if (width < 1180) return "desktop";
  return "wide";
}

export function useReaderLayout() {
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [measuredBottom, setMeasuredBottom] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  useEffect(() => {
    if (!header) return;
    const measure = () => setMeasuredBottom(Math.round(header.getBoundingClientRect().bottom));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [header]);

  // A callback ref for the collapsed header, so it is measured whenever it mounts.
  const measureHeader = useCallback((el: HTMLElement | null) => setHeader(el), []);

  return useMemo(() => {
    const bp = breakpointFor(size.w);
    const headerBottom =
      header && measuredBottom !== null ? measuredBottom : FALLBACK_HEADER_BOTTOM[bp];
    const sidebarWidth = bp === "tablet" ? 332 : 368;

    const phoneTop = (sidebar: boolean, selection: number) =>
      (sidebar ? 12 : headerBottom + 12) + selection;

    const sheetHeight = (sidebar: boolean, selection: number) =>
      bp === "phone"
        ? Math.max(180, Math.min(Math.round(size.h * 0.62), size.h - phoneTop(sidebar, selection) - 180))
        : 0;

    const mapInsets = ({
      sidebar,
      selection,
    }: {
      sidebar: boolean;
      selection: number;
    }): MapInsets => {
      if (bp === "phone") {
        return {
          top: phoneTop(sidebar, selection),
          left: 12,
          right: 12,
          bottom: sidebar ? sheetHeight(sidebar, selection) + 8 : 76,
        };
      }
      return {
        top: (sidebar ? 16 : headerBottom + 12) + selection,
        left: sidebar ? 16 + sidebarWidth + 16 : 16,
        right: 16,
        bottom: 64,
      };
    };

    return { bp, headerBottom, measureHeader, sidebarWidth, mapInsets, sheetHeight };
  }, [size, measuredBottom, header, measureHeader]);
}
