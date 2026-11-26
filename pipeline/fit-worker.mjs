// Worker thread: one as-of model fit → one forecast-ledger entry.
import { parentPort } from 'node:worker_threads';
import { DEFAULTS, PROBS } from '../src/model/config.js';
import { fitModel, prepareSeries } from '../src/model/gibbs.js';
import { components, quantilesCount, simulateSums, quantileSorted } from '../src/model/predict.js';
import { makeRng, hashSeed } from '../src/model/rng.js';
import { addDays, dateRange } from '../src/model/calendar.js';

export function ledgerEntry({ key, origin, counts, horizons }) {
  const dates = dateRange(addDays(origin, -(counts.length - 1)), origin);
  const data = prepareSeries(dates, counts);
  const seed = hashSeed(DEFAULTS.ledgerSampler.seed, key, origin);
  const base = { seed, kappa: DEFAULTS.kappa, priors: DEFAULTS.priors };
  let fit = fitModel(data, { ...DEFAULTS.ledgerSampler, ...base });
  // A light sampler occasionally fails its convergence check: run it again, longer.
  let refit = false;
  if (!(fit.diag.maxRhat <= 1.1)) {
    refit = true;
    fit = fitModel(data, { chains: 4, warmup: 1000, draws: 2500, ...base });
  }
  const entry = {};
  if (horizons > 0) {
    entry.h = Array.from({ length: horizons }, (_, i) => quantilesCount(components(fit, i + 1), PROBS).map(Math.round));
  }
  const sums = simulateSums(fit, 7, makeRng(hashSeed('week', key, origin)), 20);
  entry.w = PROBS.map((pr) => Math.round(quantileSorted(sums, pr)));
  return { key, origin, entry, refit, maxRhat: fit.diag.maxRhat, minEss: fit.diag.minEss };
}

if (parentPort) {
  parentPort.on('message', (task) => {
    try {
      parentPort.postMessage({ ok: true, result: ledgerEntry(task) });
    } catch (err) {
      parentPort.postMessage({ ok: false, error: `${task.key} @ ${task.origin}: ${err.message}` });
    }
  });
}
