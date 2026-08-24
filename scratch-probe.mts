import { politeGetText } from "@/lib/sources/http";
import { flattenForEvidence, officeEvidenceIn, OFFICE_EVIDENCE } from "@/lib/hunt/candidate-evidence";
const r = await politeGetText("http://garykapner.com", { profile: "browser" });
console.log("status", r.status, "bytes", r.text.length);
const hay = flattenForEvidence(r.text);
console.log("flattened length", hay.length);
console.log("has 'gary kapner':", hay.includes("gary kapner"));
for (const [label, re] of OFFICE_EVIDENCE) console.log(`  ${label.padEnd(26)} ${re.test(hay)}`);
for (const probe of ["candidate for", "township committee", "paid for by", "your candidate"]) {
  const i = hay.indexOf(probe);
  console.log(`  "${probe}" at ${i}${i >= 0 ? " :: " + hay.slice(Math.max(0, i - 60), i + 80) : ""}`);
}
console.log("\nfirst 400 of flattened:", hay.slice(0, 400));
