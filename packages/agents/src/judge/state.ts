/**
 * State for the judgment questions: only the facts each judgment turns on, as named JSON fields.
 * Deliberately far smaller than statePrompt's ~2,900 tokens — a narrow question does not need the order menu,
 * the commodity gazetteer or the site list, and paying for them twice is most of what makes a hybrid path expensive.
 */
import type { Mandate } from '@wind-spirit/sim';
import { strengthReckoning } from '../prompt.js';
import type { VillageView } from '../view.js';
import type { CredibilityInput, HostInput, VerdictInput } from './types.js';

/** Structurally what both judges accept as state: plain JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

const piety = (t: number[]): string => (t[0] < 350 ? 'skeptical of spirits' : t[0] > 650 ? 'deeply pious' : 'open to the spirit world');

/** What the chief knows that bears on whether a whisper is worth believing. */
export function credibilityState(i: CredibilityInput): JsonObject {
  const v = i.view;
  return {
    whisper: i.whisper,
    village: v.village.name,
    chief_is: piety(v.village.chiefTraits),
    now: { year: v.year, season: v.season, week: v.week },
    land: { cleared_plots: v.plots.cleared, planted_plots: v.plots.planted, free_plots: v.plots.free },
    food: { weeks_of_stores: v.foodWeeks, hungry_people_now: v.people.hungryNow, eats_per_week: v.yields.need },
    stores: v.stores.map(s => `${s.units} ${s.name}${s.food ? ' (food)' : ''}`),
    people: { total: v.people.total, adults: v.people.adults, deaths_this_season: v.people.deathsRecent },
    rumors_we_have_noticed: v.rumors,
    what_the_spirit_said_before_and_what_came_of_it: v.spirit.chronicle,
    how_we_regard_the_spirit: v.spirit.attitude,
    what_happened_since_we_last_decided: v.events,
  };
}

/** A claim that has come due, and what the village saw in the meantime. */
export function verdictState(i: VerdictInput): JsonObject {
  const v = i.view;
  return {
    the_claim: i.claim,
    what_happened_since: i.since,
    now: { year: v.year, season: v.season },
    food: { weeks_of_stores: v.foodWeeks, hungry_people_now: v.people.hungryNow },
    land: { cleared_plots: v.plots.cleared, planted_plots: v.plots.planted },
    people: { total: v.people.total, deaths_this_season: v.people.deathsRecent },
    stores: v.stores.map(s => `${s.units} ${s.name}${s.food ? ' (food)' : ''}`),
  };
}

const goods = (g: Record<string, number>, cname: (id: string) => string): string[] =>
  Object.entries(g).map(([c, q]) => `${Math.round(q / 1000)} ${cname(c)}`);

/** Us, them, and what they are asking for. */
export function hostState(i: HostInput): JsonObject {
  const v = i.view; const m: Mandate = i.mandate;
  const them = v.villages.find(x => x.name === i.from);
  return {
    they_are: i.from,
    they_offer: goods(m.offer ?? {}, i.cname),
    they_ask_for: goods(m.want ?? {}, i.cname),
    they_offer_to_teach_us: m.transfer ? i.rname(m.transfer) : null,
    they_back_the_ask_with_a_threat_of_war: !!m.threat,
    how_many_of_them_are_here: i.partySize ?? null,
    our_warriors_judge_them: i.partySize ? strengthReckoning(i.partySize, v.people.adults) : null,
    they_are_refugees_asking_to_join_us: m.refuge ?? null,
    their_message: m.message ?? null,
    us: {
      village: v.village.name,
      people: v.people.total,
      grown_men_and_women: v.people.adults,
      weeks_of_food_stored: v.foodWeeks,
      stores: v.stores.map(s => `${s.units} ${s.name}${s.food ? ' (food)' : ''}`),
      chief_is: piety(v.village.chiefTraits),
    },
    them_as_we_know_them: them
      ? { people_when_last_seen: them.sizeSeen, years_since_seen: them.lastSeenYearsAgo, our_trades: them.trades, their_raids_on_us: them.raids, grudge: them.grudge, kin: them.kin || 'not kin' }
      : 'strangers we have no dealings with',
  };
}
