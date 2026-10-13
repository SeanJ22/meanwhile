import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";

export const metadata = {
  title: titleFor("What this site collects"),
};

export default function TransparencyPage() {
  return (
    <main className="mw-page min-h-dvh overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <div>
          <Logo variant="wordmark" size={30} />
        </div>
        <h1 className="mt-2 text-xl font-semibold text-paper">What this site collects</h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          We collect how people use this site: what they look at, search, type and react to.
          Ask questions and answers are saved exactly as written, with the ZIP and districts used for the question.
          We count where readers are and how many distinct readers use the site.
          What people tell us may be shared in summarized or anonymous form.
        </p>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          An address entry goes to the Census geocoder to find your districts. The address stays on your device
          until you press “Forget this address.” Address-entry records contain the ZIP, districts and an anonymous
          browser hash for counting distinct readers.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-paper">ZIP locations</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-paper-dim">
          ZIP locations use U.S. Census Bureau ZCTAs and{" "}
          <a href="https://www.geonames.org/" className="underline">GeoNames postal codes</a>
          {" "}under <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">CC BY 4.0</a>,
          with postal types from <a href="https://github.com/seanpianka/Zipcodes" className="underline">Zipcodes</a>.
          Census boundaries connect postal coordinates to places. Your residential address finds your districts.
        </p>

        <p className="mt-10 text-[0.8125rem]">
          <Link href="/" className="mw-back-pill">
            ← Back to the map
          </Link>
        </p>
      </div>
    </main>
  );
}
