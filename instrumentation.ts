/** The President is shared; ZIPs and state directories load through their place and state readers. */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  void import("./lib/reader/national.ts").then(({ readNationalShelf }) => readNationalShelf())
    .catch(error => console.error("NATIONAL_SHELF_LOAD_FAILED", error));
}
