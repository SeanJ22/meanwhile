import { readFileSync } from "node:fs";
const cards = JSON.parse(readFileSync("data/ballot/candidate-cards-2026.json", "utf8"));
const links = JSON.parse(readFileSync("data/ballot/candidate-links-2026.json", "utf8"));
const hunt = JSON.parse(readFileSync("data/ballot/candidate-hunt-state.json", "utf8"));
const pref = (o, p) => Object.keys(o).filter((k) => k.startsWith(p)).length;
for (const p of ["ballot-az-pima:", "ballot-nh-merrimack:", "ballot-nj-morris:"]) {
  console.log(p, "cards", pref(cards.cards, p), "links", pref(links.links, p), "hunt", pref(hunt.candidates, p));
}
console.log("cards.hunts", cards.hunts.length, JSON.stringify(cards.hunts[0]).slice(0, 400));
console.log("links.hunts", links.hunts.length, JSON.stringify(links.hunts[0]).slice(0, 400));
console.log("huntState sample", JSON.stringify(Object.entries(hunt.candidates)[0], null, 1).slice(0, 1200));
console.log("cards sample", JSON.stringify(Object.entries(cards.cards)[0], null, 1).slice(0, 900));
