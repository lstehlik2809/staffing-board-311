// Invented-data scenarios for usability tests ("read, judge, decide").
// Each is a fixed, seeded simulation run through exactly the same analysis and
// statement-writing code as the live board. Run by hand when the scenarios or
// the model change:  node pipeline/scenarios.mjs [--no-llm]
import { makeRng, hashSeed } from '../src/model/rng.js';
import { addDays, dateRange, dow, holidayOn, isAfterHoliday } from '../src/model/calendar.js';
import { p, writeJson, readJson, log } from './lib.mjs';
import { analyze } from './analyze.mjs';
import { narrate } from './narrate.mjs';

const AS_OF = '2026-03-10';   // a Tuesday, with no holiday nearby
const RUN_DATE = '2026-03-12';
const START = addDays(AS_OF, -1000);
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const SEED = seedArg ? +seedArg.split("=")[1] : 2;
const DRY = process.argv.includes('--dry');

const TOPICS = [
  ['Housing repairs', 310], ['Request status', 250], ['Towed vehicles', 170], ['Noise', 150], ['Staff feedback', 200],
  ['Parking permits', 130], ['Legal advice line', 160], ['Benefits enquiries', 140], ['Bulky waste collection', 120], ['Street lighting', 70],
  ['Blocked access', 85], ['Police non-emergency', 90], ['Appliance removal', 85], ['Shelter enquiries', 80], ['Directory enquiries', 95],
  ['Housing court', 75], ['Public transport', 70], ['Collection schedule', 65], ['Dangerous conditions', 60], ['Missed collection', 75],
  ['Animal welfare', 55], ['Heating and hot water', 110], ['Tenant support', 100], ['Council tax', 90],
];

const DOW_EFFECT = [-0.96, 0, -0.04, -0.07, -0.09, -0.155, -0.88]; // Sunday..Saturday, log scale
const HOL_EFFECT = { major: -0.99, federal: -0.65, minor: -0.33, bridge: -0.36 };

/** Simulate one daily series from the model's own generative story. */
function simulate(dates, rng, { level0, tau, sigWd, sigWe, phi, weekendScale = 1, poisson = false }) {
  let level = Math.log(level0);
  let a = 0;
  const out = {};
  for (const d of dates) {
    const wd = dow(d);
    const weekend = wd === 0 || wd === 6;
    const hol = holidayOn(d);
    level += tau * rng.normal();
    a = phi * a + (hol ? 0.09 : weekend ? sigWe : sigWd) * rng.normal();
    let mu = level + DOW_EFFECT[wd] * (weekend ? weekendScale : 1) + a;
    if (hol) mu += HOL_EFFECT[hol.cls];
    else if (isAfterHoliday(d)) mu += 0.07;
    let n = Math.exp(mu);
    if (poisson) n += Math.sqrt(n) * rng.normal(); // counting noise for small topics
    out[d] = Math.max(1, Math.round(n));
  }
  return out;
}

function baseData() {
  const dates = dateRange(START, AS_OF);
  const totals = simulate(dates, makeRng(hashSeed('scenario', SEED, 'total')), { level0: 12400, tau: 0.008, sigWd: 0.033, sigWe: 0.075, phi: 0.26 });
  const topics = TOPICS.map(([name, base], i) => {
    const rng = makeRng(hashSeed('scenario', SEED, 'topic', i));
    const daily = simulate(dates, rng, { level0: base, tau: 0.006, sigWd: 0.07, sigWe: 0.1, phi: 0.2, weekendScale: 0.45 + 0.3 * rng.uniform(), poisson: true });
    return { name, daily };
  });
  return { totals, topics };
}

const scale = (series, from, to, f) => {
  for (const d of dateRange(from, to)) series[d] = Math.round(series[d] * (typeof f === 'function' ? f(d) : f));
};

const SCENARIOS = [
  {
    id: 'quiet',
    title: 'a quiet day',
    summary: 'nothing has changed, so no rule should fire.',
    description: 'Simulated calls for an invented contact centre in which nothing has changed.',
    apply: () => {},
  },
  {
    id: 'jump',
    title: 'a one-day jump',
    summary: 'the latest day is well above its expected range and one topic has risen.',
    description: 'Simulated calls for an invented contact centre, with the latest day raised by about a quarter and one topic raised for three days.',
    apply: ({ totals, topics }) => {
      scale(totals, AS_OF, AS_OF, 1.26);
      scale(topics.find((t) => t.name === 'Heating and hot water').daily, addDays(AS_OF, -2), AS_OF, 2.4);
    },
  },
  {
    id: 'rise',
    title: 'a sustained rise',
    summary: 'demand has run about 16% higher for a week, after the rosters were fixed.',
    description: 'Simulated calls for an invented contact centre, with all calls raised by about 16% over the last seven days and two topics raised more.',
    apply: ({ totals, topics }) => {
      scale(totals, addDays(AS_OF, -6), AS_OF, 1.16);
      scale(topics.find((t) => t.name === 'Benefits enquiries').daily, addDays(AS_OF, -6), AS_OF, 1.6);
      scale(topics.find((t) => t.name === 'Council tax').daily, addDays(AS_OF, -6), AS_OF, 1.5);
    },
  },
];

const useLlm = !process.argv.includes('--no-llm');
const liveBoard = readJson(p('public', 'data', 'board.json'));
const peakShare = { weekday: 0.094, sat: 0.073, sun: 0.067 };
const hourlyShares = liveBoard ? liveBoard.staffing.hourlyShares : null;
const index = [];

for (const sc of SCENARIOS) {
  log(`scenario "${sc.id}"`);
  const data = baseData();
  sc.apply(data);
  for (const t of data.topics) {
    const last = dateRange(addDays(AS_OF, -90), AS_OF);
    t.calls = last.reduce((s, d) => s + t.daily[d], 0);
  }
  const meta = { id: sc.id, title: sc.title, summary: sc.summary, description: sc.description };
  const board = await analyze({
    mode: 'scenario', scenario: meta,
    runDate: RUN_DATE, asOf: AS_OF,
    totals: data.totals, topics: data.topics,
    peakShare, hourlyShares,
    ledger: { series: {} }, ledgerPlan: 'sparse',
    source: { name: 'Invented data', publisher: 'Simulated for usability tests', caveat: 'Nothing here describes a real organisation.' },
  });
  if (DRY) {
    const f = board.signals.filter((s) => s.triggered).map((s) => s.id);
    const worst = board.staffing.outlook.reduce((a, r) => Math.max(a, r.shortfallProb), 0);
    console.log(`SEED ${SEED} ${sc.id}: fired [${f.join(', ')}] worst shortfall ${(worst * 100).toFixed(0)}%`);
    continue;
  }
  board.narrative = await narrate(board.facts, board.templates, {
    useLlm,
    auditDir: p('public', 'data', 'audit'),
    auditId: `scenario-${sc.id}`,
    context: { mode: 'scenario', scenario: sc.id, runDate: RUN_DATE, asOf: AS_OF, planningDay: board.planningDay },
  });
  writeJson(p('public', 'data', 'scenarios', `${sc.id}.json`), board);
  index.push({ id: sc.id, title: sc.title, summary: sc.summary });
  const fired = board.signals.filter((s) => s.triggered).map((s) => s.id);
  log(`  rules fired: ${fired.length ? fired.join(', ') : 'none'}; statements: ${board.narrative.source}`);
}
if (!DRY) {
  writeJson(p('public', 'data', 'scenarios', 'index.json'), index, true);
  log('scenarios written');
}
