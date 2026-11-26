// Turn counts into the board: control limits from the forecast ledger, the
// headline model fit, the staffing outlook, the four rules, and the facts that
// every statement is written from.
import { DEFAULTS, PROBS, Q, MODEL_VERSION } from '../src/model/config.js';
import { fitModel, prepareSeries, drawsOf, CLASS_LABELS } from '../src/model/gibbs.js';
import { summarise } from '../src/model/predict.js';
import { addDays, dateRange, diffDays, holidayOn, dow, FEATURES } from '../src/model/calendar.js';
import { forecastDays, outlookBasis, staffingOutlook, evaluateSignals, buildFacts, statusVs, ROUTINE } from '../src/model/board.js';
import { templateStatements } from '../src/model/statements.js';
import { runFits } from './pool.mjs';
import { log } from './lib.mjs';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Separate usable counts from days with no record or an incomplete record.
 * A missing or incomplete day becomes null — never zero.
 */
export function cleanTotals(raw, start, end) {
  const counts = {};
  const excluded = [];
  const history = Array.from({ length: 7 }, () => []);
  const pct = Math.round(DEFAULTS.incompleteShare * 100);
  for (const date of dateRange(start, end)) {
    const n = raw[date];
    const d = dow(date);
    if (n == null) {
      counts[date] = null;
      excluded.push({ date, recorded: null, reason: 'No records in the source for this day.' });
      continue;
    }
    const ref = history[d].length >= 4 ? median(history[d].slice(-8)) : null;
    if (!holidayOn(date) && ref != null && n < DEFAULTS.incompleteShare * ref) {
      counts[date] = null;
      excluded.push({
        date, recorded: n,
        reason: `Only ${n.toLocaleString('en-US')} calls recorded, under ${pct}% of the usual level for that weekday: treated as an incomplete record, not as demand.`,
      });
      continue;
    }
    counts[date] = n;
    if (!holidayOn(date)) history[d].push(n);
  }
  return { counts, excluded };
}

function weekBlocks(get, ledgerSeries, asOf, nBlocks) {
  const blocks = [];
  for (let k = nBlocks - 1; k >= 0; k--) {
    const end = addDays(asOf, -7 * k);
    const start = addDays(end, -6);
    const origin = addDays(end, -7);
    const vals = dateRange(start, end).map(get);
    const total = vals.every((v) => v != null) ? vals.reduce((a, b) => a + b, 0) : null;
    const e = ledgerSeries ? ledgerSeries[origin] : null;
    const lim = e
      ? { lo: e.w[Q.lo3], q25: e.w[Q.q25], q75: e.w[Q.q75], hi: e.w[Q.hi3] }
      : { lo: null, q25: null, q75: null, hi: null };
    const status = !e ? 'no_limits' : total == null ? 'incomplete' : statusVs(total, lim.lo, lim.hi);
    blocks.push({ start, end, total, ...lim, status });
  }
  const e = ledgerSeries ? ledgerSeries[asOf] : null;
  const next = e
    ? { start: addDays(asOf, 1), end: addDays(asOf, 7), lo: e.w[Q.lo3], q25: e.w[Q.q25], q75: e.w[Q.q75], hi: e.w[Q.hi3] }
    : null;
  return { blocks, next };
}

/** Out-of-sample track record of the forecasts in the ledger. */
function coverageStats(ledgerTotal, get, asOf, days) {
  const horizons = [1, 3, 7, 14];
  const byHorizon = Object.fromEntries(horizons.map((h) => [h, { n: 0, in50: 0, in90: 0, inLimits: 0, below: 0, above: 0 }]));
  const week = { n: 0, in50: 0, in90: 0, inLimits: 0 };
  let firstOrigin = null;
  let lastOrigin = null;
  for (let k = 1; k <= days; k++) {
    const origin = addDays(asOf, -k);
    const e = ledgerTotal[origin];
    if (!e) continue;
    firstOrigin = origin;
    if (!lastOrigin) lastOrigin = origin;
    for (const h of horizons) {
      const day = addDays(origin, h);
      if (diffDays(day, asOf) > 0) continue;
      const a = get(day);
      if (a == null) continue;
      const q = e.h[h - 1];
      const c = byHorizon[h];
      c.n++;
      if (a >= q[Q.q25] && a <= q[Q.q75]) c.in50++;
      if (a >= q[Q.q05] && a <= q[Q.q95]) c.in90++;
      if (a < q[Q.lo3]) c.below++;
      else if (a > q[Q.hi3]) c.above++;
      else c.inLimits++;
    }
    if (diffDays(addDays(origin, 7), asOf) <= 0) {
      const vals = dateRange(addDays(origin, 1), addDays(origin, 7)).map(get);
      if (vals.every((v) => v != null)) {
        const tot = vals.reduce((x, y) => x + y, 0);
        week.n++;
        if (tot >= e.w[Q.q25] && tot <= e.w[Q.q75]) week.in50++;
        if (tot >= e.w[Q.q05] && tot <= e.w[Q.q95]) week.in90++;
        if (tot >= e.w[Q.lo3] && tot <= e.w[Q.hi3]) week.inLimits++;
      }
    }
  }
  return { firstOrigin, lastOrigin, byHorizon, week };
}

/**
 * @param input {{
 *   mode: 'live'|'scenario', scenario?: object, runDate: string, asOf: string,
 *   totals: {[date]: number}, topics: {name: string, calls?: number, daily: {[date]: number}}[],
 *   peakShare: {weekday:number, sat:number, sun:number}, hourlyShares: object,
 *   ledger: object, ledgerPlan: 'daily'|'sparse', source: object, lastRecordAt?: string }}
 */
export async function analyze(input) {
  const { mode, runDate, asOf, ledger, ledgerPlan } = input;
  const D = DEFAULTS;
  const planningDay = addDays(runDate, 1);
  if (diffDays(planningDay, asOf) < 1) throw new Error('Planning day must be after the last complete data day.');
  if (diffDays(planningDay, asOf) + D.outlookDays - 1 > D.horizon) {
    throw new Error(`Data are too old (through ${asOf}) to plan ${planningDay} with a ${D.horizon}-day forecast.`);
  }

  // ---- clean series -------------------------------------------------------
  const coverage = ledgerPlan === 'daily' ? D.coverageDays : 0;
  const firstOrigin = addDays(asOf, -Math.max(coverage + 14, D.displayPastDays + 1, 7 * D.topicBlocks + 7));
  const seriesStart = addDays(firstOrigin, -(D.trainDays - 1));
  const cleanStart = addDays(seriesStart, -70);
  const { counts, excluded } = cleanTotals(input.totals, cleanStart, asOf);
  const getTotal = (d) => (counts[d] == null ? null : counts[d]);
  const topicGet = (t) => (d) => (counts[d] == null ? null : (t.daily[d] == null ? 0 : t.daily[d]));

  // ---- forecast ledger: one as-of fit per origin that is not there yet ------
  if (!ledger.series) ledger.series = {};
  const tasks = [];
  const want = (key, origin, get, trainDays, horizons) => {
    if (!ledger.series[key]) ledger.series[key] = {};
    if (ledger.series[key][origin]) return;
    const dates = dateRange(addDays(origin, -(trainDays - 1)), origin);
    tasks.push({ key, origin, counts: dates.map(get), horizons });
  };
  for (let d = firstOrigin; diffDays(d, asOf) <= 0; d = addDays(d, 1)) want('total', d, getTotal, D.trainDays, D.horizon);
  for (const t of input.topics) {
    const key = `topic:${t.name}`;
    if (ledgerPlan === 'daily') {
      for (let k = 7 * D.topicBlocks; k >= 0; k--) want(key, addDays(asOf, -k), topicGet(t), D.topicTrainDays, 0);
    } else {
      for (let k = D.topicBlocks; k >= 0; k--) want(key, addDays(asOf, -7 * k), topicGet(t), D.topicTrainDays, 0);
    }
  }
  if (tasks.length) {
    log(`forecast ledger: ${tasks.length} as-of fits to run`);
    let done = 0;
    let worstRhat = 0;
    let refits = 0;
    let worstKey = '';
    const t0 = Date.now();
    await runFits(tasks, (r) => {
      ledger.series[r.key][r.origin] = r.entry;
      if (r.maxRhat > worstRhat) { worstRhat = r.maxRhat; worstKey = `${r.key} @ ${r.origin}`; }
      if (r.refit) refits++;
      if (++done % 200 === 0) log(`  ${done}/${tasks.length} fits`);
    });
    log(`forecast ledger: done in ${((Date.now() - t0) / 1000).toFixed(1)} s (${refits} re-run with a longer sampler; worst final R-hat ${worstRhat.toFixed(3)} for ${worstKey})`);
  }
  const LT = ledger.series.total;

  // ---- headline model: the same fit the browser reproduces ------------------
  const trainDates = dateRange(addDays(asOf, -(D.trainDays - 1)), asOf);
  const trainCounts = trainDates.map(getTotal);
  const t0 = Date.now();
  const fit = fitModel(prepareSeries(trainDates, trainCounts), { ...D.sampler, kappa: D.kappa, priors: D.priors });
  log(`headline model: ${fit.S} draws in ${Date.now() - t0} ms, max R-hat ${fit.diag.maxRhat.toFixed(3)}, min ESS ${Math.round(fit.diag.minEss)}`);

  // ---- main chart: six weeks of days against the range expected the day before
  const pastDays = dateRange(addDays(asOf, -(D.displayPastDays - 1)), asOf).map((date) => {
    const e = LT[addDays(date, -1)];
    const calls = getTotal(date);
    const q = e ? e.h[0] : null;
    const hol = holidayOn(date);
    const ex = excluded.find((x) => x.date === date);
    return {
      date, calls,
      recorded: ex ? ex.recorded : calls,
      lo: q ? q[Q.lo3] : null, q25: q ? q[Q.q25] : null, q75: q ? q[Q.q75] : null, hi: q ? q[Q.hi3] : null,
      status: calls == null ? 'incomplete' : !q ? 'no_limits' : statusVs(calls, q[Q.lo3], q[Q.hi3]),
      holiday: hol ? hol.name : null,
      note: ex ? ex.reason : null,
    };
  });
  const day = pastDays[pastDays.length - 1];
  const forecast = forecastDays(fit, addDays(asOf, 1), addDays(asOf, D.horizon));

  // ---- 7-day blocks: all calls and each topic --------------------------------
  const totalWeeks = weekBlocks(getTotal, LT, asOf, D.topicBlocks);
  const week = totalWeeks.blocks[totalWeeks.blocks.length - 1];
  const topics = input.topics.map((t) => {
    const wb = weekBlocks(topicGet(t), ledger.series[`topic:${t.name}`], asOf, D.topicBlocks);
    const latest = wb.blocks[wb.blocks.length - 1];
    return { name: t.name, calls91: t.calls == null ? null : t.calls, blocks: wb.blocks, next: wb.next, latest, status: latest.status };
  });

  // ---- staffing outlook --------------------------------------------------------
  const locked = {};
  const lockedFrom = {};
  for (let i = 0; i < D.outlookDays; i++) {
    const date = addDays(planningDay, i);
    const origin = addDays(date, -D.staffing.lockDays);
    const e = LT[origin];
    if (e) {
      locked[date] = e.h[D.staffing.lockDays - 1][Q.q90];
      lockedFrom[date] = origin;
    }
  }
  const basis = outlookBasis({ fit, planningDay, days: D.outlookDays, rules: D.rules });
  const outlook = staffingOutlook({ basis, locked, peakShare: input.peakShare, st: D.staffing, rules: D.rules });

  // ---- rules, facts, template statements ------------------------------------------
  const signals = evaluateSignals({ day, week, outlook, topics });
  const outside = pastDays.filter((d) => d.status === 'above' || d.status === 'below');
  const nextDay = forecast.find((f) => f.date === planningDay) || null;
  const facts = buildFacts({
    asOf, planningDay, day, week, pastWindow: { days: pastDays.length, outside }, nextDay, outlook, topics, signals, rules: D.rules,
  });

  // ---- posterior summaries and track record ------------------------------------------
  const round = (o, k = 4) => ({ q05: +o.q05.toFixed(k), q50: +o.q50.toFixed(k), q95: +o.q95.toFixed(k) });
  const params = [
    ...CLASS_LABELS.map((label, k) => ({ key: `sigma:${k}`, label: `Ordinary day-to-day noise, ${label}`, unit: 'log scale', ...round(summarise(drawsOf(fit, `sigma:${k}`))) })),
    { key: 'tau', label: 'Daily drift of the level', unit: 'log scale', ...round(summarise(drawsOf(fit, 'tau'))) },
    { key: 'phi', label: 'One-day carry-over', unit: 'share carried to the next day', ...round(summarise(drawsOf(fit, 'phi'))) },
    { key: 'pi', label: 'Share of exceptional days', unit: 'share of days', ...round(summarise(drawsOf(fit, 'pi'))) },
    ...FEATURES.map((f, j) => ({ key: `beta:${j}`, label: f.label, unit: 'effect on log calls', ...round(summarise(drawsOf(fit, `beta:${j}`))) })),
  ];
  const diag = {
    maxRhat: +fit.diag.maxRhat.toFixed(4), minEss: Math.round(fit.diag.minEss), ok: fit.diag.ok,
    rhatLimit: fit.diag.rhatLimit, essLimit: fit.diag.essLimit,
  };

  return {
    schema: 1,
    mode,
    scenario: input.scenario || null,
    generatedAt: new Date().toISOString(),
    runDate, asOf, planningDay,
    lastRecordAt: input.lastRecordAt || null,
    source: input.source,
    model: {
      version: MODEL_VERSION, sampler: D.sampler, ledgerSampler: D.ledgerSampler, kappa: D.kappa,
      priors: D.priors, trainDays: D.trainDays, probs: PROBS,
    },
    series: { start: trainDates[0], end: asOf, counts: trainCounts },
    excluded: excluded.filter((x) => diffDays(x.date, trainDates[0]) >= 0),
    pastDays, forecast,
    weeks: totalWeeks,
    topics,
    staffing: {
      assumptions: D.staffing, rules: D.rules, peakShare: input.peakShare, hourlyShares: input.hourlyShares,
      locked, lockedFrom, outlook,
    },
    signals,
    routine: ROUTINE,
    facts,
    templates: templateStatements(facts),
    posterior: {
      params, diag, nMissing: fit.nMissing,
      exceptionalDays: trainDates.filter((_, t) => fit.zProb[t] > 0.5).length,
    },
    coverage: ledgerPlan === 'daily' ? coverageStats(LT, getTotal, asOf, D.coverageDays) : null,
  };
}

/** Drop ledger entries that no future run can need. */
export function pruneLedger(ledger, asOf, topicNames) {
  const keepTotal = addDays(asOf, -(DEFAULTS.coverageDays + 30));
  const keepTopic = addDays(asOf, -(7 * DEFAULTS.topicBlocks + 14));
  const wanted = new Set(['total', ...topicNames.map((n) => `topic:${n}`)]);
  for (const key of Object.keys(ledger.series)) {
    if (!wanted.has(key)) { delete ledger.series[key]; continue; }
    const cut = key === 'total' ? keepTotal : keepTopic;
    for (const origin of Object.keys(ledger.series[key])) {
      if (origin < cut) delete ledger.series[key][origin];
    }
  }
}
