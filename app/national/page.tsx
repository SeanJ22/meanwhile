import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NationalSection } from "@/components/national/national-section";
import { titleFor } from "@/lib/brand";
import { readNationalCards } from "@/lib/national/section";

export const metadata = { title: titleFor("National government") };

export default async function NationalPage() {
  const cards = await readNationalCards();
  return (
    <main className="mw-page mx-auto max-w-2xl px-4 py-8 text-paper">
      <p className="text-[0.8125rem]"><Link href="/" className="mw-back-pill">← Back</Link></p>
      <div className="mt-3"><Logo variant="wordmark" size={30} /></div>
      <h1 className="mt-1 text-xl font-semibold">National government</h1>
      <NationalSection cards={cards} />
    </main>
  );
}
