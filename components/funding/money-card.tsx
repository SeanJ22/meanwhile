"use client";

import { useState } from "react";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import {
  campaignMoneySources, federalAwardSources,
  type CampaignMoneyView, type CampaignPeriodView, type FederalAwardsView,
} from "@/lib/funding/money-card-view";
import { shareWords } from "@/lib/funding/concentration";
import { formatDateLong } from "@/lib/text/format-date";
import { readerText } from "@/lib/text/reader-names";

const VISIBLE_ROWS = 8;
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (amount: number) => Number.isInteger(amount) ? whole.format(amount) : cents.format(amount);

function smallShare(period: CampaignPeriodView): string | null {
  const { individual, individualSmall } = period;
  return individual && individualSmall && individual.amount > 0 && individualSmall.amount >= 0 && individualSmall.amount <= individual.amount
    ? shareWords(individualSmall.amount, individual.amount) : null;
}

function Named({ title, rows }: { title: string; rows: CampaignPeriodView["donors"] }) {
  return rows.length ? <p className="t-detail text-voice"><span className="font-medium">{title}:</span> {rows.map(row => `${readerText(row.name, "name")} ${money(row.amount)}`).join(" · ")}</p> : null;
}

/** One summary and one table for a person or committee: a row per filing period. */
export function CampaignMoneyCard({ view, id }: { view: CampaignMoneyView; id: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? view.periods : view.periods.slice(0, VISIBLE_ROWS);
  const several = new Set(view.periods.map(period => period.filerName)).size > 1;
  const cell = (stated: { amount: number } | null) => stated ? money(stated.amount) : "Not stated";
  return <div className="space-y-2" data-money-card="campaign">
    <p className="t-body text-paper">{view.summary}</p>
    <div className="overflow-x-auto">
      <table className="w-full t-detail text-left">
        <caption className="sr-only">Campaign money by filing period</caption>
        <thead><tr className="text-paper-dim"><th scope="col" className="py-1 pr-3 font-medium">Period</th><th scope="col" className="py-1 pr-3 font-medium">Raised</th>
          <th scope="col" className="py-1 pr-3 font-medium">Spent</th><th scope="col" className="py-1 pr-3 font-medium">From donors giving $200 or less</th><th scope="col" className="py-1 font-medium">Filing</th></tr></thead>
        {shown.map(period => <tbody key={period.key} data-campaign-period={period.key} className="border-t border-current/10">
          <tr>
            <th scope="row" className="py-1 pr-3 text-left font-normal">{period.label}{several && <span className="block text-voice">{readerText(period.filerName, "name")}</span>}</th>
            <td className="py-1 pr-3 font-mono tabular-nums">{cell(period.raised)}</td>
            <td className="py-1 pr-3 font-mono tabular-nums">{cell(period.spent)}</td>
            <td className="py-1 pr-3 font-mono tabular-nums">{smallShare(period) ?? "Not stated"}</td>
            <td className="py-1"><a className="text-link" href={period.filingUrl} rel="noopener noreferrer" target="_blank">Filing</a></td>
          </tr>
          {(period.donors.length > 0 || period.committees.length > 0) && <tr><td colSpan={5} className="pb-2 space-y-1">
            <Named title="Donors over $200" rows={period.donors} />
            <Named title="Committees and organizations" rows={period.committees} />
          </td></tr>}
        </tbody>)}
      </table>
    </div>
    {view.periods.length > VISIBLE_ROWS && <button type="button" className="t-caption text-link" onClick={() => setAll(value => !value)}>
      {all ? "Show fewer periods" : `Show ${view.periods.length - VISIBLE_ROWS} earlier periods`}</button>}
    <CardSourcesContribution id={`${id}:campaign-money`} sources={campaignMoneySources(view)} />
  </div>;
}

/** One summary and one table of awards for a government or body. */
export function FederalAwardsCard({ view, id }: { view: FederalAwardsView; id: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? view.awards : view.awards.slice(0, VISIBLE_ROWS);
  return <div className="space-y-2" data-money-card="federal">
    <p className="t-body text-paper">{readerText(view.summary, "sentence", view.agencies.map(agency => agency.name))}</p>
    <div className="overflow-x-auto">
      <table className="w-full t-detail text-left">
        <caption className="sr-only">Federal awards received</caption>
        <thead><tr className="text-paper-dim"><th scope="col" className="py-1 pr-3 font-medium">Award</th><th scope="col" className="py-1 pr-3 font-medium">Amount</th>
          <th scope="col" className="py-1 pr-3 font-medium">Date</th><th scope="col" className="py-1 font-medium">Agency</th></tr></thead>
        <tbody>{shown.map(award => <tr key={award.awardId} data-federal-award={award.awardId} className="border-t border-current/10 align-top">
          <th scope="row" className="py-1 pr-3 text-left font-normal">{readerText(award.title, "title")}</th>
          <td className="py-1 pr-3 font-mono tabular-nums">{money(award.amount)}</td>
          <td className="py-1 pr-3">{formatDateLong(award.date) ?? award.date}</td>
          <td className="py-1">{readerText(award.agency, "name")}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {view.awards.length > VISIBLE_ROWS && <button type="button" className="t-caption text-link" onClick={() => setAll(value => !value)}>
      {all ? "Show fewer awards" : `Show ${view.awards.length - VISIBLE_ROWS} more awards`}</button>}
    <CardSourcesContribution id={`${id}:federal-awards`} sources={federalAwardSources(view)} />
  </div>;
}
