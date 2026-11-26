// Tests for the parts that decide what the board says. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { makeRng, hashSeed } from '../src/model/rng.js';
import { holidayOn, isAfterHoliday, featureIdx, addDays, dateRange, dow, FEATURES } from '../src/model/calendar.js';
import { fitModel, prepareSeries, drawsOf, dayClass } from '../src/model/gibbs.js';
import { components, cdf, quantileLog, quantilesCount, exceedProb, simulateSums, quantileSorted, summarise, normCdf } from '../src/model/predict.js';
import { erlangC, serviceLevel, agentsOnPhones, rosterFor, capacityCalls } from '../src/model/staffing.js';
import { statusVs, outlookBasis, staffingOutlook, evaluateSignals, buildFacts } from '../src/model/board.js';
import { templateStatements } from '../src/model/statements.js';
import { DEFAULTS, PROBS, Q } from '../src/model/config.js';
import { validateStatements } from '../pipeline/narrate.mjs';
import { cleanTotals } from '../pipeline/analyze.mjs';

test('random numbers are reproducible and well behaved', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const xs = Array.from({ length: 5 }, () => a.normal());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b.normal()));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c.normal()));
  const r = makeRng(hashSeed('moments'));
  let s = 0, s2 = 0, g = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) { const z = r.normal(); s += z; s2 += z * z; g += r.gamma(3.5); }
  assert.ok(Math.abs(s / n) < 0.01, 'normal mean');
  assert.ok(Math.abs(s2 / n - 1) < 0.02, 'normal variance');
  assert.ok(Math.abs(g / n - 3.5) < 0.03, 'gamma mean');
});

test('holiday calendar', () => {
  assert.equal(holidayOn('2026-11-26').name, 'Thanksgiving');
  assert.equal(holidayOn('2026-11-27').cls, 'bridge');
  assert.equal(holidayOn('2026-01-19').name, 'Martin Luther King Jr. Day');
  assert.equal(holidayOn('2026-05-25').name, 'Memorial Day');
  assert.equal(holidayOn('2026-09-07').name, 'Labor Day');
  assert.equal(holidayOn('2026-07-04'), null, 'a holiday on a Saturday is not modelled');
  assert.equal(holidayOn('2026-11-24'), null);
  assert.equal(isAfterHoliday('2026-09-08'), true);
  assert.equal(isAfterHoliday('2026-11-27'), false, 'the day after Thanksgiving is its own class');
  assert.equal(dow('2026-11-24'), 2);
  assert.deepEqual(featureIdx('2026-11-23'), [], 'Monday is the reference day');
  assert.deepEqual(featureIdx('2026-11-26'), [2, 6], 'Thursday + major holiday');
  assert.equal(dayClass('2026-11-26'), 2);
  assert.equal(dayClass('2026-11-28'), 1);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(dateRange('2026-12-30', '2027-01-02').length, 4);
});

test('Erlang C matches published values and the roster inverse is exact', () => {
  assert.ok(Math.abs(erlangC(12, 10) - 0.4494) < 0.002);
  assert.ok(Math.abs(erlangC(11, 10) - 0.6821) < 0.002);
  assert.equal(erlangC(10, 10), 1);
  const st = DEFAULTS.staffing;
  const n = agentsOnPhones(1100, st);
  const load = (1100 * st.ahtSec) / 3600;
  assert.ok(serviceLevel(n, load, st.ahtSec, st.answerSec) >= st.slTarget);
  assert.ok(serviceLevel(n - 1, load, st.ahtSec, st.answerSec) < st.slTarget);
  for (const rostered of [20, 57, 143, 260]) {
    const cap = capacityCalls(rostered, 0.094, st);
    assert.ok(rosterFor(cap, 0.094, st) <= rostered);
    assert.ok(rosterFor(cap + 1, 0.094, st) > rostered);
  }
});

// ---- a simulated series with known parameters --------------------------------
const TRUE = { sigma: [0.035, 0.08, 0.09], tau: 0.01, phi: 0.3, level: Math.log(12000) };
const DOW_EFF = [-0.95, 0, -0.04, -0.07, -0.09, -0.15, -0.88];
function simulated(seed, days = 728, end = '2026-11-24') {
  const rng = makeRng(seed);
  const dates = dateRange(addDays(end, -(days - 1)), end);
  let level = TRUE.level, a = 0;
  const counts = dates.map((d) => {
    level += TRUE.tau * rng.normal();
    const k = dayClass(d);
    const special = rng.uniform() < 0.04;
    a = TRUE.phi * a + TRUE.sigma[k] * (special ? 10 : 1) * rng.normal();
    const h = holidayOn(d);
    const hol = h ? { major: -1, federal: -0.65, minor: -0.33, bridge: -0.36 }[h.cls] : isAfterHoliday(d) ? 0.07 : 0;
    return Math.round(Math.exp(level + DOW_EFF[dow(d)] + hol + a));
  });
  return { dates, counts };
}
const settings = { ...DEFAULTS.sampler, kappa: DEFAULTS.kappa, priors: DEFAULTS.priors };
const sim = simulated(7);
const fit = fitModel(prepareSeries(sim.dates, sim.counts), settings);

test('the sampler converges and recovers known parameters', () => {
  assert.ok(fit.diag.maxRhat < 1.02, `R-hat ${fit.diag.maxRhat}`);
  assert.ok(fit.diag.minEss > 300, `ESS ${fit.diag.minEss}`);
  const within = (name, truth, slack = 0) => {
    const v = Float64Array.from(drawsOf(fit, name)).sort();
    const lo = quantileSorted(v, 0.005) - slack, hi = quantileSorted(v, 0.995) + slack;
    assert.ok(truth >= lo && truth <= hi, `${name}: true ${truth} outside [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
  };
  within('sigma:0', TRUE.sigma[0]);
  within('sigma:1', TRUE.sigma[1]);
  within('phi', TRUE.phi);
  within('tau', TRUE.tau, 0.004);
  within(`beta:${FEATURES.findIndex((f) => f.key === 'sat')}`, DOW_EFF[6]);
  within(`beta:${FEATURES.findIndex((f) => f.key === 'fri')}`, DOW_EFF[5]);
});

test('the same seed gives the same fit; a different seed gives a close one', () => {
  const again = fitModel(prepareSeries(sim.dates, sim.counts), settings);
  assert.deepEqual(Array.from(again.muT.slice(0, 50)), Array.from(fit.muT.slice(0, 50)));
  const other = fitModel(prepareSeries(sim.dates, sim.counts), { ...settings, seed: 99 });
  const a = quantilesCount(components(fit, 3), PROBS), b = quantilesCount(components(other, 3), PROBS);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) / v < 0.02, `quantile ${i} moved by more than 2% between seeds`));
});

test('missing days are imputed, never read as zero', () => {
  const counts = [...sim.counts];
  for (const i of [100, 101, 400, counts.length - 3]) counts[i] = null;
  const f = fitModel(prepareSeries(sim.dates, counts), { ...settings, chains: 2, draws: 800 });
  assert.equal(f.nMissing, 4);
  assert.ok(Number.isNaN(f.zProb[100]));
  const base = summarise(drawsOf(fit, 'sigma:0')).q50, withGaps = summarise(drawsOf(f, 'sigma:0')).q50;
  assert.ok(Math.abs(base - withGaps) / base < 0.15, 'four missing days must not change the noise estimate much');
});

test('predictive quantiles and probabilities are consistent', () => {
  const comp = components(fit, 5);
  for (const p of [0.00135, 0.25, 0.5, 0.9, 0.99865]) assert.ok(Math.abs(cdf(comp, quantileLog(comp, p)) - p) < 1e-6);
  const q = quantilesCount(comp, PROBS);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1], 'quantiles increase');
  assert.ok(Math.abs(exceedProb(comp, q[Q.q90], true) - 0.1) < 1e-4, 'P(calls > 90th percentile) = 10% for an ordinary day');
  assert.ok(exceedProb(comp, q[Q.q90]) > 0.1, 'allowing for an exceptional day adds risk');
  assert.ok(Math.abs(normCdf(1.959964) - 0.975) < 1e-6);
  // sums: the middle of the simulated week total is close to the sum of daily medians
  const sums = simulateSums(fit, 7, makeRng(1), 20);
  let med = 0;
  for (let h = 1; h <= 7; h++) med += quantilesCount(components(fit, h), [0.5])[0];
  assert.ok(Math.abs(quantileSorted(sums, 0.5) - med) / med < 0.02);
});

test('forecast ranges are calibrated on simulated data (one-day-ahead, 120 origins)', () => {
  const long = simulated(11, 728 + 120);
  let in50 = 0, inLimits = 0, n = 0;
  const light = { ...DEFAULTS.ledgerSampler, kappa: DEFAULTS.kappa, priors: DEFAULTS.priors };
  for (let k = 0; k < 120; k += 2) {
    const end = long.dates.length - 120 + k;
    const f = fitModel(prepareSeries(long.dates.slice(end - 728, end), long.counts.slice(end - 728, end)), { ...light, seed: k });
    const q = quantilesCount(components(f, 1), PROBS);
    const actual = long.counts[end];
    n++;
    if (actual >= q[Q.q25] && actual <= q[Q.q75]) in50++;
    if (actual >= q[Q.lo3] && actual <= q[Q.hi3]) inLimits++;
  }
  assert.ok(in50 / n > 0.33 && in50 / n < 0.67, `middle half covered ${in50}/${n}`);
  assert.ok(inLimits / n > 0.88, `limits covered ${inLimits}/${n} (about 4% of simulated days are exceptional by design)`);
});

test('rules: a roster below the forecast fires the staffing rule; a roster above does not', () => {
  const st = DEFAULTS.staffing, rules = DEFAULTS.rules;
  const peakShare = { weekday: 0.094, sat: 0.073, sun: 0.067 };
  const planningDay = addDays(fit.lastDate, 3);
  const basis = outlookBasis({ fit, planningDay, days: 7, rules });
  const lockAt = (prob) => Object.fromEntries(basis.map((b) => [b.date, quantilesCount(b.comp, [prob])[0]]));
  const tight = staffingOutlook({ basis, locked: lockAt(0.3), peakShare, st, rules });
  const ample = staffingOutlook({ basis, locked: lockAt(0.97), peakShare, st, rules });
  assert.ok(tight.every((r) => r.status === 'shortfall' && r.addAgents > 0));
  assert.ok(ample.every((r) => r.status !== 'shortfall' && r.addAgents === 0));
  assert.ok(tight[0].shortfallProb > 0.6 && ample[0].shortfallProb < 0.1);
  // adding the suggested agents brings the risk under the threshold
  const fixed = staffingOutlook({ basis: basis.slice(0, 1), locked: lockAt(0.3), peakShare, st, rules, rosterAdjust: tight[0].addAgents });
  assert.ok(fixed[0].shortfallProb < rules.shortfallProb);
  assert.equal(statusVs(5, 1, 4), 'above');
  assert.equal(statusVs(0, 1, 4), 'below');
  assert.equal(statusVs(4, 1, 4), 'within');
  const day = { date: fit.lastDate, calls: 100, lo: 90, hi: 110, status: 'within' };
  const week = { start: addDays(fit.lastDate, -6), end: fit.lastDate, total: 700, lo: 600, hi: 800, status: 'within' };
  const sig = evaluateSignals({ day, week, outlook: tight, topics: [] });
  assert.deepEqual(sig.filter((s) => s.triggered).map((s) => s.id), ['staffing']);
});

test('incomplete records are set aside, not counted as demand', () => {
  const raw = {};
  dateRange('2026-01-01', '2026-03-31').forEach((d) => { raw[d] = dow(d) === 0 || dow(d) === 6 ? 5000 : 12000; });
  raw['2026-03-10'] = 300;      // a feed gap on a Tuesday
  delete raw['2026-03-11'];     // no rows at all
  const { counts, excluded } = cleanTotals(raw, '2026-01-01', '2026-03-31');
  assert.equal(counts['2026-03-10'], null);
  assert.equal(counts['2026-03-11'], null);
  assert.equal(counts['2026-03-12'], 12000);
  assert.deepEqual(excluded.map((e) => e.date), ['2026-03-10', '2026-03-11']);
});

test('statement checks: templates pass; a wrong number, a wrong verdict or a cause fails', () => {
  const file = new URL('../public/data/board.json', import.meta.url);
  if (!fs.existsSync(file)) return; // no board yet: nothing to check against
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  const facts = board.facts;
  const good = templateStatements(facts);
  assert.deepEqual(validateStatements(good, facts), []);
  const wrongNumber = { ...good, volume_title: good.volume_title.replace(facts.volume.latest_day_calls, '99,999') };
  assert.ok(validateStatements(wrongNumber, facts).some((p) => p.includes('99,999')));
  const flipped = facts.volume.latest_day_status.startsWith('within') ? 'above the expected range' : 'within the expected range';
  const wrongVerdict = { ...good, volume_title: good.volume_title.replace(facts.volume.latest_day_status, flipped) };
  assert.ok(validateStatements(wrongVerdict, facts).some((p) => p.includes('exact phrase')));
  const causal = { ...good, staffing_title: `${good.staffing_title} This is because of the weather.` };
  assert.ok(validateStatements(causal, facts).some((p) => p.includes('because')));
  // the page recomputes the same facts from the same inputs
  const rebuilt = buildFacts({
    asOf: board.asOf, planningDay: board.planningDay,
    day: board.pastDays.at(-1), week: board.weeks.blocks.at(-1),
    pastWindow: { days: board.pastDays.length, outside: board.pastDays.filter((d) => d.status === 'above' || d.status === 'below') },
    nextDay: board.forecast.find((f) => f.date === board.planningDay), outlook: board.staffing.outlook,
    topics: board.topics, signals: board.signals, rules: board.staffing.rules,
  });
  assert.deepEqual(rebuilt, facts);
});

// ---- statement rules added after the model comparison -----------------------
const boardFile = new URL('../public/data/board.json', import.meta.url);
const loadBoard = () => JSON.parse(fs.readFileSync(boardFile, 'utf8'));
const NUM_RE = /\d[\d,]*(?:\.\d+)?%?/g;

test('statement checks: an empty "no action" headline and a redundant topics title fail', () => {
  if (!fs.existsSync(boardFile)) return;
  const facts = loadBoard().facts;
  if (facts.overall !== 'no_rule_triggered' || facts.topics.topics_outside_expected_range !== 0) return;
  const good = templateStatements(facts);
  assert.deepEqual(validateStatements(good, facts), []);
  // verdict only
  const empty = { ...good, headline: 'No action needed. No rule was triggered.' };
  assert.ok(validateStatements(empty, facts).some((p) => p.startsWith('headline: after "No action needed."')));
  // the threshold is not evidence: "25%" must not count as the "5%" risk
  const threshold = { ...good, headline: `No action needed. None of the next ${facts.outlook_days} days reaches the ${facts.staffing.action_threshold} action threshold.` };
  assert.ok(validateStatements(threshold, facts).some((p) => p.startsWith('headline: after "No action needed."')));
  // the roster's margin alone is not enough: the latest day's calls must be there too
  const risk = facts.staffing.highest_shortfall_risk;
  const riskOnly = { ...good, headline: `No action needed. The highest shortfall risk is ${risk.shortfall_risk}, on ${risk.day}.` };
  assert.ok(validateStatements(riskOnly, facts).some((p) => p.includes('the latest day’s calls')));
  // both pieces of evidence, each with its day
  const fv = facts.volume;
  const both = { ...good, headline: `No action needed. ${fv.latest_day} had ${fv.latest_day_calls} calls, ${fv.latest_day_status}, and the highest shortfall risk is ${risk.shortfall_risk}, on ${risk.day}.` };
  assert.ok(!validateStatements(both, facts).some((p) => p.startsWith('headline:')), JSON.stringify(validateStatements(both, facts)));
  // "none outside; all within" says the same thing twice
  const v = facts.volume, n = facts.topics.topics_tracked;
  const redundant = { ...good, topics_title: `The 7-day total of ${v.last_7_days_total} calls was ${v.last_7_days_status}. None of the ${n} topics are outside the expected range; all are within the expected range.` };
  assert.ok(validateStatements(redundant, facts).some((p) => p.includes('without also saying')));
  const once = { ...good, topics_title: `The 7-day total of ${v.last_7_days_total} calls was ${v.last_7_days_status}. All ${n} topics are within the expected range.` };
  assert.deepEqual(validateStatements(once, facts), []);
});

test('statement checks: spelled-out numbers are checked too', () => {
  if (!fs.existsSync(boardFile)) return;
  const facts = loadBoard().facts;
  const present = new Set((JSON.stringify(facts).match(NUM_RE) || []));
  const word = Object.entries({ eleven: '11', twelve: '12', nine: '9', eight: '8', six: '6' }).find(([, d]) => !present.has(d));
  if (!word) return;
  const st = { ...templateStatements(facts) };
  st.staffing_title = `${st.staffing_title.replace(/\.$/, '')}, ${word[0]} in all.`;
  assert.ok(validateStatements(st, facts).some((p) => p.includes(`"${word[0]}"`)));
});

test('statement checks: all calls above the range with no topic outside it can still pass', () => {
  if (!fs.existsSync(boardFile)) return;
  const facts = structuredClone(loadBoard().facts);
  if (facts.topics.topics_outside_expected_range !== 0) return;
  facts.volume.last_7_days_status = 'above the expected range';
  assert.deepEqual(validateStatements(templateStatements(facts), facts), []);
});

test('facts and template sentences hold up when the day, the week and the roster are missing', () => {
  if (!fs.existsSync(boardFile)) return;
  const b = loadBoard();
  const day = { ...b.pastDays.at(-1), calls: null, lo: null, hi: null, status: 'incomplete' };
  const week = { ...b.weeks.blocks.at(-1), total: null, status: 'incomplete' };
  const outlook = b.staffing.outlook.map((r) => ({ ...r, rostered: null, shortfallProb: null, surplusProb: null, status: 'no_roster', addAgents: null }));
  const signals = evaluateSignals({ day, week, outlook, topics: b.topics });
  const facts = buildFacts({
    asOf: b.asOf, planningDay: b.planningDay, day, week, pastWindow: { days: b.pastDays.length, outside: [] },
    nextDay: null, outlook, topics: b.topics, signals, rules: b.staffing.rules,
  });
  assert.equal(facts.volume.last_7_days_total, null, 'a week with a missing day has no total, not "0"');
  assert.ok(!/incomplete the|no_limits/.test(JSON.stringify(facts)), 'status phrases are words, not codes');
  const tpl = templateStatements(facts);
  for (const [k, s] of Object.entries(tpl)) assert.ok(!/null|undefined|NaN/.test(s), `${k} prints a missing value: ${s}`);
  assert.deepEqual(validateStatements(tpl, facts), []);
});
