// Posterior predictive calculations. For one future day the predictive
// distribution of the log count is a mixture of normals over posterior draws,
// so quantiles and exceedance probabilities are computed exactly (to bisection
// tolerance) rather than read off noisy simulated tails. Sums over several days
// have no closed form and are simulated.

import { fromLog, dayClass, N_CLASSES } from './gibbs.js';
import { addDays, featureIdx } from './calendar.js';

// Complementary error function, fractional error below 1.2e-7 everywhere
// (Chebyshev fit, Numerical Recipes).
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);

/** Evenly spaced subset of posterior draws (keeps every chain represented). */
export function thinIndex(S, maxDraws = 1500) {
  const n = Math.min(S, maxDraws);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = Math.floor((i * S) / n);
  return idx;
}

/**
 * Predictive components for the day h steps after the last fitted day.
 * Per retained draw: mean, sd on an ordinary day, sd on an exceptional day, pi.
 * The carry-over a_T decays by phi each day; the level drifts by tau each day.
 */
export function components(fit, h, maxDraws = 1500) {
  const idx = thinIndex(fit.S, maxDraws);
  const n = idx.length;
  const k2 = fit.kappa * fit.kappa;
  const classes = [];
  for (let j = 1; j <= h; j++) classes.push(dayClass(addDays(fit.lastDate, j)));
  const feat = featureIdx(addDays(fit.lastDate, h));
  const mean = new Float64Array(n), sdOrd = new Float64Array(n), sdSpec = new Float64Array(n), pi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = idx[i];
    const phi = fit.phi[s];
    let xb = 0;
    for (let k = 0; k < feat.length; k++) xb += fit.beta[s * fit.p + feat[k]];
    let v = 0, w = 1; // w = phi^(2 (h - j)), built from the target day backwards
    for (let j = h; j >= 1; j--) { v += w * fit.sigma2[s * N_CLASSES + classes[j - 1]]; w *= phi * phi; }
    mean[i] = fit.muT[s] + xb + Math.pow(phi, h) * fit.aT[s];
    const varOrd = h * fit.tau2[s] + v;
    sdOrd[i] = Math.sqrt(varOrd);
    sdSpec[i] = Math.sqrt(varOrd + (k2 - 1) * fit.sigma2[s * N_CLASSES + classes[h - 1]]);
    pi[i] = fit.pi[s];
  }
  return { n, mean, sdOrd, sdSpec, pi };
}

/** P(log count <= x). ordinaryOnly ignores the exceptional-day component. */
export function cdf(comp, x, ordinaryOnly = true) {
  let acc = 0;
  if (ordinaryOnly) {
    for (let i = 0; i < comp.n; i++) acc += normCdf((x - comp.mean[i]) / comp.sdOrd[i]);
  } else {
    for (let i = 0; i < comp.n; i++) {
      acc += (1 - comp.pi[i]) * normCdf((x - comp.mean[i]) / comp.sdOrd[i]) +
        comp.pi[i] * normCdf((x - comp.mean[i]) / comp.sdSpec[i]);
    }
  }
  return acc / comp.n;
}

/** Quantile on the log scale, by bisection on the mixture CDF. */
export function quantileLog(comp, prob, ordinaryOnly = true) {
  let lo = Infinity, hi = -Infinity;
  const sd = ordinaryOnly ? comp.sdOrd : comp.sdSpec;
  for (let i = 0; i < comp.n; i++) {
    lo = Math.min(lo, comp.mean[i] - 9 * sd[i]);
    hi = Math.max(hi, comp.mean[i] + 9 * sd[i]);
  }
  for (let it = 0; it < 44; it++) {
    const mid = 0.5 * (lo + hi);
    if (cdf(comp, mid, ordinaryOnly) < prob) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Predictive quantiles of the count for an ordinary day. */
export function quantilesCount(comp, probs, ordinaryOnly = true) {
  return probs.map((pr) => fromLog(quantileLog(comp, pr, ordinaryOnly)));
}

/** P(count > threshold), by default including the chance of an exceptional day. */
export function exceedProb(comp, thresholdCount, ordinaryOnly = false) {
  return 1 - cdf(comp, Math.log(thresholdCount + 0.5), ordinaryOnly);
}

/**
 * Simulated totals over the next H days (ordinary days only), keeping the
 * day-to-day carry-over. Returns a sorted Float64Array of simulated sums.
 */
export function simulateSums(fit, H, rng, reps = 20, maxDraws = 1500) {
  const idx = thinIndex(fit.S, maxDraws);
  const dates = [];
  for (let j = 1; j <= H; j++) dates.push(addDays(fit.lastDate, j));
  const classes = dates.map(dayClass);
  const feats = dates.map(featureIdx);
  const xb = new Float64Array(H), sig = new Float64Array(H);
  const sums = new Float64Array(idx.length * reps);
  let k = 0;
  for (let i = 0; i < idx.length; i++) {
    const s = idx[i];
    const tau = Math.sqrt(fit.tau2[s]);
    const phi = fit.phi[s];
    for (let h = 0; h < H; h++) {
      let v = 0;
      for (let j = 0; j < feats[h].length; j++) v += fit.beta[s * fit.p + feats[h][j]];
      xb[h] = v;
      sig[h] = Math.sqrt(fit.sigma2[s * N_CLASSES + classes[h]]);
    }
    for (let r = 0; r < reps; r++) {
      let level = fit.muT[s], a = fit.aT[s], total = 0;
      for (let h = 0; h < H; h++) {
        level += tau * rng.normal();
        a = phi * a + sig[h] * rng.normal();
        total += fromLog(level + xb[h] + a);
      }
      sums[k++] = total;
    }
  }
  sums.sort();
  return sums;
}

export function quantileSorted(sorted, prob) {
  const pos = prob * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Posterior median and central 90% interval of a draws array. */
export function summarise(arr, transform = (v) => v) {
  const v = Float64Array.from(arr, transform).sort();
  return { q05: quantileSorted(v, 0.05), q50: quantileSorted(v, 0.5), q95: quantileSorted(v, 0.95) };
}
