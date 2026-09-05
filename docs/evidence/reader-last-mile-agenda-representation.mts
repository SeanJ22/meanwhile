import { writeFileSync } from "node:fs";
import { agendaRepresentationProof } from "../../scripts/lib/reader-agenda-representation-proof.ts";
const proof = await agendaRepresentationProof();
writeFileSync("docs/evidence/reader-last-mile-agenda-representation.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ documents: proof.documentDenominator, meetings: proof.representations.length, topics: proof.topics.length, failed: proof.representations.filter(row => row.status !== "PROVEN").length }));
