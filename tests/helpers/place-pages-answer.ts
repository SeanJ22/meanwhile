/** What the pages query answers for the saved pages of a selection: one row holding the print, the requested boards and every page. */
export const placePagesAnswer = (pages: readonly { page_id: string; page_kind: string; built_at: string; body_ids?: readonly string[]; version?: number; row: unknown }[]) =>
  [{ read: { print: "fixture", bodies: pages[0]?.body_ids ?? [], held: [], headers: {},
    pages: pages.map(page => [page.page_id, page.page_kind, String(Date.parse(page.built_at) / 1000), page.version ?? 1, page.row]) } }];
