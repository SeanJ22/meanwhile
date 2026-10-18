/** Each server keeps the small national shelf ready for every reader. */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  // Static HTML can arrive while the resident tables and their module load.
  void import("./lib/reader/national.ts").then(({ readNationalShelf }) => readNationalShelf())
    .catch(error => console.error("NATIONAL_SHELF_LOAD_FAILED", error));
}
