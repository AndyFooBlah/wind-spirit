/** Category checkers. Each returns named 0/1 checks; the case score is their mean. */
import type { Order } from '@wind-spirit/sim';
import type { EvalCase } from './corpus.js';
import type { Parsed } from '../parse.js';
import type { HostAnswer } from '@wind-spirit/sim';

const MODERN = /\b(computer|internet|percent|technology|economy|strategy|optimi[sz]e|data|algorithm|metric|kpi|resource management|json)\b/i;
const FOOD: Order['task'][] = ['forage', 'hunt', 'fish', 'farm'];
const VENTURE: Order['task'][] = ['explore', 'colonize', 'raid', 'envoy', 'expedition'];

export type Checks = Record<string, boolean>;

export function scoreDecision(c: EvalCase, p: Parsed): Checks {
  const f = c.facts; const assigned = p.orders.filter(o => o.task !== 'colonize').reduce((a, o) => a + o.workers, 0);
  const food = p.orders.filter(o => FOOD.includes(o.task)).reduce((a, o) => a + o.workers, 0);
  const has = (t: Order['task']) => p.orders.some(o => o.task === t);
  const checks: Checks = {
    valid: p.dropped.length === 0,
    withinBudget: assigned <= f.free,
    usesMostAdults: assigned >= Math.floor(f.free * 0.7),
    journalInCharacter: p.journal.length >= 60 && !MODERN.test(p.journal) && !p.journal.trim().startsWith('{'),
  };
  const winter = f.season === 3;
  switch (c.category) {
    case 'routine':
      // A village with a year of stores may spend a season building; the food-share rule only binds while stores are shorter than that.
      if (f.foodWeeks < 52) checks.feedsFirst = food >= Math.ceil(assigned * (winter ? 0.5 : 0.3));
      checks.investsWhenAble = !f.canInvest || f.hungry > 0 || p.orders.some(o => ['craft', 'build', 'research', 'clear'].includes(o.task));
      if (f.season === 0 && c.view.plots.cleared > 0) checks.plantsInSpring = has('farm');           // only when there is something to plant
      if (f.season === 2 && c.view.plots.planted > 0) checks.harvestsInAutumn = has('farm');          // only when there is something to harvest
      break;
    case 'crisis':
      if (c.expect.winterPrep) { checks.winterPrep = p.orders.some(o => o.task === 'hunt' || o.task === 'fish') && (has('gather') || has('craft') || food >= Math.ceil(assigned * 0.6)); }
      else { checks.foodShare = food >= Math.ceil(assigned * Number(c.expect.foodShare ?? 0.6)); checks.noVentures = !p.orders.some(o => VENTURE.includes(o.task) && o.task !== 'expedition'); if (f.season === 0 && c.view.plots.cleared > 0) checks.keepsFarming = has('farm'); }
      break;
    case 'firstspring':
      checks.feedsFirst = food >= Math.ceil(f.free * Number(c.expect.foodShare ?? 0.34));
      checks.noneStarve = food > 0;
      break;
    case 'expansion': {
      const col = has('colonize');
      checks.colonizeCall = c.expect.colonize === 'either' ? true : c.expect.colonize === 'yes' ? col : !col;
      checks.noRaidOnFriends = !has('raid');
      break;
    }
    case 'spirit':
      if (c.expect.winterPrep) checks.winterPrep = p.orders.some(o => o.task === 'hunt' || o.task === 'fish') && (has('gather') || has('craft') || food >= Math.ceil(assigned * 0.5));
      if (c.expect.stillPlants && c.view.plots.cleared > 0) checks.stillPlants = has('farm');
      if (c.expect.researches) checks.researches = has('research');
      if (c.expect.replies) checks.replies = !!p.replyToSpirit && p.replyToSpirit.length > 20;
      break;
    default: break;
  }
  return checks;
}

export function scoreHost(c: EvalCase, answer: HostAnswer, journal: string): Checks {
  const allowed = String(c.expect.answer ?? '').split('|');
  const checks: Checks = { answerClass: allowed.includes(answer.kind), journalInCharacter: journal.length >= 30 && !MODERN.test(journal) };
  if (c.expect.keepsReserve && answer.kind === 'counter') { const give = Object.values(answer.give).reduce((a, b) => a + b, 0); checks.keepsReserve = give < c.facts.storesGrain - c.facts.pop * 8 * 1000 + 1; }
  return checks;
}

export function scoreDream(c: EvalCase, reply: string): Checks {
  const v = c.view; const facts = [v.village.name, ...v.stores.slice(0, 6).map(s => s.name), ...v.recipes.slice(0, 6).map(r => r.name), ...v.villages.map(x => x.name)].filter(Boolean);
  const mentions = facts.some(n => reply.toLowerCase().includes(n.toLowerCase().split(' ')[0]));
  const checks: Checks = {
    prose: !reply.trim().startsWith('{') && !reply.includes('"orders"') && reply.length >= 40 && reply.length <= 1500,
    inCharacter: !MODERN.test(reply),
    answersQuestion: !c.expect.answersQuestion || reply.length >= 60,
  };
  if (c.expect.mentionsFact) checks.mentionsFact = mentions;
  return checks;
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const checksScore = (c: Checks): number => mean(Object.values(c).map(b => (b ? 1 : 0)));
