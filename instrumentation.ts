/** Place lookup and the President are shared; a state's directory comes from its state package. */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  // Static HTML can arrive while the resident tables and their module load.
  void import("./lib/reader/national.ts").then(({ readZipPlaces, readNationalPresident }) =>
    Promise.all([readZipPlaces(), readNationalPresident()]))
    .catch(error => console.error("NATIONAL_SHELF_LOAD_FAILED", error));
}
