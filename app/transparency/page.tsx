import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { titleFor } from "@/lib/brand";

export const metadata = { title: titleFor("What this site collects") };

export default function TransparencyPage() {
  return (
    <main className="mw-page min-h-dvh overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <Logo variant="wordmark" size={30} />
        <h1 className="mt-2 text-xl font-semibold text-paper">What this site collects</h1>
        <div className="mt-6 space-y-7 t-body leading-relaxed text-paper">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Visits, searches and questions</h2>
            <p>We save the ZIPs and districts people view, searches, cards opened, time spent on cards, ballot picks and reactions. A random browser key lets us count return visits. The server stores a hash of that key.</p>
            <p>Every Ask question is saved with the reader&apos;s place, the answer and information about how it was answered. Questions can be sent to our AI provider, Anthropic, to answer them. We use this information to learn what readers need, improve coverage and build data products.</p>
            <p>Before storing free text, the site removes patterns that look like email addresses, phone numbers and street addresses. Ask also removes recognized self-introductions. These automatic checks can miss identifying details. Summaries and anonymous data may be shared or licensed.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your address and districts</h2>
            <p>The address box asks for your street. It asks for a house number when the street crosses a boundary or the street name alone cannot be placed. What you type passes through our server to the U.S. Census Bureau to find your districts and contests.</p>
            <p>Your street label, ZIP, matched districts and contests, and lookup time are held in this tab until you choose “Forget this address,” close the tab or clear the browser&apos;s site data. The house-number field is cleared after the request. The district lookup does not write the address to our database.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Finding where to vote</h2>
            <p>The voting-location lookup sends an entered street address through our server to the U.S. Census Bureau. It can also send address fields to an election office&apos;s lookup service. A ZIP lookup uses the ZIP to find the area.</p>
            <p>If you choose “Ask Google&apos;s election data,” the lookup can send the address to Google when an official source is unavailable. Census, election offices and Google handle requests under their own privacy practices.</p>
            <p>The voting panel holds your typed address and results in memory while it is open. Its lookup uses uncached requests and responses and does not save the address to browser storage or our database.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Reactions and ballot picks</h2>
            <p>A reaction saves your answer, the item you reacted to, its place and the time. A separate random key is kept in this browser; its hash lets you change a previous reaction. Optional reaction text is checked for contact details before storage.</p>
            <p>Your ballot-pick list is kept in this browser. Pick events are also sent to the site with the contest and choice, so we can understand how the ballot is used.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Feedback and reply emails</h2>
            <p>Feedback goes to the person who built this site. We save the message, time, page or card being reported, and ZIP when supplied. Contact-shaped text is removed from the message before storage. If you fill in the optional reply-email field, that email is kept separately and linked to your message so the author can reply.</p>
            <p>Feedback has a separate store and read path from the site&apos;s behavior and reaction data. If you are pictured here and want your photograph removed, send a request through <Link href="/feedback" className="text-link underline">Feedback</Link>.</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Browser storage and request limits</h2>
            <p>This browser also remembers your ZIP, recent ZIPs, theme, map preferences, tutorial progress, reactions and ballot picks. The selected districts and street are held for the tab. Clearing site data removes these saved choices and random browser keys. It does not remove records already saved on our server.</p>
            <p>Server records have no automatic deletion schedule in the application. Requests may use an IP address temporarily to limit repeated submissions. Hosting and lookup providers may keep their own request logs.</p>
          </section>
          <Card title="ZIP locations" sources={[
            { what: "Census ZIP areas and boundaries", provenance: { sourceOrg: "U.S. Census Bureau", sourceUrl: "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html", collectedAt: "", verifiedAt: null } },
            { what: "Postal coordinates", provenance: { sourceOrg: "GeoNames", sourceUrl: "https://www.geonames.org/", collectedAt: "", verifiedAt: null } },
            { what: "GeoNames license: CC BY 4.0", provenance: { sourceOrg: "Creative Commons", sourceUrl: "https://creativecommons.org/licenses/by/4.0/", collectedAt: "", verifiedAt: null } },
            { what: "Postal types", provenance: { sourceOrg: "Zipcodes", sourceUrl: "https://github.com/seanpianka/Zipcodes", collectedAt: "", verifiedAt: null } },
          ]}>{null}</Card>
        </div>
        <p className="mt-10 t-body"><Link href="/" className="mw-back-pill">← Back to the map</Link></p>
      </div>
    </main>
  );
}
