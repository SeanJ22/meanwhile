/**
 * **THE TEN STANCE TOPICS (CA-10).**
 *
 * One list, one setting. The person card's topic chips and the ballot card's
 * passages both read it, so both show the same ten plain nouns. A topic is a
 * plain noun, never a framing ("housing", not "the housing crisis"): a framing
 * on the card is the product taking a position through the label.
 *
 * Each topic carries the lowercased search phrases looked for in a person's own
 * published text. Phrases are multi-word by preference — one loose word turns a
 * search into noise the reader has to filter for us. Every person is searched
 * for the same list in the same order; nothing here takes a person.
 *
 * The list is the code default of the reader-facing setting `stances.topics`
 * (BR-05). A change in Admin reaches readers through the reader-edge settings
 * publication; the site never reads the control plane per request.
 */
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";

export interface StanceTopic {
  /** Stable key, lowercase with hyphens. */
  id: string;
  /** The plain noun the reader sees. */
  label: string;
  /** Lowercased phrases to look for in the person's own published text. */
  phrases: readonly string[];
}

export const STANCE_TOPICS_SETTING = "stances.topics";

export const DEFAULT_STANCE_TOPICS: readonly StanceTopic[] = [
  { id: "housing", label: "housing", phrases: [
    "affordable housing", "housing costs", "cost of housing", "homeownership", "rent is too",
    "housing supply", "build more homes", "zoning reform"] },
  { id: "water", label: "water", phrases: [
    "water supply", "drought", "colorado river", "groundwater", "water rights", "drinking water"] },
  { id: "schools", label: "schools", phrases: [
    "public schools", "school funding", "teacher pay", "student debt", "school choice", "early childhood education"] },
  { id: "taxes", label: "taxes", phrases: [
    "tax cuts", "tax increase", "property taxes", "income tax", "tax code", "tax relief"] },
  { id: "immigration", label: "immigration", phrases: [
    "immigration", "border security", "the border", "asylum", "deportation", "path to citizenship"] },
  { id: "health-care", label: "health care", phrases: [
    "health care costs", "healthcare costs", "prescription drug", "medicaid", "medicare",
    "affordable care act", "health insurance"] },
  { id: "public-safety", label: "public safety", phrases: [
    "public safety", "law enforcement", "police department", "community policing", "crime rate",
    "fire department", "gun violence", "second amendment", "gun safety"] },
  { id: "jobs", label: "jobs", phrases: [
    "good-paying jobs", "good paying jobs", "minimum wage", "small businesses", "manufacturing jobs",
    "workers' rights", "right to organize"] },
  { id: "environment", label: "environment", phrases: [
    "clean energy", "renewable energy", "climate change", "climate crisis", "energy costs", "fossil fuel",
    "energy independence", "clean air", "air quality"] },
  { id: "transportation", label: "transportation", phrases: [
    "public transit", "public transportation", "light rail", "road repair", "traffic congestion", "bike lanes"] },
];

function validTopic(value: unknown): value is StanceTopic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const topic = value as Record<string, unknown>;
  return typeof topic.id === "string" && /^[a-z][a-z-]{0,31}$/.test(topic.id)
    && typeof topic.label === "string" && topic.label.trim() !== "" && topic.label.length <= 40
    && topic.label === topic.label.toLowerCase()
    && Array.isArray(topic.phrases) && topic.phrases.length > 0 && topic.phrases.length <= 40
    && topic.phrases.every((p) => typeof p === "string" && p.trim() !== "" && p === p.toLowerCase().trim() && p.length <= 60);
}

/** Exactly ten topics, no repeated id or label. */
export function validStanceTopics(value: unknown): value is readonly StanceTopic[] {
  return Array.isArray(value) && value.length === 10 && value.every(validTopic)
    && new Set(value.map((t) => t.id)).size === 10 && new Set(value.map((t) => t.label)).size === 10;
}

registerSetting({
  key: STANCE_TOPICS_SETTING, label: "The ten stance topics and their search phrases",
  defaultValue: DEFAULT_STANCE_TOPICS as unknown as SettingValue,
  readerFacing: true, control: "json",
  validate: (value): value is SettingValue => validStanceTopics(value),
});
