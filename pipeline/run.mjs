// Daily pipeline: fetch → analyse → write statements → publish board.json.
//
//   node pipeline/run.mjs               full run (needs OPENAI_API_KEY)
//   node pipeline/run.mjs --no-llm      template statements only
//   node pipeline/run.mjs --offline     reuse the last fetched data (data/raw)
//   node pipeline/run.mjs --run-date=YYYY-MM-DD
import { DEFAULTS } from '../src/model/config.js';
import { addDays, dateRange, holidayOn } from '../src/model/calendar.js';
import {
  p, DATASET, readJson, writeJson, nyToday, log,
  fetchDailyTotals, fetchLastTimestamp, fetchTopTopics, fetchTopicDaily, fetchHourly,
} from './lib.mjs';
import { analyze, pruneLedger } from './analyze.mjs';
import { narrate } from './narrate.mjs';

const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};
const runDate = argValue('run-date') || nyToday();
const RAW = p('data', 'raw', 'fetch.json');

/** Share of a day's calls in each hour, by day type; the peak share drives staffing. */
function hourlyProfile(rows) {
  const acc = { weekday: new Array(24).fill(0), sat: new Array(24).fill(0), sun: new Array(24).fill(0) };
  for (const r of rows) acc[r.dow === 0 ? 'sun' : r.dow === 6 ? 'sat' : 'weekday'][r.hh] += r.n;
  const hourlyShares = {};
  const peakShare = {};
  for (const [type, arr] of Object.entries(acc)) {
    const total = arr.reduce((a, b) => a + b, 0);
    if (!total) throw new Error(`No intraday data for ${type}.`);
    hourlyShares[type] = arr.map((v) => +(v / total).toFixed(5));
    peakShare[type] = Math.max(...hourlyShares[type]);
  }
  return { hourlyShares, peakShare };
}

async function fetchAll() {
  log(`fetching from NYC Open Data (${DATASET.id})`);
  const lastRecordAt = await fetchLastTimestamp(addDays(runDate, -10));
  if (!lastRecordAt) throw new Error('The source returned no records for the last 10 days.');
  // The newest date is complete only if its records run to the end of the day.
  const lastDate = lastRecordAt.slice(0, 10);
  const asOf = lastRecordAt.slice(11, 13) >= '23' ? lastDate : addDays(lastDate, -1);
  log(`latest record ${lastRecordAt} → last complete day ${asOf}`);

  const totals = await fetchDailyTotals(addDays(asOf, -1010));
  for (const d of Object.keys(totals)) if (d > asOf) delete totals[d];
  // Candidate topics by recent volume; keep those answered every day of the week
  // in workable numbers (the model works on log counts, so near-empty days break it).
  const candidates = await fetchTopTopics(addDays(asOf, -90), asOf, DEFAULTS.topicCandidates);
  const daily = await fetchTopicDaily(candidates.map((t) => t.name), addDays(asOf, -450));
  const yearDays = dateRange(addDays(asOf, -363), asOf).filter((d) => totals[d] != null);
  const p05 = (name) => {
    const v = yearDays.map((d) => daily[name][d] || 0).sort((a, b) => a - b);
    return v[Math.floor(0.05 * (v.length - 1))];
  };
  const top = candidates.filter((t) => p05(t.name) >= DEFAULTS.topicMinDaily).slice(0, DEFAULTS.topicCount);
  log(`topics: ${candidates.length} candidates, ${top.length} kept (5th percentile of daily calls at least ${DEFAULTS.topicMinDaily})`);
  const profStart = addDays(asOf, -55);
  const holidays = dateRange(profStart, asOf).filter((d) => holidayOn(d));
  const hourly = await fetchHourly(profStart, asOf, holidays);
  const fetched = {
    fetchedAt: new Date().toISOString(), lastRecordAt, asOf, totals,
    topics: top.map((t) => ({ ...t, daily: daily[t.name] })),
    hourly, profileWindow: { start: profStart, end: asOf, excluded: holidays },
  };
  writeJson(RAW, fetched);
  return fetched;
}

const fetched = args.has('--offline') ? readJson(RAW) : await fetchAll();
if (!fetched) throw new Error('No cached fetch found; run once without --offline.');
const { asOf } = fetched;
log(`run date ${runDate}, data through ${asOf}, ${Object.keys(fetched.totals).length} days of totals, ${fetched.topics.length} topics`);

const ledgerFile = p('data', 'ledger.json');
const ledger = readJson(ledgerFile, { note: 'As-of forecasts. Each entry was produced with data up to its origin date only.', series: {} });

const board = await analyze({
  mode: 'live',
  runDate, asOf,
  totals: fetched.totals,
  topics: fetched.topics,
  ...hourlyProfile(fetched.hourly),
  ledger, ledgerPlan: 'daily',
  lastRecordAt: fetched.lastRecordAt,
  source: {
    ...DATASET,
    fetchedAt: fetched.fetchedAt,
    profileWindow: fetched.profileWindow,
    caveat: 'NYC notes that since March 2020 this dataset does not fully represent agent-handled calls: actual calls handled are higher.',
  },
});

pruneLedger(ledger, asOf, fetched.topics.map((t) => t.name));
writeJson(ledgerFile, ledger);

board.narrative = await narrate(board.facts, board.templates, {
  useLlm: !args.has('--no-llm'),
  auditDir: p('public', 'data', 'audit'),
  auditId: `live-${runDate}`,
  context: { mode: 'live', runDate, asOf: board.asOf, planningDay: board.planningDay },
});

writeJson(p('public', 'data', 'board.json'), board);
const fired = board.signals.filter((s) => s.triggered).map((s) => s.id);
log(`board written: data through ${board.asOf}, planning ${board.planningDay}, rules fired: ${fired.length ? fired.join(', ') : 'none'}, statements: ${board.narrative.source}`);
